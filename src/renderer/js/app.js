import { api, ApiError } from './api.js';
import * as ui from './ui.js';
import { renderLogin, renderSetup } from './views/login.js';
import { renderMemberHome, renderMemberWeek, renderMemberGrades } from './views/member.js';
import { renderOverview, renderSubmissions, renderMembers, renderAssignment, renderWeekView } from './views/leader.js';
import { renderSettings } from './views/settings.js';

/* ------------------------------------------------------------------ */
/* 状态                                                                */
/* ------------------------------------------------------------------ */

const state = {
  me: null,
  setup: null,
  route: { name: 'login', params: {} },
  notifications: { items: [], unreadCount: 0 },
  shownKeys: new Set(),
  settings: null,
  lastSyncAt: 0,
  ready: false,
};

const app = {
  state,
  api,
  ui,
  navigate,
  rerender: () => renderRoute(),
  afterLogin,
  logout,
  toast: ui.toast,
  confirm: ui.confirmDialog,
  openModal: ui.openModal,
  setBusy: ui.setBusy,
  isLeader: () => ['leader', 'captain'].includes(state.me?.user?.role),
  isCaptain: () => state.me?.user?.role === 'captain',
  defaultRoute: () => (app.isLeader() ? '#/leader/overview' : '#/member/home'),
  notifyChanged: () => updateNavBadge(),
  getWeekParam: () => state.route.params.week || null,
  restartPolling: () => startPolling(),
  setNotificationPrefs: (prefs) => {
    state.settings = state.settings || {};
    state.settings.notifications = { ...(state.settings.notifications || {}), ...prefs };
    startPolling();
  },
  isDesktop: () => !!window.rmh,
};

// 浏览器模式（无 Electron）：隐藏窗口按钮，改为全屏网页布局
if (!window.rmh) document.body.classList.add('is-web');

