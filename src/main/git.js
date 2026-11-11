'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

/**
 * git 执行层。
 * 优先使用 WSL 中的 git（需求指定），WSL 不可用时自动回退到 Windows git。
 * 认证信息通过 `-c http.<url>.extraheader=...` 在每次命令中传入，绝不写入 .git/config。
 */

function execFileRaw(file, args, opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      child = execFile(
        file,
        args,
        {
          cwd: opts.cwd,
          env: opts.env || process.env,
          windowsHide: true,
          timeout: opts.timeout || 180000,
          maxBuffer: 256 * 1024 * 1024,
          encoding: 'buffer',
        },
        (err, stdout, stderr) => {
          resolve({
            code: err ? (typeof err.code === 'number' ? err.code : err.killed ? 124 : 1) : 0,
            stdout: decode(stdout),
            stderr: decode(stderr),
            error: err || null,
            ms: Date.now() - started,
          });
        },
      );
      if (child.stdin) child.stdin.end();
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err && err.message), error: err, ms: 0 });
    }
  });
}

function decode(buf) {
  if (!buf || !buf.length) return '';
  // wsl.exe 部分版本输出 UTF-16LE；根据 NUL 字节密度判断。
  let nul = 0;
  for (let i = 0; i < Math.min(buf.length, 400); i += 1) if (buf[i] === 0) nul += 1;
  if (nul > 10) return buf.toString('utf16le').replace(/\u0000/g, '');
  return buf.toString('utf8').replace(/\u0000/g, '');
}

/** Windows 绝对路径 -> WSL 路径（/mnt/d/...）。 */
function toWslPath(winPath) {
  const resolved = path.resolve(winPath);
  const m = /^([A-Za-z]):[\\/]?(.*)$/.exec(resolved);
  if (!m) return resolved.split(path.sep).join('/');
  const drive = m[1].toLowerCase();
  const rest = m[2].split(path.sep).join('/');
  return `/mnt/${drive}${rest ? '/' + rest : ''}`;
}

class GitRunner {
  constructor(logger, options = {}) {
    this.logger = logger;
    this.detected = null;
    this.forcedMode = options.mode || null;
    this.forcedDistro = options.distro || null;
  }

  async detect(force = false) {
    if (this.detected && !force) return this.detected;
    const log = this.logger;
    const result = {
      mode: 'none',
      label: '未检测到 Git',
      version: null,
      distro: null,
      wslError: null,
      windowsVersion: null,
      checkedAt: new Date().toISOString(),
    };

    const tryWsl = async () => {
      const listArgs = this.forcedDistro ? ['-d', this.forcedDistro] : [];
      const probe = await execFileRaw(
        'wsl.exe',
        [...listArgs, '--exec', 'git', '--version'],
        { timeout: 12000, env: { ...process.env, WSL_UTF8: '1' } },
      );
      if (probe.code !== 0) {
        result.wslError = (probe.stderr || probe.stdout || 'WSL 不可用').trim().slice(0, 400);
        return null;
      }
      const version = (probe.stdout || '').trim();
      return { version, distro: this.forcedDistro || null };
    };

    const tryWindows = async () => {
      const probe = await execFileRaw('git', ['--version'], { timeout: 12000 });
      if (probe.code !== 0) return null;
      return (probe.stdout || '').trim();
    };

    if (this.forcedMode === 'windows') {
      const v = await tryWindows();
      if (v) Object.assign(result, { mode: 'windows', label: 'Windows Git', version: v, windowsVersion: v });
    } else if (this.forcedMode === 'wsl') {
      const w = await tryWsl();
      if (w) Object.assign(result, { mode: 'wsl', label: 'WSL Git', version: w.version, distro: w.distro });
    } else {
      // 自动：WSL 优先
      const w = await tryWsl();
      if (w) {
        Object.assign(result, { mode: 'wsl', label: 'WSL Git', version: w.version, distro: w.distro });
      } else {
        const v = await tryWindows();
        if (v) Object.assign(result, { mode: 'windows', label: 'Windows Git（WSL 不可用，已自动回退）', version: v, windowsVersion: v });
      }
    }

    // Windows 版本仅在需要提示时补测
    if (result.mode === 'wsl' && !result.windowsVersion) {
      const v = await tryWindows();
      if (v) result.windowsVersion = v;
    }

    log.info(`git 通道: ${result.mode} / ${result.version || 'n/a'}${result.wslError ? ` / WSL: ${result.wslError}` : ''}`);
    this.detected = result;
    return result;
  }

