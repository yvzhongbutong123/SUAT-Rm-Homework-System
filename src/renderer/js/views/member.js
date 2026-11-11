import { icon, escapeHtml, formatBytes, formatDate, timeAgo, countdown, scoreClass, groupOf, toast, setBusy } from '../ui.js';
import { renderMarkdown } from '../markdown.js';

/* ------------------------------------------------------------------ */
/* 组员端                                                              */
/* ------------------------------------------------------------------ */

function pickDefaultWeek(weeks) {
  if (!weeks.length) return null;
  // 优先队长指定的“当前周”，而不是编号最新的周次
  const current = weeks.find((w) => w.isCurrent);
  if (current) return current;
  const now = Date.now();
  const open = weeks
    .filter((w) => w.deadline && new Date(w.deadline).getTime() > now)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  if (open.length) return open[0];
  return weeks[weeks.length - 1];
}

export async function renderMemberHome(ctx) {
  const { api, state } = ctx;
  const data = await api.get('/api/weeks');
  if (!data.weeks.length) {
    return {
      title: '我的作业',
      sub: '本周任务',
      html: emptyState('还没有发布任何作业', '请等待组长在 Rm-Homework 仓库中创建 weekNN 目录。'),
    };
  }
  const target = pickDefaultWeek(data.weeks);
  return renderWeekPage(ctx, target.week, data, { showList: true });
}

export async function renderMemberWeek(ctx) {
  const { api } = ctx;
  const week = ctx.state.route.params.week;
  if (!week) return renderMemberHome(ctx);
  const data = await api.get('/api/weeks');
  if (!data.weeks.find((w) => w.week === week)) {
    return { title: '作业详情', html: emptyState('未找到该周作业', `仓库中不存在 ${week} 目录。`) };
  }
  return renderWeekPage(ctx, week, data, { showList: false });
}

