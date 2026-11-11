import {
  icon,
  escapeHtml,
  formatBytes,
  formatDate,
  timeAgo,
  scoreClass,
  groupOf,
  toast,
  openModal,
  confirmDialog,
  setBusy,
} from '../ui.js';
import { renderMarkdown } from '../markdown.js';

/* ------------------------------------------------------------------ */
/* 组长端：进度看板                                                     */
/* ------------------------------------------------------------------ */

const QUICK_COMMENTS = [
  '完成度不错，继续保持。',
  '代码结构清晰，注意变量命名规范。',
  '文档需要补充运行说明与环境要求。',
  '请补充关键步骤的截图或录屏。',
  '关键指标已达到，可以进入下一阶段。',
  '建议先自测通过后再提交。',
];

export async function renderOverview(ctx) {
  const { api, state } = ctx;
  let week = state.overviewWeek;
  let data = await api.get(`/api/admin/overview${week ? `?week=${encodeURIComponent(week)}` : ''}`);
  if (week === undefined) {
    const fallback = data.currentWeek || data.weeks[data.weeks.length - 1];
    state.overviewWeek = fallback || null;
    if (fallback) data = await api.get(`/api/admin/overview?week=${encodeURIComponent(fallback)}`);
  }
  week = state.overviewWeek;

  const summary = data.summary;
  const pendingRows = data.rows.filter((r) => r.submitted && r.score == null);
  const submittedRows = data.rows.filter((r) => r.submitted);
  const leaderboard = buildLeaderboard(data.rows);

  const html = `
    <div class="stack">
      ${
        data.pendingMembers && data.pendingMembers.length
          ? `<div class="alert alert--warn">${icon('users', 15)}
              <span><b>${data.pendingMembers.length} 位成员尚未进组</b>：${data.pendingMembers
                .map((m) => '@' + escapeHtml(m.login))
                .join('、')}。前往「成员管理」认领到${data.scope ? groupOf(data.groups, data.scope).name : '对应小组'}。</span>
            </div>`
          : ''
      }
      <div class="row row--wrap" style="justify-content:space-between">
        <div class="row" style="gap:10px">
          <select class="select" id="week-filter" style="width:200px;height:34px">
            <option value="">全部周次</option>
            ${data.weeks
              .map(
                (w) =>
                  `<option value="${w}" ${week === w ? 'selected' : ''}>${escapeHtml(w.toUpperCase())}${data.currentWeek === w ? ' · 当前周' : ''}</option>`,
              )
              .join('')}
          </select>
          <span class="badge ${ctx.app.isCaptain() ? 'badge--red' : data.scope ? 'badge--blue' : 'badge--gray'}">
            ${ctx.app.isCaptain() ? '队长 · 全队管理' : data.scope ? `负责：${escapeHtml(groupOf(data.groups, data.scope).name)}` : '组长 · 全部小组'}
          </span>
          ${
            ctx.app.isCaptain() && week && week !== data.currentWeek
              ? `<button class="btn btn--sm btn--primary" id="set-current-week">${icon('target', 13)} 设为当前周</button>`
              : ''
          }
        </div>
        <div class="row" style="gap:8px">
          <span class="tiny muted" id="sync-label">${icon('clock', 12)} 更新于 ${formatDate(data.generatedAt)}</span>
          <button class="btn btn--sm" id="refresh-overview" data-overview-refresh>${icon('refresh', 13)} 刷新</button>
        </div>
      </div>

      <div class="grid grid--4">
        <div class="stat stat--accent">
          <div class="stat__label">${icon('trend', 13)} 提交率</div>
          <div class="stat__value">${summary.rate}<small>%</small></div>
          <div class="stat__foot">${summary.submitted} / ${summary.total} 人次${week ? ` · ${escapeHtml(week.toUpperCase())}` : ' · 全部周次'}</div>
        </div>
        <div class="stat">
          <div class="stat__label">${icon('award', 13)} 平均分</div>
          <div class="stat__value">${summary.avgScore == null ? '—' : summary.avgScore}<small>/ 100</small></div>
          <div class="stat__foot">已批改 ${summary.graded} 份</div>
        </div>
        <div class="stat">
          <div class="stat__label">${icon('clock', 13)} 待批改</div>
          <div class="stat__value" style="color:${pendingRows.length ? 'var(--amber)' : 'var(--text)'}">${pendingRows.length}</div>
          <div class="stat__foot">${pendingRows.length ? '建议尽快反馈' : '全部处理完毕'}</div>
        </div>
        <div class="stat">
          <div class="stat__label">${icon('users', 13)} 战队成员</div>
          <div class="stat__value">${summary.memberCount}</div>
          <div class="stat__foot">${data.groups.map((g) => `${g.name.replace('组', '')} ${g.members.length}`).join(' · ')}</div>
        </div>
      </div>

      <div class="grid grid--3">
        ${data.groups
          .map(
            (g) => `
          <div class="group-card" style="border-color:${hexA(g.color, 0.28)}">
            <div class="group-card__glow" style="background:${g.color}"></div>
            <div class="group-card__head">
              <div class="group-card__icon" style="background:${g.color}">${escapeHtml(g.short || g.id.toUpperCase())}</div>
              <div class="group-card__name">${escapeHtml(g.name)}</div>
              <div class="spacer"></div>
              <span class="tiny muted">${g.members.length} 人</span>
            </div>
            <div class="group-card__nums">
              <span class="group-card__rate">${g.rate}<span style="font-size:14px;color:var(--text-3)">%</span></span>
              <span class="tiny muted">提交率</span>
            </div>
            <div class="progress" style="margin-top:8px">
              <div class="progress__bar" style="width:${g.rate}%;background:${g.color}"></div>
            </div>
            <div class="group-card__meta">
              <span>提交 <b>${g.submitted}/${g.total}</b></span>
              <span>已批 <b>${g.graded}</b></span>
              <span>均分 <b>${g.avgScore == null ? '—' : g.avgScore}</b></span>
            </div>
          </div>`,
          )
          .join('')}
      </div>

      <div class="grid" style="grid-template-columns:minmax(0,1.5fr) minmax(300px,.8fr)">
        <div class="card">
          <div class="card__head">
            <div>
              <div class="card__title">待批改</div>
              <div class="card__sub">${pendingRows.length} 份提交等待反馈</div>
            </div>
            <div class="card__spacer"></div>
            <button class="btn btn--sm btn--ghost" data-nav-submissions>查看全部 ${icon('arrowRight', 12)}</button>
          </div>
          ${
            pendingRows.length
              ? `<div class="table-wrap" style="border:0;border-radius:0">
                  <table class="table">
                    <thead><tr><th>成员</th><th>分组</th>${week ? '' : '<th>周次</th>'}<th>提交时间</th><th style="text-align:right">操作</th></tr></thead>
                    <tbody>
                      ${pendingRows
                        .slice(0, 8)
                        .map(
                          (r) => `
                        <tr>
                          <td>
                            <div class="row" style="gap:8px">
                              <span class="avatar" style="width:26px;height:26px;font-size:11px">${escapeHtml((r.name || r.login).slice(0, 1))}</span>
                              <span>
                                <div class="small">${escapeHtml(r.name || r.login)}</div>
                                <div class="tiny muted">@${escapeHtml(r.login)}</div>
                              </span>
                            </div>
                          </td>
                          <td><span class="badge" style="background:${hexA(groupOf(data.groups, r.group).color, 0.14)};color:${groupOf(data.groups, r.group).color}">${escapeHtml(groupOf(data.groups, r.group).name)}</span></td>
                          ${week ? '' : `<td class="num">${escapeHtml(r.week.toUpperCase())}</td>`}
                          <td class="tiny muted">${escapeHtml(r.uploadedAt ? timeAgo(r.uploadedAt) : '—')}</td>
                          <td>
                            <div class="actions">
                              <button class="btn btn--sm btn--primary" data-grade="${r.week}|${r.login}">${icon('edit', 12)} 批改</button>
                            </div>
                          </td>
                        </tr>`,
                        )
                        .join('')}
                    </tbody>
                  </table>
                </div>`
              : `<div class="empty" style="padding:30px">
                  <div class="empty__icon" style="color:var(--green);background:var(--green-soft);border-color:rgba(47,212,143,.3)">${icon('check', 20)}</div>
                  <div class="empty__title">没有待批改的作业</div>
                  <div class="empty__sub">${submittedRows.length ? '所有提交都已反馈' : '还没有组员提交'}</div>
                </div>`
          }
        </div>

        <div class="card">
          <div class="card__head">
            <div class="card__title">成绩排行</div>
            <div class="card__spacer"></div>
            <span class="tiny muted">平均分</span>
          </div>
          <div class="card__body" style="padding-top:8px">
            ${
              leaderboard.length
                ? leaderboard
                    .slice(0, 8)
                    .map(
                      (m, i) => `
                  <div class="rank">
                    <span class="rank__no">#${i + 1}</span>
                    <span class="rank__name">${escapeHtml(m.name)} <span class="tiny muted">@${escapeHtml(m.login)}</span></span>
                    <span class="rank__score" style="color:${m.avg >= 85 ? 'var(--green)' : m.avg >= 70 ? 'var(--amber)' : '#ff8a93'}">${m.avg.toFixed(1)}</span>
                  </div>`,
                    )
                    .join('')
                : `<div class="empty" style="padding:20px"><div class="empty__sub">暂无已批改成绩</div></div>`
            }
          </div>
        </div>
      </div>
    </div>`;

  return {
    title: '进度看板',
    sub: week ? `${week.toUpperCase()} · 提交与批改概览` : '全部周次 · 提交与批改概览',
    html,
    mount(el) {
      el.querySelector('#week-filter').addEventListener('change', (e) => {
        state.overviewWeek = e.target.value || null;
        ctx.rerender();
      });
      el.querySelector('#refresh-overview').addEventListener('click', async () => {
        const btn = el.querySelector('#refresh-overview');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 刷新中';
        try {
          await api.post('/api/sync').catch(() => {});
          ctx.rerender();
        } finally {
          btn.disabled = false;
        }
      });

      el.querySelector('#set-current-week')?.addEventListener('click', async () => {
        const btn = el.querySelector('#set-current-week');
        btn.disabled = true;
        try {
          await api.post('/api/admin/weeks/current', { week });
          toast(`已将 ${week.toUpperCase()} 设为当前周`, { variant: 'success' });
          ctx.rerender();
        } catch (err) {
          toast(err.message, { variant: 'error' });
          btn.disabled = false;
        }
      });
      el.querySelector('[data-nav-submissions]')?.addEventListener('click', () => {
        location.hash = '#/leader/submissions';
      });
      el.querySelectorAll('[data-grade]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [w, login] = btn.getAttribute('data-grade').split('|');
          const row = data.rows.find((r) => r.week === w && r.login === login);
          if (row) openGradeModal(ctx, row, () => ctx.rerender());
        });
      });
    },
  };
}

