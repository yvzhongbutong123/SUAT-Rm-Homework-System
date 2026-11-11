'use strict';

/**
 * 前端集成冒烟测试：用 jsdom 加载真实页面逻辑 + 真实本地 API（演示模式）。
 * 验证：登录、路由、看板、批改弹窗、成员页、设置页、成绩 Toast。
 * 运行：node tests/frontend-smoke.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, '.smoke-data');

const { JSDOM } = require('jsdom');
const { Logger } = require('../src/main/logger');
const { SettingsStore } = require('../src/main/settings');
const { GitRunner } = require('../src/main/git');
const { AppServices } = require('../src/main/services/app');
const { LocalServer } = require('../src/main/server');

const pkg = require('../package.json');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const errors = [];

function check(name, cond, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function becomeDemoUser(dom, login) {
  await dom.window.fetch(`/api/demo/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-rmh-key': dom.window.__key },
    body: JSON.stringify({ login }),
  }).catch(() => {});
}

async function main() {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });

  const logger = new Logger(path.join(DATA, 'smoke.log'));
  const settings = new SettingsStore({ dir: DATA, safeStorage: null, logger });
  settings.load();
  const git = new GitRunner(logger);
  const services = new AppServices({ settings, logger, git, dataDir: DATA, fetchImpl: globalThis.fetch });

  const server = new LocalServer({
    app: services,
    logger,
    staticDir: path.join(ROOT, 'src', 'renderer'),
    version: pkg.version,
  });
  const key = 'smoke-key';
  server.setApiKey(key);
  const port = await server.start();
  const base = `http://127.0.0.1:${port}`;

  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: base + '/?k=' + key,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // 暴露给页面逻辑的全局对象
  window.__key = key;
  for (const k of ['window', 'document', 'location', 'history', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'CustomEvent', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    try {
      global[k] = window[k];
    } catch {
      /* ignore readonly */
    }
  }
  global.window = window;
  global.document = window.document;
  global.location = window.location;
  global.history = window.history;
  global.self = window;

  // 让相对路径 fetch 指向本地服务
  const realFetch = globalThis.fetch;
  window.fetch = (input, init) => realFetch(new URL(String(input), base), init);
  global.fetch = window.fetch;

  // Electron preload 的模拟实现
  window.rmh = {
    apiKey: key,
    platform: 'win32',
    getPathForFile: () => '',
    pathInfo: async () => ({ exists: false }),
    pickFolder: async () => ({ canceled: true }),
    uploadFolder: async () => ({ ok: false, error: 'smoke: not implemented' }),
    uploadFiles: async () => ({ ok: false, error: 'smoke: not implemented' }),
    exportSubmission: async () => ({ ok: false, canceled: true }),
    showItemInFolder: () => {},
    openExternal: () => {},
    openDataDir: () => {},
    getInfo: async () => ({ version: pkg.version, platform: 'win32', dataDir: DATA }),
    window: {
      minimize: () => {},
      toggleMaximize: async () => false,
      isMaximized: async () => false,
      close: () => {},
      onMaximized: () => () => {},
    },
  };

  window.addEventListener('error', (e) => errors.push(String(e.error || e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

  console.log('\n前端集成冒烟测试\n');

  // 加载应用
  await import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'js', 'app.js')).href);
  await wait(1500);

  check('启动后渲染登录页', !!document.querySelector('.login__title'), document.body.textContent.slice(0, 120));
  check('登录页提供演示账号按钮', document.querySelectorAll('[data-demo]').length >= 2);
  check(
    'Token 与兑换码合并为单一表单',
    !document.querySelector('#login-tabs') && !!document.querySelector('#code-field') && !document.querySelector('#code-field').hidden,
  );

  // 以组长身份进入
  const leaderBtn = document.querySelector('[data-demo="rm-leader"]');
  check('存在组长演示入口', !!leaderBtn);
  leaderBtn.click();
  await wait(2500);
  check('组长端外壳渲染', !!document.querySelector('.shell .sidebar'));
  check('进度看板渲染', document.body.textContent.includes('提交率'));
  check('三组卡片渲染', document.querySelectorAll('.group-card').length === 3);
  check('看板周次下拉包含全部周次', document.querySelectorAll('#week-filter option').length >= 4);
  check('看板默认选中当前周', document.querySelector('#week-filter')?.value === 'week03');
  check('导航含成员管理', document.body.textContent.includes('成员管理'));

  // 打开批改弹窗
  const gradeBtn = document.querySelector('[data-grade]');
  check('看板提供批改入口', !!gradeBtn);
  if (gradeBtn) {
    gradeBtn.click();
    await wait(500);
    check('批改弹窗打开', !!document.querySelector('.modal .grade-score__value'));
    check('批改弹窗含快捷评语', document.querySelectorAll('.quick-comment').length >= 3);
    document.querySelector('.modal-backdrop')?.remove();
  }

  // 提交与批改页
  const subsNav = document.querySelector('[data-nav="#/leader/submissions"]');
  check('存在提交与批改导航', !!subsNav);
  subsNav.click();
  await wait(1500);
  check('提交表格渲染', document.querySelectorAll('table.table tbody tr').length > 0);
  check('工具栏筛选存在', !!document.querySelector('#week-filter'));

  // 查看作业
  const weeksNav = document.querySelector('[data-nav="#/leader/weeks"]');
  check('存在查看作业导航', !!weeksNav);
  weeksNav.click();
  await wait(1600);
  check('查看作业页渲染', document.body.textContent.includes('作业内容'));
  check('查看作业有小组标签', document.querySelectorAll('#view-tabs [data-vt]').length >= 1);

  // 成员管理
  document.querySelector('[data-nav="#/leader/members"]').click();
  await wait(1500);
  check('成员表格渲染', document.body.textContent.includes('成员与权限'));
  check('分组下拉存在', document.querySelectorAll('[data-group]').length >= 5);

  // 设置页
  document.querySelector('[data-nav="#/settings"]').click();
  await wait(1500);
  check('设置页渲染', document.body.textContent.includes('Git 通道'));
  check('Git 通道状态显示', /Windows Git|WSL Git|不可用/.test(document.body.textContent));
  check('账号徽章显示组长', /组长/.test(document.querySelector('#app .card .badge')?.textContent || ''));
  check(
    '待分组红点在 0 时隐藏',
    document.querySelector('[data-nav-badge="pending"]')?.hidden === true,
  );

  // 布置作业
  const assignNav = document.querySelector('[data-nav="#/leader/assignment"]');
  check('存在布置作业导航', !!assignNav);
  assignNav.click();
  await wait(1800);
  check('布置作业页渲染', document.body.textContent.includes('发布设置'));
  check('Markdown 编辑器存在', !!document.querySelector('#md-input'));
  check('周次选择存在', !!document.querySelector('#week-select'));
  check('布置作业有小组选择', !!document.querySelector('#edit-target'));
  check('小组选项存在', document.querySelectorAll('#edit-target option').length >= 1);

  document.querySelector('#new-week').click();
  await wait(1200);
  const ta = document.querySelector('#md-input');
  ta.value = '# Week 04 · 集成测试作业\n\n这是由测试发布的作业要求。';
  ta.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  document.querySelector('#title-input').value = '集成测试作业';
  document.querySelector('#tags-input').value = '测试, 集成';
  document.querySelector('#publish').click();
  await wait(2600);
  const w4 = await (
    await window.fetch('/api/weeks', { headers: { 'x-rmh-key': key } })
  ).json();
  check('新周次已发布到仓库', w4.data.weeks.some((w) => w.week === 'week04'));
  check('发布成功提示出现', !!document.querySelector('.toast--success'));

  // 切换到组员：成绩 Toast + 新作业提示
  document.querySelector('[data-nav="#/settings"]');
  await services.demoLogin({ login: 'alice' });
  // 通过应用自身的退出+登录流程
  window.__RMH_APP__.logout();
  await wait(600);
  const aliceBtn = document.querySelector('[data-demo="alice"]');
  check('可切回登录页并选择组员', !!aliceBtn);
  if (aliceBtn) {
    aliceBtn.click();
    await wait(2600);
    check('组员端外壳渲染', !!document.querySelector('.shell'));
    check('组员端展示作业要求', document.body.textContent.includes('作业要求'));
    check('成绩 Toast 弹出', !!document.querySelector('.score-toast'));
    check('Toast 含分数 92', (document.querySelector('.score-toast__score')?.textContent || '').includes('92'));
    check('Toast 含评语', (document.querySelector('.score-toast__comment')?.textContent || '').length > 10);
    check('新作业提示弹出', !!document.querySelector('.week-toast'));

    // 组员端查看作业
    const memberWeeksNav = document.querySelector('[data-nav="#/member/weeks"]');
    check('组员端有查看作业导航', !!memberWeeksNav);
    memberWeeksNav.click();
    await wait(1500);
    check('组员查看作业页渲染', document.body.textContent.includes('作业内容'));
    check('组员查看作业只显示本组', document.querySelectorAll('#view-tabs [data-vt]').length === 2);
  }

  // 成绩页
  document.querySelector('[data-nav="#/member/grades"]')?.click();
  await wait(1500);
  check('成绩页渲染', document.body.textContent.includes('平均分'));
  const gradeViewBtn = document.querySelector('[data-view-week]');
  check('成绩页有查看作业按钮', !!gradeViewBtn);
  if (gradeViewBtn) {
    gradeViewBtn.click();
    await wait(1500);
    check('成绩页查看作业跳转到查看作业页', location.hash === '#/member/weeks' && document.body.textContent.includes('作业内容'));
  }

  // 周详情不应出现 api 未定义
  location.hash = '#/member/week/week01';
  await wait(1500);
  check('周详情正常渲染', document.body.textContent.includes('作业要求') && !document.body.textContent.includes('api is not defined'));

  // Markdown 安全
  check('页面未出现脚本执行错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  const severe = errors.filter((e) => !/Not implemented|clipboard/i.test(e));
  check('无未处理的前端异常', severe.length === 0, severe.slice(0, 3).join(' | '));

  console.log(`\n结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}\n`);
  await server.stop();
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