window.__RMH_APP__ = app;

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  bindTitlebar();
  bindGlobalClicks();
  window.addEventListener('hashchange', renderRoute);

  // 主进程恢复上次登录完成后，若当前仍停留在登录页则刷新
  if (window.rmh && window.rmh.onSessionRestored) {
    window.rmh.onSessionRestored(() => {
      if (!state.me || !state.me.authenticated) location.reload();
    });
  }

  renderBootLoading();

  // 等待主进程恢复会话（记住的账号 / 上次登录）
  for (let i = 0; i < 30; i += 1) {
    try {
      state.me = await api.get('/api/me');
    } catch (err) {
      break;
    }
    if (state.me.authenticated) break;
    if (i === 0) {
      const s = await api.get('/api/settings').catch(() => null);
      const hasSaved = !!(s && s.accounts && s.accounts.length && s.autoLogin !== false);
      if (!s || (!s.hasToken && !hasSaved)) break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  state.settings = await api.get('/api/settings').catch(() => null);
  state.ready = true;

  if (state.me && state.me.authenticated) {
    if (state.me.needSetup) {
      renderSetupPage({ needSetup: true });
      return;
    }
    if (!location.hash || location.hash === '#/' || location.hash === '#/login') {
      navigate(app.defaultRoute(), { replace: true });
    }
    renderShell();
    refreshNotifications({ silent: true });
    startPolling();
  } else {
    renderLoginPage();
    // 仓库首次克隆较慢时，后台恢复登录可能晚于页面渲染；这里继续等待并自动进入
    if (state.settings && (state.settings.hasToken || (state.settings.accounts || []).some((a) => a.hasToken))) {
      watchRestore();
    }
  }
}

function watchRestore() {
  let tries = 0;
  const timer = setInterval(async () => {
    tries += 1;
    if (tries > 30) {
      clearInterval(timer);
      return;
    }
    try {
      const me = await api.get('/api/me');
      if (me && me.authenticated) {
        clearInterval(timer);
        location.reload();
      }
    } catch {
      /* ignore */
    }
  }, 2000);
}

function renderBootLoading() {
  document.getElementById('app').innerHTML = `
    <div class="boot-loading">
      <div class="boot-loading__logo">${ui.icon('target', 28)}</div>
      <div class="muted small">正在连接本地服务…</div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  if (!parts.length) return { name: 'home', params: {} };
  const [root, second, third] = parts;
  if (root === 'settings') return { name: 'settings', params: {} };
  if (root === 'member') {
    if (second === 'week') return { name: 'member.week', params: { week: third } };
    if (second === 'weeks') return { name: 'member.weeks', params: {} };
    if (second === 'grades') return { name: 'member.grades', params: {} };
    return { name: 'member.home', params: {} };
  }
  if (root === 'leader') {
    if (second === 'assignment') return { name: 'leader.assignment', params: {} };
    if (second === 'weeks') return { name: 'leader.weeks', params: {} };
    if (second === 'submissions') return { name: 'leader.submissions', params: {} };
    if (second === 'members') return { name: 'leader.members', params: {} };
    return { name: 'leader.overview', params: {} };
  }
  return { name: 'member.home', params: {} };
}

function navigate(hash, { replace = false } = {}) {
  if (location.hash === hash) {
    renderRoute();
    return;
  }
  if (replace) {
    history.replaceState(null, '', hash);
    renderRoute();
  } else {
    location.hash = hash;
  }
}

function renderRoute() {
  if (!state.ready) return;
  if (!state.me || !state.me.authenticated) {
    renderLoginPage();
    return;
  }
  const route = parseHash();
  if (route.name === 'settings') {
    state.route = route;
    renderShell();
    return;
  }
  if (route.name.startsWith('leader.') && !app.isLeader()) {
    navigate('#/member/home', { replace: true });
    return;
  }
  if (route.name.startsWith('member.') && app.isLeader()) {
    navigate('#/leader/overview', { replace: true });
    return;
  }
  state.route = route;
  renderShell();
}

/* ------------------------------------------------------------------ */
/* 外壳                                                                */
/* ------------------------------------------------------------------ */

const NAV_MEMBER = [
  { id: 'member.home', label: '我的作业', icon: 'inbox', hash: '#/member/home' },
  { id: 'member.weeks', label: '查看作业', icon: 'eye', hash: '#/member/weeks' },
  { id: 'member.grades', label: '我的成绩', icon: 'award', hash: '#/member/grades' },
  { id: 'settings', label: '设置', icon: 'settings', hash: '#/settings' },
];
const NAV_LEADER = [
  { id: 'leader.overview', label: '进度看板', icon: 'dashboard', hash: '#/leader/overview' },
  { id: 'leader.assignment', label: '布置作业', icon: 'edit', hash: '#/leader/assignment' },
  { id: 'leader.weeks', label: '查看作业', icon: 'eye', hash: '#/leader/weeks' },
  { id: 'leader.submissions', label: '提交与批改', icon: 'layers', hash: '#/leader/submissions' },
  { id: 'leader.members', label: '成员管理', icon: 'users', hash: '#/leader/members' },
  { id: 'settings', label: '设置', icon: 'settings', hash: '#/settings' },
];

const GROUP_NAMES = { algo: '算法组', mech: '机械组', embedded: '嵌入式组' };

function groupName(id) {
  const groups = state.me?.groups || [];
  const g = groups.find((x) => x.id === id);
  return g ? g.name : GROUP_NAMES[id] || id || '未分组';
}

function renderShell() {
  const user = state.me.user;
  const nav = app.isLeader() ? NAV_LEADER : NAV_MEMBER;
  const isDemo = state.me.mode === 'demo';
  const subtitle = isDemo
    ? '演示数据'
    : app.isCaptain()
      ? '队长 · 全队管理'
      : app.isLeader()
        ? '组长'
        : user.group
          ? groupName(user.group)
          : '待分组';

  document.getElementById('app').innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar__logo">
          <div class="sidebar__logo-mark">${ui.icon('target', 20)}</div>
          <div class="sidebar__logo-text">
            <b>RM HOMEWORK</b>
            <span>TEAM CONSOLE</span>
          </div>
        </div>
        <div class="nav-group-label">工作台</div>
        ${nav
          .map(
            (item) => `
          <div class="nav-item ${state.route.name === item.id ? 'active' : ''}" data-nav="${item.hash}">
            ${ui.icon(item.icon, 17)}
            <span>${item.label}</span>
            ${item.id === 'member.home' ? '<span class="nav-badge" data-nav-badge="unread" hidden>0</span>' : ''}
            ${item.id === 'leader.members' ? '<span class="nav-badge" data-nav-badge="pending" hidden>0</span>' : ''}
          </div>`,
          )
          .join('')}
        <div class="sidebar__spacer"></div>
        ${
          isDemo
            ? `<div class="alert alert--warn" style="margin-bottom:10px;padding:9px 10px;font-size:11.5px">${ui.icon('alert', 14)}<span>演示模式：数据保存在本地，不会推送到 GitHub。</span></div>`
            : ''
        }
        <div class="user-card" data-nav="#/settings">
          <div class="avatar">${user.avatarUrl ? `<img class="avatar" src="${user.avatarUrl}" alt="" />` : (user.name || user.login).slice(0, 1).toUpperCase()}</div>
          <div class="user-card__meta">
            <div class="user-card__name">${ui.escapeHtml(user.name || user.login)}</div>
            <div class="user-card__sub">@${ui.escapeHtml(user.login)} · ${subtitle}</div>
          </div>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <div>
            <div class="topbar__title" id="view-title">…</div>
            <div class="topbar__sub" id="view-sub"></div>
          </div>
          <div class="topbar__spacer"></div>
          <div class="topbar__actions" id="topbar-actions"></div>
        </div>
        <div class="content" id="content">
          <div class="card card--pad"><span class="spinner"></span> <span class="muted small">加载中…</span></div>
        </div>
      </div>
    </div>`;

  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.getAttribute('data-nav')));
  });

  bindSidebarAvatar();
  updateNavBadge();

  const map = {
    'member.home': renderMemberHome,
    'member.week': renderMemberWeek,
    'member.weeks': renderWeekView,
    'member.grades': renderMemberGrades,
    'leader.overview': renderOverview,
    'leader.assignment': renderAssignment,
    'leader.weeks': renderWeekView,
    'leader.submissions': renderSubmissions,
    'leader.members': renderMembers,
    settings: renderSettings,
  };
  const render = map[state.route.name] || renderMemberHome;
  loadView(render);
}

