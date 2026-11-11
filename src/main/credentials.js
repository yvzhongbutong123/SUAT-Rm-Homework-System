'use strict';

const crypto = require('node:crypto');
const os = require('node:os');

/**
 * 凭据加密器。
 * - Electron 环境优先使用 safeStorage（系统级加密）。
 * - 浏览器 / 纯 Node 环境使用 AES-256-GCM，密钥由本机信息派生（避免明文落盘）。
 * 注意：本机派生密钥只能防止"直接读到明文"，不能防御已控制本机的攻击者。
 */
class CredentialCipher {
  constructor(safeStorage) {
    this.safeStorage = safeStorage || null;
    this._key = null;
  }

  canUseSafeStorage() {
    try {
      return !!(this.safeStorage && typeof this.safeStorage.isEncryptionAvailable === 'function' && this.safeStorage.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  get mode() {
    return this.canUseSafeStorage() ? 'safeStorage' : 'aes-256-gcm';
  }

  key() {
    if (!this._key) {
      let user = '';
      try {
        user = `${os.hostname()}|${os.userInfo().username}`;
      } catch {
        user = os.hostname();
      }
      this._key = crypto.scryptSync(user, 'RMHomework-credential-v1', 32);
    }
    return this._key;
  }

  encrypt(text) {
    if (!text) return null;
    if (this.canUseSafeStorage()) {
      return `ss:${this.safeStorage.encryptString(text).toString('base64')}`;
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `aes:${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
  }

  decrypt(payload) {
    if (!payload || typeof payload !== 'string') return null;
    try {
      if (payload.startsWith('ss:')) {
        if (!this.safeStorage || !this.safeStorage.decryptString) return null;
        return this.safeStorage.decryptString(Buffer.from(payload.slice(3), 'base64'));
      }
      if (payload.startsWith('aes:')) {
        const raw = Buffer.from(payload.slice(4), 'base64');
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const data = raw.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
      }
    } catch {
      return null;
    }
    return null;
  }
}

module.exports = { CredentialCipher };
