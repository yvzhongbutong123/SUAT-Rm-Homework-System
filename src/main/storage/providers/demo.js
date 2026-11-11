'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { FsStore } = require('../fs-store');
const { buildDemoFiles } = require('../demo-seed');

/**
 * 演示存储：同样是本地文件树，但不需要 GitHub / Git。
 * 首次启动时写入一套完整的示例仓库，方便离线体验与验收。
 */
class DemoStorage extends FsStore {
  constructor({ rootDir, logger }) {
    super({ rootDir, logger });
    this.ready = false;
  }

  async ensure() {
    if (this.ready) return;
    await this.ensureRoot();
    const marker = path.join(this.rootDir, '.seeded');
    if (!fs.existsSync(marker)) {
      for (const item of buildDemoFiles()) {
        const abs = this.resolve(item.rel);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, item.content, 'utf8');
      }
      await fsp.writeFile(marker, new Date().toISOString(), 'utf8');
    }
    this.ready = true;
  }

  async pull() {
    await this.ensure();
    return { ok: true, demo: true };
  }

  async mutate(fn) {
    await this.ensure();
    await fn();
    return { ok: true, demo: true, commit: null };
  }

  async info() {
    return {
      provider: 'demo',
      owner: 'demo',
      repo: 'Rm-Homework（演示）',
      branch: 'main',
      remoteUrl: null,
      gitChannel: 'none',
      gitLabel: '演示模式（未连接 GitHub）',
      gitVersion: null,
      wslError: null,
      lastSync: new Date().toISOString(),
      lastSyncError: null,
      cacheDir: this.rootDir,
      demo: true,
    };
  }
}

module.exports = { DemoStorage };
