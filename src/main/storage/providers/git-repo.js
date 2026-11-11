'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { FsStore } = require('../fs-store');
const { Mutex, HttpError } = require('../../util');

/**
 * Git 仓库存储：本地维护一份工作副本，
 * 所有写操作「拉取 → 修改 → 提交 → 推送」，非快进冲突时自动重试。
 * 支持 HTTPS（Token 认证）与 SSH（本机 SSH Key）两种远程地址。
 */
class GitRepoStorage extends FsStore {
  constructor({ rootDir, logger, git, config }) {
    super({ rootDir, logger });
    this.git = git;
    this.config = config; // {owner, repo, branch, token, login, repoUrl, protocol}
    this.mutex = new Mutex();
    this.lastSync = null;
    this.lastSyncError = null;
    this.initialized = false;
  }

  get remoteUrl() {
    return this.config.repoUrl || `https://github.com/${this.config.owner}/${this.config.repo}.git`;
  }

  get branch() {
    return this.config.branch || 'main';
  }

  /** SSH 模式不使用 Token（依赖本机 SSH key），HTTPS 模式才注入 Token。 */
  authToken() {
    return this.config.protocol === 'ssh' ? null : this.config.token;
  }

  async ensure() {
    if (this.initialized) return;
    await fsp.mkdir(this.rootDir, { recursive: true });
    const gitDir = path.join(this.rootDir, '.git');

    if (!fs.existsSync(gitDir)) {
      const entries = await fsp.readdir(this.rootDir).catch(() => []);
      if (entries.length) {
        await fsp.rm(this.rootDir, { recursive: true, force: true });
        await fsp.mkdir(this.rootDir, { recursive: true });
      }
      await this.cloneOrInit();
    } else {
      await this.git.run(['remote', 'set-url', 'origin', this.remoteUrl], {
        cwd: this.rootDir,
        token: this.authToken(),
      });
    }

    await this.git.run(['config', 'user.name', this.config.login || 'RM Homework Bot'], { cwd: this.rootDir });
    await this.git.run(['config', 'user.email', `${this.config.login || 'rm-bot'}@users.noreply.github.com`], {
      cwd: this.rootDir,
    });
    await this.git.run(['config', 'core.autocrlf', 'false'], { cwd: this.rootDir });
    await this.git.run(['config', 'core.quotepath', 'false'], { cwd: this.rootDir });
    this.initialized = true;
  }

  async cloneOrInit() {
    this.logger.info(`克隆仓库 ${this.remoteUrl} -> ${this.rootDir}`);
    const clone = await this.git.run(['clone', '--branch', this.branch, this.remoteUrl, '.'], {
      cwd: this.rootDir,
      token: this.authToken(),
      timeout: 900000,
    });
    if (clone.code === 0) return;

    this.logger.warn(`克隆失败，尝试本地初始化: ${(clone.stderr || '').slice(0, 300)}`);
    const init = await this.git.run(['init', '-b', this.branch, '.'], { cwd: this.rootDir });
    if (init.code !== 0) throw new HttpError(500, `无法初始化本地 Git 仓库：${init.stderr}`);
    await this.git.run(['remote', 'add', 'origin', this.remoteUrl], { cwd: this.rootDir });
  }

  async fetchRemote() {
    return this.git.run(['fetch', 'origin', '--prune'], {
      cwd: this.rootDir,
      token: this.authToken(),
      timeout: 300000,
    });
  }

  /** 拉取远端到本地（丢弃本地缓存中的未提交修改，因为所有修改都会立即推送）。 */
  async pull({ strict = false } = {}) {
    await this.ensure();
    return this.mutex.run(async () => {
      const fetchRes = await this.fetchRemote();
      if (fetchRes.code !== 0) {
        const msg = (fetchRes.stderr || fetchRes.stdout || '').trim();
        this.lastSyncError = msg || '拉取失败';
        this.logger.warn(`fetch 失败：${msg.slice(0, 500)}`);
        if (strict) throw new HttpError(502, this.friendlyGitError(msg));
        return { ok: false, error: msg };
      }
      const hasRemote = await this.git.run(['rev-parse', '--verify', `refs/remotes/origin/${this.branch}`], {
        cwd: this.rootDir,
      });
      if (hasRemote.code === 0) {
        const reset = await this.git.run(['reset', '--hard', `origin/${this.branch}`], { cwd: this.rootDir });
        if (reset.code !== 0) this.logger.warn(`reset 失败：${reset.stderr}`);
        await this.git.run(['clean', '-fd'], { cwd: this.rootDir });
      }
      this.lastSync = new Date().toISOString();
      this.lastSyncError = null;
      return { ok: true };
    });
  }

