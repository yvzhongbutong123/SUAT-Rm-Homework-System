import { icon, escapeHtml, formatDate, toast, confirmDialog, openModal } from '../ui.js';

export async function renderSettings(ctx) {
  const { api, state } = ctx;
  const [settings, me, git, info] = await Promise.all([
    api.get('/api/settings'),
    api.get('/api/me'),
    api.get('/api/git/status').catch(() => null),
    api.get('/api/system/info').catch(() => null),
  ]);
  const user = me.user || {};
  const repo = me.repo || {};
  const isDemo = me.mode === 'demo';
  const gitModeLabel = git ? (git.mode === 'wsl' ? 'WSL Git' : git.mode === 'windows' ? 'Windows Git' : '不可用') : '未知';

  const html = `
    <div class="stack" style="max-width:1000px">
      <div class="card">
        <div class="card__head">
          <div class="card__title">账号</div>
          <div class="card__spacer"></div>
          <span class="badge ${user.role === 'captain' ? 'badge--red' : user.role === 'leader' ? 'badge--red' : 'badge--blue'}">${user.role === 'captain' ? '队长' : user.role === 'leader' ? '组长' : '组员'}</span>
          ${isDemo ? '<span class="badge badge--amber">演示模式</span>' : ''}
        </div>
        <div class="card__body">
          <div class="row" style="gap:14px">
            <div class="avatar avatar--lg">${user.avatarUrl ? `<img class="avatar avatar--lg" src="${user.avatarUrl}" alt="" />` : escapeHtml((user.name || user.login || 'U').slice(0, 1).toUpperCase())}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:16px;font-weight:650">${escapeHtml(user.name || user.login || '未登录')}</div>
              <div class="small muted">@${escapeHtml(user.login || '')}${user.group ? ` · ${escapeHtml(user.group)}` : ''}</div>
              <div class="tiny muted" style="margin-top:3px">
                角色：${user.role === 'captain' ? '队长（全队管理）' : user.role === 'leader' ? '组长' : '组员'}
                · 来源 GitHub members.json${me.roleInfo && me.roleInfo.syncedAt ? ` · ${formatDate(me.roleInfo.syncedAt)} 同步` : ''}
              </div>
            </div>
            <button class="btn btn--danger" id="logout">${icon('logout', 14)} 退出登录</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head">
          <div class="card__title">已保存的账号</div>
          <div class="card__spacer"></div>
          <span class="badge badge--gray">${(settings.accounts || []).length} 个</span>
        </div>
        <div class="card__body">
          ${
            (settings.accounts || []).length
              ? (settings.accounts || [])
                  .map(
                    (a) => `
                <div class="account-row">
                  <span class="avatar" style="width:30px;height:30px;font-size:12px">${
                    a.avatarUrl ? `<img class="avatar" src="${escapeHtml(a.avatarUrl)}" alt="" />` : escapeHtml((a.name || a.login).slice(0, 1).toUpperCase())
                  }</span>
                  <span class="account-row__meta">
                    <span class="account-row__name">${escapeHtml(a.name || a.login)} ${a.login === user.login ? '<span class="badge badge--green" style="margin-left:6px">当前</span>' : ''}</span>
                    <span class="account-row__sub">@${escapeHtml(a.login)} · ${a.hasToken ? `已保存 Token（${escapeHtml(settings.cipher || '加密')}）` : '未保存 Token'} · ${a.lastUsed ? `最近 ${formatDate(a.lastUsed)}` : ''}</span>
                  </span>
                  <button class="btn btn--sm btn--ghost" data-remove-account="${escapeHtml(a.login)}">移除</button>
                </div>`,
                  )
                  .join('')
              : `<div class="empty" style="padding:18px"><div class="empty__sub">还没有保存的账号。登录时勾选「记住此账号」即可。</div></div>`
          }
          <div class="setting-row" style="margin-top:8px">
            <div class="setting-row__main">
              <div class="setting-row__title">启动时自动登录</div>
              <div class="setting-row__desc">使用最近保存的账号自动进入工作台；关闭后每次启动显示登录页。</div>
            </div>
            <div class="setting-row__control" style="display:flex;justify-content:flex-end">
              <button class="switch ${settings.autoLogin ? 'on' : ''}" id="auto-login-switch" aria-label="切换自动登录"></button>
            </div>
          </div>
          <div class="row" style="margin-top:12px;gap:10px">
            <button class="btn btn--sm btn--danger" id="clear-accounts">${icon('trash', 13)} 清除全部已保存账号</button>
            <span class="tiny muted">Token 加密保存在本机，可随时撤销</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head">
          <div class="card__title">数据仓库</div>
          <div class="card__spacer"></div>
          ${repo.htmlUrl ? `<button class="btn btn--sm btn--ghost" id="open-repo">${icon('github', 13)} 在浏览器打开</button>` : ''}
        </div>
        <div class="card__body">
          <dl class="kv">
            <dt>仓库</dt><dd class="mono">${escapeHtml(repo.owner || '—')}/${escapeHtml(repo.name || '—')}</dd>
            <dt>分支</dt><dd class="mono">${escapeHtml(repo.defaultBranch || settings.repo.branch || 'main')}</dd>
            <dt>同步状态</dt><dd>${escapeHtml(git && git.lastSync ? formatDate(git.lastSync) : '尚未同步')}</dd>
            <dt>存储方式</dt><dd>${isDemo ? '本地演示数据（不会推送）' : 'GitHub 仓库 · 每次操作自动 commit & push'}</dd>
            <dt>本地缓存</dt><dd class="mono tiny" style="color:var(--text-3)">${escapeHtml(settings.dataDir)}</dd>
          </dl>
          <div class="alert alert--info" style="margin-top:14px">${icon('info', 15)}
            <span>切换仓库需要重新登录：点击「退出登录」，用另一个 Token 登录后即可连接到对应账号下的 Rm-Homework。</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head">
          <div class="card__title">Git 通道</div>
          <div class="card__spacer"></div>
          <span class="badge ${git && git.mode === 'wsl' ? 'badge--green' : git && git.mode === 'windows' ? 'badge--amber' : 'badge--red'}">${escapeHtml(gitModeLabel)}</span>
        </div>
        <div class="card__body">
          ${
            git && git.mode === 'windows'
              ? `<div class="alert alert--warn" style="margin-bottom:14px">${icon('alert', 15)}
                  <span>未检测到可用的 WSL Git，已自动回退到 Windows Git。${git.wslError ? `<br /><span class="tiny mono">${escapeHtml(git.wslError)}</span>` : ''}</span>
                </div>`
              : ''
          }
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__title">Git 执行方式</div>
              <div class="setting-row__desc">优先使用 WSL 中的 Git；不可用时自动回退到 Windows Git。切换后立即生效。</div>
            </div>
            <div class="setting-row__control">
              <select class="select" id="git-mode">
                <option value="auto" ${settings.gitMode === 'auto' ? 'selected' : ''}>自动（WSL 优先）</option>
                <option value="wsl" ${settings.gitMode === 'wsl' ? 'selected' : ''}>仅 WSL</option>
                <option value="windows" ${settings.gitMode === 'windows' ? 'selected' : ''}>仅 Windows Git</option>
              </select>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__title">WSL 发行版（可选）</div>
              <div class="setting-row__desc">留空则使用默认发行版。例如 Ubuntu-22.04。</div>
            </div>
            <div class="setting-row__control">
              <input class="input" id="wsl-distro" placeholder="默认发行版" value="${escapeHtml(settings.wslDistro || '')}" />
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__title">版本信息</div>
              <div class="setting-row__desc mono tiny">${escapeHtml(git ? git.version || '—' : '—')}${git && git.wslError ? ` · WSL: ${escapeHtml(git.wslError.slice(0, 120))}` : ''}</div>
            </div>
            <div class="setting-row__control" style="display:flex;gap:8px;justify-content:flex-end">
              <button class="btn btn--sm" id="git-save">保存</button>
              <button class="btn btn--sm btn--ghost" id="git-detect">${icon('refresh', 13)} 重新检测</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div class="card__title">通知与提醒</div></div>
        <div class="card__body">
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__title">成绩弹窗提醒</div>
              <div class="setting-row__desc">组长完成批改后，在页面右下角弹出分数与评语。</div>
            </div>
            <div class="setting-row__control" style="display:flex;justify-content:flex-end">
              <button class="switch ${settings.notifications.enabled ? 'on' : ''}" id="notify-switch" aria-label="切换成绩提醒"></button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__main">
              <div class="setting-row__title">轮询间隔</div>
              <div class="setting-row__desc">组员端每隔该时间从 GitHub 拉取一次，用于发现新的批改结果（15 - 300 秒）。</div>
            </div>
            <div class="setting-row__control">
              <select class="select" id="poll-seconds">
                ${[15, 25, 45, 60, 120, 300].map((s) => `<option value="${s}" ${settings.notifications.pollSeconds === s ? 'selected' : ''}>${s} 秒</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head">
          <div class="card__title">存储扩展</div>
          <div class="card__spacer"></div>
          <span class="badge badge--gray">预留接口</span>
        </div>
        <div class="card__body">
          <div class="alert alert--info" style="margin-bottom:14px">${icon('layers', 15)}
            <span>当前版本以 GitHub 作为唯一存储后端。机械组 CAD 等大文件超过 20MB 时，可在后续版本启用 OSS / 网盘后端，仓库中只保留清单文件。</span>
          </div>
          <dl class="kv">
            <dt>后端类型</dt><dd>GitHub（Git，默认）</dd>
            <dt>OSS 状态</dt><dd>未启用 · 接口已预留（storage/providers/oss.js）</dd>
            <dt>大文件阈值</dt><dd>50MB 警告 / 100MB 拒绝（GitHub 限制）</dd>
          </dl>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><div class="card__title">关于</div></div>
        <div class="card__body">
          <dl class="kv">
            <dt>应用</dt><dd>RoboMaster 战队作业管理 <span class="mono tiny">v${escapeHtml((info && info.version) || '1.0.0')}</span></dd>
            <dt>运行环境</dt><dd>${escapeHtml((info && `${info.platform} / ${info.arch}`) || navigator.platform || '—')} · Electron ${escapeHtml((info && info.electron) || '—')}</dd>
            <dt>数据目录</dt><dd class="mono tiny" style="color:var(--text-3)">${escapeHtml(settings.dataDir)}</dd>
          </dl>
          <div class="row" style="margin-top:14px;gap:8px">
            <button class="btn btn--sm" id="open-data">${icon('folder', 13)} 打开数据目录</button>
            <button class="btn btn--sm btn--ghost" id="show-about">${icon('info', 13)} 使用说明</button>
            <button class="btn btn--sm btn--ghost" id="check-update">${icon('refresh', 13)} 检查更新</button>
            <button class="btn btn--sm btn--danger" id="shutdown-app">${icon('logout', 13)} 退出应用</button>
          </div>
          <div id="update-result" class="tiny muted" style="margin-top:10px;line-height:1.7"></div>
        </div>
      </div>
    </div>`;

  return {
    title: '设置',
    sub: '账号 · 仓库 · Git 通道',
    html,
    mount(el) {
      el.querySelector('#logout').addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: '退出登录',
          message: '退出后本机保存的账号仍会保留，下次可一键登录；如需彻底清除请到「已保存的账号」中移除。',
          confirmText: '退出',
          danger: true,
        });
        if (ok) ctx.app.logout();
      });

      el.querySelectorAll('[data-remove-account]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const login = btn.getAttribute('data-remove-account');
          const ok = await confirmDialog({
            title: '移除已保存账号',
            message: `确定移除 @${login} 吗？移除后需要重新输入 Token 才能登录。`,
            confirmText: '移除',
            danger: true,
          });
          if (!ok) return;
          try {
            await api.post('/api/accounts/remove', { login });
            toast(`已移除 @${login}`, { variant: 'success' });
            ctx.rerender();
          } catch (err) {
            toast(err.message, { variant: 'error' });
          }
        }),
      );

      el.querySelector('#clear-accounts').addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: '清除全部已保存账号',
          message: '将删除本机保存的所有账号与 Token。已登录的当前会话不受影响，但下次需要重新登录。',
          confirmText: '全部清除',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.post('/api/accounts/clear');
          toast('已清除全部已保存账号', { variant: 'success' });
          ctx.rerender();
        } catch (err) {
          toast(err.message, { variant: 'error' });
        }
      });

      const autoSwitch = el.querySelector('#auto-login-switch');
      autoSwitch.addEventListener('click', async () => {
        const next = !autoSwitch.classList.contains('on');
        autoSwitch.classList.toggle('on', next);
        await api.patch('/api/settings', { autoLogin: next });
        toast(next ? '已开启启动时自动登录' : '已关闭启动时自动登录', { variant: 'success' });
      });

      el.querySelector('#open-repo')?.addEventListener('click', () => {
        if (window.rmh?.openExternal) window.rmh.openExternal(repo.htmlUrl);
        else if (repo.htmlUrl) window.open(repo.htmlUrl, '_blank');
      });

      el.querySelector('#git-save').addEventListener('click', async () => {
        const gitMode = el.querySelector('#git-mode').value;
        const wslDistro = el.querySelector('#wsl-distro').value.trim();
        try {
          await api.patch('/api/settings', { gitMode, wslDistro });
          toast('Git 设置已保存', { variant: 'success' });
          ctx.rerender();
        } catch (err) {
          toast(err.message, { variant: 'error' });
        }
      });

      el.querySelector('#git-detect').addEventListener('click', async () => {
        const btn = el.querySelector('#git-detect');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 检测中';
        try {
          const det = await api.get('/api/git/status?force=1');
          toast(`检测结果：${det.label || det.mode}`, { variant: det.mode === 'none' ? 'error' : 'success' });
          ctx.rerender();
        } catch (err) {
          toast(err.message, { variant: 'error' });
          btn.disabled = false;
        }
      });

      const sw = el.querySelector('#notify-switch');
      sw.addEventListener('click', async () => {
        const next = !sw.classList.contains('on');
        sw.classList.toggle('on', next);
        await api.patch('/api/settings', { notifications: { enabled: next, pollSeconds: settings.notifications.pollSeconds } });
        ctx.app.setNotificationPrefs({ enabled: next });
        toast(next ? '已开启成绩提醒' : '已关闭成绩提醒', { variant: 'success' });
      });

      el.querySelector('#poll-seconds').addEventListener('change', async (e) => {
        const sec = Number(e.target.value);
        await api.patch('/api/settings', { notifications: { enabled: true, pollSeconds: sec } });
        ctx.app.setNotificationPrefs({ pollSeconds: sec });
        toast(`轮询间隔已设为 ${sec} 秒`, { variant: 'success' });
      });

      el.querySelector('#shutdown-app').addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: '退出应用',
          message: '将停止后台服务，浏览器页面会失效。确定退出吗？',
          confirmText: '退出',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.post('/api/shutdown');
        } catch {
          /* ignore */
        }
        toast('服务已停止，可关闭此页面', { variant: 'info' });
      });

      el.querySelector('#open-data').addEventListener('click', () => {
        if (window.rmh?.openDataDir) window.rmh.openDataDir();
        else toast(`数据目录：${settings.dataDir}`, { variant: 'info', timeout: 8000 });
      });

      el.querySelector('#check-update').addEventListener('click', async () => {
        const btn = el.querySelector('#check-update');
        const box = el.querySelector('#update-result');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 检查中';
        try {
          const res = await api.get('/api/update/check');          if (res.hasUpdate) {
            box.innerHTML = `发现新版本 <b>v${escapeHtml(res.latest)}</b>（当前 v${escapeHtml(res.current)}）<br>${escapeHtml(res.notes || '')}${
              res.url ? `<br><a href="${escapeHtml(res.url)}" target="_blank" rel="noopener">下载更新</a>` : ''
            }`;
            toast(`发现新版本 v${res.latest}`, { variant: 'info', timeout: 8000 });
          } else if (res.latest) {
            box.textContent = `已是最新版本 v${res.current}`;
          } else {
            box.textContent = '更新仓库暂未提供版本信息（version.json）';
          }
        } catch (err) {
          box.textContent = `检查失败：${err.message}`;
        } finally {
          btn.disabled = false;
          btn.innerHTML = `${icon('refresh', 13)} 检查更新`;
        }
      });

      el.querySelector('#show-about').addEventListener('click', () => {
        openModal({
          title: '使用说明',
          wide: true,
          body: `
            <div class="md" style="font-size:13px">
              <h2>组长端</h2>
              <ul>
                <li><b>进度看板</b>：查看三组提交率、平均分、待批改列表。</li>
                <li><b>提交与批改</b>：一键下载组员作业 ZIP，在线打分并推送 evaluation.json。</li>
                <li><b>成员管理</b>：为登录过的成员分配分组；也可用兑换码将成员提升为组长。</li>
              </ul>
              <h2>组员端</h2>
              <ul>
                <li><b>我的作业</b>：按分组展示本周要求，拖入文件夹即可提交（自动命名）。</li>
                <li><b>成绩提醒</b>：组长批改后自动在右下角弹出分数与评语。</li>
              </ul>
              <h2>仓库结构</h2>
              <pre><code>weekNN/
├─ README.md          通用作业要求
├─ meta.json          截止时间等
├─ algo.md / mech.md / embedded.md   分组补充
└─ submissions/
   └─ &lt;github-login&gt;/
      ├─ 你的文件…
      ├─ submission.json
      └─ evaluation.json  组长批改结果</code></pre>
              <p class="muted">新增一周作业：在仓库中新建 <code>weekNN</code> 目录，放入 README.md 与 meta.json 即可，客户端会自动发现。</p>
            </div>`,
          footer: '<button class="btn btn--primary" data-close>知道了</button>',
          onMount(h) {
            h.el.querySelector('[data-close]').addEventListener('click', h.close);
          },
        });
      });
    },
  };
}
