'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 本地设置与凭据。
 * Token 使用 Electron safeStorage 加密后落盘；不可用时退化为仅当前进程内存保存（并给出警告）。
 */
class SettingsStore {
  constructor({ dir, safeStorage, logger }) {
    this.dir = dir;
    this.safeStorage = safeStorage || null;
    this.logger = logger;
    this.file = path.join(dir, 'settings.json');
    this.data = this.defaults();
    this.memoryToken = null;
    this.tokenPlaintextFallback = false;
  }

  defaults() {
    return {
      version: 1,
      mode: 'git',
      repo: {
        owner: 'yvzhongbutong123',
        name: 'SUAT-Rm-Homework',
        branch: 'main',
        url: 'git@github.com:yvzhongbutong123/SUAT-Rm-Homework.git',
        protocol: 'ssh',
      },
      gitMode: 'auto',
      wslDistro: '',
      oauthClientId: '',
      oss: { enabled: false, endpoint: '', bucket: '', thresholdMB: 20 },
      notifications: { enabled: true, pollSeconds: 25, read: {} },
      autoLogin: true,
      accounts: [],
      roleCache: {},
      lastLogin: '',
      window: { width: 1440, height: 920, maximized: false },
      createdAt: new Date().toISOString(),
    };
  }

  load() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = { ...this.defaults(), ...raw, repo: { ...this.defaults().repo, ...(raw.repo || {}) } };
        this.data.notifications = { ...this.defaults().notifications, ...(raw.notifications || {}) };
        this.data.notifications.read = this.data.notifications.read || {};
      }
    } catch (err) {
      this.logger.warn(`读取设置失败，使用默认值：${err.message}`);
      this.data = this.defaults();
    }
    return this.data;
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.logger.error(`保存设置失败：${err.message}`);
    }
  }

  get() {
    return this.data;
  }

  patch(partial) {
    this.data = { ...this.data, ...partial };
    this.save();
    return this.data;
  }

  setToken(token) {
    this.memoryToken = token || null;
    if (!token) {
      delete this.data.tokenEnc;
      delete this.data.tokenPlainFallback;
      this.save();
      return;
    }
    if (this.safeStorage && this.safeStorage.isEncryptionAvailable && this.safeStorage.isEncryptionAvailable()) {
      this.data.tokenEnc = this.safeStorage.encryptString(token).toString('base64');
      delete this.data.tokenPlainFallback;
      this.tokenPlaintextFallback = false;
    } else {
      // 没有系统加密能力时：不落盘，只保存在内存，避免明文凭据。
      delete this.data.tokenEnc;
      this.tokenPlaintextFallback = true;
      this.logger.warn('系统加密不可用，Token 仅保存在当前进程内存中。');
    }
    this.save();
  }

  getToken() {
    if (this.memoryToken) return this.memoryToken;
    if (this.data.tokenEnc && this.safeStorage && this.safeStorage.decryptString) {
      try {
        this.memoryToken = this.safeStorage.decryptString(Buffer.from(this.data.tokenEnc, 'base64'));
        return this.memoryToken;
      } catch (err) {
        this.logger.warn(`解密 Token 失败：${err.message}`);
      }
    }
    return null;
  }

  markEvaluationsRead(keys) {
    const now = new Date().toISOString();
    for (const key of keys) this.data.notifications.read[key] = now;
    // 只保留最近 500 条
    const entries = Object.entries(this.data.notifications.read);
    if (entries.length > 500) {
      entries.sort((a, b) => String(b[1]).localeCompare(String(a[1])));
      this.data.notifications.read = Object.fromEntries(entries.slice(0, 500));
    }
    this.save();
  }

  isRead(key) {
    return !!this.data.notifications.read[key];
  }
}

module.exports = { SettingsStore };
