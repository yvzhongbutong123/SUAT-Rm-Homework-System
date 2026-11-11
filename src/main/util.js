'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

/**
 * 通用工具：路径安全、格式化、简单校验。
 */

const WEEK_RE = /^week\d{2,3}$/i;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GROUP_IDS = ['algo', 'mech', 'embedded'];

function isWeekName(name) {
  return typeof name === 'string' && WEEK_RE.test(name);
}

function isValidLogin(login) {
  return typeof login === 'string' && LOGIN_RE.test(login);
}

function assertWeek(week) {
  if (!isWeekName(week)) throw new HttpError(400, `非法的周次: ${week}`);
  return week;
}

function assertLogin(login) {
  if (!isValidLogin(login)) throw new HttpError(400, `非法的 GitHub 账号名: ${login}`);
  return login;
}

/** 把相对路径解析到 base 之内，拒绝穿越。 */
function safeJoin(base, rel) {
  const target = path.resolve(base, rel);
  const relToBase = path.relative(base, target);
  if (relToBase.startsWith('..') || path.isAbsolute(relToBase)) {
    throw new HttpError(400, `非法路径: ${rel}`);
  }
  return target;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function randomId() {
  return crypto.randomBytes(8).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 串行队列：所有写仓库的操作排队执行，避免 git 索引竞争。 */
class Mutex {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(fn) {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => {});
    return result;
  }
}

/** 递归遍历目录，返回 [{ abs, rel, size }]；跳过隐藏的 .git 与系统垃圾文件。 */
function walkFiles(root, opts = {}) {
  const skipNames = new Set(['.git', '.DS_Store', 'Thumbs.db', 'desktop.ini', '__MACOSX']);
  const maxFiles = opts.maxFiles || 20000;
  const out = [];
  const stack = [''];

  while (stack.length) {
    const relDir = stack.pop();
    const absDir = path.join(root, relDir);
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (skipNames.has(entry.name)) continue;
      const rel = relDir ? path.join(relDir, entry.name) : entry.name;
      const abs = path.join(root, rel);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(rel);
      } else if (entry.isFile()) {
        if (out.length >= maxFiles) {
          throw new HttpError(413, `文件数量超过上限 ${maxFiles} 个，请拆分后上传`);
        }
        let stat;
        try {
          stat = fs.statSync(abs);
        } catch {
          continue;
        }
        out.push({ abs, rel: toPosix(rel), size: stat.size });
      }
    }
  }
  return out;
}

function pathSize(dir) {
  try {
    return walkFiles(dir).reduce((sum, f) => sum + f.size, 0);
  } catch {
    return 0;
  }
}

module.exports = {
  HttpError,
  WEEK_RE,
  GROUP_IDS,
  isWeekName,
  isValidLogin,
  assertWeek,
  assertLogin,
  safeJoin,
  toPosix,
  sha1,
  randomId,
  nowIso,
  formatBytes,
  sleep,
  Mutex,
  walkFiles,
  pathSize,
};
