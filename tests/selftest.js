'use strict';

/**
 * 端到端自测（不需要 Electron / GitHub）。
 * 运行：npm run selftest
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert');

const { Logger } = require('../src/main/logger');
const { SettingsStore } = require('../src/main/settings');
const { GitRunner } = require('../src/main/git');
const { AppServices } = require('../src/main/services/app');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, '.test-data');

let passed = 0;
let failed = 0;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    results.push(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    results.push(`  ✗ ${name}\n      ${err.message}`);
    if (process.env.RMH_DEBUG) console.error(err);
  }
}

function readZipEntries(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('缺少 ZIP 结束记录');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const names = [];
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录损坏');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

async function main() {
  await fsp.rm(DATA, { recursive: true, force: true });
  await fsp.mkdir(DATA, { recursive: true });

  const logger = new Logger(path.join(DATA, 'test.log'));
  const settings = new SettingsStore({ dir: DATA, safeStorage: null, logger });
  settings.load();
  const git = new GitRunner(logger);
  const app = new AppServices({ settings, logger, git, dataDir: DATA, fetchImpl: globalThis.fetch });

  console.log('\nRoboMaster 作业管理 · 自测\n');

  await test('演示模式：组长登录', async () => {
    const res = await app.demoLogin({ login: 'rm-leader' });
    assert.strictEqual(res.user.role, 'leader', '应为组长');
    assert.strictEqual(res.mode, 'demo');
  });

  await test('演示模式：发现 3 个周次', async () => {
    const data = await app.listWeeks();
    assert.deepStrictEqual(data.weeks.map((w) => w.week), ['week01', 'week02', 'week03']);
    assert.strictEqual(data.weeks[0].title, '环境搭建与基本功');
    assert.strictEqual(data.groups.length, 3);
  });

  await test('组员端：按分组读取 README', async () => {
    await app.demoLogin({ login: 'alice' });
    const week = await app.getWeek('week01');
    assert.ok(week.readme.includes('环境搭建'), '应包含通用说明');
    assert.ok(week.groupReadme.includes('OpenCV'), '算法组应有分组说明');
    assert.strictEqual(week.group, 'algo');
    assert.strictEqual(week.mine.submitted, true);
    assert.strictEqual(week.mine.evaluation.score, 92);
    assert.ok(week.mine.files.length >= 3, '应列出文件');
    assert.ok(!week.mine.files.some((f) => f.rel.endsWith('evaluation.json')), '系统文件不应出现在文件列表');
  });

  await test('组员端：未读成绩通知', async () => {
    const n = await app.getNotifications();
    assert.ok(n.unreadCount >= 1, '演示数据应有一条未读成绩');
    const item = n.items.find((i) => i.week === 'week01');
    assert.strictEqual(item.score, 92);
    assert.ok(item.comment.length > 10);
  });

  await test('组员端：标记已读后不再提醒', async () => {
    const n = await app.getNotifications();
    await app.markNotificationsRead([...n.items, ...(n.announcements || [])].map((i) => i.key));
    const after = await app.getNotifications();
    assert.strictEqual(after.unreadCount, 0);
  });

  await test('组员端：文件夹上传（自动以账号命名）', async () => {
    const src = path.join(DATA, 'incoming-src');
    await fsp.mkdir(path.join(src, 'src'), { recursive: true });
    await fsp.writeFile(path.join(src, 'README.md'), '# 我的 week02 作业\n\n灯条检测。\n');
    await fsp.writeFile(path.join(src, 'src', 'detect.py'), 'print("armor")\n');
    await fsp.writeFile(path.join(src, 'report.md'), '完成度 80%\n');

    const res = await app.submitFolder('week02', src);
    assert.strictEqual(res.fileCount, 3);
    assert.strictEqual(res.login, 'alice');

    const week = await app.getWeek('week02');
    assert.strictEqual(week.mine.submitted, true);
    assert.strictEqual(week.mine.fileCount, 3);
    assert.ok(week.mine.uploadedAt, '应有上传时间');
    assert.ok(
      fs.existsSync(path.join(DATA, 'demo-repo', 'week02', '算法组', 'submissions', 'alice', 'submission.json')),
      '应生成 submission.json（按组隔离）',
    );
    assert.ok(
      fs.existsSync(path.join(DATA, 'demo-repo', 'week02', '算法组', 'submissions', 'alice', 'src', 'detect.py')),
    );
  });

  await test('组员端：不能访问组长接口', async () => {
    let error = null;
    try {
      await app.adminOverview('week01');
    } catch (err) {
      error = err;
    }
    assert.ok(error && error.status === 403, '应返回 403');
  });

  await test('组长端：看板统计三组提交率与平均分', async () => {
    await app.demoLogin({ login: 'rm-leader' });
    const data = await app.adminOverview('week01');
    assert.strictEqual(data.groups.length, 3);
    const algo = data.groups.find((g) => g.id === 'algo');
    assert.strictEqual(algo.total, 3);
    assert.strictEqual(algo.submitted, 3);
    assert.strictEqual(algo.avgScore != null, true);
    assert.ok(data.rows.length >= 7);
    const bob = data.rows.find((r) => r.login === 'bob' && r.week === 'week01');
    assert.strictEqual(bob.score, 85);
  });

  await test('组长端：批改生成 evaluation.json', async () => {
    const res = await app.grade({ week: 'week02', member: 'alice', score: 91.5, comment: '检测速度不错，注意误检率。' });
    assert.strictEqual(res.evaluation.score, 91.5);
    const file = path.join(DATA, 'demo-repo', 'week02', '算法组', 'submissions', 'alice', 'evaluation.json');
    assert.ok(fs.existsSync(file));
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(payload.score, 91.5);
    assert.strictEqual(payload.gradedBy, 'rm-leader');
    assert.ok(payload.gradedAt);
  });

  await test('组长端：批改后组员收到新提醒', async () => {
    await app.demoLogin({ login: 'alice' });
    const n = await app.getNotifications();
    const item = n.items.find((i) => i.week === 'week02');
    assert.ok(item, '应有 week02 成绩');
    assert.strictEqual(item.score, 91.5);
    assert.strictEqual(item.read, false);
    assert.ok(n.unreadCount >= 1);
  });

  await test('组长端：一键导出 ZIP（含文件清单）', async () => {
    await app.demoLogin({ login: 'rm-leader' });
    const out = path.join(DATA, 'export', 'week02-alice.zip');
    const res = await app.exportSubmission('week02', 'alice', out);
    assert.ok(fs.existsSync(out));
    assert.ok(res.files >= 4);
    const names = readZipEntries(out);
    assert.ok(names.some((n) => n.includes('README.md')), 'ZIP 应包含 README.md');
    assert.ok(names.some((n) => n.includes('evaluation.json')), 'ZIP 应包含批改结果');
    assert.ok(names.every((n) => n.startsWith('week02-alice/')), 'ZIP 应有顶层目录');
  });

  await test('队长端：布置作业并发布 week04', async () => {
    await app.demoLogin({ login: 'diana' });
    await app.redeem('1145141919810');
    const next = await app.nextWeek();
    assert.strictEqual(next.week, 'week04', '下一个周次应为 week04');

    const res = await app.saveWeek({
      week: 'week04',
      title: '联调与性能优化',
      deadline: '2026-12-01T23:59:00+08:00',
      tags: ['联调', '性能'],
      readme: '# Week 04\n\n完成整车联调，输出测试报告。\n',
      groups: { algo: '## 算法组补充\n\n检测帧率 ≥ 60 FPS。', mech: '', embedded: '' },
    });
    assert.ok(res.publishedAt, '应返回发布时间');
    assert.strictEqual(res.week, 'week04');

    await app.demoLogin({ login: 'alice' });
    const week = await app.getWeek('week04');
    assert.ok(week.readme.includes('整车联调'));
    assert.ok(week.groupReadme.includes('60 FPS'), '算法组补充应可读取');
    assert.strictEqual(week.title, '联调与性能优化');

    const weeks = await app.listWeeks();
    assert.ok(weeks.weeks.find((w) => w.week === 'week04'), '新周次应出现在列表中');
    assert.ok(fs.existsSync(path.join(DATA, 'demo-repo', 'week04', 'submissions', '.gitkeep')), '应创建 submissions 目录');
  });

  await test('组员端：收到新作业发布通知', async () => {
    await app.demoLogin({ login: 'alice' });
    const n = await app.getNotifications();
    assert.ok(Array.isArray(n.announcements), '应返回 announcements');
    const item = n.announcements.find((a) => a.week === 'week04');
    assert.ok(item, '应包含 week04 发布通知');
    assert.strictEqual(item.read, false);
    assert.ok(item.title.includes('联调'));
  });

  await test('组员不能发布作业', async () => {
    await app.demoLogin({ login: 'alice' });
    let error = null;
    try {
      await app.saveWeek({ week: 'week05', readme: 'x' });
    } catch (err) {
      error = err;
    }
    assert.ok(error && error.status === 403);
  });

  await test('分组权限：组组长只能管理本组', async () => {
    await app.demoLogin({ login: 'rm-leader' });
    await app.setMember('eric', { group: 'mech', role: 'leader' });

    await app.demoLogin({ login: 'eric' });
    const currentWeekName = await app.currentWeek();
    const overview = await app.adminOverview(currentWeekName);
    assert.strictEqual(overview.scope, 'mech');
    assert.strictEqual(overview.groups.length, 1);
    assert.strictEqual(overview.groups[0].id, 'mech');
    assert.ok(overview.rows.every((r) => r.group === 'mech'), '只应看到机械组成员');

    // 历史周同样按组隔离
    const historyOverview = await app.adminOverview('week01');
    assert.strictEqual(historyOverview.scope, 'mech', '历史周也只显示本组');
    assert.strictEqual(historyOverview.groups.length, 1);

    let error = null;
    try {
      await app.grade({ week: 'week01', member: 'alice', score: 90, comment: '越权' });
    } catch (e) {
      error = e;
    }
    assert.ok(error && error.status === 403, '不能批改其他组');

    const res = await app.grade({ week: 'week01', member: 'carol', score: 88, comment: '机械组批改' });
    assert.strictEqual(res.evaluation.gradedBy, 'eric');

    let error2 = null;
    try {
      await app.setMember('alice', { group: 'algo' });
    } catch (e) {
      error2 = e;
    }
    assert.ok(error2 && error2.status === 403, '不能修改其他组成员');
  });

  await test('查看作业：当期按组、往期全队', async () => {
    await app.demoLogin({ login: 'eric' });
    const currentWeekName = await app.currentWeek();
    const currentView = await app.getWeekView(currentWeekName);
    assert.strictEqual(currentView.isCurrent, true);
    assert.strictEqual(currentView.groups.length, 1, '组组长当前周只看本组');
    assert.strictEqual(currentView.groups[0].id, 'mech');

    const historyView = await app.getWeekView('week01');
    assert.strictEqual(historyView.isHistory, true);
    assert.strictEqual(historyView.groups.length, 1, '组组长历史周只看本组');
    assert.strictEqual(historyView.groups[0].id, 'mech');

    await app.demoLogin({ login: 'rm-leader' });
    const capView = await app.getWeekView(currentWeekName);
    assert.strictEqual(capView.groups.length, 0, '未分配小组的组长也看不到小组作业');

    // 组员也可以查看：无论当前周还是历史周都只看本组
    await app.demoLogin({ login: 'alice' });
    const memberCurrent = await app.getWeekView(currentWeekName);
    assert.strictEqual(memberCurrent.groups.length, 1, '组员当前周只看本组');
    assert.strictEqual(memberCurrent.groups[0].id, 'algo');
    assert.strictEqual(memberCurrent.canEdit, false);
    const memberHistory = await app.getWeekView('week01');
    assert.strictEqual(memberHistory.groups.length, 1, '组员历史周只看本组');
    assert.strictEqual(memberHistory.groups[0].id, 'algo');
  });

  await test('未分组：不能提交，组长收到进组通知', async () => {
    await app.demoLogin({ login: 'rm-leader' });
    await app.setMember('grace', { group: null });

    await app.demoLogin({ login: 'grace' });
    const week = await app.getWeek('week02');
    assert.strictEqual(week.needsGroup, true);
    assert.strictEqual(week.canSubmit, false);

    const tmp = path.join(DATA, 'grace-src');
    await fsp.mkdir(tmp, { recursive: true });
    await fsp.writeFile(path.join(tmp, 'a.txt'), 'x');
    let error = null;
    try {
      await app.submitFolder('week02', tmp);
    } catch (e) {
      error = e;
    }
    assert.ok(error && error.status === 403, '未分组不能提交');

    await app.demoLogin({ login: 'rm-leader' });
    const n = await app.getNotifications();
    assert.ok(Array.isArray(n.joinRequests));
    assert.ok(n.joinRequests.some((j) => j.login === 'grace'), '组长应收到未进组通知');
  });

  await test('成员管理：分配分组 / 移除成员', async () => {
    await app.demoLogin({ login: 'rm-leader' });
    const before = await app.listMembers();
    assert.ok(before.members.find((m) => m.login === 'grace'));
    await app.setMember('grace', { group: 'embedded' });
    const after = await app.listMembers();
    const grace = after.members.find((m) => m.login === 'grace');
    assert.strictEqual(grace.group, 'embedded');
    assert.strictEqual(grace.pendingGroup, false);

    await app.setMember('grace', { group: null });
    const again = await app.listMembers();
    assert.strictEqual(again.members.find((m) => m.login === 'grace').pendingGroup, true);

    // 只有队长可以删除成员：组长尝试删除应被拒绝
    let removeErr = null;
    try {
      await app.removeMember('grace');
    } catch (e) {
      removeErr = e;
    }
    assert.ok(removeErr && removeErr.status === 403, '组长不能删除成员');
    assert.ok((await app.listMembers()).members.find((m) => m.login === 'grace'), 'grace 应仍然存在');
  });

  await test('兑换码：错误码被拒绝', async () => {
    await app.demoLogin({ login: 'alice' });
    let error = null;
    try {
      await app.redeem('wrong-code');
    } catch (err) {
      error = err;
    }
    assert.ok(error && error.status === 400);
  });

  await test('兑换码：pxr20080819Q 提升为组长', async () => {
    await app.demoLogin({ login: 'bob' });
    assert.strictEqual(app.session.user.role, 'member');
    await app.redeem('pxr20080819Q');
    assert.strictEqual(app.session.user.role, 'leader');
    const members = await app.listMembers();
    assert.strictEqual(members.members.find((m) => m.login === 'bob').role, 'leader');
  });

  await test('成绩越界校验', async () => {
    await app.demoLogin({ login: 'rm-leader' });
    let error = null;
    try {
      await app.grade({ week: 'week01', member: 'alice', score: 120, comment: 'x' });
    } catch (err) {
      error = err;
    }
    assert.ok(error && error.status === 400);
  });

  await test('角色持久化：重新登录后仍为组长', async () => {
    await app.demoLogin({ login: 'bob' });
    assert.strictEqual(app.session.user.role, 'leader', 'bob 应仍是组长');
    const cached = app.cachedRole('bob');
    assert.ok(cached && cached.role === 'leader', '本地角色缓存应记录组长');
  });

  await test('账号保存：加密存储、可读取、可移除', async () => {
    const { CredentialCipher } = require('../src/main/credentials');
    const { AccountStore } = require('../src/main/accounts');
    const cipher = new CredentialCipher(null);
    const token = 'ghp_test_token_1234567890';
    const encrypted = cipher.encrypt(token);
    assert.ok(encrypted.startsWith('aes:'), '无 safeStorage 时应使用 AES');
    assert.ok(!encrypted.includes(token), '密文不应包含明文');
    assert.strictEqual(cipher.decrypt(encrypted), token);

    const store = new AccountStore({ settings, cipher, logger });
    store.upsert({ login: 'alice', name: '陈思远', avatarUrl: 'https://x/a.png' }, token);
    assert.strictEqual(store.tokenFor('alice'), token);
    const pub = store.list()[0];
    assert.strictEqual(pub.login, 'alice');
    assert.strictEqual(pub.hasToken, true);
    assert.strictEqual(pub.tokenEnc, undefined, '对外列表不应包含密文');
    assert.strictEqual(store.latest().login, 'alice');
    store.remove('alice');
    assert.strictEqual(store.tokenFor('alice'), null);
    assert.strictEqual(store.list().length, 0);
  });

  await test('账号保存：自动登录开关可关闭', async () => {
    settings.data.autoLogin = false;
    const restored = await app.restore();
    assert.strictEqual(restored, null);
    settings.data.autoLogin = true;
  });

  await test('队长兑换码：1145141919810 获得全队权限', async () => {
    await app.demoLogin({ login: 'diana' });
    const res = await app.redeem('1145141919810');
    assert.strictEqual(res.role, 'captain');
    assert.strictEqual(app.session.user.role, 'captain');

    const overview = await app.adminOverview('week01');
    assert.strictEqual(overview.scope, null);
    assert.strictEqual(overview.groups.length, 3, '队长应看到三个小组');
    const capView = await app.getWeekView('week01');
    assert.strictEqual(capView.groups.length, 3, '队长可查看全部小组作业');

    // 队长可以任命组长
    await app.setMember('bob', { role: 'leader', group: 'algo' });
    const members = await app.listMembers();
    assert.strictEqual(members.members.find((m) => m.login === 'bob').role, 'leader');

    // 队长账号不可被管理（组组长尝试）
    await app.demoLogin({ login: 'eric' });
    let err = null;
    try {
      await app.setMember('diana', { group: 'mech' });
    } catch (e) {
      err = e;
    }
    assert.ok(err && err.status === 403);

    // 组长不能管理队长
    await app.demoLogin({ login: 'rm-leader' });
    let err2 = null;
    try {
      await app.removeMember('diana');
    } catch (e) {
      err2 = e;
    }
    assert.ok(err2 && err2.status === 403);

    // 角色持久化
    await app.demoLogin({ login: 'diana' });
    assert.strictEqual(app.session.user.role, 'captain');
  });

  await test('队长：可改自己组别，不可改自己角色', async () => {
    await app.demoLogin({ login: 'diana' });
    assert.strictEqual(app.session.user.role, 'captain');

    await app.setMember('diana', { group: 'mech' });
    const members = await app.getMembers();
    assert.strictEqual(members.members.diana.group, 'mech', '队长应能修改自己的组别');
    assert.strictEqual(members.members.diana.role, 'captain', '角色应保持不变');

    let err = null;
    try {
      await app.setMember('diana', { role: 'leader' });
    } catch (e) {
      err = e;
    }
    assert.ok(err && (err.status === 400 || err.status === 403), '不能修改自己的角色');

    const overview = await app.adminOverview('week01');
    assert.ok(!overview.pendingMembers.some((p) => p.login === 'diana'), '队长不应出现在待分组列表');
    const n = await app.getNotifications();
    assert.ok(!n.joinRequests.some((j) => j.login === 'diana'), '队长不应出现在进组通知');

    await app.setMember('diana', { group: null });
  });

  await test('当前周由队长管理，历史周同样按组隔离', async () => {
    const current = await app.currentWeek();
    assert.strictEqual(current, 'week04', '最新发布的周次应为当前周');

    // 组长（总组长）不能修改当前周
    await app.demoLogin({ login: 'rm-leader' });
    let err = null;
    try {
      await app.saveWeek({ week: 'week04', title: '组长越权', readme: 'x' });
    } catch (e) {
      err = e;
    }
    assert.ok(err && err.status === 403, '当前周只允许队长编辑');

    // 历史周：组员只看本组记录
    await app.demoLogin({ login: 'alice' });
    const history = await app.getWeek('week01');
    assert.strictEqual(history.history, true);
    assert.strictEqual(history.isCurrent, false);
    assert.ok(history.submissions.length >= 1, '历史周应包含本组提交');
    assert.ok(history.submissions.every((s) => s.group === 'algo'), '历史周不应包含其他组');
    assert.strictEqual(history.groupsContent.length, 1, '历史周只包含本组作业内容');
    assert.strictEqual(history.groupsContent[0].id, 'algo');

    // 当前周仍按组隔离
    const currentWeekData = await app.getWeek('week04');
    assert.strictEqual(currentWeekData.history, false);

    // 看板应返回全部周次，供切换查看
    await app.demoLogin({ login: 'rm-leader' });
    const overview = await app.adminOverview('week01');
    assert.ok(overview.weeks.includes('week01'), '应包含 week01');
    assert.ok(overview.weeks.includes('week04'), '应包含 week04');
    assert.ok(overview.weeks.length >= 3, '应返回全部周次');
  });

  await test('路径穿越防护', async () => {
    const { safeJoin } = require('../src/main/util');
    let error = null;
    try {
      safeJoin(DATA, '../../etc/passwd');
    } catch (err) {
      error = err;
    }
    assert.ok(error, '应拒绝穿越路径');
  });

  await test('Markdown 渲染器（前端模块）可用', async () => {
    const mod = await import('../src/renderer/js/markdown.js');
    const html = mod.renderMarkdown('# 标题\n\n**粗体** 与 `代码`\n\n- [x] 完成\n- [ ] 待办\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    assert.ok(html.includes('<h1>标题</h1>'));
    assert.ok(html.includes('<strong>粗体</strong>'));
    assert.ok(html.includes('<code>代码</code>'));
    assert.ok(html.includes('<table>'));
    assert.ok(html.includes('task-box'));
  });

  await test('Markdown 默认转义 HTML（防注入）', async () => {
    const mod = await import('../src/renderer/js/markdown.js');
    const html = mod.renderMarkdown('<script>alert(1)</script>');
    assert.ok(!html.includes('<script>'), '不应保留 script 标签');
    assert.ok(html.includes('&lt;script&gt;'));
  });

  console.log(results.join('\n'));
  console.log(`\n结果：${passed} 通过，${failed} 失败\n`);

  await fsp.rm(DATA, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