function buildLeaderboard(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.score == null) continue;
    const cur = map.get(r.login) || { login: r.login, name: r.name, scores: [] };
    cur.scores.push(r.score);
    map.set(r.login, cur);
  }
  return [...map.values()]
    .map((m) => ({ ...m, avg: m.scores.reduce((a, b) => a + b, 0) / m.scores.length }))
    .sort((a, b) => b.avg - a.avg);
}

function hexA(hex, alpha) {
  const h = String(hex || '#64748b').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ------------------------------------------------------------------ */
/* 组长端：提交与批改                                                   */
/* ------------------------------------------------------------------ */

export async function renderSubmissions(ctx) {
  const { api, state } = ctx;
  let week = state.submissionsWeek;
  let data = await api.get(`/api/admin/overview${week ? `?week=${encodeURIComponent(week)}` : ''}`);
  if (week === undefined) {
    week = data.currentWeek || null;
    state.submissionsWeek = week;
    if (week) data = await api.get(`/api/admin/overview?week=${encodeURIComponent(week)}`);
  }
  const groups = data.groups;
  const filter = state.submissionsFilter || 'all';
  const query = (state.submissionsQuery || '').toLowerCase();

  const rows = data.rows
    .filter((r) => {
      if (filter === 'pending') return r.submitted && r.score == null;
      if (filter === 'graded') return r.score != null;
      if (filter === 'missing') return !r.submitted;
      return true;
    })
    .filter((r) => !query || r.login.toLowerCase().includes(query) || (r.name || '').toLowerCase().includes(query))
    .sort((a, b) => {
      if (a.submitted !== b.submitted) return a.submitted ? -1 : 1;
      return String(a.group || '').localeCompare(String(b.group || '')) || a.login.localeCompare(b.login);
    });

  const html = `
    <div class="stack">
      <div class="card">
        <div class="toolbar">
          <select class="select" id="week-filter" style="width:150px">
            <option value="">全部周次</option>
            ${data.weeks.map((w) => `<option value="${w}" ${week === w ? 'selected' : ''}>${escapeHtml(w.toUpperCase())}</option>`).join('')}
          </select>
          <div class="tabs">
            <button class="tab ${filter === 'all' ? 'active' : ''}" data-filter="all">全部</button>
            <button class="tab ${filter === 'pending' ? 'active' : ''}" data-filter="pending">待批改</button>
            <button class="tab ${filter === 'graded' ? 'active' : ''}" data-filter="graded">已批改</button>
            <button class="tab ${filter === 'missing' ? 'active' : ''}" data-filter="missing">未提交</button>
          </div>
          <div class="spacer"></div>
          <div class="row" style="gap:6px">
            <input class="input" id="member-search" placeholder="搜索成员 / 账号" value="${escapeHtml(state.submissionsQuery || '')}" style="width:190px;height:32px" />
            <button class="btn btn--sm" id="refresh-subs">${icon('refresh', 13)} 同步</button>
          </div>
        </div>
        <div class="table-wrap" style="border:0;border-radius:0;max-height:calc(100vh - 300px)">
          <table class="table">
            <thead>
              <tr>
                <th>成员</th><th>分组</th>${week ? '' : '<th>周次</th>'}<th>状态</th><th>文件</th><th>提交时间</th><th>分数</th><th style="text-align:right">操作</th>
              </tr>
            </thead>
            <tbody>
              ${
                rows.length
                  ? rows
                      .map(
                        (r) => `
                  <tr>
                    <td>
                      <div class="row" style="gap:9px">
                        <span class="avatar" style="width:28px;height:28px;font-size:11.5px">${escapeHtml((r.name || r.login).slice(0, 1))}</span>
                        <span>
                          <div class="small">${escapeHtml(r.name || r.login)}</div>
                          <div class="tiny muted">@${escapeHtml(r.login)}</div>
                        </span>
                      </div>
                    </td>
                    <td><span class="badge" style="background:${hexA(groupOf(groups, r.group).color, 0.13)};color:${groupOf(groups, r.group).color}">${escapeHtml(groupOf(groups, r.group).name)}</span></td>
                    ${week ? '' : `<td class="num">${escapeHtml(r.week.toUpperCase())}</td>`}
                    <td>${
                      !r.submitted
                        ? '<span class="badge badge--gray">未提交</span>'
                        : r.score != null
                          ? '<span class="badge badge--green">已批改</span>'
                          : '<span class="badge badge--amber">待批改</span>'
                    }</td>
                    <td class="num">${r.submitted ? `${r.fileCount} · ${formatBytes(r.totalBytes)}` : '—'}</td>
                    <td class="tiny muted">${escapeHtml(r.uploadedAt ? formatDate(r.uploadedAt) : r.submitted ? '—' : '')}</td>
                    <td>${r.score != null ? `<span class="score-pill ${scoreClass(r.score)}">${r.score}</span>` : '<span class="muted tiny">—</span>'}</td>
                    <td>
                      <div class="actions">
                        <button class="btn btn--sm btn--ghost" data-view="${r.week}|${r.login}" ${r.submitted ? '' : 'disabled'} title="查看文件">${icon('eye', 12)}</button>
                        <button class="btn btn--sm btn--ghost" data-download="${r.week}|${r.login}" ${r.submitted ? '' : 'disabled'} title="下载作业">${icon('download', 12)}</button>
                        <button class="btn btn--sm ${r.submitted && r.score == null ? 'btn--primary' : ''}" data-grade="${r.week}|${r.login}" ${r.submitted ? '' : 'disabled'}>${r.score != null ? '重批' : '批改'}</button>
                      </div>
                    </td>
                  </tr>`,
                      )
                      .join('')
                  : `<tr><td colspan="7"><div class="empty" style="padding:34px"><div class="empty__icon">${icon('search', 20)}</div><div class="empty__title">没有符合条件的记录</div></div></td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
      <div class="tiny muted">提示：一键下载会生成 ZIP，包含该成员本目录下的全部文件（含已有 evaluation.json）。</div>
    </div>`;

  return {
    title: '提交与批改',
    sub: `${rows.length} 条记录${week ? ` · ${week.toUpperCase()}` : ''}`,
    html,
    mount(el) {
      el.querySelector('#week-filter').addEventListener('change', (e) => {
        state.submissionsWeek = e.target.value || null;
        ctx.rerender();
      });
      el.querySelectorAll('[data-filter]').forEach((tab) =>
        tab.addEventListener('click', () => {
          state.submissionsFilter = tab.getAttribute('data-filter');
          ctx.rerender();
        }),
      );
      let timer = null;
      el.querySelector('#member-search').addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          state.submissionsQuery = e.target.value;
          ctx.rerender();
        }, 300);
      });
      el.querySelector('#refresh-subs').addEventListener('click', async () => {
        const btn = el.querySelector('#refresh-subs');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 同步中';
        try {
          await api.post('/api/sync');
          toast('已从 GitHub 同步最新数据', { variant: 'success' });
          ctx.rerender();
        } catch (err) {
          toast(err.message, { variant: 'error' });
          btn.disabled = false;
          btn.innerHTML = `${icon('refresh', 13)} 同步`;
        }
      });

      el.querySelectorAll('[data-grade]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const [w, login] = btn.getAttribute('data-grade').split('|');
          const row = data.rows.find((r) => r.week === w && r.login === login);
          if (row) openGradeModal(ctx, row, () => ctx.rerender());
        }),
      );
      el.querySelectorAll('[data-download]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const [w, login] = btn.getAttribute('data-download').split('|');
          if (!window.rmh) {
            const url = `/api/admin/export?week=${encodeURIComponent(w)}&member=${encodeURIComponent(login)}&k=${encodeURIComponent(api.key)}`;
            const a = document.createElement('a');
            a.href = url;
            a.download = `${w}-${login}.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            toast('已开始下载作业压缩包', { variant: 'success' });
            return;
          }
          setBusy('正在打包作业…');
          try {
            const res = await window.rmh.exportSubmission(w, login);
            setBusy(null);
            if (res.canceled) return;
            if (!res.ok) {
              toast(res.error || '下载失败', { variant: 'error' });
              return;
            }
            toast(`已保存：${res.data.path}`, { variant: 'success', title: '作业已导出', timeout: 7000 });
            window.rmh.showItemInFolder(res.data.path);
          } catch (err) {
            setBusy(null);
            toast(err.message, { variant: 'error' });
          }
        }),
      );
      el.querySelectorAll('[data-view]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const [w, login] = btn.getAttribute('data-view').split('|');
          const detail = await api.get(`/api/admin/submission?week=${encodeURIComponent(w)}&login=${encodeURIComponent(login)}`).catch((err) => {
            toast(err.message, { variant: 'error' });
            return null;
          });
          if (!detail) return;
          openModal({
            title: `${login} · ${w.toUpperCase()}`,
            sub: `${detail.fileCount} 个文件 · ${formatBytes(detail.totalBytes)}`,
            wide: true,
            body: `
              <div class="stack" style="gap:8px;max-height:52vh;overflow:auto">
                ${detail.files
                  .map(
                    (f) =>
                      `<div class="file-item">${icon('file', 13)}<span class="file-item__name">${escapeHtml(f.rel)}</span><span class="file-item__size">${formatBytes(f.size)}</span></div>`,
                  )
                  .join('')}
              </div>
              ${
                detail.evaluation
                  ? `<div class="alert alert--info" style="margin-top:14px">${icon('award', 15)}<span>已批改：<b>${detail.evaluation.score}</b> 分 · ${escapeHtml(detail.evaluation.comment || '无评语')}</span></div>`
                  : ''
              }`,
            footer: `<button class="btn btn--ghost" data-close>关闭</button>`,
            onMount(h) {
              h.el.querySelector('[data-close]').addEventListener('click', h.close);
            },
          });
        }),
      );
    },
  };
}