function bindSidebarAvatar() {
  const img = document.querySelector('.user-card .avatar img');
  if (img) {
    img.addEventListener('error', () => {
      const parent = img.parentElement;
      const login = state.me?.user?.login || 'U';
      parent.innerHTML = ui.escapeHtml(login.slice(0, 1).toUpperCase());
    });
  }
}

async function loadView(render) {
  const content = document.getElementById('content');
  if (!content) return;
  state.viewToken = (state.viewToken || 0) + 1;
  const token = state.viewToken;
  try {
    const result = await render(appContext(token));
    if (token !== state.viewToken) return;
    content.innerHTML = result.html;
    content.classList.remove('page-enter');
    void content.offsetWidth;
    content.classList.add('page-enter');
    if (result.mount) result.mount(content);
    if (result.title) document.getElementById('view-title').textContent = result.title;
    if (result.sub != null) document.getElementById('view-sub').textContent = result.sub;
    const actions = document.getElementById('topbar-actions');
    if (actions) {
      actions.innerHTML = '';
      if (result.actions) result.actions(actions);
    }
  } catch (err) {
    if (token !== state.viewToken) return;
    console.error(err);
    content.innerHTML = `
      <div class="card card--pad">
        <div class="empty">
          <div class="empty__icon">${ui.icon('alert', 22)}</div>
          <div class="empty__title">加载失败</div>
          <div class="empty__sub">${ui.escapeHtml(err.message || '未知错误')}</div>
          <button class="btn" style="margin-top:14px" data-retry>重试</button>
        </div>
      </div>`;
    content.querySelector('[data-retry]')?.addEventListener('click', () => loadView(render));
  }
}

function appContext(token) {
  return {
    app,
    state,
    api,
    ui,
    token,
    navigate,
    isLeader: app.isLeader(),
    rerender: () => loadView(resolveRenderer()),
    toast: ui.toast,
    confirm: ui.confirmDialog,
    openModal: ui.openModal,
    refreshNotifications: () => refreshNotifications({ silent: true }),
  };
}

