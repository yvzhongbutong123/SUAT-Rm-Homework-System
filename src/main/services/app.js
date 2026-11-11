'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createStorage } = require('../storage');
const { buildTemplateFiles, TEAMS_JSON, GROUPS } = require('../storage/demo-seed');
const { GithubClient } = require('../github');
const { zipDirectory } = require('../zip');
const { CredentialCipher } = require('../credentials');
const { AccountStore } = require('../accounts');
const { parseRepoUrl, DEFAULT_REPO_URL } = require('../repo-url');
const { HttpError, isWeekName, isValidLogin, GROUP_IDS, walkFiles, nowIso, Mutex, randomId } = require('../util');
const pkg = require('../../../package.json');
const { checkUpdate } = require('../updater');

const BUILTIN_LEADER_CODE = 'pxr20080819Q';
const BUILTIN_CAPTAIN_CODE = '1145141919810';
const SYSTEM_FILES = new Set(['submission.json', 'evaluation.json', '.gitkeep']);

/** 小组对应的目录名（优先 teams.json 的 folder，其次中文组名，最后 id）。 */
function folderOf(teams, groupId) {
  const list = (teams && teams.groups) || GROUPS;
  const g = list.find((x) => x.id === groupId);
  return (g && (g.folder || g.name)) || groupId;
}

const DEFAULT_FOLDERS = { algo: '算法组', mech: '机械组', embedded: '嵌入式组' };

/**
 * 应用服务层：认证、成员、作业周、提交、批改、统计、通知。
 * 该层不关心 HTTP / Electron，可由测试直接实例化。
 */
class AppServices {
  constructor({ settings, logger, git, dataDir, fetchImpl, safeStorage }) {
    this.settings = settings;
    this.logger = logger;
    this.git = git;
    this.dataDir = dataDir;
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.cipher = new CredentialCipher(safeStorage);
    this.accounts = new AccountStore({ settings, cipher: this.cipher, logger });
    this.session = null; // { token, gh, user, demo }
    this.storage = null;
    this.mode = 'git';
    this.repoInfo = { exists: false };
    this.lastPullAt = 0;
    this.lock = new Mutex();
    this.restorePromise = null;
    this.warnings = [];
  }

  /* ------------------------------------------------------------------ */
  /* 基础                                                                */
  /* ------------------------------------------------------------------ */

