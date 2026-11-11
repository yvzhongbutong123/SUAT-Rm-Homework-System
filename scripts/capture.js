'use strict';

/**
 * 界面截图脚本（开发辅助）：以演示数据启动应用并保存关键页面。
 * 用法：npx electron scripts/capture.js
 */

const { app, BrowserWindow, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { Logger } = require('../src/main/logger');
const { SettingsStore } = require('../src/main/settings');
const { GitRunner } = require('../src/main/git');
const { AppServices } = require('../src/main/services/app');
const { LocalServer } = require('../src/main/server');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, '.capture-data');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const pkg = require('../package.json');

process.env.RMH_DATA_DIR = DATA;

const apiKey = crypto.randomBytes(16).toString('hex');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const LOG_FILE = path.join(ROOT, 'docs', 'screenshots', 'capture.log');
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    /* ignore */
  }
}

process.on('uncaughtException', (err) => {
  log('UNCAUGHT', err.stack || err.message);
});
process.on('unhandledRejection', (err) => {
  log('UNHANDLED', (err && (err.stack || err.message)) || String(err));
});

async function main() {
  log('start, runAsNode=', process.env.ELECTRON_RUN_AS_NODE);
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(DATA, { recursive: true });

  const logger = new Logger(path.join(DATA, 'capture.log'));
  const settings = new SettingsStore({ dir: DATA, safeStorage, logger });
  settings.load();
  const git = new GitRunner(logger);
  const services = new AppServices({
    settings,
    logger,
    git,
    dataDir: DATA,
    fetchImpl: (url, opts) => require('electron').net.fetch(url, opts),
  });

  const server = new LocalServer({
    app: services,
    logger,
    staticDir: path.join(ROOT, 'src', 'renderer'),
    version: pkg.version,
  });
  server.setApiKey(apiKey);
  const port = await server.start();
  const base = `http://127.0.0.1:${port}/?k=${apiKey}`;

  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    show: true,
    frame: false,
    backgroundColor: '#080b12',
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  const shot = async (name) => {
    await wait(1400);
    const img = await win.webContents.capturePage();
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, img.toPNG());
    log(`saved ${file} (${img.getSize().width}x${img.getSize().height})`);
  };

  const load = async (hash) => {
    await win.loadURL(base + hash);
    await wait(2000);
  };

  win.webContents.on('console-message', (_e, level, message) => log('renderer:', message));
  win.webContents.on('did-fail-load', (_e, code, desc) => log('did-fail-load', code, desc));

  await load('#/login');
  await shot('01-login');

  await services.demoLogin({ login: 'rm-leader' });
  await load('#/leader/overview');
  await shot('02-leader-overview');

  await win.webContents.executeJavaScript(`(() => {
    const btn = document.querySelector('[data-grade]');
    if (btn) btn.click();
    return !!btn;
  })()`);
  await wait(700);
  await shot('03-grade-modal');
  await win.webContents.executeJavaScript(`document.querySelector('.modal-backdrop')?.remove()`);

  await load('#/leader/submissions');
  await shot('04-leader-submissions');

  await load('#/leader/members');
  await shot('05-leader-members');

  await services.demoLogin({ login: 'alice' });
  await load('#/member/home');
  await shot('06-member-home-toast');

  await load('#/member/grades');
  await shot('07-member-grades');

  await load('#/settings');
  await shot('08-settings');

  console.log('done');
  await server.stop();
  app.quit();
}

app.whenReady().then(main).catch((err) => {
  console.error(err);
  app.quit();
});
