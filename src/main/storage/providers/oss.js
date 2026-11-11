'use strict';

/**
 * 云存储（OSS / 网盘）预留接口。
 *
 * 设计目标：当单个提交目录超过 GitHub 的舒适区间（默认 20MB）时，
 * 把大文件上传到对象存储，并在 GitHub 仓库中只保存清单（manifest），
 * 组员端/组长端下载时再按需回源。当前版本默认关闭，走 GitHub 全程。
 *
 * 实现新的 provider 时只需实现下面的方法，并在 storage/index.js 中注册。
 */
class OssStorageProvider {
  constructor(config = {}) {
    this.config = config;
    this.enabled = !!(config && config.enabled);
  }

  assertEnabled() {
    if (!this.enabled) {
      throw new Error('云存储未启用：当前版本使用 GitHub 作为唯一存储后端（已在设置中预留 OSS 配置）。');
    }
  }

  /** 上传单个文件，返回可公开/带签名的 URL 以及对象 key。 */
  async putFile(_key, _buffer, _contentType) {
    this.assertEnabled();
    throw new Error('OSS provider 尚未实现');
  }

  /** 为下载生成临时地址。 */
  async signedUrl(_key) {
    this.assertEnabled();
    throw new Error('OSS provider 尚未实现');
  }

  /** 删除对象。 */
  async deleteFile(_key) {
    this.assertEnabled();
    throw new Error('OSS provider 尚未实现');
  }

  /** 仓库内清单文件建议结构。 */
  static manifest(week, login, objects) {
    return {
      version: 1,
      week,
      login,
      createdAt: new Date().toISOString(),
      objects,
    };
  }
}

module.exports = { OssStorageProvider };