async function renderWeekPage(ctx, week, weeksData, opts = {}) {
  const { api, state } = ctx;
  const detail = await api.get(`/api/weeks/${encodeURIComponent(week)}`);
  const groups = weeksData.groups || [];
  const group = groupOf(groups, detail.group || state.me.user.group || null);
  const cd = countdown(detail.deadline);
  const submitted = detail.mine.submitted;
  const evaluation = detail.mine.evaluation;
  const files = detail.mine.files || [];
  const showGroupFirst = !detail.readme && !!detail.groupReadme;

  const html = `
    <div class="stack">
      <div class="week-hero">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div>
            <div class="week-hero__label">${escapeHtml(week.toUpperCase())} · ${escapeHtml(group.name)}</div>
            <div class="week-hero__title">${escapeHtml(detail.title)}</div>
            <div class="week-hero__meta">
              <span>${icon('clock', 13)} 截止 ${formatDate(detail.deadline)}</span>
              <span class="countdown ${cd.over ? 'countdown--over' : ''}" data-countdown="${escapeHtml(detail.deadline || '')}">
                ${icon('clock', 12)} ${escapeHtml(cd.text)}
              </span>
              ${(detail.tags || []).map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('')}
            </div>
          </div>
          <div style="text-align:right">
            ${
              detail.history
                ? '<span class="badge badge--gray">历史周 · 本组可查</span>'
                : evaluation
                  ? `<span class="badge badge--green">${icon('check', 12)} 已批改</span>`
                  : submitted
                    ? '<span class="badge badge--blue">已提交 · 待批改</span>'
                    : '<span class="badge badge--amber">未提交</span>'
            }
            <div class="tiny muted" style="margin-top:8px">${
              detail.history
                ? `${(detail.submissions || []).length} 人提交`
                : submitted
                  ? `${detail.mine.fileCount} 个文件 · ${formatBytes(detail.mine.totalBytes)}`
                  : '拖入文件夹即可提交'
            }</div>
          </div>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:minmax(0,1.55fr) minmax(330px,0.85fr)">
        <div class="card" style="min-height:420px">
          <div class="card__head">
            <div>
              <div class="card__title">作业要求</div>
              <div class="card__sub">来自 weekly/README.md</div>
            </div>
            <div class="card__spacer"></div>
            <div class="tabs" id="readme-tabs" ${detail.groupReadme ? '' : 'hidden'}>
              <button class="tab ${showGroupFirst ? '' : 'active'}" data-md="all">通用要求</button>
              <button class="tab ${showGroupFirst ? 'active' : ''}" data-md="group">${escapeHtml(group.name)}补充</button>
            </div>
          </div>
          <div class="card__body">
            <div class="md" id="readme-body" ${showGroupFirst ? 'hidden' : ''}>${renderMarkdown(detail.readme || '（本周暂无说明）')}</div>
            <div class="md" id="readme-group" ${showGroupFirst ? '' : 'hidden'}>${renderMarkdown(detail.groupReadme || '')}</div>
          </div>
        </div>

        <div class="stack">
          ${
            detail.history
              ? `<div class="card">
                  <div class="card__head">
                    <div>
                      <div class="card__title">历史记录 · 本组</div>
                      <div class="card__sub">该周已结束，仅显示本组记录</div>
                    </div>
                    <div class="card__spacer"></div>
                    <span class="badge badge--gray">${(detail.submissions || []).length} 人提交</span>
                  </div>
                  <div class="card__body">
                    <div class="tabs" id="history-tabs">
                      <button class="tab active" data-hg="all">通用要求</button>
                      ${(detail.groupsContent || [])
                        .map((g) => `<button class="tab" data-hg="${escapeHtml(g.id)}">${escapeHtml(g.name)}</button>`)
                        .join('')}
                    </div>
                    <div class="md" id="history-body" style="margin-top:10px">${renderMarkdown(detail.readme || '（无通用要求）')}</div>
                    <div class="table-wrap" style="margin-top:14px;max-height:280px">
                      <table class="table">
                        <thead><tr><th>成员</th><th>组别</th><th>分数</th><th>提交时间</th><th>评语</th></tr></thead>
                        <tbody>
                          ${
                            (detail.submissions || []).length
                              ? (detail.submissions || [])
                                  .map((s) => {
                                    const g = groupOf(detail.groups, s.group);
                                    return `<tr>
                                      <td class="small">${escapeHtml(s.name)} <span class="tiny muted">@${escapeHtml(s.login)}</span></td>
                                      <td><span class="badge" style="background:${g.color}22;color:${g.color}">${escapeHtml(g.name)}</span></td>
                                      <td>${s.score != null ? `<span class="score-pill ${scoreClass(s.score)}">${s.score}</span>` : '<span class="tiny muted">—</span>'}</td>
                                      <td class="tiny muted">${escapeHtml(s.uploadedAt ? formatDate(s.uploadedAt) : '—')}</td>
                                      <td class="tiny text-2" style="max-width:220px">${escapeHtml(s.comment || '')}</td>
                                    </tr>`;
                                  })
                                  .join('')
                              : '<tr><td colspan="5"><div class="empty" style="padding:16px"><div class="empty__sub">该周暂无提交</div></div></td></tr>'
                          }
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>`
              : `<div class="card">
            <div class="card__head">
              <div>
                <div class="card__title">提交作业</div>
                <div class="card__sub">${submitted ? '已提交，可覆盖更新' : '文件夹将以你的账号命名'}</div>
              </div>
              <div class="card__spacer"></div>
              <span class="badge ${submitted ? 'badge--green' : 'badge--gray'}">${submitted ? '已提交' : '未提交'}</span>
            </div>
            <div class="card__body">
              ${
                submitted
                  ? `<div class="row" style="margin-bottom:12px">
                       <div class="avatar" style="background:rgba(47,212,143,.12);color:var(--green);border-color:rgba(47,212,143,.3)">${icon('check', 16)}</div>
                       <div>
                         <div class="small strong">${escapeHtml(state.me.user.login)}</div>
                         <div class="tiny muted">${detail.mine.fileCount} 个文件 · ${formatBytes(detail.mine.totalBytes)}${detail.mine.uploadedAt ? ` · ${timeAgo(detail.mine.uploadedAt)}` : ''}</div>
                       </div>
                     </div>
                     <div class="stack" style="gap:6px;max-height:150px;overflow:auto">
                       ${files
                         .slice(0, 8)
                         .map(
                           (f) => `<div class="file-item">${icon('file', 13)}<span class="file-item__name">${escapeHtml(f.rel)}</span><span class="file-item__size">${formatBytes(f.size)}</span></div>`,
                         )
                         .join('')}
                       ${files.length > 8 ? `<div class="tiny muted" style="padding:2px 4px">还有 ${files.length - 8} 个文件…</div>` : ''}
                     </div>`
                  : ''
              }
              ${
                detail.needsGroup
                  ? `<div class="alert alert--warn" style="margin-top:4px">${icon('users', 15)}
                      <span>你还没有加入任何小组，暂时不能提交作业。请联系组长把你加入小组。</span>
                    </div>`
                  : `<div class="dropzone" id="dropzone" style="margin-top:${submitted ? '14px' : '0'}">
                <div class="dropzone__icon">${icon('upload', 22)}</div>
                <div class="dropzone__title">${submitted ? '拖入新文件夹以重新提交' : '把整个作业文件夹拖到这里'}</div>
                <div class="dropzone__hint">或点击选择文件夹 · 将上传到 ${escapeHtml(week)}/${escapeHtml(group.folder || group.name)}/submissions/${escapeHtml(state.me.user.login)}</div>
                <div class="row" style="justify-content:center;margin-top:12px">
                  <button class="btn btn--primary btn--sm" id="pick-folder">${icon('folder', 13)} 选择文件夹</button>
                </div>
              </div>`
              }
              <div class="tiny muted" style="margin-top:10px;line-height:1.6">
                单文件 ≤ 100MB（GitHub 限制）。大文件（CAD 图纸等）可在设置中预留 OSS 云存储。
              </div>
            </div>
          </div>`
          }

          <div class="card">
            <div class="card__head">
              <div class="card__title">我的成绩</div>
              <div class="card__spacer"></div>
              ${evaluation ? `<span class="score-pill ${scoreClass(evaluation.score)}">${evaluation.score} 分</span>` : '<span class="badge badge--gray">待批改</span>'}
            </div>
            <div class="card__body">
              ${
                evaluation
                  ? `<div class="row" style="align-items:flex-start;gap:14px">
                       <div style="font-size:38px;font-weight:800;line-height:1;font-family:var(--mono);background:linear-gradient(180deg,#fff,#ff8d96);-webkit-background-clip:text;background-clip:text;color:transparent">${evaluation.score}</div>
                       <div style="min-width:0;flex:1">
                         <div class="small strong">${escapeHtml(evaluation.gradedBy || '组长')} 批改</div>
                         <div class="tiny muted">${formatDate(evaluation.gradedAt)}</div>
                         <div class="small text-2" style="margin-top:8px;white-space:pre-wrap">${escapeHtml(evaluation.comment || '（无评语）')}</div>
                       </div>
                     </div>`
                  : `<div class="empty" style="padding:14px 6px">
                       <div class="empty__icon" style="width:42px;height:42px">${icon('clock', 18)}</div>
                       <div class="empty__title">组长还没有批改</div>
                       <div class="empty__sub">批改完成后，分数会自动弹到右下角</div>
                     </div>`
              }
            </div>
          </div>
        </div>
      </div>

      ${
        opts.showList
          ? `<div class="card">
               <div class="card__head">
                 <div class="card__title">近期安排</div>
                 <div class="card__spacer"></div>
                 <span class="tiny muted">共 ${weeksData.weeks.length} 周</span>
               </div>
               <div class="card__body">
                 <div class="grid grid--3">
                   ${weeksData.weeks
                     .map((w) => {
                       const c = countdown(w.deadline);
                       const ev = w.mine && w.mine.evaluation;
                       return `<button class="card card--pad" style="text-align:left;cursor:pointer;background:rgba(148,163,184,.03);border-color:${w.week === week ? 'rgba(230,57,70,.35)' : 'var(--line)'}" data-week="${w.week}">
                         <div class="row" style="justify-content:space-between">
                           <span class="tiny mono" style="color:var(--accent-2);letter-spacing:.12em">${escapeHtml(w.week.toUpperCase())}${w.isCurrent ? ' · 当前周' : ' · 历史'}</span>
                           ${ev ? `<span class="score-pill ${scoreClass(ev.score)}" style="font-size:11px">${ev.score}</span>` : w.mine && w.mine.submitted ? '<span class="badge badge--blue">待批改</span>' : '<span class="badge badge--gray">未提交</span>'}
                         </div>
                         <div class="small strong" style="margin:7px 0 4px">${escapeHtml(w.title)}</div>
                         <div class="tiny muted">${escapeHtml(c.text)} · ${w.submissionCount}/${w.totalMembers} 人已交</div>
                       </button>`;
                     })
                     .join('')}
                 </div>
               </div>
             </div>`
          : ''
      }
    </div>
  `;

  return {
    title: '我的作业',
    sub: `${group.name}`,
    html,
    mount(el) {
      mountCountdown(el, detail.deadline);
      bindReadmeTabs(el);
      bindUpload(el, ctx, week, () => ctx.rerender());
      const htabs = el.querySelector('#history-tabs');
      if (htabs) {
        htabs.querySelectorAll('[data-hg]').forEach((tab) => {
          tab.addEventListener('click', () => {
            htabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
            const id = tab.getAttribute('data-hg');
            const content =
              id === 'all'
                ? detail.readme
                : ((detail.groupsContent || []).find((g) => g.id === id) || {}).readme;
            el.querySelector('#history-body').innerHTML = renderMarkdown(content || '（暂无内容）');
          });
        });
      }
      el.querySelectorAll('[data-week]').forEach((btn) => {
        btn.addEventListener('click', () => {
          ctx.state.route = { name: 'member.week', params: { week: btn.getAttribute('data-week') } };
          location.hash = `#/member/week/${btn.getAttribute('data-week')}`;
        });
      });
    },
  };
}

