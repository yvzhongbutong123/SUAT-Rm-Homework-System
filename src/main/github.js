'use strict';

/**
 * GitHub REST API 客户端。
 * 只依赖注入的 fetch（Electron 主进程传入 net.fetch 以走系统代理；测试时用全局 fetch）。
 */
class GithubApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

class GithubClient {
  constructor({ token, fetchImpl, userAgent = 'RM-Homework-App' }) {
    this.token = token;
    this.fetch = fetchImpl || globalThis.fetch;
    this.userAgent = userAgent;
    this.scopes = null;
  }

  async request(url, options = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': this.userAgent,
      ...(options.headers || {}),
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res;
    try {
      res = await this.fetch(url, { ...options, headers });
    } catch (err) {
      throw new GithubApiError(0, `无法连接 GitHub：${err.message}`);
    }
    const scopeHeader = res.headers.get('x-oauth-scopes');
    if (scopeHeader != null) this.scopes = scopeHeader.split(',').map((s) => s.trim()).filter(Boolean);
    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!res.ok) {
      const msg = body && body.message ? body.message : `GitHub API ${res.status}`;
      throw new GithubApiError(res.status, msg, { body, status: res.status });
    }
    return body;
  }

  api(path, options) {
    return this.request(`https://api.github.com${path}`, options);
  }

  async getUser() {
    const user = await this.api('/user');
    return {
      login: user.login,
      id: user.id,
      name: user.name || user.login,
      avatarUrl: user.avatar_url,
      htmlUrl: user.html_url,
      publicRepos: user.public_repos,
    };
  }

  async getRepo(owner, repo) {
    try {
      const data = await this.api(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
      return {
        exists: true,
        owner: data.owner.login,
        name: data.name,
        fullName: data.full_name,
        private: data.private,
        defaultBranch: data.default_branch,
        permissions: data.permissions || null,
        size: data.size,
        updatedAt: data.updated_at,
        htmlUrl: data.html_url,
      };
    } catch (err) {
      if (err instanceof GithubApiError && err.status === 404) return { exists: false };
      throw err;
    }
  }

  async createRepo({ name, private: isPrivate = true, description = '' }) {
    return this.request('https://api.github.com/user/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        private: isPrivate,
        description,
        auto_init: false,
        has_issues: false,
        has_wiki: false,
        has_projects: false,
      }),
    });
  }

  async getAuthenticatedUserScopes() {
    await this.api('/user');
    return this.scopes;
  }

  /** 设备码流程：申请设备码。 */
  async startDeviceFlow(clientId, scope = 'repo') {
    const res = await this.request('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scope }).toString(),
    });
    return res;
  }

  /** 设备码流程：轮询换取 token。 */
  async pollDeviceFlow(clientId, deviceCode) {
    const res = await this.request('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString(),
    });
    return res;
  }

  /** 读取仓库根目录清单（用于初始化检测）。 */
  async listContents(owner, repo, path = '') {
    return this.api(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`);
  }
}

module.exports = { GithubClient, GithubApiError };
