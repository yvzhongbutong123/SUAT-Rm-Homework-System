/**
 * 轻量 UI 工具：图标、Toast、模态框、格式化。
 */

const ICONS = {
  dashboard:
    '<path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  award:
    '<circle cx="12" cy="9" r="5"/><path d="m8.2 13.4-1.7 7L12 18l5.5 2.4-1.7-7"/>',
  users:
    '<path d="M16 19v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 17.5V19"/><circle cx="10" cy="8" r="3.5"/><path d="M20 19v-1a4 4 0 0 0-3-3.8"/><path d="M15.5 4.3a3.5 3.5 0 0 1 0 6.8"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  refresh:
    '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  download:
    '<path d="M12 4v12m0 0 4-4m-4 4-4-4"/><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  inbox:
    '<path d="M3 13h4l2 3h6l2-3h4"/><path d="M4.5 5h15l1.5 8v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4l1.5-8Z"/>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  logout: '<path d="M15 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2"/><path d="M10 12h11m0 0-3-3m3 3-3 3"/>',
  github:
    '<path d="M9 19c-4.3 1.3-4.3-2.2-6-2.7m12 5.4v-3.5a3 3 0 0 0-.9-2.4c3-.3 6.2-1.5 6.2-6.7a5.2 5.2 0 0 0-1.4-3.6 4.9 4.9 0 0 0-.1-3.6s-1.1-.3-3.7 1.4a12.7 12.7 0 0 0-6.6 0C6.9 1.4 5.8 1.7 5.8 1.7a4.9 4.9 0 0 0-.1 3.6A5.2 5.2 0 0 0 4.3 9c0 5.2 3.2 6.4 6.2 6.7a3 3 0 0 0-.9 2.3V21"/>',
  spark: '<path d="M12 3v4m0 10v4m-7-9H3m18 0h-2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/><circle cx="12" cy="12" r="3.2"/>',
  arrowRight: '<path d="M5 12h14m0 0-6-6m6 6-6 6"/>',
  trash:
    '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7"/><path d="M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  alert:
    '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5"/><circle cx="12" cy="17.2" r="0.6" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8m-3 0 3 3m-6 0 3 3"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  code: '<path d="m8 6-6 6 6 6M16 6l6 6-6 6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  zap: '<path d="M13 2 3 14h7l-1 8 11-13h-7l1-7Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
};

export function icon(name, size = 16, extra = '') {
  const path = ICONS[name] || ICONS.info;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${extra}>${path}</svg>`;
}

export function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (x) => String(x).padStart(2, '0');
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (!withTime) return base;
  return `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 86400 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
  return formatDate(iso, false);
}

export function countdown(iso) {
  if (!iso) return { text: '未设置截止时间', over: false, urgent: false };
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return { text: '未设置截止时间', over: false, urgent: false };
  const diff = target - Date.now();
  if (diff <= 0) return { text: '已截止', over: true, urgent: false };
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  let text;
  if (days > 0) text = `剩余 ${days} 天 ${hours} 小时`;
  else if (hours > 0) text = `剩余 ${hours} 小时 ${mins} 分`;
  else text = `剩余 ${Math.max(1, mins)} 分钟`;
  return { text, over: false, urgent: diff < 24 * 3600 * 1000 };
}

export function scoreClass(score) {
  if (score == null) return '';
  if (score >= 85) return '';
  if (score >= 70) return 'score-pill--mid';
  return 'score-pill--low';
}

/* ------------------------- Toast ------------------------- */