function mountCountdown(el, deadline) {
  if (!deadline) return;
  const node = el.querySelector('[data-countdown]');
  if (!node) return;
  const tick = () => {
    const c = countdown(deadline);
    node.innerHTML = `${icon('clock', 12)} ${escapeHtml(c.text)}`;
    node.classList.toggle('countdown--over', c.over);
  };
  tick();
  const timer = setInterval(() => {
    if (!node.isConnected) {
      clearInterval(timer);
      return;
    }
    tick();
  }, 30000);
}

function bindReadmeTabs(el) {
  const tabs = el.querySelector('#readme-tabs');
  if (!tabs) return;
  const all = el.querySelector('#readme-body');
  const group = el.querySelector('#readme-group');
  tabs.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      const isGroup = tab.getAttribute('data-md') === 'group';
      all.hidden = isGroup;
      group.hidden = !isGroup;
    });
  });
}

function bindUpload(el, ctx, week, done) {
  const { api } = ctx;
  const zone = el.querySelector('#dropzone');
  const pick = el.querySelector('#pick-folder');
  if (!zone || !pick) return;
  const isDesktop = !!window.rmh;

  const reportSuccess = (data) => {
    toast(`提交成功：${data.fileCount} 个文件（${formatBytes(data.totalBytes)}）`, {
      variant: 'success',
      title: '已推送到 GitHub',
      timeout: 6000,
    });
    for (const w of data.warnings || []) toast(w, { variant: 'warn', timeout: 9000 });
    ctx.refreshNotifications();
    done();
  };

  /* ---------------- 桌面模式：按路径复制整个文件夹 ---------------- */
  const uploadPath = async (folderPath) => {
    setBusy('正在上传并推送到 GitHub…');
    try {
      const res = await window.rmh.uploadFolder(week, folderPath);
      setBusy(null);
      if (!res.ok) {
        toast(res.error || '上传失败', { variant: 'error', title: '提交失败', timeout: 8000 });
        return;
      }
      reportSuccess(res.data);
    } catch (err) {
      setBusy(null);
      toast(err.message, { variant: 'error' });
    }
  };

  /* ---------------- 浏览器模式：逐个文件上传 ---------------- */
  const uploadFilesWeb = async (items) => {
    if (!items.length) {
      toast('没有选择到文件', { variant: 'warn' });
      return;
    }
    setBusy(`正在上传 0/${items.length}…`);
    try {
      const begin = await api.post('/api/upload/begin');
      let n = 0;
      for (const item of items) {
        n += 1;
        if (n % 5 === 1 || n === items.length) setBusy(`正在上传 ${n}/${items.length}：${item.rel}`);
        const res = await fetch(
          `/api/upload/chunk?session=${encodeURIComponent(begin.session)}&rel=${encodeURIComponent(item.rel)}`,
          {
            method: 'POST',
            headers: { 'x-rmh-key': api.key, 'Content-Type': 'application/octet-stream' },
            body: item.file,
          },
        );
        const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
        if (!json.ok) throw new Error(json.error || '上传失败');
      }
      const data = await api.post('/api/upload/commit', { session: begin.session, week });
      setBusy(null);
      reportSuccess(data);
    } catch (err) {
      setBusy(null);
      toast(`上传失败：${err.message}`, { variant: 'error', timeout: 9000 });
    }
  };

  const pickWebFolder = () =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.multiple = true;
      input.onchange = () => {
        const files = [...input.files].map((f) => {
          const parts = (f.webkitRelativePath || f.name).split('/');
          const rel = parts.length > 1 ? parts.slice(1).join('/') : f.name;
          return { file: f, rel };
        });
        input.remove();
        resolve(files);
      };
      document.body.appendChild(input);
      input.click();
    });

  const entriesToFiles = async (dataTransfer) => {
    const roots = [];
    for (const item of [...(dataTransfer.items || [])]) {
      if (item.kind !== 'file' || !item.webkitGetAsEntry) continue;
      const entry = item.webkitGetAsEntry();
      if (entry) roots.push(entry);
    }
    const out = [];
    const walk = async (entry, relDir, isRoot) => {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        out.push({ file, rel: relDir ? `${relDir}/${file.name}` : file.name });
        return;
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        const children = [];
        for (;;) {
          const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) break;
          children.push(...batch);
        }
        const childDir = isRoot ? '' : relDir ? `${relDir}/${entry.name}` : entry.name;
        for (const child of children) await walk(child, childDir, false);
      }
    };
    for (const root of roots) await walk(root, '', true);
    // 兜底：没有 entry 时直接用 files
    if (!out.length && dataTransfer.files && dataTransfer.files.length) {
      for (const f of [...dataTransfer.files]) {
        const parts = (f.webkitRelativePath || f.name).split('/');
        out.push({ file: f, rel: parts.length > 1 ? parts.slice(1).join('/') : f.name });
      }
    }
    return out;
  };

  /* ---------------- 事件 ---------------- */
  pick.addEventListener('click', async () => {
    if (!isDesktop) {
      await uploadFilesWeb(await pickWebFolder());
      return;
    }
    const res = await window.rmh.pickFolder();
    if (res && !res.canceled && res.path) await uploadPath(res.path);
  });

  const over = (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.add('dragover');
  };
  const leave = (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
  };
  zone.addEventListener('dragover', over);
  zone.addEventListener('dragenter', over);
  zone.addEventListener('dragleave', leave);
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('dragover');
    const dt = e.dataTransfer;
    if (!dt) return;

    if (!isDesktop) {
      await uploadFilesWeb(await entriesToFiles(dt));
      return;
    }

    if (!dt.files || !dt.files.length) {
      toast('没有检测到文件，请拖入一个文件夹', { variant: 'warn' });
      return;
    }
    const files = Array.from(dt.files);
    const p = window.rmh.getPathForFile(files[0]);
    if (p) {
      const info = await window.rmh.pathInfo(p);
      if (info.exists && info.isDirectory) {
        await uploadPath(p);
        return;
      }
    }
    // 桌面兜底：读取文件内容后经 IPC 上传
    try {
      setBusy('正在读取文件并上传…');
      const payload = [];
      for (const f of files) {
        const rel = (f.webkitRelativePath || f.name).split('/').slice(-1)[0];
        const buf = await f.arrayBuffer();
        payload.push({ rel, data: buf });
      }
      const res = await window.rmh.uploadFiles(week, payload);
      setBusy(null);
      if (!res.ok) {
        toast(res.error || '上传失败', { variant: 'error', timeout: 8000 });
        return;
      }
      reportSuccess(res.data);
    } catch (err) {
      setBusy(null);
      toast(`上传失败：${err.message}`, { variant: 'error', timeout: 8000 });
    }
  });
}