/* ------------------------------------------------------------------ */
/* 批改弹窗                                                            */
/* ------------------------------------------------------------------ */

function openGradeModal(ctx, row, onDone) {
  const { api } = ctx;
  const initial = row.score != null ? row.score : 85;
  const m = openModal({
    title: `批改 · ${row.name || row.login}`,
    sub: `${row.week.toUpperCase()} · ${row.fileCount} 个文件 · ${formatBytes(row.totalBytes)}`,
    body: `
      <div class="field">
        <label class="field__label">分数</label>
        <div class="grade-score">
          <input class="grade-score__value" id="grade-score" type="number" min="0" max="100" step="0.5" value="${initial}" />
          <input class="grade-slider" id="grade-slider" type="range" min="0" max="100" step="1" value="${Math.round(initial)}" />
          <span class="muted small">/ 100</span>
        </div>
        <div class="field__hint">0 - 100，支持 0.5 分粒度。组长提交后会立即生成 evaluation.json 并推送。</div>
      </div>
      <div class="field">
        <label class="field__label">评语</label>
        <textarea class="textarea" id="grade-comment" placeholder="写下具体的改进建议，组员会在右下角弹窗中看到这段评语。">${escapeHtml(row.comment || '')}</textarea>
        <div class="quick-comments">
          ${QUICK_COMMENTS.map((c) => `<button type="button" class="quick-comment" data-quick="${escapeHtml(c)}">${escapeHtml(c.slice(0, 14))}…</button>`).join('')}
        </div>
      </div>
      <div class="alert alert--info">${icon('info', 14)}<span>提交后将直接写入 <code>${escapeHtml(row.week)}/submissions/${escapeHtml(row.login)}/evaluation.json</code> 并推送到 GitHub。组员端会在下个轮询周期（约 25 秒）收到成绩提醒。</span></div>
      <div class="field__error" id="grade-error" style="min-height:16px;margin-top:10px"></div>`,
    footer: `<button class="btn btn--ghost" data-cancel>取消</button>
             <button class="btn btn--primary" data-submit>${icon('check', 14)} 提交批改</button>`,
    onMount(h) {
      const scoreEl = h.el.querySelector('#grade-score');
      const slider = h.el.querySelector('#grade-slider');
      const comment = h.el.querySelector('#grade-comment');
      const errEl = h.el.querySelector('#grade-error');
      slider.addEventListener('input', () => {
        scoreEl.value = slider.value;
      });
      scoreEl.addEventListener('input', () => {
        const v = Number(scoreEl.value);
        if (Number.isFinite(v)) slider.value = String(Math.max(0, Math.min(100, v)));
      });
      h.el.querySelectorAll('[data-quick]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const text = btn.getAttribute('data-quick');
          comment.value = comment.value.trim() ? `${comment.value.trim()}\n${text}` : text;
          comment.focus();
        }),
      );
      h.el.querySelector('[data-cancel]').addEventListener('click', h.close);
      h.el.querySelector('[data-submit]').addEventListener('click', async () => {
        const score = Number(scoreEl.value);
        if (!Number.isFinite(score) || score < 0 || score > 100) {
          errEl.textContent = '分数需在 0 - 100 之间';
          return;
        }
        const btn = h.el.querySelector('[data-submit]');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 推送中…';
        try {
          await api.post('/api/admin/grade', {
            week: row.week,
            member: row.login,
            score,
            comment: comment.value.trim(),
          });
          h.close();
          toast(`已提交 ${row.login} 的批改：${score} 分`, { variant: 'success', title: '评分已推送' });
          if (onDone) onDone();
        } catch (err) {
          errEl.textContent = err.message;
          btn.disabled = false;
          btn.innerHTML = `${icon('check', 14)} 提交批改`;
        }
      });
      setTimeout(() => scoreEl.focus(), 80);
    },
  });
  return m;
}

