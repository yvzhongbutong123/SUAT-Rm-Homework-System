'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const keyArg = process.argv.find((a) => a.startsWith('--rmh-key='));
const apiKey = keyArg ? keyArg.slice('--rmh-key='.length) : '';

contextBridge.exposeInMainWorld('rmh', {
  apiKey,
  platform: process.platform,

  /** Electron 32+：从拖拽的 File 对象取回真实磁盘路径（文件夹亦可）。 */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  pathInfo: (target) => ipcRenderer.invoke('path:info', target),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  uploadFolder: (week, folderPath) => ipcRenderer.invoke('app:upload-folder', { week, folderPath }),
  uploadFiles: (week, files) => ipcRenderer.invoke('app:upload-files', { week, files }),
  exportSubmission: (week, member) => ipcRenderer.invoke('app:export-submission', { week, member }),
  showItemInFolder: (target) => ipcRenderer.invoke('shell:show-item', target),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  getInfo: () => ipcRenderer.invoke('app:info'),

  /** 主进程恢复上次登录后通知渲染进程 */
  onSessionRestored: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('session:restored', handler);
    return () => ipcRenderer.removeListener('session:restored', handler);
  },

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    close: () => ipcRenderer.invoke('window:close'),
    onMaximized: (cb) => {
      const handler = (_e, value) => cb(value);
      ipcRenderer.on('window:maximized', handler);
      return () => ipcRenderer.removeListener('window:maximized', handler);
    },
  },
});
