'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');

const { Logger } = require('./logger');
const { SettingsStore } = require('./settings');
const { GitRunner } = require('./git');
const { AppServices } = require('./services/app');
const { LocalServer } = require('./server');

const APP_ID = 'com.rmteam.homework';
const pkg = require('../../package.json');

// 固定应用名，保证 userData 目录稳定为 %APPDATA%\RMHomework
app.setName('RMHomework');

const isDev = process.argv.includes('--dev');
const apiKey = crypto.randomBytes(24).toString('hex');

let mainWindow = null;
let logger = null;
let settings = null;
let services = null;
let server = null;
let gitRunner = null;

function dataDir() {
  return process.env.RMH_DATA_DIR || app.getPath('userData');
}

function createWindow(port) {
  const state = settings.data.window || {};
  const win = new BrowserWindow({
    width: Math.max(1180, state.width || 1440),
    height: Math.max(720, state.height || 920),
    minWidth: 1080,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#080b12',
    title: 'RoboMaster 战队作业管理',
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      additionalArguments: [`--rmh-key=${apiKey}`],
    },
  });

  Menu.setApplicationMenu(null);
  win.loadURL(`http://127.0.0.1:${port}/?k=${apiKey}`);

  win.once('ready-to-show', () => {
    win.show();
    if (state.maximized) win.maximize();
  });

  const reportMax = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', mainWindow.isMaximized());
    }
  };
  win.on('maximize', reportMax);
  win.on('unmaximize', reportMax);

  win.on('close', () => {
    const s = settings.get();
    s.window = {
      width: win.getWidth(),
      height: win.getHeight(),
      maximized: win.isMaximized(),
    };
    settings.save();
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // 外部链接一律用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: pkg.version,
    platform: process.platform,
    arch: process.arch,
    dataDir: dataDir(),
    isDev,
    electron: process.versions.electron,
  }));

  ipcMain.handle('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:is-maximized', () => !!(mainWindow && mainWindow.isMaximized()));
  ipcMain.handle('window:close', () => mainWindow && mainWindow.close());

  ipcMain.handle('dialog:pick-folder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择要提交的作业文件夹',
      properties: ['openDirectory'],
      buttonLabel: '选择此文件夹',
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    return { canceled: false, path: res.filePaths[0] };
  });

  ipcMain.handle('path:info', async (_event, target) => {
    try {
      const st = await fsp.stat(String(target));
      return { exists: true, isDirectory: st.isDirectory(), isFile: st.isFile(), size: st.size };
    } catch {
      return { exists: false };
    }
  });

  ipcMain.handle('app:upload-folder', async (_event, { week, folderPath }) => {
    try {
      const result = await services.submitFolder(week, folderPath);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || null };
    }
  });

  // 拖拽兜底：把文件内容写入临时目录后走同一套提交流程
  ipcMain.handle('app:upload-files', async (_event, { week, files }) => {
    const tmpRoot = path.join(dataDir(), 'incoming', crypto.randomBytes(6).toString('hex'));
    try {
      if (!Array.isArray(files) || !files.length) throw new Error('没有可上传的文件');
      let total = 0;
      for (const f of files) {
        const rel = String(f.rel || f.name || '').replace(/\\/g, '/');
        if (!rel || rel.split('/').includes('..')) continue;
        const abs = path.join(tmpRoot, rel);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        const buf = Buffer.from(f.data);
        total += buf.length;
        if (total > 400 * 1024 * 1024) throw new Error('文件总大小超过 400MB，请改用文件夹上传');
        await fsp.writeFile(abs, buf);
      }
      const result = await services.submitFolder(week, tmpRoot);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || null };
    } finally {
      fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  ipcMain.handle('app:export-submission', async (_event, { week, member }) => {
    try {
      const res = await dialog.showSaveDialog(mainWindow, {
        title: '保存作业压缩包',
        defaultPath: path.join(app.getPath('downloads'), `${week}-${member}.zip`),
        filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
        buttonLabel: '保存',
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      const out = await services.exportSubmission(week, member, res.filePath);
      return { ok: true, data: out };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('shell:show-item', (_event, target) => {
    if (target && fs.existsSync(target)) shell.showItemInFolder(target);
  });

  ipcMain.handle('shell:open-external', async (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) await shell.openExternal(url);
  });

  ipcMain.handle('app:open-data-dir', async () => {
    await shell.openPath(dataDir());
  });
}

async function bootstrap() {
  const root = dataDir();
  fs.mkdirSync(root, { recursive: true });
  logger = new Logger(path.join(root, 'logs', 'app.log'));
  logger.info(`启动 RM Homework v${pkg.version}  data=${root}`);

  settings = new SettingsStore({ dir: root, safeStorage, logger });
  settings.load();

  gitRunner = new GitRunner(logger, {
    mode: settings.data.gitMode === 'auto' ? null : settings.data.gitMode,
    distro: settings.data.wslDistro || null,
  });

  services = new AppServices({
    settings,
    logger,
    git: gitRunner,
    dataDir: root,
    safeStorage,
    fetchImpl: (url, opts) => require('electron').net.fetch(url, opts),
  });

  server = new LocalServer({
    app: services,
    logger,
    staticDir: path.join(__dirname, '../renderer'),
    version: pkg.version,
  });
  server.setApiKey(apiKey);
  const port = await server.start();

  registerIpc();
  mainWindow = createWindow(port);

  // 后台恢复上次登录，不阻塞界面；完成后通知前端刷新
  services
    .restore()
    .then((result) => {
      if (result && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:restored');
      }
    })
    .catch((err) => logger.warn(`恢复会话失败：${err.message}`));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    bootstrap().catch((err) => {
      logger?.error(err.stack || err.message);
      dialog.showErrorBox('启动失败', String(err.stack || err.message));
      app.quit();
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && server) mainWindow = createWindow(server.port);
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    logger?.flush();
  });

  process.on('uncaughtException', (err) => {
    logger?.error(`未捕获异常：${err.stack || err.message}`);
  });
  process.on('unhandledRejection', (err) => {
    logger?.error(`未处理的 Promise 拒绝：${err && (err.stack || err.message)}`);
  });
}