/* ------------------------------------------------------------------ */
/* 组长端：布置作业                                                     */
/* ------------------------------------------------------------------ */

const WEEK_TEMPLATE = [
  '# Week 04 · 本周主题',
  '',
  '> 一句话说明本周目标。',
  '',
  '## 本周任务',
  '',
  '1. 任务一（可量化）',
  '2. 任务二',
  '3. 任务三',
  '',
  '## 提交要求',
  '',
  '- 提交整个作业文件夹（系统会自动以你的 GitHub 账号命名）',
  '- 代码需包含 README，说明如何运行',
  '- 截止时间：**周日 23:59**',
  '',
  '## 评分标准',
  '',
  '| 维度 | 分值 | 说明 |',
  '| --- | --- | --- |',
  '| 完成度 | 40 | 任务是否全部完成 |',
  '| 代码质量 | 30 | 结构、命名、注释 |',
  '| 文档 | 20 | README 与报告清晰度 |',
  '| 规范 | 10 | 提交结构与命名 |',
].join('\n');

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function renderAssignment(ctx) {
  const { api, state } = ctx;
  const [weeksData, nextInfo] = await Promise.all([api.get('/api/weeks'), api.get('/api/admin/weeks/next')]);
  const existing = weeksData.weeks.map((w) => w.week);
  const currentEntry = weeksData.weeks.find((w) => w.isCurrent);
  let week = state.assignmentWeek || (currentEntry && currentEntry.week) || existing[existing.length - 1] || nextInfo.week;

  let editor;
  if (existing.includes(week)) {
    editor = await api.get(`/api/admin/weeks/${encodeURIComponent(week)}/editor`);
  } else {
    editor = {
      week,
      exists: false,
      title: '',
      deadline: '',
      tags: [],
      readme: '',
      groups: {},
      groupsMeta: weeksData.groups || [],
    };
  }
  const allGroups = weeksData.groups || [];
  const displayWeek = editor.week || week;
  const myGroup = editor.scope || null;
  const isGroupLeader = !!myGroup;
  const isCaptain = ctx.app.isCaptain();
  const targetOptions = isGroupLeader
    ? [{ id: myGroup, label: groupOf(allGroups, myGroup).name }]
    : isCaptain
      ? [{ id: 'common', label: '通用要求' }, ...allGroups.map((g) => ({ id: g.id, label: g.name }))]
      : [{ id: 'common', label: '通用要求' }];
  let editTarget = state.assignmentTarget;
  if (!editTarget || !targetOptions.some((t) => t.id === editTarget)) {
    editTarget = isGroupLeader ? myGroup : 'common';
  }
  const targetMeta = editTarget === 'common' ? null : groupOf(allGroups, editTarget);
  const primaryContent =
    editTarget === 'common' ? editor.readme || '' : (editor.groups && editor.groups[editTarget]) || '';
  const fileLabel = targetMeta
    ? `${displayWeek}/${targetMeta.folder || targetMeta.name}/README.md`
    : `${displayWeek}/README.md`;

  const html = `
    <div class="stack">
      <div class="card">
        <div class="assignment-head">
          <span class="badge ${editor.exists ? 'badge--blue' : 'badge--amber'}">${editor.exists ? '编辑已有作业' : '新建作业'}</span>
          <span class="mono tiny" id="file-label" style="color:var(--text-3)">${escapeHtml(fileLabel)}</span>
          <select class="select" id="edit-target" style="width:150px;height:32px" title="选择要布置/编辑的小组">
            ${targetOptions
              .map((t) => `<option value="${t.id}" ${t.id === editTarget ? 'selected' : ''}>${escapeHtml(t.label)}</option>`)
              .join('')}
          </select>
          ${editor.isCurrent ? '<span class="badge badge--red">当前周</span>' : ''}
          <span class="spacer"></span>
          <div class="row" style="gap:8px">
            ${editor.exists && !editor.isCurrent && ctx.app.isCaptain() ? `<button class="btn btn--sm btn--primary" id="set-current">${icon('target', 13)} 设为当前周</button>` : ''}
            <select class="select" id="week-select" style="width:160px;height:32px">
              ${existing.map((w) => `<option value="${w}" ${w === week ? 'selected' : ''}>${w.toUpperCase()}</option>`).join('')}
              ${!existing.includes(week) ? `<option value="${week}" selected>${week.toUpperCase()}（新建）</option>` : ''}
            </select>
            <button class="btn btn--sm" id="new-week">${icon('plus', 13)} 新建周次</button>
          </div>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:minmax(0,1fr) 350px">
        <div class="card editor-shell">
          <div class="editor-toolbar">
            <button class="tb-btn" data-insert="h1" title="一级标题">H1</button>
            <button class="tb-btn" data-insert="h2" title="二级标题">H2</button>
            <button class="tb-btn" data-insert="bold" title="粗体"><b>B</b></button>
            <button class="tb-btn" data-insert="italic" title="斜体"><i>I</i></button>
            <button class="tb-btn" data-insert="code" title="行内代码">${icon('code', 13)}</button>
            <span class="tb-sep"></span>
            <button class="tb-btn" data-insert="ul" title="无序列表">${icon('inbox', 13)} 列表</button>
            <button class="tb-btn" data-insert="ol" title="有序列表">1. 列表</button>
            <button class="tb-btn" data-insert="quote" title="引用">${icon('info', 13)}</button>
            <button class="tb-btn" data-insert="table" title="表格">${icon('layers', 13)} 表格</button>
            <button class="tb-btn" data-insert="link" title="链接">${icon('external', 13)}</button>
            <span class="tb-sep"></span>
            <button class="tb-btn" data-insert="preview" title="切换预览">${icon('eye', 13)} 预览</button>
            <span class="spacer"></span>
            <button class="tb-btn" id="apply-template" title="插入周作业模板">${icon('spark', 13)} 模板</button>
          </div>
          <textarea class="assignment-textarea" id="md-input" spellcheck="false" placeholder="在这里编写本周作业要求（Markdown）…">${escapeHtml(primaryContent)}</textarea>
          <div class="md md-preview" id="md-preview" hidden></div>
          <div class="editor-foot">
            <span id="char-count">0 字</span>
            <span class="spacer"></span>
            <span>Markdown · 保存后自动推送到 GitHub</span>
          </div>
        </div>

        <div class="stack assignment-side">
          <div class="card">
            <div class="card__head">
              <div class="card__title">发布设置</div>
              <div class="card__spacer"></div>
              <span class="badge ${editor.exists ? 'badge--green' : 'badge--gray'}">${editor.exists ? '已发布过' : '未发布'}</span>
            </div>
            <div class="card__body">
              <div class="field">
                <label class="field__label">周次编号</label>
                <input class="input mono" id="week-input" value="${escapeHtml(displayWeek)}" ${editor.exists ? 'readonly' : ''} placeholder="week04" />
                <div class="field__hint">${editor.exists ? '已存在，如需新建请点右上角「新建周次」' : '格式 weekNN，例如 week04'}</div>
              </div>
              <div class="field">
                <label class="field__label">标题</label>
                <input class="input" id="title-input" value="${escapeHtml(editor.title)}" placeholder="例如：目标识别与机构设计" />
              </div>
              <div class="field">
                <label class="field__label">截止时间</label>
                <input class="input" type="datetime-local" id="deadline-input" value="${toLocalInput(editor.deadline)}" />
              </div>
              <div class="field">
                <label class="field__label">标签</label>
                <input class="input" id="tags-input" value="${escapeHtml((editor.tags || []).join(', '))}" placeholder="视觉, 结构, 控制" />
                <div class="field__hint">用逗号分隔，最多 8 个</div>
              </div>
              <div class="alert alert--info" style="font-size:11.5px">${icon('layers', 14)}
                <span>${
                  isGroupLeader
                    ? `你负责${escapeHtml(groupOf(weeksData.groups, myGroup).name)}，只能编辑本组作业，其他组互不可见。`
                    : isCaptain
                      ? '通过顶部「选择小组」下拉切换要布置的小组；每次只保存当前选中的内容，其他小组不受影响。'
                      : '你未分配小组，只能编辑通用要求；请让队长把你分配到小组后再编辑组作业。'
                }</span>
              </div>
              <button class="btn btn--primary btn--block btn--lg" id="publish" ${editor.canEdit === false ? 'disabled' : ''}>${icon('upload', 15)} ${editor.canEdit === false ? '当前周由队长管理' : '保存并发布'}</button>
              ${
                editor.canEdit === false
                  ? `<div class="alert alert--warn" style="margin-top:10px">${icon('lock', 14)}<span>当前周由队长管理，你只能查看；历史周仍可编辑本组内容。</span></div>`
                  : ''
              }
              <div class="tiny muted" style="margin-top:9px;text-align:center;line-height:1.6">
                保存后自动 commit &amp; push；组员端约 25 秒内会在右下角收到发布提示
              </div>
              <div class="field__error" id="publish-error" style="margin-top:8px"></div>
            </div>
          </div>

          <div class="card card--pad">
            <div class="tiny muted" style="line-height:1.9">
              发布后写入仓库：<br />
              <code>${escapeHtml(displayWeek)}/&lt;组名&gt;/README.md</code>（当前选择的小组作业）<br />
              <code>${escapeHtml(displayWeek)}/meta.json</code>（标题 / 截止时间 / 发布时间）<br />
              <code>${escapeHtml(displayWeek)}/&lt;组名&gt;/submissions/&lt;login&gt;/</code>（按组隔离的提交目录）
            </div>
          </div>
        </div>
      </div>
    </div>`;

  return {
    title: '布置作业',
    sub: myGroup
      ? `${displayWeek.toUpperCase()} · ${groupOf(weeksData.groups, myGroup).name}`
      : editor.exists
        ? `${displayWeek.toUpperCase()} · 编辑并重新发布`
        : `${displayWeek.toUpperCase()} · 新建`,
    html,
    mount(el) {
      const ta = el.querySelector('#md-input');
      const preview = el.querySelector('#md-preview');
      const count = el.querySelector('#char-count');
      const errEl = el.querySelector('#publish-error');
      let previewMode = false;

      if (editor.canEdit === false) {
        ta.readOnly = true;
      }

      el.querySelector('#set-current')?.addEventListener('click', async () => {
        try {
          await api.post('/api/admin/weeks/current', { week: displayWeek });
          toast(`已将 ${displayWeek.toUpperCase()} 设为当前周`, { variant: 'success' });
          ctx.rerender();
        } catch (err) {
          toast(err.message, { variant: 'error' });
        }
      });

      const updateCount = () => {
        count.textContent = `${ta.value.length} 字`;
      };
      updateCount();
      ta.addEventListener('input', updateCount);

      // 切换「选择小组」时保留尚未保存的编辑内容
      const editorCache = { common: editor.readme || '' };
      for (const t of targetOptions) {
        if (t.id !== 'common') editorCache[t.id] = (editor.groups && editor.groups[t.id]) || '';
      }
      let currentTarget = editTarget;
      const targetSelect = el.querySelector('#edit-target');
      targetSelect.addEventListener('change', () => {
        editorCache[currentTarget] = ta.value;
        currentTarget = targetSelect.value;
        state.assignmentTarget = currentTarget;
        ta.value = editorCache[currentTarget] || '';
        updateCount();
        const fm = currentTarget === 'common' ? null : groupOf(weeksData.groups, currentTarget);
        el.querySelector('#file-label').textContent = fm
          ? `${displayWeek}/${fm.folder || fm.name}/README.md`
          : `${displayWeek}/README.md`;
        if (previewMode) preview.innerHTML = renderMarkdown(ta.value);
      });

      const insert = (type) => {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const selected = ta.value.slice(start, end);
        const wrap = (before, after = before, placeholder = '文本') => {
          const body = selected || placeholder;
          ta.value = ta.value.slice(0, start) + before + body + after + ta.value.slice(end);
          ta.focus();
          ta.selectionStart = start + before.length;
          ta.selectionEnd = start + before.length + body.length;
          updateCount();
        };
        if (type === 'h1') wrap('# ', '', '标题');
        else if (type === 'h2') wrap('## ', '', '小标题');
        else if (type === 'bold') wrap('**', '**', '粗体');
        else if (type === 'italic') wrap('*', '*', '斜体');
        else if (type === 'code') wrap('`', '`', '代码');
        else if (type === 'ul') wrap('- ', '', '列表项');
        else if (type === 'ol') wrap('1. ', '', '列表项');
        else if (type === 'quote') wrap('> ', '', '引用内容');
        else if (type === 'link') wrap('[', '](https://)', '链接文字');
        else if (type === 'table') {
          const table = '\n| 维度 | 分值 | 说明 |\n| --- | --- | --- |\n| 完成度 | 40 | 任务是否全部完成 |\n| 质量 | 30 | 结构与命名 |\n';
          ta.value = ta.value.slice(0, start) + table + ta.value.slice(end);
          ta.focus();
          updateCount();
        } else if (type === 'preview') {
          previewMode = !previewMode;
          ta.hidden = previewMode;
          preview.hidden = !previewMode;
          if (previewMode) preview.innerHTML = renderMarkdown(ta.value);
          return;
        }
      };

      el.querySelectorAll('[data-insert]').forEach((btn) =>
        btn.addEventListener('click', () => insert(btn.getAttribute('data-insert'))),
      );

      el.querySelector('#apply-template').addEventListener('click', () => {
        if (ta.value.trim() && !confirm('用模板覆盖当前内容？')) return;
        const current = ta.value.trim();
        const titleLine = current.split('\n').find((l) => l.startsWith('# '));
        const title = titleLine ? titleLine.replace(/^#\s*/, '') : '';
        ta.value = WEEK_TEMPLATE.replace('# Week 04 · 本周主题', `# ${displayWeek.toUpperCase()} · ${title || '本周主题'}`);
        updateCount();
        if (previewMode) preview.innerHTML = renderMarkdown(ta.value);
      });

      el.querySelector('#week-select').addEventListener('change', (e) => {
        state.assignmentWeek = e.target.value || null;
        ctx.rerender();
      });
      el.querySelector('#new-week').addEventListener('click', async () => {
        const info = await api.get('/api/admin/weeks/next');
        state.assignmentWeek = info.week;
        ctx.rerender();
      });

      el.querySelector('#publish').addEventListener('click', async () => {
        if (editor.canEdit === false) {
          errEl.textContent = '当前周由队长管理，你只能查看';
          return;
        }
        const weekVal = el.querySelector('#week-input').value.trim();
        if (!/^week\d{2,3}$/i.test(weekVal)) {
          errEl.textContent = '周次格式应为 weekNN，例如 week04';
          return;
        }
        const title = el.querySelector('#title-input').value.trim();
        const deadlineRaw = el.querySelector('#deadline-input').value;
        const tags = el
          .querySelector('#tags-input')
          .value.split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean);
        const target = el.querySelector('#edit-target').value;
        const btn = el.querySelector('#publish');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 正在推送到 GitHub…';
        errEl.textContent = '';
        try {
          const payload = {
            week: weekVal,
            title,
            deadline: deadlineRaw ? new Date(deadlineRaw).toISOString() : '',
            tags,
            target,
          };
          if (target === 'common') payload.readme = ta.value;
          else payload.groups = { [target]: ta.value };
          const res = await api.post('/api/admin/weeks', payload);
          state.assignmentTarget = target;
          toast(res.message || '已发布', { variant: 'success', title: '发布成功', timeout: 8000 });
          state.assignmentWeek = res.week;
          ctx.rerender();
        } catch (err) {
          errEl.textContent = err.message;
          btn.disabled = false;
          btn.innerHTML = `${icon('upload', 15)} 保存并发布`;
        }
      });

      setTimeout(() => ta.focus(), 80);
    },
  };
}


