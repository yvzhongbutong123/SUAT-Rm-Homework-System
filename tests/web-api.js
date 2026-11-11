'use strict';

/**
 * 浏览器模式核心链路测试（无需 Electron / 浏览器）：
 * 静态页面、演示登录、分片上传、ZIP 下载。
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const { Logger } = require('../src/main/logger');
const { SettingsStore } = require('../src/main/settings');
const { GitRunner } = require('../src/main/git');
const { AppServices } = require('../src/main/services/app');
const { LocalServer } = require('../src/main/server');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, '.web-test');
const KEY = 'web-test-key';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function main() {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });

  const logger = new Logger(path.join(DATA, 'web.log'));
  const settings = new SettingsStore({ dir: DATA, safeStorage: null, logger });
  settings.load();
  const git = new GitRunner(logger);
  const services = new AppServices({ settings, logger, git, dataDir: DATA, fetchImpl: globalThis.fetch });
  const server = new LocalServer({
    app: services,
    logger,
    staticDir: path.join(ROOT, 'src', 'renderer'),
    version: '1.0.0',
  });
  server.setApiKey(KEY);
  await server.start();
  const base = `http://127.0.0.1:${server.port}`;
  const auth = { 'x-rmh-key': KEY };

  console.log('\n浏览器模式接口测试\n');

  const html = await fetch(`${base}/?k=${KEY}`);
  const text = await html.text();
  check('静态页面可访问', html.status === 200 && text.includes('RoboMaster'));
  check('页面含模块脚本', text.includes('js/app.js'));

  const me = await (await fetch(`${base}/api/me`, { headers: auth })).json();
  check('未登录返回演示账号列表', me.ok && me.data.demoUsers.length >= 2);

  const login = await (
    await fetch(`${base}/api/demo/login`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'alice' }),
    })
  ).json();
  check('演示登录成功', login.ok && login.data.user.login === 'alice');

  const begin = await (
    await fetch(`${base}/api/upload/begin`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' })
  ).json();
  check('创建上传会话', begin.ok && /^[a-f0-9]{16}$/.test(begin.data.session));
  const session = begin.data.session;

  const chunks = [
    ['README.md', '# 浏览器上传测试\n'],
    ['src/main.py', 'print("hello")\n'],
  ];
  for (const [rel, content] of chunks) {
    const res = await fetch(`${base}/api/upload/chunk?session=${session}&rel=${encodeURIComponent(rel)}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/octet-stream' },
      body: Buffer.from(content),
    });
    const json = await res.json();
    check(`上传文件 ${rel}`, json.ok === true, json.error);
  }

  const commit = await (
    await fetch(`${base}/api/upload/commit`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, week: 'week02' }),
    })
  ).json();
  check('提交入库', commit.ok && commit.data.fileCount === 2, commit.error);
  check('文件落盘', fs.existsSync(path.join(DATA, 'demo-repo', 'week02', '算法组', 'submissions', 'alice', 'src', 'main.py')));

  // 组长导出
  await fetch(`${base}/api/demo/login`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'rm-leader' }),
  });
  const zipRes = await fetch(`${base}/api/admin/export?week=week02&member=alice&k=${KEY}`);
  const buf = Buffer.from(await zipRes.arrayBuffer());
  check('ZIP 下载返回 200', zipRes.status === 200);
  check('ZIP 内容有效', buf.length > 100 && buf[0] === 0x50 && buf[1] === 0x4b);
  check('下载头含文件名', String(zipRes.headers.get('content-disposition')).includes('week02-alice.zip'));

  const badKey = await fetch(`${base}/api/me?k=wrong`);
  check('错误 Key 被拒绝', badKey.status === 403);

  console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
  await server.stop();
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
