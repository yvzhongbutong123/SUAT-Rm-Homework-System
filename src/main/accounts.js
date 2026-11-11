'use strict';

const { nowIso } = require('./util');

/**
 * 本机已保存的账号（登录名 + 加密后的 Token）。
 * 数据结构写入 settings.json 的 accounts 数组：
 * [{ login, name, avatarUrl, tokenEnc, savedAt, lastUsed }]
 */
class AccountStore {
  constructor({ settings, cipher, logger }) {
    this.settings = settings;
    this.cipher = cipher;
    this.logger = logger;
  }

  all() {
    const list = this.settings.data.accounts;
    return Array.isArray(list) ? list : [];
  }

  persist(list) {
    this.settings.data.accounts = list.slice(0, 10);
    this.settings.save();
  }

  /** 对外展示：不含密文。 */
  list() {
    return this.all()
      .slice()
      .sort((a, b) => String(b.lastUsed || '').localeCompare(String(a.lastUsed || '')))
      .map((a) => ({
        login: a.login,
        name: a.name || a.login,
        avatarUrl: a.avatarUrl || '',
        savedAt: a.savedAt || null,
        lastUsed: a.lastUsed || null,
        hasToken: !!a.tokenEnc,
      }));
  }

  upsert(user, token) {
    const list = this.all().slice();
    const idx = list.findIndex((a) => a.login === user.login);
    const now = nowIso();
    const entry = {
      login: user.login,
      name: user.name || user.login,
      avatarUrl: user.avatarUrl || '',
      tokenEnc: token ? this.cipher.encrypt(token) : null,
      savedAt: idx >= 0 ? list[idx].savedAt || now : now,
      lastUsed: now,
    };
    if (idx >= 0) list[idx] = entry;
    else list.unshift(entry);
    this.persist(list);
    this.logger.info(`已保存账号 ${user.login}（加密方式 ${this.cipher.mode}）`);
  }

  touch(login) {
    const list = this.all().slice();
    const idx = list.findIndex((a) => a.login === login);
    if (idx < 0) return;
    list[idx].lastUsed = nowIso();
    this.persist(list);
  }

  tokenFor(login) {
    const entry = this.all().find((a) => a.login === login);
    if (!entry || !entry.tokenEnc) return null;
    const token = this.cipher.decrypt(entry.tokenEnc);
    if (!token) {
      this.logger.warn(`账号 ${login} 的 Token 解密失败，已忽略`);
      return null;
    }
    return token;
  }

  latest() {
    const list = this.all();
    if (!list.length) return null;
    return list
      .slice()
      .sort((a, b) => String(b.lastUsed || '').localeCompare(String(a.lastUsed || '')))
      .find((a) => a.tokenEnc) || null;
  }

  remove(login) {
    const list = this.all().filter((a) => a.login !== login);
    this.persist(list);
  }

  clear() {
    this.persist([]);
  }
}

module.exports = { AccountStore };