  /** 把 Windows 路径转换为当前通道可用的工作目录。 */
  cwdFor(dir, mode) {
    if (mode === 'wsl') return toWslPath(dir);
    return dir;
  }

  buildArgs(mode, args, opts) {
    const base = ['-c', 'core.quotepath=false', '-c', 'core.autocrlf=false', '-c', 'gc.auto=0'];
    if (mode === 'wsl' && opts.cwdPosix) base.push('-c', `safe.directory=${opts.cwdPosix}`);
    if (opts.token) {
      const b64 = Buffer.from(`x-access-token:${opts.token}`, 'utf8').toString('base64');
      base.push('-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${b64}`);
      base.push('-c', 'credential.helper=');
    }
    return base.concat(args);
  }

  /**
   * 执行 git 命令。
   * @param {string[]} args
   * @param {{cwd?: string, token?: string, timeout?: number}} opts
   */
  async run(args, opts = {}) {
    const det = await this.detect();
    if (det.mode === 'none') {
      throw new Error('未检测到可用的 Git。请安装 Git for Windows 或启用 WSL，然后在「设置」中重试。');
    }
    const cwd = opts.cwd ? path.resolve(opts.cwd) : undefined;
    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo',
      GCM_INTERACTIVE: 'never',
      LC_ALL: 'C.UTF-8',
      LANG: 'C.UTF-8',
    };
    const full = this.buildArgs(det.mode, args, { token: opts.token, cwdPosix: cwd ? toWslPath(cwd) : '' });
    let runFile;
    let runArgs;
    if (det.mode === 'wsl') {
      const distroArgs = det.distro ? ['-d', det.distro] : [];
      runArgs = [...distroArgs, ...(cwd ? ['--cd', toWslPath(cwd)] : []), '--exec', 'git', ...full];
      runFile = 'wsl.exe';
    } else {
      runFile = 'git';
      runArgs = full;
    }

    const started = Date.now();
    const res = await execFileRaw(runFile, runArgs, { cwd, timeout: opts.timeout || 180000, env });
    const printable = full.map((a) => (a.includes('AUTHORIZATION') ? 'AUTHORIZATION: ***' : a)).join(' ');
    const line = `$ git ${printable}  (cwd=${cwd || '.'}) -> ${res.code} in ${Date.now() - started}ms`;
    if (res.code === 0) this.logger.debug(line);
    else this.logger.warn(`${line}\n${(res.stderr || '').slice(0, 1200)}`);

    return res;
  }

  /** 返回仓库的 last commit 时间映射（按路径）。 */
  async lastCommitTimes(cwd, relPath, token) {
    const res = await this.run(
      ['log', '-n', '200', '--format=%x01%cI', '--name-only', '--', relPath],
      { cwd, token, timeout: 60000 },
    );
    const map = new Map();
    if (res.code !== 0) return map;
    let current = null;
    for (const raw of res.stdout.split(/\r?\n/)) {
      if (raw.startsWith('\u0001')) {
        current = raw.slice(1).trim();
      } else if (raw.trim() && current) {
        const file = raw.trim();
        if (!map.has(file)) map.set(file, current);
      }
    }
    return map;
  }
}

module.exports = { GitRunner, toWslPath, execFileRaw, decode };
