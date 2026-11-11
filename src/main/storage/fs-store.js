'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { safeJoin, walkFiles, toPosix } = require('../util');

/**
 * 文件级存储基类。
 * 负责一个仓库工作副本内的读写；Git 仓库与本地演示仓库共用这套实现。
 * 上层（Storage）只通过相对路径访问，天然把存储位置与业务逻辑解耦。
 */
class FsStore {
  constructor({ rootDir, logger }) {
    this.rootDir = path.resolve(rootDir);
    this.logger = logger;
  }

  resolve(rel) {
    return safeJoin(this.rootDir, rel);
  }

  async ensureRoot() {
    await fsp.mkdir(this.rootDir, { recursive: true });
  }

  async exists(rel) {
    try {
      await fsp.access(this.resolve(rel));
      return true;
    } catch {
      return false;
    }
  }

  async stat(rel) {
    try {
      return await fsp.stat(this.resolve(rel));
    } catch {
      return null;
    }
  }

  async isDir(rel) {
    const st = await this.stat(rel);
    return !!(st && st.isDirectory());
  }

  async readText(rel) {
    try {
      return await fsp.readFile(this.resolve(rel), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async readBuffer(rel) {
    try {
      return await fsp.readFile(this.resolve(rel));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async readJson(rel) {
    const text = await this.readText(rel);
    if (text == null || text.trim() === '') return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      this.logger.warn(`JSON 解析失败 ${rel}: ${err.message}`);
      return null;
    }
  }

  async writeJsonRaw(rel, obj) {
    const abs = this.resolve(rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    return abs;
  }

  /** @param {{rel:string, data:Buffer|string}[]} files */
  async writeFilesRaw(files) {
    for (const file of files) {
      const abs = this.resolve(file.rel);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      if (Buffer.isBuffer(file.data)) await fsp.writeFile(abs, file.data);
      else await fsp.writeFile(abs, String(file.data), 'utf8');
    }
  }

  async removeDirRaw(rel) {
    const abs = this.resolve(rel);
    await fsp.rm(abs, { recursive: true, force: true });
  }

  async removeFileRaw(rel) {
    await fsp.rm(this.resolve(rel), { force: true });
  }

  /** 把本地文件夹整体复制到仓库内 relDir（覆盖同名目录）。 */
  async copyDirRaw(relDir, srcDir) {
    const dest = this.resolve(relDir);
    await fsp.mkdir(dest, { recursive: true });
    await fsp.cp(srcDir, dest, {
      recursive: true,
      force: true,
      errorOnExist: false,
      filter: (src) => {
        const base = path.basename(src);
        return !['.git', '.DS_Store', 'Thumbs.db', 'desktop.ini', '__MACOSX'].includes(base);
      },
    });
  }

  /** 列出目录内容（不回显隐藏符号链接）。 */
  async listDir(rel) {
    const abs = this.resolve(rel);
    let entries;
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const out = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const childRel = toPosix(path.join(rel, entry.name));
      if (entry.isDirectory()) {
        out.push({ name: entry.name, rel: childRel, type: 'dir', size: 0, fileCount: 0 });
      } else if (entry.isFile()) {
        const st = await fsp.stat(path.join(abs, entry.name)).catch(() => null);
        out.push({ name: entry.name, rel: childRel, type: 'file', size: st ? st.size : 0, fileCount: 0 });
      }
    }
    // 补目录文件数与体积
    for (const item of out) {
      if (item.type === 'dir') {
        try {
          const files = walkFiles(this.resolve(item.rel));
          item.fileCount = files.length;
          item.size = files.reduce((s, f) => s + f.size, 0);
        } catch {
          /* ignore */
        }
      }
    }
    return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  }

  /** 扫描根目录下的 weekNN 目录。 */
  async listWeekDirs() {
    let entries;
    try {
      entries = await fsp.readdir(this.rootDir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory() && /^week\d{2,3}$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  async dirFiles(relDir) {
    const abs = this.resolve(relDir);
    if (!fs.existsSync(abs)) return [];
    return walkFiles(abs).map((f) => ({ rel: f.rel, size: f.size }));
  }
}

module.exports = { FsStore };