  /**
   * 原子变更：pull -> fn() -> commit -> push；非快进冲突时重试。
   * @param {() => Promise<void>} fn 幂等的修改动作
   * @param {string} message 提交信息
   */
  async mutate(fn, message, { retries = 3 } = {}) {
    await this.ensure();
    return this.mutex.run(async () => {
      let lastError = null;
      for (let attempt = 1; attempt <= retries; attempt += 1) {
        if (attempt > 1) {
          this.logger.info(`推送冲突，第 ${attempt} 次重试：${message}`);
          await new Promise((r) => setTimeout(r, 600 * attempt));
        }
        const pullRes = await this.fetchRemote();
        if (pullRes.code !== 0) {
          const msg = (pullRes.stderr || pullRes.stdout || '').trim();
          throw new HttpError(502, this.friendlyGitError(msg));
        }
        const hasRemote = await this.git.run(['rev-parse', '--verify', `refs/remotes/origin/${this.branch}`], {
          cwd: this.rootDir,
        });
        if (hasRemote.code === 0) {
          await this.git.run(['reset', '--hard', `origin/${this.branch}`], { cwd: this.rootDir });
          await this.git.run(['clean', '-fd'], { cwd: this.rootDir });
        }

        await fn();

        const add = await this.git.run(['add', '-A'], { cwd: this.rootDir });
        if (add.code !== 0) throw new HttpError(500, `git add 失败：${add.stderr}`);
        const status = await this.git.run(['status', '--porcelain'], { cwd: this.rootDir });
        const changed = (status.stdout || '').trim().length > 0;
        if (!changed) {
          this.lastSync = new Date().toISOString();
          return { ok: true, noop: true, commit: null };
        }

        const commit = await this.git.run(['commit', '-m', message], { cwd: this.rootDir, timeout: 120000 });
        if (commit.code !== 0) {
          throw new HttpError(500, `git commit 失败：${(commit.stderr || commit.stdout).slice(0, 500)}`);
        }
        const hash = await this.git.run(['rev-parse', '--short', 'HEAD'], { cwd: this.rootDir });

        const push = await this.git.run(['push', 'origin', `HEAD:refs/heads/${this.branch}`], {
          cwd: this.rootDir,
          token: this.authToken(),
          timeout: 600000,
        });
        if (push.code === 0) {
          this.lastSync = new Date().toISOString();
          this.lastSyncError = null;
          this.logger.info(`已推送 ${hash.stdout.trim()}：${message}`);
          return { ok: true, commit: hash.stdout.trim(), message };
        }

        const stderr = (push.stderr || push.stdout || '').trim();
        lastError = stderr;
        const conflict = /non-fast-forward|\[rejected\]|fetch first|failed to push/i.test(stderr);
        if (!conflict) {
          throw new HttpError(502, this.friendlyGitError(stderr));
        }
      }
      throw new HttpError(409, `多次重试后仍无法推送，请稍后再试。\n${this.friendlyGitError(lastError || '')}`);
    });
  }

  friendlyGitError(raw) {
    const text = String(raw || '');
    if (/Permission denied \(publickey\)|Could not read from remote repository/i.test(text)) {
      return 'SSH 认证失败：本机未配置可用的 GitHub SSH Key。请在登录页改用 HTTPS 地址 + Token，或先配置 ssh-agent 与密钥。';
    }
    if (/Authentication failed|could not read Username|terminal prompts disabled|403/i.test(text)) {
      return 'GitHub 认证失败：Token 可能已过期，或没有该仓库的写入权限。请在「设置」中更新 Token。';
    }
    if (/Repository not found|404/i.test(text)) {
      return '仓库不存在或当前账号无权访问。请确认仓库名称与权限（私有仓库需要 repo 权限）。';
    }
    if (/Could not resolve host|unable to access|Failed to connect|network|timed out/i.test(text)) {
      return '无法连接 GitHub，请检查网络或代理设置。';
    }
    if (/Permission denied|fatal: could not create work tree/i.test(text)) {
      return '本地缓存目录不可写，请在「设置」中更换数据目录。';
    }
    return text.slice(0, 800) || 'Git 操作失败';
  }

  async isGitRepo() {
    return fs.existsSync(path.join(this.rootDir, '.git'));
  }

  async info() {
    const det = await this.git.detect();
    return {
      provider: 'git',
      owner: this.config.owner,
      repo: this.config.repo,
      branch: this.branch,
      remoteUrl: this.remoteUrl,
      protocol: this.config.protocol,
      gitChannel: det.mode,
      gitLabel: det.label,
      gitVersion: det.version,
      wslError: det.wslError || null,
      lastSync: this.lastSync,
      lastSyncError: this.lastSyncError,
      cacheDir: this.rootDir,
    };
  }
}

module.exports = { GitRepoStorage };