export async function renderMemberGrades(ctx) {
  const { api } = ctx;
  const data = await api.get('/api/weeks');
  const graded = [];
  for (const w of data.weeks) {
    const ev = w.mine && w.mine.evaluation;
    if (ev) graded.push({ week: w.week, title: w.title, evaluation: ev, submissionCount: w.submissionCount, totalMembers: w.totalMembers });
  }
  graded.sort((a, b) => String(b.evaluation.gradedAt || '').localeCompare(String(a.evaluation.gradedAt || '')));

  const scores = graded.map((g) => g.evaluation.score);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const best = scores.length ? Math.max(...scores) : null;

  const html = `
    <div class="stack">
      <div class="grid grid--3">
        <div class="stat stat--accent">
          <div class="stat__label">${icon('award', 13)} 平均分</div>
          <div class="stat__value">${avg == null ? '—' : avg.toFixed(1)}<small>/ 100</small></div>
          <div class="stat__foot">基于 ${graded.length} 次批改</div>
        </div>
        <div class="stat">
          <div class="stat__label">${icon('target', 13)} 最高分</div>
          <div class="stat__value">${best == null ? '—' : best}</div>
          <div class="stat__foot">继续保持</div>
        </div>
        <div class="stat">
          <div class="stat__label">${icon('check', 13)} 已批改</div>
          <div class="stat__value">${graded.length}<small>/${data.weeks.length} 周</small></div>
          <div class="stat__foot">批改后自动弹出提醒</div>
        </div>
      </div>

      ${
        graded.length
          ? `<div class="grid grid--2">
              ${graded
                .map(
                  (g) => `
                <div class="card">
                  <div class="card__head">
                    <div>
                      <div class="card__title">${escapeHtml(g.title)}</div>
                      <div class="card__sub">${escapeHtml(g.week.toUpperCase())} · ${formatDate(g.evaluation.gradedAt)}</div>
                    </div>
                    <div class="card__spacer"></div>
                    <span class="score-pill ${scoreClass(g.evaluation.score)}">${g.evaluation.score} 分</span>
                  </div>
                  <div class="card__body">
                    <div class="small text-2" style="white-space:pre-wrap;line-height:1.8">${escapeHtml(g.evaluation.comment || '（无评语）')}</div>
                    <div class="hr"></div>
                    <div class="row tiny muted">
                      <span>${icon('users', 12)} ${escapeHtml(g.evaluation.gradedBy || '组长')} 批改</span>
                      <span class="spacer"></span>
                      <button class="btn btn--sm btn--ghost" data-view-week="${g.week}">查看作业 ${icon('chevron', 12)}</button>
                    </div>
                  </div>
                </div>`,
                )
                .join('')}
            </div>`
          : `<div class="card card--pad">${emptyState('还没有成绩', '组长完成批改后，这里会出现评分与评语，同时右下角会弹出提醒。')}</div>`
      }
    </div>`;

  return {
    title: '我的成绩',
    sub: '评分与评语',
    html,
    mount(el) {
      el.querySelectorAll('[data-view-week]').forEach((b) =>
        b.addEventListener('click', () => {
          ctx.state.weekViewWeek = b.getAttribute('data-view-week');
          location.hash = '#/member/weeks';
        }),
      );
    },
  };
}

function emptyState(title, sub) {
  return `<div class="empty">
    <div class="empty__icon">${icon('inbox', 22)}</div>
    <div class="empty__title">${escapeHtml(title)}</div>
    <div class="empty__sub">${escapeHtml(sub)}</div>
  </div>`;
}
