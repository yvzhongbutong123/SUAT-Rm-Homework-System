'use strict';

/**
 * 账号保存 / 自动登录链路测试（用假 GitHub API，不需要网络与真实 Token）。
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const { Logger } = require('../src/main/logger');
const { SettingsStore } = require('../src/main/settings');
const { GitRunner } = require('../src/main/git');
const { AppServices } = require('../src/main/services/app');

const DATA = path.join(__dirname, '..', '.account-test');
const TOKEN = 'ghp_fake_token_1234567890';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fakeFetch = async (url) => {
  const u = String(url);
  if (u.endsWith('/user')) {
    return json({ login: 'tester', id: 42, name: '测试队员', avatar_url: 'https://example.com/a.png' });
  }
  if (u.includes('/repos/')) return json({ message: 'Not Found' }, 404);
  return json({ message: 'unexpected' }, 500);
};

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

  const logger = new Logger(path.join(DATA, 't.log'));
  const settings = new SettingsStore({ dir: DATA, safeStorage: null, logger });
  settings.load();
  const git = new GitRunner(logger);
  const app = new AppServices({ settings, logger, git, dataDir: DATA, fetchImpl: fakeFetch, safeStorage: null });

  console.log('\n账号保存 / 自动登录测试\n');

  const result = await app.login({
    token: TOKEN,
    remember: true,
    repoUrl: 'https://github.com/tester/Rm-Homework.git',
  });
  check('登录成功（仓库不存在进入初始化）', result.needSetup === true);

  const accounts = await app.listAccounts();
  check('账号已保存', accounts.accounts.length === 1 && accounts.accounts[0].login === 'tester');
  check('账号标记已保存 Token', accounts.accounts[0].hasToken === true);
  check('列表不泄露 Token', !JSON.stringify(accounts.accounts).includes(TOKEN));

  const raw = fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8');
  check('settings.json 不含明文 Token', !raw.includes(TOKEN));
  check('Token 使用加密前缀', raw.includes('aes:') || raw.includes('ss:'));

  // 模拟重启
  const settings2 = new SettingsStore({ dir: DATA, safeStorage: null, logger });
  settings2.load();
  const app2 = new AppServices({ settings: settings2, logger, git, dataDir: DATA, fetchImpl: fakeFetch, safeStorage: null });
  const restored = await app2.restore();
  check('重启后自动登录', !!restored && restored.user.login === 'tester');

  // 关闭自动登录
  settings2.data.autoLogin = false;
  settings2.save();
  const app3 = new AppServices({ settings: settings2, logger, git, dataDir: DATA, fetchImpl: fakeFetch, safeStorage: null });
  const r3 = await app3.restore();
  check('关闭自动登录后不恢复', r3 === null);
  settings2.data.autoLogin = true;
  settings2.save();

  // 一键登录（使用保存的 Token）
  const app4 = new AppServices({ settings: settings2, logger, git, dataDir: DATA, fetchImpl: fakeFetch, safeStorage: null });
  const quick = await app4.login({ accountLogin: 'tester' });
  check('一键登录使用保存的 Token', quick.needSetup === true);

  // 移除账号
  await app4.removeAccount('tester');
  check('移除账号后列表为空', (await app4.listAccounts()).accounts.length === 0);
  const app5 = new AppServices({ settings: settings2, logger, git, dataDir: DATA, fetchImpl: fakeFetch, safeStorage: null });
  check('移除后无法自动登录', (await app5.restore()) === null);

  console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