function resolveRenderer() {
  return (
    {
      'member.home': renderMemberHome,
      'member.week': renderMemberWeek,
      'member.weeks': renderWeekView,
      'member.grades': renderMemberGrades,
      'leader.overview': renderOverview,
      'leader.assignment': renderAssignment,
      'leader.weeks': renderWeekView,
      'leader.submissions': renderSubmissions,
      'leader.members': renderMembers,
      settings: renderSettings,
    }[state.route.name] || renderMemberHome
  );
}

/* ------------------------------------------------------------------ */
/* 登录                                                                */
/* ------------------------------------------------------------------ */

function renderLoginPage() {
  document.getElementById('app').innerHTML = '';
  const node = renderLogin({
    app,
    api,
    ui,
    state,
    onLogin: afterLogin,
    onSetup: (result) => renderSetupPage(result),
  });
  document.getElementById('app').appendChild(node);
}

function renderSetupPage(result) {
  const node = renderSetup({
    app,
    api,
    ui,
    state,
    loginResult: result,
    onDone: afterLogin,
  });
  document.getElementById('app').innerHTML = '';
  document.getElementById('app').appendChild(node);
}

async function afterLogin(result) {
  state.me = await api.get('/api/me');
  state.settings = await api.get('/api/settings').catch(() => state.settings);
  state.setup = null;
  if (result && result.needSetup) {
    renderSetupPage(result);
    return;
  }
  const hash = app.defaultRoute();
  if (location.hash !== hash) {
    history.replaceState(null, '', hash);
  }
  renderRoute();
  startPolling();
  setTimeout(() => refreshNotifications({ silent: false }), 350);
  const warnings = (result && result.warnings) || state.me.warnings || [];
  for (const w of warnings.slice(0, 2)) ui.toast(w, { variant: 'warn', title: '提示', timeout: 7000 });
}

async function logout() {
  try {
    await api.post('/api/logout');
  } catch {
    /* ignore */
  }
  state.me = null;
  state.notifications = { items: [], unreadCount: 0 };
  state.shownKeys.clear();
  stopPolling();
  history.replaceState(null, '', '#/login');
  // 重新取一次未登录状态，登录页需要演示账号列表
  state.me = await api.get('/api/me').catch(() => null);
  renderLoginPage();
}

/* ------------------------------------------------------------------ */
/* 通知与轮询                                                          */
/* ------------------------------------------------------------------ */

let pollTimer = null;