function mountToast(html, { variant = 'info', timeout = 4600 } = {}) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast--${variant}`;
  el.innerHTML = html;
  root.appendChild(el);
  const remove = () => {
    if (!el.isConnected) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  };
  if (timeout > 0) setTimeout(remove, timeout);
  el.querySelectorAll('[data-toast-close]').forEach((b) => b.addEventListener('click', remove));
  return { el, close: remove };
}

export function toast(message, { variant = 'info', title = '', timeout = 4000 } = {}) {
  const colors = {
    info: ['var(--blue-soft)', 'var(--blue)'],
    success: ['var(--green-soft)', 'var(--green)'],
    error: ['var(--accent-soft)', '#ff8a93'],
    warn: ['var(--amber-soft)', 'var(--amber)'],
  };
  const [bg, fg] = colors[variant] || colors.info;
  const iconName = variant === 'success' ? 'check' : variant === 'error' ? 'alert' : variant === 'warn' ? 'alert' : 'info';
  return mountToast(
    `<span class="toast__icon" style="background:${bg};color:${fg}">${icon(iconName, 16)}</span>
     <div class="toast__body">
       ${title ? `<div class="toast__title">${escapeHtml(title)}</div>` : ''}
       <div class="toast__text">${escapeHtml(message)}</div>
     </div>
     <button class="toast__close" data-toast-close aria-label="关闭">${icon('x', 13)}</button>`,
    { variant, timeout },
  );
}

/**
 * 成绩通知卡：右下角弹出，带分数、周次、评语。
 * @returns {{el: HTMLElement, close: Function}}
 */
export function scoreToast(item, { onView } = {}) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'score-toast';
  const scoreText = Number.isInteger(item.score) ? item.score : item.score.toFixed(1);
  el.innerHTML = `
    <div class="score-toast__top">
      <span class="score-toast__label">NEW · 作业已批改</span>
      <button class="score-toast__close" aria-label="关闭">${icon('x', 14)}</button>
    </div>
    <div class="score-toast__spark">${icon('spark', 34)}</div>
    <div class="score-toast__main">
      <div class="score-toast__score">${scoreText}<small>/ 100</small></div>
      <div>
        <div class="score-toast__week">${escapeHtml(item.week.toUpperCase())}</div>
        <div class="score-toast__meta">${escapeHtml(item.gradedBy || '组长')} · ${escapeHtml(timeAgo(item.gradedAt) || '刚刚')}</div>
      </div>
    </div>
    ${item.comment ? `<div class="score-toast__comment">${escapeHtml(item.comment)}</div>` : ''}
    <div class="score-toast__foot">
      <button class="btn btn--sm btn--primary" data-view>查看详情</button>
      <button class="btn btn--sm btn--ghost" data-dismiss>知道了</button>
    </div>
    <div class="score-toast__progress"></div>
  `;
  root.appendChild(el);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), 280);
  };
  el.querySelector('.score-toast__close').addEventListener('click', close);
  el.querySelector('[data-dismiss]').addEventListener('click', close);
  el.querySelector('[data-view]').addEventListener('click', () => {
    close();
    if (onView) onView(item);
  });
  if (onView) {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      close();
      onView(item);
    });
  }
  // 12 秒后自动收起；进度条动画 10 秒
  setTimeout(close, 12000);
  return { el, close };
}

/**
 * 新作业发布通知卡（组员端右下角）。
 */
export function weekToast(item, { onView } = {}) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'week-toast';
  const dl = item.deadline ? `截止 ${formatDate(item.deadline)}` : '未设置截止时间';
  el.innerHTML = `
    <div class="week-toast__icon">${icon('bell', 17)}</div>
    <div class="week-toast__body">
      <div class="week-toast__label">NEW ASSIGNMENT</div>
      <div class="week-toast__title">${escapeHtml(item.title || item.week)}</div>
      <div class="week-toast__meta">${escapeHtml(String(item.week || '').toUpperCase())} · ${escapeHtml(dl)}</div>
    </div>
    <button class="week-toast__close" aria-label="关闭">${icon('x', 13)}</button>
  `;
  root.appendChild(el);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  };
  el.querySelector('.week-toast__close').addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });
  el.addEventListener('click', () => {
    close();
    if (onView) onView(item);
  });
  setTimeout(close, 11000);
  return { el, close };
}

/**
 * 未分组 / 加入申请通知（组长端）。
 */
export function joinToast(item, { onView } = {}) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'week-toast join-toast';
  el.innerHTML = `
    <div class="week-toast__icon" style="background:rgba(246,167,35,.14);border-color:rgba(246,167,35,.3);color:var(--amber)">${icon('users', 16)}</div>
    <div class="week-toast__body">
      <div class="week-toast__label" style="color:var(--amber)">JOIN REQUEST</div>
      <div class="week-toast__title">${escapeHtml(item.name || item.login)} 尚未进组</div>
      <div class="week-toast__meta">@${escapeHtml(item.login)} · 点击前往成员管理认领</div>
    </div>
    <button class="week-toast__close" aria-label="关闭">${icon('x', 13)}</button>
  `;
  root.appendChild(el);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  };
  el.querySelector('.week-toast__close').addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });
  el.addEventListener('click', () => {
    close();
    if (onView) onView(item);
  });
  setTimeout(close, 12000);
  return { el, close };
}

/* ------------------------- Modal ------------------------- */

export function openModal({ title, sub = '', body = '', footer = '', wide = false, onMount, closable = true }) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal__head">
        <div>
          <div class="modal__title">${escapeHtml(title)}</div>
          ${sub ? `<div class="modal__sub">${escapeHtml(sub)}</div>` : ''}
        </div>
        ${closable ? '<button class="modal__close" data-close aria-label="关闭"></button>' : ''}
      </div>
      <div class="modal__body"></div>
      ${footer ? `<div class="modal__foot">${footer}</div>` : ''}
    </div>`;
  const closeBtn = backdrop.querySelector('[data-close]');
  if (closeBtn) closeBtn.innerHTML = icon('x', 15);
  backdrop.querySelector('.modal__body').innerHTML = body;
  root.appendChild(backdrop);

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && closable) close();
  };
  document.addEventListener('keydown', onKey);
  if (closable) {
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close();
    });
    if (closeBtn) closeBtn.addEventListener('click', close);
  }
  const handle = { el: backdrop.querySelector('.modal'), body: backdrop.querySelector('.modal__body'), close };
  if (onMount) onMount(handle);
  return handle;
}

export function confirmDialog({ title = '确认操作', message, confirmText = '确定', danger = false }) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      body: `<div style="font-size:13px;line-height:1.7;color:var(--text-2)">${escapeHtml(message)}</div>`,
      footer: `<button class="btn" data-cancel>取消</button>
               <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-ok>${escapeHtml(confirmText)}</button>`,
      onMount(h) {
        h.el.querySelector('[data-cancel]').addEventListener('click', () => {
          h.close();
          resolve(false);
        });
        h.el.querySelector('[data-ok]').addEventListener('click', () => {
          h.close();
          resolve(true);
        });
      },
    });
    m.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        m.close();
        resolve(true);
      }
    });
  });
}

/* ------------------------- 其它 ------------------------- */

export function setBusy(text) {
  let el = document.getElementById('busy-overlay');
  if (!text) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'busy-overlay';
    el.className = 'loading-overlay';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="loading-box"><span class="spinner"></span><span>${escapeHtml(text)}</span></div>`;
}

export function deadlineState(iso) {
  const c = countdown(iso);
  return c;
}

export function groupOf(groups, id) {
  return (groups || []).find((g) => g.id === id) || { id: id || 'unknown', name: id || '未分组', color: '#64748b', short: '—' };
}