/* ------------------------------------------------------------------ */
/* 组长端：查看作业（当期与往期）                                       */
/* ------------------------------------------------------------------ */

export async function renderWeekView(ctx) {
  const { api, state } = ctx;
  const weeksData = await api.get('/api/weeks');
  if (!weeksData.weeks.length) {
    return {
      title: '查看作业',
      sub: '当期与往期',
      html: `<div class="card card--pad"><div class="empty">
        <div class="empty__icon">${icon('inbox', 22)}</div>
        <div class="empty__title">还没有任何作业</div>
        <div class="empty__sub">先在「布置作业」中发布第一周吧。</div>
      </div></div>`,
    };
  }

  const currentEntry = weeksData.weeks.find((w) => w.isCurrent);
  let week = state.weekViewWeek;
  if (!week || !weeksData.weeks.some((w) => w.week === week)) {
    week = (currentEntry && currentEntry.week) || weeksData.weeks[weeksData.weeks.length - 1].week;
  }
  const view = await api.get(`/api/admin/weeks/${encodeURIComponent(week)}/view`);
  const bodyByTarget = { common: view.readme || '' };
  for (const g of view.groups) bodyByTarget[g.id] = g.readme || '';

  const html = `
    <div class="stack">
      <div class="card">
        <div class="assignment-head">
          <span class="badge ${view.isCurrent ? 'badge--red' : 'badge--gray'}">${view.isCurrent ? '当前周' : '历史周'}</span>
          <span class="mono tiny" style="color:var(--text-3)">${escapeHtml(week)}</span>
          <span class="badge badge--gray">${view.groups.length} 个小组</span>
          <span class="spacer"></span>
          <div class="row" style="gap:8px">
            <select class="select" id="view-week" style="width:200px;height:34px">
              ${weeksData.weeks
                .map(
                  (w) =>
                    `<option value="${w.week}" ${w.week === week ? 'selected' : ''}>${w.week.toUpperCase()}${w.isCurrent ? ' · 当前周' : ''}</option>`,
                )
                .join('')}
            </select>
            ${view.canEdit ? `<button class="btn btn--sm btn--primary" id="go-edit">${icon('edit', 13)} 去编辑</button>` : ''}
          </div>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:minmax(0,1fr) 300px">
        <div class="card">
          <div class="card__head">
            <div>
              <div class="card__title">作业内容</div>
              <div class="card__sub">${escapeHtml(view.title)}</div>
            </div>
            <div class="card__spacer"></div>
            <div class="tabs" id="view-tabs">
              <button class="tab active" data-vt="common">通用</button>
              ${view.groups
                .map((g) => `<button class="tab" data-vt="${escapeHtml(g.id)}">${escapeHtml(g.name)}</button>`)
                .join('')}
            </div>
          </div>
          <div class="card__body">
            <div class="md" id="view-body">${renderMarkdown(view.readme || '（无通用要求）')}</div>
          </div>
        </div>

        <div class="stack">
          <div class="card card--pad">
            <dl class="kv">
              <dt>周次</dt><dd class="mono">${escapeHtml(week.toUpperCase())}</dd>
              <dt>标题</dt><dd>${escapeHtml(view.title)}</dd>
              <dt>截止时间</dt><dd>${escapeHtml(formatDate(view.deadline))}</dd>
              <dt>状态</dt><dd>${view.isCurrent ? '当前周' : '历史周'}</dd>
            </dl>
          </div>
          <div class="card card--pad">
            <div class="tiny muted" style="line-height:1.8">
              作业与提交始终按小组隔离；队长可查看全部小组，组长只能查看本组（无论当期或往期）。
            </div>
          </div>
        </div>
      </div>
    </div>`;

  return {
    title: '查看作业',
    sub: view.isCurrent ? `${week.toUpperCase()} · 当前周` : `${week.toUpperCase()} · 历史周`,
    html,
    mount(el) {
      el.querySelector('#view-week').addEventListener('change', (e) => {
        state.weekViewWeek = e.target.value;
        ctx.rerender();
      });
      const tabs = el.querySelector('#view-tabs');
      tabs.querySelectorAll('[data-vt]').forEach((tab) => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
          const id = tab.getAttribute('data-vt');
          el.querySelector('#view-body').innerHTML = renderMarkdown(bodyByTarget[id] || '（暂无内容）');
        });
      });
      el.querySelector('#go-edit')?.addEventListener('click', () => {
        state.assignmentWeek = week;
        const active = el.querySelector('#view-tabs .tab.active');
        state.assignmentTarget = active ? active.getAttribute('data-vt') : 'common';
        location.hash = '#/leader/assignment';
      });
    },
  };
}

