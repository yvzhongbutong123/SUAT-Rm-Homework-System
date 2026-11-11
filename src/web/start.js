'use strict';

/**
 * 浏览器模式启动器（不依赖 Electron）。
 * 启动本地服务并自动打开默认浏览器；也作为单文件 exe 的入口。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const { Logger } = require('../main/logger');
const { SettingsStore } = require('../main/settings');
const { GitRunner } = require('../main/git');
const { AppServices } = require('../main/services/app');
const { LocalServer } = require('../main/server');

const pkg = require('../../package.json');

/* ---------------- 启动诊断日志（尽可能早地落盘） ---------------- */
const BOOT_LOG_FILES = [];
try {
  BOOT_LOG_FILES.push(path.join(path.dirname(process.execPath), 'startup.log'));
} catch {
  /* ignore */
}
try {
  BOOT_LOG_FILES.push(path.join(process.env.APPDATA || os.homedir(), 'RMHomework', 'startup.log'));
} catch {
  /* ignore */
}

function bootLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  for (const file of BOOT_LOG_FILES) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, line);
      break;
    } catch {
      /* try next */
    }
  }
  try {
    process.stdout.write(line);
  } catch {
    /* ignore */
  }
}

process.on('uncaughtException', (err) => {
  bootLog('UNCAUGHT ' + (err && (err.stack || err.message)));
});
process.on('unhandledRejection', (err) => {
  bootLog('UNHANDLED ' + (err && (err.stack || err.message)));
});

function resolveDataDir() {
  if (process.env.RMH_DATA_DIR) {
    fs.mkdirSync(process.env.RMH_DATA_DIR, { recursive: true });
    return process.env.RMH_DATA_DIR;
  }
  const candidates = [
    path.join(process.env.APPDATA || '', 'RMHomework'),
    path.join(path.dirname(process.execPath), 'data'),
    path.join(os.tmpdir(), 'RMHomework'),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch (err) {
      bootLog(`数据目录不可用 ${dir}: ${err.message}`);
    }
  }
  throw new Error('无法创建可写的数据目录');
}

function openBrowser(url) {
  const attempts = [
    () => spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }),
    () => spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }),
    () => spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }),
  ];
  for (const attempt of attempts) {
    try {
      const child = attempt();
      child.unref();
      bootLog(`已尝试打开浏览器 ${url}`);
      return true;
    } catch (err) {
      bootLog(`打开浏览器失败：${err.message}`);
    }
  }
  return false;
}

async function main() {
  bootLog(`启动 v${pkg.version} exec=${process.execPath} node=${process.version}`);
  const dataDir = resolveDataDir();
  bootLog(`数据目录 ${dataDir}`);
  const logger = new Logger(path.join(dataDir, 'logs', 'web.log'));
  logger.info(`浏览器模式启动 v${pkg.version}  data=${dataDir}`);

  const settings = new SettingsStore({ dir: dataDir, safeStorage: null, logger });
  settings.load();

  const git = new GitRunner(logger, {
    mode: settings.data.gitMode === 'auto' ? null : settings.data.gitMode,
    distro: settings.data.wslDistro || null,
  });

  const services = new AppServices({
    settings,
    logger,
    git,
    dataDir,
    safeStorage: null,
    fetchImpl: globalThis.fetch,
  });

  // 内嵌资源优先（单文件 exe 打包时注入），否则读取源码目录
  let staticAssets = null;
  try {
    // eslint-disable-next-line global-require
    staticAssets = require('./embedded-assets');
  } catch {
    staticAssets = null;
  }

  const server = new LocalServer({
    app: services,
    logger,
    staticDir: path.join(__dirname, '..', 'renderer'),
    staticAssets,
    version: pkg.version,
  });
  const apiKey = crypto.randomBytes(16).toString('hex');
  server.setApiKey(apiKey);
  bootLog('正在监听本地端口…');
  const port = await server.start();
  const url = `http://127.0.0.1:${port}/?k=${apiKey}`;
  bootLog(`服务已启动 ${url}`);

  console.log('');
  console.log('  RoboMaster 战队作业管理 · 浏览器模式');
  console.log('  ------------------------------------------------');
  console.log(`  地址: ${url}`);
  console.log(`  数据: ${dataDir}`);
  console.log('  关闭此窗口即可停止服务。');
  console.log('');

  if (!process.env.RMH_NO_OPEN) {
    const opened = openBrowser(url);
    if (!opened) {
      console.log('  未能自动打开浏览器，请复制上面的地址手动访问。');
    }
  }

  const shutdown = () => {
    console.log('\n正在停止服务…');
    server.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 后台恢复上次登录（记住的账号），不阻塞服务启动
  bootLog('尝试恢复已保存的账号…');
  services
    .restore()
    .then((result) => {
      bootLog(result ? `已自动登录 ${result.user && result.user.login}` : '没有可自动登录的账号');
    })
    .catch((err) => bootLog(`恢复登录失败 ${err.message}`));
}

main().catch((err) => {
  bootLog('FAILED ' + (err && (err.stack || err.message)));
  console.error('启动失败：', err);
  process.exitCode = 1;
});