function startPolling() {
  stopPolling();
  const sec = Math.max(15, Math.min(300, state.settings?.notifications?.pollSeconds || 25));
  pollTimer = setInterval(() => pollTick(), sec * 1000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

let syncing = false;

async function pollTick() {
  if (!state.me?.authenticated) return;
  if (syncing) return;
  syncing = true;
  try {
    // 组员端需要主动拉取远端，才能及时发现组长提交的 evaluation.json
    if (!app.isLeader()) {
      await api.post('/api/sync').catch(() => {});
    }

    // 组长可能刚刚分配了分组 / 提升了角色，这里刷新会话状态
    const me = await api.get('/api/me').catch(() => null);
    if (me && me.authenticated) {
      const before = `${state.me.user.role}|${state.me.user.group}`;
      const after = `${me.user.role}|${me.user.group}`;
      state.me = me;
      updateNavBadge();
      if (before !== after) {
        const roleChanged = before.split('|')[0] !== after.split('|')[0];
        if (roleChanged) navigate(app.defaultRoute(), { replace: true });
        else renderShell();
        return;
      }
    }

    await refreshNotifications({ silent: true });
    if (app.isLeader() && state.route.name === 'leader.overview') {
      const el = document.querySelector('[data-overview-refresh]');
      if (el) el.click();
    }
  } finally {
    syncing = false;
  }
}

async function refreshNotifications({ silent = true } = {}) {
  if (!state.me?.authenticated) return;
  try {
    const data = await api.get('/api/notifications');
    state.notifications = data;
    updateNavBadge();
    const enabled = !state.settings || !state.settings.notifications || state.settings.notifications.enabled !== false;
    const freshScores = data.items.filter((i) => !i.read && !state.shownKeys.has(i.key));
    const freshWeeks = (data.announcements || []).filter(
      (a) => !a.read && !state.shownKeys.has(a.key) && !app.isLeader(),
    );
    const freshJoins = (data.joinRequests || []).filter(
      (j) => !j.read && !state.shownKeys.has(j.key) && app.isLeader(),
    );
    if (freshScores.length || freshWeeks.length || freshJoins.length) {
      if (enabled) {
        for (const item of freshScores.slice(0, 3)) {
          state.shownKeys.add(item.key);
          ui.scoreToast(item, {
            onView: () => {
              navigate('#/member/grades');
            },
          });
        }
        for (const item of freshWeeks.slice(0, 2)) {
          state.shownKeys.add(item.key);
          ui.weekToast(item, {
            onView: () => {
              navigate(`#/member/week/${item.week}`);
            },
          });
        }
        for (const item of freshJoins.slice(0, 2)) {
          state.shownKeys.add(item.key);
          ui.joinToast(item, {
            onView: () => {
              navigate('#/leader/members');
            },
          });
        }
      }
      const keys = [...freshScores, ...freshWeeks, ...freshJoins].map((i) => i.key);
      await api.post('/api/notifications/read', { keys }).catch(() => {});
      state.notifications.unreadCount = Math.max(0, data.unreadCount - keys.length);
      updateNavBadge();
    }
  } catch (err) {
    if (!silent) ui.toast(err.message, { variant: 'error' });
  }
}

function updateNavBadge() {
  const unread = state.notifications?.unreadCount || 0;
  const pending = state.me?.pendingCount || 0;
  document.querySelectorAll('[data-nav-badge="unread"]').forEach((badge) => {
    badge.hidden = unread <= 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
  });
  document.querySelectorAll('[data-nav-badge="pending"]').forEach((badge) => {
    badge.hidden = pending <= 0;
    badge.textContent = pending > 99 ? '99+' : String(pending);
  });
}

/* ------------------------------------------------------------------ */
/* 标题栏 / 全局事件                                                   */
/* ------------------------------------------------------------------ */

function bindTitlebar() {
  const tag = document.getElementById('titlebar-tag');
  const setTag = () => {
    if (!tag) return;
    if (!state.me?.authenticated) {
      tag.textContent = '未连接';
      return;
    }
    tag.textContent = state.me.mode === 'demo' ? '演示模式' : `GitHub · ${state.me.repo.owner}/${state.me.repo.name}`;
  };
  setTag();
  setInterval(setTag, 2000);

  const min = document.getElementById('win-min');
  const max = document.getElementById('win-max');
  const close = document.getElementById('win-close');
  const rmh = window.rmh;
  if (rmh) {
    min.addEventListener('click', () => rmh.window.minimize());
    max.addEventListener('click', () => rmh.window.toggleMaximize());
    close.addEventListener('click', () => rmh.window.close());
    rmh.window.isMaximized().then((v) => document.body.classList.toggle('is-maximized', v));
    rmh.window.onMaximized((v) => {
      document.body.classList.toggle('is-maximized', v);
      max.innerHTML = v
        ? '<svg viewBox="0 0 12 12" width="10" height="10"><rect x="3" y="3" width="6" height="6" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M4.5 3V2.2h5.3v5.3H9" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>'
        : '<svg viewBox="0 0 12 12" width="10" height="10"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
    });
    max.addEventListener('dblclick', (e) => e.stopPropagation());
  }
}

function bindGlobalClicks() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-external]');
    if (a) {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (window.rmh?.openExternal) window.rmh.openExternal(href);
      else window.open(href, '_blank');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
      if (!e.defaultPrevented) {
        // 交给 Chromium 默认刷新
      }
    }
  });
}

boot().catch((err) => {
  console.error(err);
  const appEl = document.getElementById('app');
  appEl.innerHTML = `
    <div class="boot-loading">
      <div class="empty__title">启动失败</div>
      <div class="empty__sub">${ui.escapeHtml(err.message || String(err))}</div>
      <button class="btn" id="boot-retry">重试</button>
    </div>`;
  appEl.querySelector('#boot-retry').addEventListener('click', () => location.reload());
});