export async function renderMembers(ctx) {
  const { api } = ctx;
  const data = await api.get('/api/admin/members');
  const groups = data.groups;
  const pending = data.members.filter((m) => m.pendingGroup);
  const counts = groups.map((g) => ({ ...g, count: data.members.filter((m) => m.group === g.id).length }));

  const html = `
    <div class="stack">
      <div class="row" style="gap:10px">
        <span class="badge ${ctx.app.isCaptain() ? 'badge--red' : data.scope ? 'badge--blue' : 'badge--gray'}">
          ${ctx.app.isCaptain() ? '队长 · 可管理全队（含组长）' : data.scope ? `你负责：${escapeHtml(groupOf(groups, data.scope).name)}` : '组长 · 全部小组'}
        </span>
        ${ctx.app.isCaptain()
          ? '<span class="tiny muted">可以任命/撤销组长、调整任意成员的分组</span>'
          : data.scope
            ? '<span class="tiny muted">只能为待分组成员分配本组，或管理本组成员</span>'
            : '<span class="tiny muted">可为任意成员分配分组</span>'}
      </div>
      ${
        pending.length
          ? `<div class="alert alert--warn">${icon('alert', 15)}
              <span><b>${pending.length} 位成员尚未进组</b>：${pending.map((m) => `@${escapeHtml(m.login)}`).join('、')}。${
                data.scope ? '点击「加入我组」即可认领。' : '请为他们分配分组。'
              }</span>
            </div>`
          : ''
      }
      <div class="grid grid--4">
        <div class="stat">
          <div class="stat__label">${icon('users', 13)} 成员总数</div>
          <div class="stat__value">${data.members.length}</div>
          <div class="stat__foot">含组长 ${data.members.filter((m) => m.role === 'leader').length} 人</div>
        </div>
        ${counts
          .map(
            (g) => `
          <div class="stat">
            <div class="stat__label"><span class="dot" style="color:${g.color}"></span> ${escapeHtml(g.name)}</div>
            <div class="stat__value">${g.count}<small>人</small></div>
            <div class="stat__foot">${g.count ? `${Math.round((g.count / Math.max(1, data.members.length)) * 100)}% 占比` : '暂无成员'}</div>
          </div>`,
          )
          .join('')}
      </div>

      <div class="card">
        <div class="card__head">
          <div>
            <div class="card__title">成员与权限</div>
            <div class="card__sub">修改分组或角色会直接写入仓库 members.json</div>
          </div>
          <div class="card__spacer"></div>
          <button class="btn btn--sm" id="refresh-members">${icon('refresh', 13)} 刷新</button>
        </div>
        <div class="table-wrap" style="border:0;border-radius:0">
          <table class="table" style="min-width:1000px">
            <thead><tr><th>成员</th><th>GitHub 账号</th><th style="min-width:190px">分组</th><th style="min-width:140px">角色</th><th>加入时间</th><th style="text-align:right">操作</th></tr></thead>
            <tbody>
              ${data.members
                .sort((a, b) => {
                  const rank = (r) => (r.role === 'captain' ? 0 : r.role === 'leader' ? 1 : 2);
                  return (
                    rank(a) - rank(b) ||
                    String(a.group || '').localeCompare(String(b.group || '')) ||
                    a.login.localeCompare(b.login)
                  );
                })
                .map(
                  (m) => `
                <tr>
                  <td>
                    <div class="row" style="gap:9px">
                      <span class="avatar" style="width:28px;height:28px;font-size:11.5px">${escapeHtml((m.name || m.login).slice(0, 1))}</span>
                      <span class="small">${escapeHtml(m.name || m.login)}</span>
                      ${m.pendingGroup ? '<span class="badge badge--amber">待分组</span>' : ''}
                    </div>
                  </td>
                  <td class="mono tiny">@${escapeHtml(m.login)}</td>
                  <td>
                    <select class="select" data-group="${escapeHtml(m.login)}" style="width:170px;height:34px;font-size:12.5px;padding:0 34px 0 12px;line-height:34px">
                      <option value="" ${!m.group ? 'selected' : ''}>未分组</option>
                      ${groups.map((g) => `<option value="${g.id}" ${m.group === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
                    </select>
                  </td>
                  <td>
                    ${m.role === 'captain'
                      ? '<span class="badge badge--red">队长</span>'
                      : `<select class="select" data-role="${escapeHtml(m.login)}" style="width:110px;height:34px;font-size:12.5px;padding:0 34px 0 12px;line-height:34px">
                      <option value="member" ${m.role !== 'leader' ? 'selected' : ''}>组员</option>
                      <option value="leader" ${m.role === 'leader' ? 'selected' : ''}>组长</option>
                    </select>`}
                  </td>
                  <td class="tiny muted">${escapeHtml(m.createdAt ? formatDate(m.createdAt, false) : '—')}</td>
                  <td>
                    <div class="actions">
                      ${m.pendingGroup && data.scope ? `<button class="btn btn--sm btn--primary" data-claim="${escapeHtml(m.login)}">${icon('plus', 12)} 加入我组</button>` : ''}
                      ${ctx.app.isCaptain() ? `<button class="btn btn--sm btn--danger" data-remove="${escapeHtml(m.login)}" title="从仓库移除">${icon('trash', 12)}</button>` : ''}
                    </div>
                  </td>
                </tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card card--pad">
        <div class="row" style="align-items:flex-start;gap:12px">
          <div class="empty__icon" style="margin:0;width:38px;height:38px;flex:none">${icon('info', 17)}</div>
          <div class="small text-2" style="line-height:1.8">
            <b style="color:var(--text)">如何加入新成员？</b><br />
            组员用自己的 GitHub Token 登录后会自动登记到 members.json（显示为「待分组」），组长在这里分配分组即可。
            也可以把兑换码分享给核心成员，他们输入后可直接成为组长。
          </div>
        </div>
      </div>
    </div>`;

  return {
    title: '成员管理',
    sub: `${data.members.length} 位成员`,
    html,
    mount(el) {
      el.querySelector('#refresh-members').addEventListener('click', async () => {
        await api.post('/api/sync').catch(() => {});
        ctx.rerender();
      });
      el.querySelectorAll('[data-group]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          const login = sel.getAttribute('data-group');
          sel.disabled = true;
          try {
            await api.post('/api/admin/members', { login, group: sel.value });
            toast(`已更新 @${login} 的分组`, { variant: 'success' });
            ctx.rerender();
          } catch (err) {
            toast(err.message, { variant: 'error' });
            sel.disabled = false;
          }
        });
      });
      el.querySelectorAll('[data-role]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          const login = sel.getAttribute('data-role');
          if (sel.value === 'member') {
            const ok = await confirmDialog({
              title: '降级为组员',
              message: `确定将 @${login} 降级为组员吗？该账号将无法再访问组长端。`,
              confirmText: '确认降级',
              danger: true,
            });
            if (!ok) {
              sel.value = 'leader';
              return;
            }
          }
          sel.disabled = true;
          try {
            await api.post('/api/admin/members', { login, role: sel.value });
            toast(`已更新 @${login} 的角色`, { variant: 'success' });
            ctx.rerender();
          } catch (err) {
            toast(err.message, { variant: 'error' });
            sel.disabled = false;
          }
        });
      });
      el.querySelectorAll('[data-claim]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const login = btn.getAttribute('data-claim');
          btn.disabled = true;
          try {
            await api.post('/api/admin/members', { login, group: data.scope });
            toast(`已将 @${login} 加入${groupOf(groups, data.scope).name}`, { variant: 'success' });
            ctx.rerender();
          } catch (err) {
            toast(err.message, { variant: 'error' });
            btn.disabled = false;
          }
        }),
      );
      el.querySelectorAll('[data-remove]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const login = btn.getAttribute('data-remove');
          const ok = await confirmDialog({
            title: '移除成员',
            message: `确定从成员列表中移除 @${login} 吗？其已提交的作业不会被删除。`,
            confirmText: '移除',
            danger: true,
          });
          if (!ok) return;
          try {
            await api.del(`/api/admin/members/${encodeURIComponent(login)}`);
            toast(`已移除 @${login}`, { variant: 'success' });
            ctx.rerender();
          } catch (err) {
            toast(err.message, { variant: 'error' });
          }
        }),
      );
    },
  };
}
