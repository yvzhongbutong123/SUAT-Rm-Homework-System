'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 轻量日志：同时写 stdout 与滚动日志文件。
 * 任何可能含 token 的文本都先经过 redact。
 */
class Logger {
  constructor(logFile) {
    this.logFile = logFile || null;
    this.buffer = [];
    if (this.logFile) {
      try {
        fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      } catch {
        /* ignore */
      }
    }
  }

  redact(text) {
    return String(text == null ? '' : text)
      .replace(/(x-access-token:)[^@\s]*/gi, '$1***')
      .replace(/(gh[pousr]_[A-Za-z0-9]{10,})/g, '***')
      .replace(/(github_pat_[A-Za-z0-9_]{10,})/g, '***')
      .replace(/(AUTHORIZATION: basic )[A-Za-z0-9+/=]+/gi, '$1***');
  }

  write(level, args) {
    const line = `[${new Date().toISOString()}] [${level}] ${args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : JSON.stringify(a)))
      .map((s) => this.redact(s))
      .join(' ')}`;
    if (level === 'ERROR') console.error(line);
    else console.log(line);
    if (!this.logFile) return;
    this.buffer.push(line);
    if (this.buffer.length > 200) {
      const chunk = this.buffer.join('\n') + '\n';
      this.buffer = [];
      fs.appendFile(this.logFile, chunk, () => {});
    }
  }

  info(...args) {
    this.write('INFO', args);
  }

  warn(...args) {
    this.write('WARN', args);
  }

  error(...args) {
    this.write('ERROR', args);
  }

  debug(...args) {
    if (process.env.RMH_DEBUG) this.write('DEBUG', args);
  }

  flush() {
    if (this.logFile && this.buffer.length) {
      try {
        fs.appendFileSync(this.logFile, this.buffer.join('\n') + '\n');
        this.buffer = [];
      } catch {
        /* ignore */
      }
    }
  }
}

module.exports = { Logger };