  artifactDir() {
    const dir = path.join(this.dataDir, 'artifacts');
    fs.mkdirSync(dir, { recursive: true });
    // 清理 7 天前的导出包，避免长期运行占满磁盘
    try {
      const now = Date.now();
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.zip')) continue;
        const file = path.join(dir, name);
        const st = fs.statSync(file);
        if (now - st.mtimeMs > 7 * 24 * 60 * 60 * 1000) fs.rmSync(file, { force: true });
      }
    } catch {
      /* ignore */
    }
    return dir;
  }

  requireSession() {
    if (!this.session) throw new HttpError(401, '请先登录');
    return this.session;
  }

  isLeader() {
    return !!this.session && ['leader', 'captain'].includes(this.session.user.role);
  }

  isCaptain() {
    return !!this.session && this.session.user.role === 'captain';
  }

  isDemo() {
    return this.mode === 'demo';
  }

  requireLeader() {
    this.requireSession();
    if (!this.isLeader()) throw new HttpError(403, '仅组长可执行此操作');
  }

  /** 组长负责的组；null 表示未分配小组（按全部处理）或队长。 */
  leaderGroup() {
    if (!this.session) return null;
    if (this.session.user.role === 'captain') return null;
    return this.session.user.role === 'leader' ? this.session.user.group || null : null;
  }

  /** 当前账号的数据范围：组员=自己的组，组长=负责组（未分配则全部），队长=全部。 */
  scopeGroup() {
    if (!this.session) return null;
    if (this.session.user.role === 'captain') return null;
    return this.session.user.group || null;
  }

  canManageGroup(group) {
    if (!this.isLeader()) return false;
    const scope = this.leaderGroup();
    return scope === null || scope === group;
  }

  /** 查找成员提交目录（兼容新结构 WeekNN/组名/submissions/login 与旧结构）。 */
  async submissionRel(week, login) {
    const storage = this.storageOrThrow();
    const membersData = await this.getMembers();
    const group = (membersData.members[login] || {}).group || null;
    const candidates = [];
    if (group) {
      let teams = null;
      try {
        teams = await this.getTeams();
      } catch {
        teams = null;
      }
      const folder = folderOf(teams, group);
      candidates.push(`${week}/${folder}/submissions/${login}`);
      candidates.push(`${week}/submissions/${group}/${login}`);
    }
    candidates.push(`${week}/submissions/${login}`);
    for (const rel of candidates) {
      if (await storage.isDir(rel)) return rel;
    }
    return null;
  }

  submissionWriteRel(week, login, group, folder) {
    if (!group) return `${week}/submissions/${login}`;
    return `${week}/${folder || DEFAULT_FOLDERS[group] || group}/submissions/${login}`;
  }

  /** 成员是否在组长的管理范围内（待分组成员对所有组长可见，可被认领）。 */
  async assertManageable(login) {
    const membersData = await this.getMembers();
    const target = membersData.members[login];
    if (!target) throw new HttpError(404, '成员不存在');
    if (target.role === 'captain') throw new HttpError(403, '队长账号不可被管理');
    if (this.isCaptain()) return target;
    if (this.leaderGroup() === null) return target;
    if (!target.group || target.group === this.leaderGroup()) return target;
    throw new HttpError(403, `你只能管理${this.leaderGroup()}组的成员`);
  }

  storageOrThrow() {
    if (!this.storage) throw new HttpError(409, '仓库尚未初始化', { code: 'REPO_NOT_READY' });
    return this.storage;
  }

  async getTeams() {
    const data = this.storage ? await this.storage.readJson('teams.json') : null;
    return data || JSON.parse(JSON.stringify(TEAMS_JSON));
  }

  async getMembers() {
    const storage = this.storageOrThrow();
    const data = await storage.readJson('members.json');
    if (!data || typeof data !== 'object') return { version: 1, members: {} };
    if (!data.members) data.members = {};
    return data;
  }

  /** 缓存账号角色（GitHub members.json 为权威来源，本地仅作离线兜底与展示）。 */
  cacheRole(login, role, group) {
    const cache = this.settings.data.roleCache || {};
    cache[login] = { role, group: group || null, syncedAt: nowIso() };
    this.settings.data.roleCache = cache;
    this.settings.save();
  }

  cachedRole(login) {
    return (this.settings.data.roleCache || {})[login] || null;
  }

  /** 从 members.json 刷新当前会话的角色与分组（组长分配后无需重新登录）。 */
  async refreshSession() {
    if (!this.session || !this.storage || this.session.demo) return;
    try {
      const data = await this.getMembers();
      const record = data.members[this.session.user.login];
      if (!record) return;
      const role = record.role === 'captain' ? 'captain' : record.role === 'leader' ? 'leader' : 'member';
      const group = record.group || null;
      if (role !== this.session.user.role || group !== this.session.user.group) {
        this.logger.info(`会话权限更新 ${this.session.user.login}: ${this.session.user.role}/${this.session.user.group} -> ${role}/${group}`);
        this.session.user.role = role;
        this.session.user.group = group;
      }
      if (record.name) this.session.user.name = record.name;
      this.session.user.pendingGroup = !group && role === 'member';
      const prevCache = this.cachedRole(this.session.user.login);
      const stale =
        !prevCache ||
        prevCache.role !== role ||
        prevCache.group !== group ||
        Date.now() - new Date(prevCache.syncedAt || 0).getTime() > 10 * 60 * 1000;
      if (stale) this.cacheRole(this.session.user.login, role, group);
    } catch {
      /* ignore */
    }
  }

  async pullThrottled(minMs = 1500) {
    if (!this.storage) return;
    const now = Date.now();
    if (now - this.lastPullAt < minMs) return;
    this.lastPullAt = now;
    try {
      await this.storage.pull();
    } catch (err) {
      this.logger.warn(`同步失败：${err.message}`);
      this.warnings.push(`同步失败：${err.message}`);
    }
  }

  async restore() {
    if (this.restorePromise) return this.restorePromise;
    this.restorePromise = (async () => {
      if (this.settings.data.autoLogin === false) return null;
      const latest = this.accounts.latest();
      const token = latest ? this.accounts.tokenFor(latest.login) : this.settings.getToken();
      const last = latest ? latest.login : this.settings.data.lastLogin;
      if (!token || !last) return null;
      try {
        const result = await this.login({ token, silent: true, remember: false });
        // 打开时合并本地与远程成员表，再做一次成员检索
        try {
          await this.mergeMembers();
        } catch (err) {
          this.logger.warn(`成员合并失败：${err.message}`);
        }
        try {
          await this.ensureMembership();
        } catch (err) {
          this.logger.warn(`成员检索失败：${err.message}`);
        }
        return result;
      } catch (err) {
        this.logger.warn(`自动恢复登录失败：${err.message}`);
        if (latest && /401|Bad credentials|登录失败|Unauthorized/i.test(err.message)) {
          this.accounts.remove(latest.login);
          this.logger.info(`已移除失效账号 ${latest.login}`);
        }
        return null;
      }
    })();
    return this.restorePromise;
  }

  /* ------------------------------------------------------------------ */
  /* 登录 / 仓库                                                         */
  /* ------------------------------------------------------------------ */

  /** 合并本地缓存与 GitHub 上的 members.json：远程为准，本地独有的成员补进远程。 */
  async mergeMembers() {
    if (!this.session || this.session.demo || !this.storage) return { merged: 0 };
    const local = await this.getMembers().catch(() => ({ members: {} }));
    const localMembers = { ...(local.members || {}) };
    if (!Object.keys(localMembers).length) return { merged: 0 };
    await this.storage.pull({ strict: false }).catch(() => {});
    const remote = await this.getMembers().catch(() => ({ members: {} }));
    const missing = Object.entries(localMembers).filter(([login]) => !remote.members[login]);
    if (!missing.length) return { merged: 0 };
    if (this.repoInfo && this.repoInfo.permissions && this.repoInfo.permissions.push === false) {
      return { merged: 0, reason: 'no-write' };
    }
    await this.storage.mutate(async () => {
      const fresh = await this.getMembers();
      for (const [login, record] of missing) {
        if (!fresh.members[login]) fresh.members[login] = record;
      }
      fresh.version = 1;
      fresh.updatedAt = nowIso();
      await this.storage.writeJsonRaw('members.json', fresh);
    }, 'chore(members): 合并本地成员');
    this.logger.info(`已合并 ${missing.length} 个本地成员到 members.json`);
    return { merged: missing.length };
  }

  /** 打开时检索 members.json：没有当前账号就写入（未分组组员），有则继续。 */
  async ensureMembership() {
    if (!this.session || this.session.demo || !this.storage) {
      return { existed: true, added: false };
    }
    const login = this.session.user.login;
    const data = await this.getMembers();
    if (data.members[login]) {
      this.session.user.pendingGroup = data.members[login].role === 'member' && !data.members[login].group;
      return { existed: true, added: false };
    }
    if (this.repoInfo && this.repoInfo.permissions && this.repoInfo.permissions.push === false) {
      return { existed: false, added: false, reason: 'no-write' };
    }
    await this.storage.mutate(async () => {
      const fresh = await this.getMembers();
      if (fresh.members[login]) return;
      fresh.version = 1;
      fresh.updatedAt = nowIso();
      fresh.members[login] = {
        role: 'member',
        group: null,
        name: this.session.user.name || login,
        createdAt: nowIso(),
        pendingGroup: true,
      };
      await this.storage.writeJsonRaw('members.json', fresh);
    }, `chore(members): 检索并登记 ${login}`);
    this.session.user.role = 'member';
    this.session.user.group = null;
    this.session.user.pendingGroup = true;
    this.logger.info(`members.json 未找到 ${login}，已登记为待分组组员`);
    return { existed: false, added: true };
  }

  async login({ token, repoUrl, silent = false, remember = true, accountLogin = null }) {
    if (!token && accountLogin) {
      token = this.accounts.tokenFor(accountLogin);
      if (!token) throw new HttpError(400, '该账号没有保存的 Token，请重新输入');
    }
    if (!token || typeof token !== 'string' || token.trim().length < 10) {
      throw new HttpError(400, '请输入有效的 GitHub Token');
    }
    this.warnings = [];
    const clean = token.trim();
    const gh = new GithubClient({ token: clean, fetchImpl: this.fetchImpl });
    let user;
    try {
      user = await gh.getUser();
    } catch (err) {
      throw new HttpError(401, `GitHub 登录失败：${err.message}`);
    }

    const saved = this.settings.data.repo || {};
    const inputUrl = String(repoUrl || saved.url || DEFAULT_REPO_URL).trim();
    let parsed;
    try {
      parsed = parseRepoUrl(inputUrl);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    const branch = saved.branch || 'main';

    let protocol = parsed.protocol;
    // 上次已确认 SSH 不可用时不重复探测
    if (protocol === 'ssh' && inputUrl === saved.url && saved.protocol === 'https') {
      protocol = 'https';
    } else if (protocol === 'ssh') {
      const probe = await this.git.run(['ls-remote', '--heads', parsed.sshUrl], { timeout: 6000 });
      if (probe.code !== 0) {
        protocol = 'https';
        this.warnings.push('未检测到可用的 SSH 密钥，本次已改用 HTTPS + Token 访问仓库。');
        this.logger.warn(`SSH 探测失败，回退 HTTPS：${(probe.stderr || '').slice(0, 200)}`);
      }
    }
    const effectiveUrl = protocol === 'ssh' ? parsed.sshUrl : parsed.httpsUrl;

    const owner = parsed.owner;
    let repo;
    try {
      repo = await gh.getRepo(owner, parsed.name);
    } catch (err) {
      throw new HttpError(502, `无法读取仓库信息：${err.message}`);
    }
    if (!repo.exists && protocol === 'ssh') {
      // Token 可能无权访问，但 SSH 可用：仍尝试克隆
      repo = {
        exists: true,
        owner,
        name: parsed.name,
        private: true,
        defaultBranch: branch,
        permissions: null,
        htmlUrl: parsed.webUrl,
        viaSsh: true,
      };
    }

    this.mode = 'git';
    this.repoInfo = repo;
    this.session = { token: clean, gh, user: { ...user, role: 'member', group: null }, demo: false };
    this.settings.setToken(clean);
    this.settings.patch({
      mode: 'git',
      repo: { ...saved, owner, name: parsed.name, branch, url: effectiveUrl, protocol },
      lastLogin: user.login,
    });

    // 记住账号（默认开启）；保存的是加密后的 Token
    if (remember !== false) {
      this.accounts.upsert(user, clean);
    } else {
      this.accounts.touch(user.login);
    }

    if (!repo.exists) {
      this.storage = null;
      return this.buildLoginResult({ needSetup: true, canWrite: false, warnings: [] });
    }

    this.storage = createStorage({
      mode: 'git',
      dataDir: this.dataDir,
      git: this.git,
      logger: this.logger,
      config: {
        owner,
        repo: parsed.name,
        branch,
        token: clean,
        login: user.login,
        repoUrl: effectiveUrl,
        protocol,
      },
    });

    // 在 pull（reset --hard）之前备份本地成员表，pull 后再与云端合并
    let localMembersBeforePull = null;
    try {
      localMembersBeforePull = await this.storage.readJson('members.json');
    } catch {
      localMembersBeforePull = null;
    }

    try {
      await this.storage.ensure();
      const pull = await this.storage.pull();
      if (!pull.ok) this.warnings.push('当前使用本地缓存（拉取失败），数据可能不是最新的。');
    } catch (err) {
      this.storage = null;
      throw new HttpError(502, `无法初始化本地仓库缓存：${err.message}`);
    }

    const teams = await this.getTeams();
    let membersData = await this.getMembers();
    const canWrite = this.repoInfo.permissions ? this.repoInfo.permissions.push !== false : true;
    if (!canWrite) {
      this.warnings.push('当前 Token 没有该仓库的写入权限，提交作业、批改与发布将会失败，请更换 Token 或检查权限。');
    }

    // 把 pull 前本地独有的成员补回云端（本地与 GitHub 合并）
    if (localMembersBeforePull && localMembersBeforePull.members && canWrite) {
      const missing = Object.entries(localMembersBeforePull.members).filter(
        ([login]) => !membersData.members[login],
      );
      if (missing.length) {
        try {
          await this.storage.mutate(async () => {
            const fresh = await this.getMembers();
            for (const [login, rec] of missing) {
              if (!fresh.members[login]) fresh.members[login] = rec;
            }
            fresh.version = 1;
            fresh.updatedAt = nowIso();
            await this.storage.writeJsonRaw('members.json', fresh);
          }, 'chore(members): 合并本地成员');
          membersData = await this.getMembers();
          this.logger.info(`登录时合并了 ${missing.length} 个本地成员`);
        } catch (err) {
          this.warnings.push('合并本地成员失败：' + err.message);
        }
      }
    }
    const record = membersData.members[user.login];

    if (record) {
      this.session.user.role =
        record.role === 'captain' ? 'captain' : record.role === 'leader' ? 'leader' : 'member';
      this.session.user.group = record.group || null;
      this.session.user.name = record.name || user.name;
      this.session.user.roleSince = record.createdAt || null;
    } else {
      // 未登记：自动登记为待分组组员（失败不阻塞登录）
      const entry = {
        role: 'member',
        group: null,
        name: user.name || user.login,
        createdAt: nowIso(),
        pendingGroup: true,
      };
      this.session.user.role = 'member';
      this.session.user.group = null;
      this.session.user.pendingGroup = true;
      // 自动登录（silent）也要登记，否则新组员会一直不出现在组长端
      if (canWrite) {
        try {
          await this.storage.mutate(async () => {
            const fresh = await this.getMembers();
            fresh.version = 1;
            fresh.updatedAt = nowIso();
            fresh.members[user.login] = entry;
            await this.storage.writeJsonRaw('members.json', fresh);
          }, `chore(members): 登记组员 ${user.login}`);
        } catch (err) {
          if (!silent) {
            this.warnings.push('自动登记成员失败（不影响浏览作业）：' + err.message);
          }
        }
      } else if (!silent) {
        this.warnings.push('当前 Token 没有作业仓库的写入权限，无法自动登记到成员表，请让组长手动添加或更换有写权限的 Token。');
      }
    }

    if (!this.session.user.group && this.session.user.role === 'member' && !this.session.user.pendingGroup) {
      this.session.user.pendingGroup = true;
    }
    this.cacheRole(user.login, this.session.user.role, this.session.user.group);

    return this.buildLoginResult({ needSetup: false, canWrite, teams });
  }

  async demoLogin({ login, role } = {}) {
    this.mode = 'demo';
    this.repoInfo = { exists: true, demo: true, permissions: { push: true } };
    this.storage = createStorage({ mode: 'demo', dataDir: this.dataDir, git: this.git, logger: this.logger });
    await this.storage.ensure();
    const membersData = await this.getMembers();
    const members = membersData.members || {};
    let target = login && members[login] ? login : null;
    if (!target) {
      const captainEntry = Object.entries(members).find(([, m]) => m.role === 'captain');
      const leaderEntry = Object.entries(members).find(([, m]) => m.role === 'leader');
      const entry = captainEntry || leaderEntry;
      target = entry ? entry[0] : Object.keys(members)[0];
    }
    if (!target) throw new HttpError(500, '演示数据缺失');

    const record = members[target];
    const roleValue =
      role === 'captain'
        ? 'captain'
        : role === 'leader'
          ? 'leader'
          : record.role === 'captain'
            ? 'captain'
            : record.role === 'leader'
              ? 'leader'
              : 'member';
    this.session = {
      token: null,
      gh: null,
      demo: true,
      user: {
        login: target,
        name: record.name || target,
        avatarUrl: null,
        htmlUrl: null,
        role: roleValue,
        group: record.group || null,
        pendingGroup: !record.group && roleValue === 'member',
        demo: true,
      },
    };
    this.settings.patch({ mode: 'demo', lastLogin: target });
    return this.buildLoginResult({ needSetup: false, canWrite: true });
  }

  async logout({ forget = false } = {}) {
    const login = this.session && this.session.user ? this.session.user.login : null;
    if (forget && login) this.accounts.remove(login);
    this.session = null;
    this.storage = null;
    this.repoInfo = { exists: false };
    this.mode = 'git';
    this.settings.setToken(null);
    this.settings.patch({ lastLogin: '' });
    return { ok: true };
  }

  /* ------------------------------------------------------------------ */
  /* 已保存账号                                                          */
  /* ------------------------------------------------------------------ */

  async listAccounts() {
    return {
      accounts: this.accounts.list(),
      autoLogin: this.settings.data.autoLogin !== false,
      cipher: this.cipher.mode,
      current: this.session && this.session.user ? this.session.user.login : null,
    };
  }

  async removeAccount(login) {
    if (!isValidLogin(login)) throw new HttpError(400, '账号名不合法');
    this.accounts.remove(login);
    if (this.settings.data.lastLogin === login) this.settings.patch({ lastLogin: '' });
    // 清除当前进程内的 Token，避免移除后仍能自动登录
    if (this.settings.getToken()) this.settings.setToken(null);
    return { ok: true, accounts: this.accounts.list() };
  }

  async clearAccounts() {
    this.accounts.clear();
    this.settings.patch({ lastLogin: '' });
    this.settings.setToken(null);
    return { ok: true, accounts: [] };
  }

  buildLoginResult(extra = {}) {
    const user = this.session ? this.session.user : null;
    return {
      user,
      mode: this.mode,
      repo: {
        owner: this.repoInfo.owner || this.settings.data.repo.owner,
        name: this.repoInfo.name || this.settings.data.repo.name,
        exists: !!this.repoInfo.exists,
        private: this.repoInfo.private,
        htmlUrl: this.repoInfo.htmlUrl || null,
        defaultBranch: this.repoInfo.defaultBranch || this.settings.data.repo.branch,
        url: this.settings.data.repo.url,
        protocol: this.settings.data.repo.protocol,
        canWrite: extra.canWrite != null ? extra.canWrite : true,
      },
      needSetup: !!extra.needSetup,
      warnings: this.warnings.slice(),
      ...extra,
    };
  }

  async me() {
    if (!this.session) {
      // 登录页需要展示可选的演示账号
      const demoUsers = await this.demoUsers().catch(() => []);
      return { authenticated: false, mode: this.mode, demoUsers };
    }
    const unread = await this.getNotifications().catch(() => ({ unreadCount: 0 }));
    let pendingCount = 0;
    if (this.isLeader() && this.storage) {
      try {
        const data = await this.getMembers();
        pendingCount = Object.values(data.members || {}).filter(
          (m) => m.role === 'member' && !m.group,
        ).length;
      } catch {
        pendingCount = 0;
      }
    }
    let gitInfo = null;
    try {
      gitInfo = this.storage ? await this.storage.info() : await this.git.detect();
    } catch {
      gitInfo = null;
    }
    return {
      authenticated: true,
      user: this.session.user,
      mode: this.mode,
      needSetup: !this.storage,
      scope: this.scopeGroup(),
      roleInfo: {
        role: this.session.user.role,
        group: this.session.user.group,
        syncedAt: (this.cachedRole(this.session.user.login) || {}).syncedAt || null,
        source: 'github:members.json',
      },
      repo: {
        owner: this.settings.data.repo.owner,
        name: this.settings.data.repo.name,
        branch: this.settings.data.repo.branch,
        url: this.settings.data.repo.url,
        protocol: this.settings.data.repo.protocol,
        exists: !!this.repoInfo.exists,
        htmlUrl: this.repoInfo.htmlUrl || null,
        canWrite: this.repoInfo.permissions ? this.repoInfo.permissions.push !== false : true,
      },
      git: gitInfo,
      unreadCount: unread.unreadCount,
      pendingCount,
      warnings: this.warnings.slice(-5),
    };
  }

  async demoUsers() {
    if (!this.storage) {
      const tmp = createStorage({ mode: 'demo', dataDir: this.dataDir, git: this.git, logger: this.logger });
      await tmp.ensure();
      const data = (await tmp.readJson('members.json')) || { members: {} };
      return Object.entries(data.members).map(([login, m]) => ({ login, ...m }));
    }
    const data = await this.getMembers();
    return Object.entries(data.members).map(([login, m]) => ({ login, ...m }));
  }

  /** 校验兑换码：组长码提升为组长，队长码提升为队长（全队管理）。 */
  async redeem(code) {
    const session = this.requireSession();
    const trimmed = String(code || '').trim();
    const teams = await this.getTeams();
    const captainCodes = [BUILTIN_CAPTAIN_CODE, ...(teams.captainRedeemCodes || [])];
    const leaderCodes = [BUILTIN_LEADER_CODE, ...(teams.leaderRedeemCodes || [])];

    let targetRole = null;
    if (trimmed && captainCodes.includes(trimmed)) targetRole = 'captain';
    else if (trimmed && leaderCodes.includes(trimmed)) targetRole = 'leader';
    if (!targetRole) throw new HttpError(400, '兑换码无效，请联系现任组长或队长获取');

    if (session.user.role === targetRole) {
      return { ok: true, already: true, user: session.user, role: targetRole };
    }
    if (session.user.role === 'captain' && targetRole === 'leader') {
      return { ok: true, already: true, user: session.user, role: 'captain' };
    }

    const roleLabel = targetRole === 'captain' ? '队长' : '组长';
    const storage = this.storageOrThrow();
    await storage.mutate(async () => {
      const fresh = await this.getMembers();
      fresh.version = 1;
      fresh.updatedAt = nowIso();
      const prev = fresh.members[session.user.login] || {};
      fresh.members[session.user.login] = {
        ...prev,
        role: targetRole,
        group: targetRole === 'captain' ? null : prev.group || null,
        name: prev.name || session.user.name,
        createdAt: prev.createdAt || nowIso(),
        promotedAt: nowIso(),
      };
      await storage.writeJsonRaw('members.json', fresh);
    }, `chore(members): 将 ${session.user.login} 提升为${roleLabel}`);

    // 校验角色确实已写入 GitHub，避免"界面是队长、重启后丢失"
    await storage.pull({ strict: true });
    const verify = await this.getMembers();
    const saved = verify.members[session.user.login];
    if (!saved || saved.role !== targetRole) {
      throw new HttpError(502, `${roleLabel}状态未能写入 GitHub，请检查 Token 是否有该仓库的写权限后重试`);
    }

    session.user.role = targetRole;
    session.user.group = saved.group || null;
    session.user.pendingGroup = false;
    this.cacheRole(session.user.login, targetRole, session.user.group);
    return { ok: true, user: session.user, role: targetRole };
  }

  /**
   * 初始化 / 连接仓库。
   * 首次使用时：创建私有仓库 Rm-Homework，写入模板，并将当前用户设为组长。
   */
  async bootstrap({ code, repoName, isPrivate = true } = {}) {
    const session = this.requireSession();
    const teams = await this.getTeams().catch(() => JSON.parse(JSON.stringify(TEAMS_JSON)));
    const captainCodes = [BUILTIN_CAPTAIN_CODE, ...(teams.captainRedeemCodes || [])];
    const leaderCodes = [BUILTIN_LEADER_CODE, ...(teams.leaderRedeemCodes || [])];
    const codeStr = String(code || '').trim();
    const isCaptainCode = captainCodes.includes(codeStr);
    if (!isCaptainCode && !leaderCodes.includes(codeStr)) {
      throw new HttpError(403, '初始化仓库需要组长或队长兑换码');
    }
    const initialRole = isCaptainCode ? 'captain' : 'leader';

    const gh = session.gh;
    const owner = this.settings.data.repo.owner || session.user.login;
    const name = (repoName || this.settings.data.repo.name || 'Rm-Homework').trim();
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw new HttpError(400, '仓库名称不合法');

    let repo = await gh.getRepo(owner, name);
    const repoExistsBefore = repo.exists;
    if (!repo.exists) {
      this.logger.info(`创建仓库 ${owner}/${name}`);
      await gh.createRepo({ name, private: isPrivate, description: 'RoboMaster 战队作业仓库（由 RM Homework 客户端维护）' });
      // GitHub 创建后可能有短暂延迟
      for (let i = 0; i < 8; i += 1) {
        repo = await gh.getRepo(owner, name).catch(() => ({ exists: false }));
        if (repo.exists) break;
        await new Promise((r) => setTimeout(r, 700));
      }
      if (!repo.exists) throw new HttpError(502, '仓库创建成功但暂时无法读取，请稍后重试');
    }

    const branch = repo.defaultBranch || 'main';
    this.repoInfo = repo;
    const httpsUrl = `https://github.com/${owner}/${name}.git`;
    this.settings.patch({
      repo: { ...this.settings.data.repo, owner, name, branch, url: httpsUrl, protocol: 'https' },
    });
    this.storage = createStorage({
      mode: 'git',
      dataDir: this.dataDir,
      git: this.git,
      logger: this.logger,
      config: {
        owner,
        repo: name,
        branch,
        token: session.token,
        login: session.user.login,
        repoUrl: httpsUrl,
        protocol: 'https',
      },
    });
    await this.storage.ensure();

    // 先同步一次，避免把远端已有内容当成空仓库而重复初始化
    await this.storage.pull().catch(() => {});
    const existingMembers = await this.storage.readJson('members.json').catch(() => null);
    const createdRepo = !repoExistsBefore;
    if (!existingMembers) {
      await this.storage.mutate(async () => {
        for (const item of buildTemplateFiles(session.user.login)) {
          const abs = this.storage.resolve(item.rel);
          await fsp.mkdir(path.dirname(abs), { recursive: true });
          await fsp.writeFile(abs, item.content, 'utf8');
        }
        // 保证当前用户是队长/组长
        const members = await this.storage.readJson('members.json').catch(() => null);
        if (members) {
          members.members[session.user.login] = {
            role: initialRole,
            group: null,
            name: session.user.name,
            createdAt: nowIso(),
            promotedAt: nowIso(),
          };
          await this.storage.writeJsonRaw('members.json', members);
        }
      }, 'chore(init): 初始化 Rm-Homework 仓库结构');
      session.user.role = initialRole;
      session.user.group = null;
      session.user.pendingGroup = false;
      this.cacheRole(session.user.login, initialRole, null);
      this.settings.patch({ lastLogin: session.user.login });
      return { ok: true, createdRepo, repo: this.repoInfo, user: session.user };
    }

    // 已初始化：按 members.json 修正角色
    const record = existingMembers.members[session.user.login];
    if (record) {
      session.user.role =
        record.role === 'captain' ? 'captain' : record.role === 'leader' ? 'leader' : 'member';
      session.user.group = record.group || null;
      session.user.name = record.name || session.user.name;
    }
    return { ok: true, createdRepo: false, repo: this.repoInfo, user: session.user };
  }

  /**
   * 初始化模板文件（当仓库已存在但缺少 members.json 时使用）。
   * 与 bootstrap 分离，方便组长在设置中"补写模板"。
   */
  async writeTemplates() { await this.refreshSession();
    this.requireLeader();
    const storage = this.storageOrThrow();
    await storage.pull({ strict: true });
    await storage.mutate(async () => {
      const exists = await storage.readJson('members.json');
      if (exists) return;
      for (const item of buildTemplateFiles(this.session.user.login)) {
        const abs = storage.resolve(item.rel);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        // 不覆盖已有文件
        if (!fs.existsSync(abs)) await fsp.writeFile(abs, item.content, 'utf8');
      }
    }, 'chore(init): 补写模板文件');
    return { ok: true };
  }

  /* ------------------------------------------------------------------ */
  /* 设置                                                               */
  /* ------------------------------------------------------------------ */

  async getSettings() {
    const data = this.settings.get();
    return {
      mode: this.mode,
      repo: data.repo,
      gitMode: data.gitMode,
      wslDistro: data.wslDistro,
      oauthClientId: data.oauthClientId,
      oss: data.oss,
      notifications: { enabled: data.notifications.enabled, pollSeconds: data.notifications.pollSeconds },
      autoLogin: data.autoLogin !== false,
      accounts: this.accounts.list(),
      dataDir: this.dataDir,
      hasToken: !!this.settings.getToken(),
      tokenEncrypted: !this.settings.tokenPlaintextFallback,
      cipher: this.cipher.mode,
    };
  }

  async updateSettings(patch = {}) {
    const allowed = {};
    if (patch.gitMode && ['auto', 'wsl', 'windows'].includes(patch.gitMode)) allowed.gitMode = patch.gitMode;
    if (typeof patch.wslDistro === 'string') allowed.wslDistro = patch.wslDistro.trim();
    if (typeof patch.oauthClientId === 'string') allowed.oauthClientId = patch.oauthClientId.trim();
    if (typeof patch.autoLogin === 'boolean') allowed.autoLogin = patch.autoLogin;
    if (patch.repo && typeof patch.repo.name === 'string') {
      const name = patch.repo.name.trim();
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw new HttpError(400, '仓库名称不合法');
      allowed.repo = { ...this.settings.data.repo, name };
    }
    if (patch.notifications) {
      allowed.notifications = {
        ...this.settings.data.notifications,
        enabled: patch.notifications.enabled !== false,
        pollSeconds: Math.min(300, Math.max(15, Number(patch.notifications.pollSeconds) || 25)),
      };
    }
    this.settings.patch(allowed);
    if (allowed.gitMode || allowed.wslDistro) {
      this.git.forcedMode = allowed.gitMode === 'auto' ? null : allowed.gitMode;
      this.git.forcedDistro = allowed.wslDistro || null;
      this.git.detected = null;
    }
    if (allowed.repo && this.session && !this.isDemo()) {
      await this.logout().catch(() => {});
      throw new HttpError(409, '仓库配置已更新，请重新登录以切换仓库', { reauth: true });
    }
    return this.getSettings();
  }

  async gitStatus(force = false) {
    const det = await this.git.detect(!!force);
    return det;
  }

  /* ------------------------------------------------------------------ */
  /* GitHub 设备码登录（可选）                                           */
  /* ------------------------------------------------------------------ */

  async startDeviceFlow({ clientId } = {}) {
    const id = String(clientId || this.settings.data.oauthClientId || '').trim();
    if (!id) throw new HttpError(400, '请先填写 OAuth App 的 Client ID');
    this.settings.patch({ oauthClientId: id });
    const gh = new GithubClient({ fetchImpl: this.fetchImpl });
    const res = await gh.startDeviceFlow(id, 'repo');
    if (!res || res.error) {
      throw new HttpError(400, `无法启动设备码登录：${(res && (res.error_description || res.error)) || '未知错误'}`);
    }
    this.logger.info(`设备码登录已启动，user_code=${res.user_code}`);
    return {
      client_id: id,
      device_code: res.device_code,
      user_code: res.user_code,
      verification_uri: res.verification_uri,
      expires_in: res.expires_in,
      interval: res.interval,
    };
  }

  async pollDeviceFlow({ clientId, deviceCode } = {}) {
    if (!clientId || !deviceCode) throw new HttpError(400, '设备码参数缺失');
    const gh = new GithubClient({ fetchImpl: this.fetchImpl });
    const res = await gh.pollDeviceFlow(clientId, deviceCode);
    return {
      accessToken: res.access_token || null,
      error: res.error || null,
      error_description: res.error_description || null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 周次与作业                                                          */
  /* ------------------------------------------------------------------ */

  async listWeeks() {
    const storage = this.storageOrThrow();
    await this.refreshSession();
    const [, teams] = await Promise.all([this.pullThrottled(), this.getTeams()]);
    const weekDirs = await storage.listWeekDirs();
    const user = this.session ? this.session.user : null;
    const isLeader = this.isLeader();
    const membersData = await this.getMembers().catch(() => ({ members: {} }));
    const scope = this.scopeGroup();
    const current = await this.currentWeek();
    const isUngroupedMember =
      this.session && this.session.user.role === 'member' && !this.session.user.group;
    const memberEntriesAll = Object.entries(membersData.members || {}).filter(([, m]) => m.role === 'member');
    // 未分组组员看不到任何组的统计；组长/队长按 scope
    const baseEntries = isUngroupedMember
      ? []
      : memberEntriesAll.filter(([, m]) => !scope || m.group === scope);

    const weeks = [];
    for (const week of weekDirs) {
      const meta = (await storage.readJson(`${week}/meta.json`)) || {};
      const readme = await storage.readText(`${week}/README.md`);
      const isCurrent = week === current;
      // 作业与提交始终按组隔离（队长可看全部）
      const memberEntries = baseEntries;
      const totalMembers = memberEntries.length;
      let submitted = 0;
      for (const [login] of memberEntries) {
        if (await this.submissionRel(week, login)) submitted += 1;
      }
      const item = {
        week,
        title: meta.title || `Week ${week.replace(/^week/i, '')}`,
        deadline: meta.deadline || null,
        publishedAt: meta.publishedAt || null,
        tags: meta.tags || [],
        groups: teams.groups || GROUPS,
        hasReadme: !!readme,
        isCurrent,
        submissionCount: submitted,
        totalMembers,
        rate: totalMembers ? Math.round((submitted / totalMembers) * 100) : 0,
      };
      if (user) {
        const rel = await this.submissionRel(week, user.login);
        item.mine = { submitted: !!rel, rel: rel || this.submissionWriteRel(week, user.login, user.group, folderOf(teams, user.group)) };
        if (rel) {
          const allFiles = await storage.dirFiles(rel).catch(() => []);
          const files = allFiles.filter((f) => !SYSTEM_FILES.has(f.rel.split('/').pop()));
          item.mine.fileCount = files.length;
          item.mine.size = files.reduce((s, f) => s + f.size, 0);
          const evaluation = await storage.readJson(`${rel}/evaluation.json`).catch(() => null);
          if (evaluation) item.mine.evaluation = evaluation;
        }
      }
      if (isLeader) item.submitted = submitted;
      weeks.push(item);
    }
    return {
      weeks,
      groups: teams.groups || GROUPS,
      teamName: teams.teamName,
      role: user ? user.role : null,
      scope,
    };
  }

  async getWeek(week) {
    if (!isWeekName(week)) throw new HttpError(400, '周次格式不正确');
    const storage = this.storageOrThrow();
    await this.refreshSession();
    const user = this.requireSession().user;
    await this.pullThrottled();

    const [meta, readme, teams] = await Promise.all([
      storage.readJson(`${week}/meta.json`),
      storage.readText(`${week}/README.md`),
      this.getTeams(),
    ]);
    if (!readme && !meta) throw new HttpError(404, `未找到 ${week} 的作业内容`);

    const group = user.group || null;
    let groupReadme = '';
    if (group) {
      const folder = folderOf(teams, group);
      groupReadme =
        (await storage.readText(`${week}/${folder}/README.md`).catch(() => null)) ||
        (await storage.readText(`${week}/groups/${group}/README.md`).catch(() => null)) ||
        (await storage.readText(`${week}/${group}.md`).catch(() => null)) ||
        (await storage.readText(`${week}/README.${group}.md`).catch(() => null)) ||
        '';
    }

    const rel = await this.submissionRel(week, user.login);
    const allFiles = rel ? await storage.dirFiles(rel).catch(() => []) : [];
    const myFiles = allFiles.filter((f) => !SYSTEM_FILES.has(f.rel.split('/').pop()));
    const submissionMeta = rel ? await storage.readJson(`${rel}/submission.json`).catch(() => null) : null;
    const evaluation = rel ? await storage.readJson(`${rel}/evaluation.json`).catch(() => null) : null;

    const current = await this.currentWeek();
    const isHistory = !!current && week !== current;
    let groupsContent = [];
    let historySubmissions = [];
    if (isHistory) {
      const historyGroup = user.group || null;
      for (const g of teams.groups || GROUPS) {
        if (!historyGroup || g.id !== historyGroup) continue;
        const folder = folderOf(teams, g.id);
        const content =
          (await storage.readText(`${week}/${folder}/README.md`).catch(() => null)) ||
          (await storage.readText(`${week}/groups/${g.id}/README.md`).catch(() => null)) ||
          (await storage.readText(`${week}/${g.id}.md`).catch(() => null)) ||
          '';
        groupsContent.push({ id: g.id, name: g.name, color: g.color, readme: content });
      }
      const membersData = await this.getMembers().catch(() => ({ members: {} }));
      for (const [login, m] of Object.entries(membersData.members || {})) {
        if (m.role !== 'member') continue;
        if (!historyGroup || m.group !== historyGroup) continue;
        const subRel = await this.submissionRel(week, login);
        if (!subRel) continue;
        const sm = await storage.readJson(`${subRel}/submission.json`).catch(() => null);
        const ev = await storage.readJson(`${subRel}/evaluation.json`).catch(() => null);
        historySubmissions.push({
          login,
          name: m.name || login,
          group: m.group || null,
          uploadedAt: sm ? sm.uploadedAt : null,
          fileCount: sm && sm.fileCount ? sm.fileCount : 0,
          score: ev && typeof ev.score === 'number' ? ev.score : null,
          comment: ev ? ev.comment : null,
          gradedAt: ev ? ev.gradedAt : null,
          gradedBy: ev ? ev.gradedBy : null,
        });
      }
      historySubmissions.sort(
        (a, b) => (a.group || '').localeCompare(b.group || '') || a.login.localeCompare(b.login),
      );
    }

    return {
      week,
      title: (meta && meta.title) || week,
      deadline: meta ? meta.deadline : null,
      publishedAt: meta ? meta.publishedAt : null,
      tags: (meta && meta.tags) || [],
      readme: readme || '',
      groupReadme: groupReadme || '',
      group,
      groups: teams.groups || GROUPS,
      needsGroup: !group,
      history: isHistory,
      isCurrent: current === week,
      groupsContent,
      submissions: historySubmissions,
      mine: {
        submitted: !!submissionMeta || allFiles.length > 0,
        rel: rel || this.submissionWriteRel(week, user.login, group, folderOf(teams, group)),
        files: myFiles,
        fileCount: submissionMeta && submissionMeta.fileCount ? submissionMeta.fileCount : myFiles.length,
        totalBytes: submissionMeta && submissionMeta.totalBytes ? submissionMeta.totalBytes : myFiles.reduce((s, f) => s + f.size, 0),
        uploadedAt: submissionMeta ? submissionMeta.uploadedAt : null,
        evaluation: evaluation || null,
      },
      canSubmit: !isHistory && user.role === 'member' && !!group,
      isLeader: ['leader', 'captain'].includes(user.role),
    };
  }

  /* ------------------------------------------------------------------ */
  /* 组长：布置作业                                                       */
  /* ------------------------------------------------------------------ */

  /** 推荐下一个周次编号。 */
  async nextWeek() { await this.refreshSession();
    this.requireLeader();
    const storage = this.storageOrThrow();
    const dirs = await storage.listWeekDirs();
    const nums = dirs
      .map((d) => parseInt(d.replace(/^week/i, ''), 10))
      .filter((n) => Number.isFinite(n));
    const next = Math.max(0, ...nums) + 1;
    return { week: `week${String(next).padStart(2, '0')}` };
  }

  /** 当前周：meta.current=true 的周次，否则取编号最大的周次。 */
  async currentWeek() {
    if (!this.storage) return null;
    const storage = this.storage;
    const dirs = await storage.listWeekDirs();
    if (!dirs.length) return null;
    const marked = [];
    for (const w of dirs) {
      const meta = await storage.readJson(`${w}/meta.json`).catch(() => null);
      if (meta && meta.current === true) marked.push(w);
    }
    if (marked.length) {
      return marked.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
    }
    return dirs[dirs.length - 1];
  }

  async isCurrentWeek(week) {
    return (await this.currentWeek()) === week;
  }

  /** 队长指定当前周（会清理其他周的 current 标记）。 */
  async setCurrentWeek(week) {
    await this.refreshSession();
    this.requireLeader();
    if (!this.isCaptain()) throw new HttpError(403, '仅队长可以设置当前周');
    if (!isWeekName(week)) throw new HttpError(400, '周次格式不正确');
    const storage = this.storageOrThrow();
    await storage.pull({ strict: true });
    if (!(await storage.isDir(week))) throw new HttpError(404, '该周次不存在');
    await storage.mutate(async () => {
      const dirs = await storage.listWeekDirs();
      for (const w of dirs) {
        const meta = (await storage.readJson(`${w}/meta.json`).catch(() => null)) || {};
        const want = w === week;
        if (meta.current !== want) {
          await storage.writeJsonRaw(`${w}/meta.json`, { ...meta, current: want });
        }
      }
    }, `chore(${week}): 设为当前周`);
    return { ok: true, week };
  }

  /** 只读查看某一周的作业内容（当前周按组隔离，往期对全队开放）。 */
  async getWeekView(week) {
    await this.refreshSession();
    this.requireSession();
    if (!isWeekName(week)) throw new HttpError(400, '周次格式不正确');
    const storage = this.storageOrThrow();
    await this.pullThrottled(500);
    const [meta, readme, teams] = await Promise.all([
      storage.readJson(`${week}/meta.json`).catch(() => null),
      storage.readText(`${week}/README.md`).catch(() => null),
      this.getTeams(),
    ]);
    if (!meta && readme == null) throw new HttpError(404, `未找到 ${week} 的作业内容`);
    const current = await this.currentWeek();
    const isHistory = !!current && week !== current;
    // 除队长外，只能看本组作业（无论当期还是往期）
    const canSeeAll = this.isCaptain();
    const scope = canSeeAll ? null : this.scopeGroup();
    const groups = [];
    for (const g of teams.groups || GROUPS) {
      if (!canSeeAll && g.id !== scope) continue;
      const folder = folderOf(teams, g.id);
      const content =
        (await storage.readText(`${week}/${folder}/README.md`).catch(() => null)) ||
        (await storage.readText(`${week}/groups/${g.id}/README.md`).catch(() => null)) ||
        (await storage.readText(`${week}/${g.id}.md`).catch(() => null)) ||
        '';
      groups.push({ id: g.id, name: g.name, color: g.color, folder, readme: content });
    }
    return {
      week,
      title: (meta && meta.title) || week,
      deadline: (meta && meta.deadline) || null,
      publishedAt: (meta && meta.publishedAt) || null,
      isCurrent: current === week,
      isHistory,
      scope,
      readme: readme || '',
      groups,
      canEdit: this.isLeader() && (this.isCaptain() || isHistory),
    };
  }

  /** 读取某一周的编辑内容（新建时返回空模板）。 */
  async getWeekEditor(week) { await this.refreshSession();
    this.requireLeader();
    if (!isWeekName(week)) throw new HttpError(400, '周次格式不正确');
    const storage = this.storageOrThrow();
    await this.pullThrottled(500);
    const [meta, readme, teams] = await Promise.all([
      storage.readJson(`${week}/meta.json`).catch(() => null),
      storage.readText(`${week}/README.md`).catch(() => null),
      this.getTeams(),
    ]);
    const scope = this.leaderGroup();
    const current = await this.currentWeek();
    const canEdit = this.isCaptain() || current !== week;
    const groups = {};
    for (const g of GROUP_IDS) {
      // 除队长外只能编辑本组；未分组（scope 为 null）则看不到任何组
      if (!this.isCaptain() && g !== scope) continue;
      const folder = folderOf(teams, g);
      groups[g] =
        (await storage.readText(`${week}/${folder}/README.md`).catch(() => null)) ||
        (await storage.readText(`${week}/groups/${g}/README.md`).catch(() => null)) ||
        (await storage.readText(`${week}/${g}.md`).catch(() => null)) ||
        '';
    }
    return {
      week,
      exists: readme != null,
      title: (meta && meta.title) || '',
      deadline: (meta && meta.deadline) || '',
      tags: (meta && meta.tags) || [],
      readme: readme || '',
      groups,
      scope,
      canEdit,
      isCurrent: current === week,
      canEditReadme: scope === null,
      publishedAt: (meta && meta.publishedAt) || null,
      updatedAt: (meta && meta.updatedAt) || null,
      groupsMeta: (teams.groups || GROUPS).filter((g) => !scope || g.id === scope),
    };
  }

  /** 新建或更新一周作业，并推送到 GitHub。 */
  async saveWeek(payload = {}) { await this.refreshSession();
    this.requireLeader();
    const week = String(payload.week || '').trim();
    if (!isWeekName(week)) throw new HttpError(400, '周次格式不正确（例如 week04）');
    const storage = this.storageOrThrow();
    const teams = await this.getTeams();

    const rawTitle = String(payload.title || '').trim().slice(0, 120);
    const title = rawTitle || `Week ${week.replace(/^week/i, '')}`;
    const tags = Array.isArray(payload.tags)
      ? payload.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
      : [];
    const readme = String(payload.readme || '').slice(0, 200000);
    const groups = payload.groups && typeof payload.groups === 'object' ? payload.groups : {};

    let deadline = '';
    if (payload.deadline) {
      const d = new Date(payload.deadline);
      if (!Number.isNaN(d.getTime())) deadline = d.toISOString();
    }

    await storage.pull({ strict: true });
    const exists = await storage.isDir(week);
    const current = await this.currentWeek();
    if (exists && current === week && !this.isCaptain()) {
      throw new HttpError(403, '当前周由队长管理，组长只能查看');
    }
    const existingMeta = (await storage.readJson(`${week}/meta.json`).catch(() => null)) || {};
    const now = nowIso();
    const meta = {
      title,
      deadline,
      publishedAt: now,
      updatedAt: now,
      tags,
      publishedBy: this.session.user.login,
      createdAt: existingMeta.createdAt || now,
      current: exists ? existingMeta.current === true : true,
    };

    const res = await storage.mutate(async () => {
      const myGroup = this.leaderGroup();
      const target = String(payload.target || '').trim();
      const files = [];
      if (myGroup) {
        // 组长只能编辑自己组的作业内容
        const folder = folderOf(teams, myGroup);
        const content = String((groups && groups[myGroup]) ?? readme).slice(0, 100000);
        files.push({ rel: `${week}/${folder}/README.md`, data: content });
        files.push({ rel: `${week}/${folder}/submissions/.gitkeep`, data: '' });
      } else if (!this.isCaptain() && target && GROUP_IDS.includes(target)) {
        throw new HttpError(403, '你未分配小组，无法编辑组作业；请让队长为你分配小组');
      } else if (target === 'common') {
        files.push({ rel: `${week}/README.md`, data: readme });
        for (const g of GROUP_IDS) {
          files.push({ rel: `${week}/${folderOf(teams, g)}/submissions/.gitkeep`, data: '' });
        }
      } else if (target && GROUP_IDS.includes(target)) {
        files.push({
          rel: `${week}/${folderOf(teams, target)}/README.md`,
          data: String((groups && groups[target]) ?? '').slice(0, 100000),
        });
        files.push({ rel: `${week}/${folderOf(teams, target)}/submissions/.gitkeep`, data: '' });
      } else {
        // 兼容旧调用：仅队长可一次写入全部；未分组组长不允许
        if (!this.isCaptain()) {
          throw new HttpError(403, '你未分配小组，无法编辑组作业；请让队长为你分配小组');
        }
        files.push({ rel: `${week}/README.md`, data: readme });
        for (const g of GROUP_IDS) {
          files.push({ rel: `${week}/${folderOf(teams, g)}/submissions/.gitkeep`, data: '' });
          if (groups && groups[g] !== undefined) {
            files.push({
              rel: `${week}/${folderOf(teams, g)}/README.md`,
              data: String(groups[g] || '').slice(0, 100000),
            });
          }
        }
      }
      await storage.writeFilesRaw(files);
      await storage.writeJsonRaw(`${week}/meta.json`, meta);
      if (!(await storage.isDir(`${week}/submissions`))) {
        await storage.writeFilesRaw([{ rel: `${week}/submissions/.gitkeep`, data: '' }]);
      }
    }, `feat(${week}): 发布作业「${title}」`);

    await this.pullThrottled(0);
    this.logger.info(`发布作业 ${week}「${title}」 by ${this.session.user.login}`);
    return {
      ok: true,
      week,
      title,
      publishedAt: meta.publishedAt,
      commit: res.commit || null,
      message: `已发布 ${week.toUpperCase()}，组员将在下一次同步时收到通知`,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 组员：提交                                                          */
  /* ------------------------------------------------------------------ */

  /** 浏览器模式分片上传：创建临时会话目录。 */
  async beginUpload() {
    this.requireSession();
    const id = randomId();
    const dir = path.join(this.dataDir, 'incoming', id);
    await fsp.mkdir(dir, { recursive: true });
    return { session: id };
  }

  /** 写入单个文件到临时会话目录。 */
  async writeUploadChunk(session, rel, buffer) {
    this.requireSession();
    if (!/^[a-f0-9]{16}$/.test(String(session || ''))) throw new HttpError(400, '上传会话无效');
    if (!buffer || !buffer.length) throw new HttpError(400, '空文件');
    const root = path.join(this.dataDir, 'incoming', session);
    const cleanRel = String(rel || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!cleanRel || cleanRel.split('/').includes('..')) throw new HttpError(400, '非法文件路径');
    const abs = path.join(root, cleanRel);
    if (!path.resolve(abs).startsWith(path.resolve(root) + path.sep)) throw new HttpError(400, '非法文件路径');
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, buffer);
    return { ok: true };
  }

  /** 结束上传：把临时目录作为一次提交推送到仓库。 */
  async commitUpload(session, week) {
    this.requireSession();
    if (!/^[a-f0-9]{16}$/.test(String(session || ''))) throw new HttpError(400, '上传会话无效');
    const dir = path.join(this.dataDir, 'incoming', session);
    try {
      const result = await this.submitFolder(week, dir);
      return result;
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async submitFolder(week, folderPath) {
    const session = this.requireSession();
    await this.refreshSession();
    if (!isWeekName(week)) throw new HttpError(400, '周次格式不正确');
    const storage = this.storageOrThrow();
    const abs = path.resolve(folderPath);
    let stat;
    try {
      stat = await fsp.stat(abs);
    } catch {
      throw new HttpError(400, '找不到要上传的文件夹');
    }
    if (!stat.isDirectory()) throw new HttpError(400, '请选择文件夹（支持整个目录拖拽）');

    const files = walkFiles(abs);
    if (!files.length) throw new HttpError(400, '文件夹是空的');
    if (files.length > 5000) throw new HttpError(413, '文件数量超过 5000 个，请精简后上传');

    const MAX_SINGLE = 100 * 1024 * 1024;
    const WARN_SINGLE = 50 * 1024 * 1024;
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    const tooBig = files.filter((f) => f.size > MAX_SINGLE);
    if (tooBig.length) {
      throw new HttpError(
        413,
        `以下文件超过 GitHub 单文件 100MB 限制：${tooBig.map((f) => f.rel).join('、')}。` +
          `可在设置中启用云存储（OSS）后重试。`,
      );
    }
    const bigFiles = files.filter((f) => f.size > WARN_SINGLE).map((f) => f.rel);

    const login = session.user.login;
    const group = session.user.group;
    if (!group) {
      throw new HttpError(403, '你还没有被分配分组，请联系组长加入小组后再提交');
    }
    const teams = await this.getTeams();
    const folder = folderOf(teams, group);
    const rel = `${week}/${folder}/submissions/${login}`;
    await storage.pull({ strict: true });

    const meta = {
      version: 1,
      week,
      login,
      group: session.user.group || null,
      uploadedAt: nowIso(),
      fileCount: files.length,
      totalBytes,
      client: 'RM-Homework/1.0.0',
    };

    const res = await storage.mutate(async () => {
      await storage.removeDirRaw(rel);
      await storage.copyDirRaw(rel, abs);
      await storage.writeJsonRaw(`${rel}/submission.json`, meta);
    }, `feat(${week}): ${login} 提交作业（${files.length} 个文件）`);

    await this.pullThrottled(0);
    this.logger.info(`提交完成 ${week}/${login}: ${files.length} files, ${totalBytes} bytes`);
    return {
      ok: true,
      week,
      login,
      rel,
      fileCount: files.length,
      totalBytes,
      commit: res.commit || null,
      warnings: bigFiles.length ? [`大文件提醒：${bigFiles.join('、')} 超过 50MB，建议后续迁移到云存储`] : [],
    };
  }

  /* ------------------------------------------------------------------ */
  /* 组长：看板 / 批改 / 下载                                            */
  /* ------------------------------------------------------------------ */

  async adminOverview(week) { await this.refreshSession();
    this.requireLeader();
    const storage = this.storageOrThrow();
    await this.pullThrottled(1000);
    const [membersData, teams] = await Promise.all([this.getMembers(), this.getTeams()]);
    const members = membersData.members || {};
    const currentWeek = await this.currentWeek();
    // 除队长外，只能看本组（无论当期还是往期）
    const scope = this.leaderGroup();
    const visibleGroups = (teams.groups || GROUPS).filter((g) => !scope || g.id === scope);
    const groups = visibleGroups.map((g) => ({ ...g, members: [], submitted: 0, graded: 0, total: 0, scores: [] }));

    const allWeeks = await storage.listWeekDirs();
    const queryWeeks = week ? [week] : allWeeks;
    const detail = [];

    for (const w of queryWeeks) {
      if (!isWeekName(w)) continue;
      for (const [login, info] of Object.entries(members)) {
        if (['leader', 'captain'].includes(info.role)) continue;
        if (scope && info.group !== scope) continue;
        const subRel = await this.submissionRel(w, login);
        const subMeta = subRel ? await storage.readJson(`${subRel}/submission.json`).catch(() => null) : null;
        const evaluation = subRel ? await storage.readJson(`${subRel}/evaluation.json`).catch(() => null) : null;
        const row = {
          week: w,
          login,
          name: info.name || login,
          group: info.group || null,
          submitted: !!subRel,
          fileCount: subMeta && subMeta.fileCount ? subMeta.fileCount : 0,
          totalBytes: subMeta && subMeta.totalBytes ? subMeta.totalBytes : 0,
          uploadedAt: subMeta ? subMeta.uploadedAt : null,
          score: evaluation && typeof evaluation.score === 'number' ? evaluation.score : null,
          comment: evaluation ? evaluation.comment : null,
          gradedAt: evaluation ? evaluation.gradedAt : null,
          gradedBy: evaluation ? evaluation.gradedBy : null,
        };
        detail.push(row);
      }

      for (const g of groups) {
        const rows = detail.filter((r) => r.week === w && r.group === g.id);
        g.total += rows.length;
        g.submitted += rows.filter((r) => r.submitted).length;
        g.graded += rows.filter((r) => r.score != null).length;
        for (const r of rows) if (r.score != null) g.scores.push(r.score);
        for (const r of rows) {
          if (!g.members.find((m) => m.login === r.login)) {
            g.members.push({ login: r.login, name: r.name, role: members[r.login].role });
          }
        }
      }
    }

    const groupStats = groups.map((g) => {
      const avg = g.scores.length ? g.scores.reduce((a, b) => a + b, 0) / g.scores.length : null;
      return {
        id: g.id,
        name: g.name,
        color: g.color,
        short: g.short,
        total: g.total,
        submitted: g.submitted,
        graded: g.graded,
        rate: g.total ? Math.round((g.submitted / g.total) * 100) : 0,
        avgScore: avg == null ? null : Math.round(avg * 10) / 10,
        members: g.members,
      };
    });

    const allScores = detail.filter((r) => r.score != null).map((r) => r.score);
    const allTotal = detail.length;
    const allSubmitted = detail.filter((r) => r.submitted).length;
    const allGraded = allScores.length;

    const pendingMembers = Object.entries(members)
      .filter(([, m]) => m.role === 'member' && !m.group)
      .map(([login, m]) => ({ login, name: m.name || login, createdAt: m.createdAt || null }));

    return {
      week: week || null,
      weeks: allWeeks,
      currentWeek,
      groups: groupStats,
      scope,
      pendingMembers,
      summary: {
        total: allTotal,
        submitted: allSubmitted,
        graded: allGraded,
        rate: allTotal ? Math.round((allSubmitted / allTotal) * 100) : 0,
        avgScore: allScores.length ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10 : null,
        memberCount: Object.values(members).filter(
          (m) => m.role === 'member' && (!scope || m.group === scope),
        ).length,
      },
      rows: detail,
      teamName: teams.teamName,
      generatedAt: nowIso(),
    };
  }

  async getSubmissionDetail(week, login) { await this.refreshSession();
    this.requireLeader();
    if (!isWeekName(week)) throw new HttpError(400, '周次格式不正确');
    if (!isValidLogin(login)) throw new HttpError(400, '账号名不合法');
    await this.assertManageable(login);
    const storage = this.storageOrThrow();
    const rel = await this.submissionRel(week, login);
    if (!rel) throw new HttpError(404, '该成员尚未提交');
    const all = await storage.dirFiles(rel);
    if (!all.length) throw new HttpError(404, '该成员尚未提交');
    const files = all.filter((f) => !SYSTEM_FILES.has(f.rel.split('/').pop()));
    const meta = await storage.readJson(`${rel}/submission.json`).catch(() => null);
    const evaluation = await storage.readJson(`${rel}/evaluation.json`).catch(() => null);
    return {
      week,
      login,
      rel,
      files,
      fileCount: meta && meta.fileCount ? meta.fileCount : files.length,
      totalBytes: meta && meta.totalBytes ? meta.totalBytes : files.reduce((s, f) => s + f.size, 0),
      meta,
      evaluation,
    };
  }

  async grade({ week, member, score, comment }) { await this.refreshSession();
    this.requireLeader();
    if (!isWeekName(week)) throw new HttpError(400, '周次格式不正确');
    if (!isValidLogin(member)) throw new HttpError(400, '账号名不合法');
    const numeric = Number(score);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) throw new HttpError(400, '分数需在 0 - 100 之间');
    await this.assertManageable(member);
    const storage = this.storageOrThrow();
    await storage.pull({ strict: true });
    const rel = await this.submissionRel(week, member);
    if (!rel) throw new HttpError(400, '该成员尚未提交，无法批改');

    const membersData = await this.getMembers();
    const target = membersData.members[member] || { group: null };
    const payload = {
      version: 1,
      week,
      member,
      group: target.group || null,
      score: Math.round(numeric * 10) / 10,
      comment: String(comment || '').slice(0, 2000),
      gradedBy: this.session.user.login,
      gradedAt: nowIso(),
      rubric: null,
    };
    const res = await storage.mutate(async () => {
      await storage.writeJsonRaw(`${rel}/evaluation.json`, payload);
    }, `chore(evaluation): ${this.session.user.login} 批改 ${member} 的 ${week}（${payload.score} 分）`);
    return { ok: true, evaluation: payload, commit: res.commit || null };
  }

  async exportSubmission(week, member, destZip) { await this.refreshSession();
    this.requireLeader();
    if (!isWeekName(week) || !isValidLogin(member)) throw new HttpError(400, '参数不正确');
    await this.assertManageable(member);
    const storage = this.storageOrThrow();
    const rel = await this.submissionRel(week, member);
    if (!rel) throw new HttpError(404, '该成员尚未提交');
    const dest = destZip || path.join(this.artifactDir(), `${week}-${member}-${Date.now()}.zip`);
    const result = await zipDirectory(storage.resolve(rel), dest, { prefix: `${week}-${member}` });
    return { ok: true, path: dest, ...result };
  }

  async listMembers() { await this.refreshSession();
    this.requireLeader();
    await this.pullThrottled();
    const data = await this.getMembers();
    const teams = await this.getTeams();
    const scope = this.leaderGroup();
    const all = Object.entries(data.members).map(([login, m]) => ({
      login,
      role: m.role || 'member',
      group: m.group || null,
      name: m.name || login,
      createdAt: m.createdAt || null,
      pendingGroup: m.role === 'member' && !m.group,
    }));
    // 组长：本组成员 + 待分组成员；未分配小组的组长：全部
    const members = scope ? all.filter((m) => !m.group || m.group === scope) : all;
    return {
      members,
      groups: (teams.groups || GROUPS).filter((g) => !scope || g.id === scope),
      scope,
      pendingCount: all.filter((m) => m.pendingGroup).length,
    };
  }

  async setMember(login, { group, role, name } = {}) { await this.refreshSession();
    this.requireLeader();
    if (!isValidLogin(login)) throw new HttpError(400, '账号名不合法');
    if (group != null && group !== '' && !GROUP_IDS.includes(group)) throw new HttpError(400, '分组不存在');
    if (role != null && !['leader', 'member'].includes(role)) throw new HttpError(400, '角色不合法');
    if (role === 'captain') throw new HttpError(403, '队长只能通过兑换码产生');
    if (login === this.session.user.login && role === 'member') {
      throw new HttpError(400, '不能将自己降级为组员');
    }
    if (login === this.session.user.login && this.isCaptain() && role && role !== 'captain') {
      throw new HttpError(403, '队长不能更改自己的角色');
    }
    const myGroup = this.leaderGroup();
    const storage = this.storageOrThrow();
    await storage.pull({ strict: true });
    const membersData = await this.getMembers();
    const target = membersData.members[login];
    if (target && target.role === 'captain' && login !== this.session.user.login) {
      throw new HttpError(403, '队长账号不可被管理');
    }
    if (myGroup) {
      await this.assertManageable(login);
      if (group != null && group !== '' && group !== myGroup) {
        throw new HttpError(403, `你只能把成员分配到${myGroup}组`);
      }
      // 防止组长通过修改自己的分组获得全局权限
      if (login === this.session.user.login && (group === null || group === '')) {
        throw new HttpError(403, '组长不能修改自己的分组，请让队长操作');
      }
      if (role === 'leader' && (group === null || group === '')) {
        throw new HttpError(403, '组长不能设置其他组长');
      }
    }
    await storage.mutate(async () => {
      const fresh = await this.getMembers();
      const prev = fresh.members[login] || { createdAt: nowIso() };
      const nextGroup = group === undefined ? prev.group || null : group === '' || group == null ? null : group;
      fresh.members[login] = {
        ...prev,
        role: role || prev.role || 'member',
        group: nextGroup,
        name: name || prev.name || login,
        updatedAt: nowIso(),
      };
      fresh.updatedAt = nowIso();
      await storage.writeJsonRaw('members.json', fresh);
    }, `chore(members): 更新 ${login} 的分组/角色`);
    return { ok: true };
  }

  async removeMember(login) { await this.refreshSession();
    this.requireLeader();
    if (!isValidLogin(login)) throw new HttpError(400, '账号名不合法');
    if (login === this.session.user.login) throw new HttpError(400, '不能移除自己');
    await this.assertManageable(login);
    const storage = this.storageOrThrow();
    await storage.pull({ strict: true });
    await storage.mutate(async () => {
      const fresh = await this.getMembers();
      if (!fresh.members[login]) throw new HttpError(404, '成员不存在');
      delete fresh.members[login];
      fresh.updatedAt = nowIso();
      await storage.writeJsonRaw('members.json', fresh);
    }, `chore(members): 移除 ${login}`);
    return { ok: true };
  }

  /* ------------------------------------------------------------------ */
  /* 成绩通知                                                            */
  /* ------------------------------------------------------------------ */

  async getNotifications() {
    if (!this.session || !this.storage) return { items: [], announcements: [], joinRequests: [], unreadCount: 0 };
    await this.refreshSession();
    const storage = this.storage;
    const login = this.session.user.login;
    const weeks = await storage.listWeekDirs();
    const teams = await this.getTeams().catch(() => null);
    const items = [];
    const announcements = [];
    const joinRequests = [];

    for (const week of weeks) {
      const rel = await this.submissionRel(week, login);
      const evaluation = rel ? await storage.readJson(`${rel}/evaluation.json`).catch(() => null) : null;
      if (evaluation && typeof evaluation.score === 'number') {
        const key = `${week}:${evaluation.gradedAt || ''}:${evaluation.score}`;
        items.push({
          key,
          week,
          score: evaluation.score,
          comment: evaluation.comment || '',
          gradedAt: evaluation.gradedAt || null,
          gradedBy: evaluation.gradedBy || null,
          read: this.settings.isRead(key),
        });
      }

      // 组长不需要收到自己发布的作业通知；组员只看与自己组相关的发布
      if (!this.isLeader()) {
        const meta = await storage.readJson(`${week}/meta.json`).catch(() => null);
        if (meta && meta.publishedAt) {
          const group = this.session.user.group;
          const generic = await storage.readText(`${week}/README.md`).catch(() => null);
          const folder = group ? folderOf(teams, group) : null;
          const groupContent = group
            ? (await storage.readText(`${week}/${folder}/README.md`).catch(() => null)) ||
              (await storage.readText(`${week}/groups/${group}/README.md`).catch(() => null))
            : null;
          if (!generic && !groupContent) continue;
          const key = `publish:${week}:${meta.publishedAt}`;
          announcements.push({
            key,
            week,
            title: meta.title || week,
            deadline: meta.deadline || null,
            publishedAt: meta.publishedAt,
            read: this.settings.isRead(key),
          });
        }
      }
    }

    // 未分组提醒：所有组长都能看到（谁先认领谁负责）
    if (this.isLeader()) {
      const membersData = await this.getMembers().catch(() => ({ members: {} }));
      for (const [name, m] of Object.entries(membersData.members || {})) {
        if (m.role !== 'member' || m.group) continue;
        const key = `join:${name}:${m.createdAt || ''}`;
        joinRequests.push({
          key,
          login: name,
          name: m.name || name,
          createdAt: m.createdAt || null,
          read: this.settings.isRead(key),
        });
      }
      joinRequests.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    }

    items.sort((a, b) => String(b.gradedAt || '').localeCompare(String(a.gradedAt || '')));
    announcements.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
    const unreadCount =
      items.filter((i) => !i.read).length +
      announcements.filter((a) => !a.read).length +
      joinRequests.filter((j) => !j.read).length;
    return { items, announcements: announcements.slice(0, 5), joinRequests: joinRequests.slice(0, 10), unreadCount };
  }

  async markNotificationsRead(keys) {
    this.requireSession();
    const list = Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : [];
    this.settings.markEvaluationsRead(list);
    return { ok: true, marked: list.length };
  }

  /** 检查应用自身是否有新版本（从 SUAT-Rm-Homework-System 仓库的 version.json）。 */
  async checkForUpdate() {
    await this.refreshSession();
    this.requireSession();
    const token = this.session && this.session.token ? this.session.token : null;
    return checkUpdate(pkg.version, token);
  }

  async sync() {
    const storage = this.storageOrThrow();
    const start = Date.now();
    const res = await storage.pull({ strict: true });
    this.lastPullAt = Date.now();
    return { ok: true, ms: Date.now() - start, ...res, info: await storage.info().catch(() => null) };
  }
}

module.exports = { AppServices, BUILTIN_LEADER_CODE, BUILTIN_CAPTAIN_CODE };
