import { icon, escapeHtml, toast, openModal } from '../ui.js';

/**
 * 登录页与仓库初始化向导。
 */

export function renderLogin(ctx) {
  const { api, state } = ctx;
  const root = document.createElement('div');
  root.className = 'login';

  const demoUsers = (state.me && state.me.demoUsers) || [];
  const leader = demoUsers.find((u) => u.role === 'leader');
  const member = demoUsers.find((u) => u.role === 'member' && u.group === 'algo') || demoUsers.find((u) => u.role === 'member');

  root.innerHTML = `
    <section class="login__brand">
      <div class="login__brand-top">
        <div class="sidebar__logo-mark">${icon('target', 21)}</div>
        <div class="sidebar__logo-text">
          <b style="font-size:15px">RM HOMEWORK</b>
          <span>TEAM CONSOLE · 2026 SEASON</span>
        </div>
      </div>

      <div class="login__headline">
        <div class="chip" style="margin-bottom:16px">${icon('zap', 12)} GitHub 作为唯一数据源</div>
        <h1>把每一周的<br />训练任务，<em>变成可见的进度</em></h1>
        <p>
          算法、机械、嵌入式三组统一作业台。组长发布任务、批改打分；组员拖拽上传、
          实时收到评分。所有内容沉淀在 <code style="font-family:var(--mono);color:#ffb3b9">Rm-Homework</code> 仓库里，可追溯、可协作。
        </p>
        <div class="login__features">
          <div class="login__feature">
            <b>${icon('folder', 13)} 文件夹直传</b>
            <span>拖入整个作业目录，自动以 GitHub 账号命名归档。</span>
          </div>
          <div class="login__feature">
            <b>${icon('bell', 13)} 成绩即时提醒</b>
            <span>组长提交评分后，右下角自动弹出分数与评语。</span>
          </div>
          <div class="login__feature">
            <b>${icon('trend', 13)} 三维进度看板</b>
            <span>提交率、平均分、待批改一目了然。</span>
          </div>
        </div>
      </div>

      <div class="login__brand-foot">
        <span>${icon('shield', 13)} Token 经系统级加密存储</span>
        <span class="dot" style="color:var(--green)"></span>
        <span>本地 Git 缓存，离线可读</span>
      </div>
    </section>

    <section class="login__panel">
      <div class="login__card">
        <div class="login__title">登录战队工作台</div>
        <div class="login__desc">使用 GitHub Token 登录。如需开通组长 / 队长权限，在下方填写兑换码即可，登录时自动兑换。</div>

        <div id="saved-accounts" hidden></div>

        <form id="login-form" autocomplete="off">
          <div class="field" id="token-field">
            <label class="field__label">Personal Access Token ${icon('key', 13)}</label>
            <input class="input" type="password" id="token-input" placeholder="ghp_… 或 github_pat_…" spellcheck="false" />
            <div class="field__hint">
              需要 <b>repo</b> 权限（经典 Token）或目标仓库的 <b>Contents: Read and write</b>（细粒度 Token）。
              <a href="#" id="token-help">如何获取？</a>
            </div>
          </div>

          <div class="field" id="code-field">
            <label class="field__label">兑换码（可选）${icon('lock', 13)}</label>
            <input class="input" type="password" id="code-input" placeholder="没有兑换码可留空" spellcheck="false" />
            <div class="field__hint">
              填写后会自动兑换为组长/队长并登录；普通组员留空即可，登录后由组长分配小组。
            </div>
          </div>

          <div class="field">
            <label class="field__label">仓库地址 <span class="tiny muted" style="margin-left:4px">高级</span></label>
            <input class="input mono" id="repo-url" spellcheck="false" placeholder="git@github.com:owner/repo.git" />
            <div class="field__hint">支持 SSH（git@…）与 HTTPS（https://…）。SSH 需要本机已配置密钥；不可用时自动改用 HTTPS + Token。</div>
          </div>

          <div id="login-error" class="field__error" style="min-height:18px;margin-bottom:8px"></div>

          <label class="checkbox-row">
            <input type="checkbox" id="remember" checked />
            <span>记住此账号，下次自动登录</span>
          </label>
          <div class="tiny muted" style="margin:-2px 0 14px 24px;line-height:1.5">
            Token 会加密保存在本机，可在「设置 → 已保存账号」中随时清除。
          </div>

          <button class="btn btn--primary btn--block btn--lg" id="login-submit" type="submit">
            ${icon('github', 16)} <span>登录</span>
          </button>
        </form>

        <div class="login__section-label">或使用设备码登录</div>
        <button class="btn btn--block" id="device-login">${icon('shield', 15)} 使用 GitHub 设备码（OAuth）</button>
        <div class="field__hint" style="margin-top:6px">
          无需粘贴 Token；需要先在 GitHub 创建 OAuth App 并填入 Client ID（设置页可配置）。
        </div>

        <div class="login__section-label">离线体验</div>
        <div class="login__demo">
          ${
            leader
              ? `<button class="demo-user" data-demo="${escapeHtml(leader.login)}">
                  <span class="avatar" style="background:linear-gradient(135deg,#7a1020,#3a0a12)">${escapeHtml((leader.name || leader.login).slice(0, 1))}</span>
                  <span class="demo-user__meta">
                    <span class="demo-user__name">${escapeHtml(leader.name || leader.login)}</span>
                    <span class="demo-user__sub">组长视角 · 看板 / 批改 / 成员管理</span>
                  </span>
                  <span style="margin-left:auto;color:var(--text-3)">${icon('arrowRight', 15)}</span>
                </button>`
              : ''
          }
          ${
            member
              ? `<button class="demo-user" data-demo="${escapeHtml(member.login)}">
                  <span class="avatar" style="background:linear-gradient(135deg,#1d3a66,#0e213c)">${escapeHtml((member.name || member.login).slice(0, 1))}</span>
                  <span class="demo-user__meta">
                    <span class="demo-user__name">${escapeHtml(member.name || member.login)}</span>
                    <span class="demo-user__sub">组员视角 · 提交作业 / 成绩提醒</span>
                  </span>
                  <span style="margin-left:auto;color:var(--text-3)">${icon('arrowRight', 15)}</span>
                </button>`
              : ''
          }
        </div>

        <div class="login__legal">
          登录即表示你授权本应用读写 <b>Rm-Homework</b> 仓库中的作业内容。
          凭据仅保存在本机（Electron safeStorage 加密），不会上传到任何第三方服务器。
        </div>
      </div>
    </section>
  `;

  const tokenInput = root.querySelector('#token-input');
  const codeInput = root.querySelector('#code-input');
  const errorEl = root.querySelector('#login-error');
  const submit = root.querySelector('#login-submit');
  const form = root.querySelector('#login-form');
  const rememberEl = root.querySelector('#remember');
  const accountsBox = root.querySelector('#saved-accounts');
  const repoInput = root.querySelector('#repo-url');

  (async () => {
    try {
      const settings = await api.get('/api/settings');
      if (settings && settings.repo && settings.repo.url) repoInput.value = settings.repo.url;
    } catch {
      /* ignore */
    }
  })();

  const setError = (msg) => {
    errorEl.textContent = msg || '';
  };

  /* ---------------- 已保存的账号 ---------------- */
  let savedAccounts = [];
  const renderAccounts = () => {
    if (!savedAccounts.length) {
      accountsBox.hidden = true;
      accountsBox.innerHTML = '';
      return;
    }
    accountsBox.hidden = false;
    accountsBox.innerHTML = `
      <div class="login__section-label">已保存的账号</div>
      <div class="saved-accounts">
        ${savedAccounts
          .map((a) => {
            const initial = (a.name || a.login || 'U').slice(0, 1).toUpperCase();
            return `<button class="saved-account" data-login="${escapeHtml(a.login)}" type="button">
              <span class="avatar" style="width:30px;height:30px;font-size:12px">${
                a.avatarUrl ? `<img class="avatar" src="${escapeHtml(a.avatarUrl)}" alt="" />` : initial
              }</span>
              <span class="saved-account__meta">
                <span class="saved-account__name">${escapeHtml(a.name || a.login)}</span>
                <span class="saved-account__sub">@${escapeHtml(a.login)} · ${a.hasToken ? '一键登录' : '需输入 Token'}</span>
              </span>
              <span class="saved-account__go">${a.hasToken ? icon('arrowRight', 14) : icon('key', 13)}</span>
              <span class="saved-account__remove" data-remove="${escapeHtml(a.login)}" title="移除该账号">${icon('x', 12)}</span>
            </button>`;
          })
          .join('')}
      </div>`;
    accountsBox.querySelectorAll('[data-login]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        if (e.target.closest('[data-remove]')) return;
        const login = btn.getAttribute('data-login');
        const acc = savedAccounts.find((a) => a.login === login);
        if (!acc) return;
        if (!acc.hasToken) {
          setError(`账号 @${login} 没有保存 Token，请粘贴 Token 后登录`);
          tokenInput.focus();
          return;
        }
        btn.disabled = true;
        setError('');
        try {
          const result = await api.post('/api/login', { accountLogin: login, remember: true, repoUrl: repoInput.value.trim() });
          ctx.onLogin(result);
        } catch (err) {
          btn.disabled = false;
          setError(err.message || '登录失败');
        }
      });
    });
    accountsBox.querySelectorAll('[data-remove]').forEach((el) =>
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const login = el.getAttribute('data-remove');
        try {
          await api.post('/api/accounts/remove', { login });
          savedAccounts = savedAccounts.filter((a) => a.login !== login);
          renderAccounts();
          toast(`已移除账号 @${login}`, { variant: 'success' });
        } catch (err) {
          toast(err.message, { variant: 'error' });
        }
      }),
    );
  };

  (async () => {
    try {
      const data = await api.get('/api/accounts');
      savedAccounts = data.accounts || [];
    } catch {
      savedAccounts = [];
    }
    renderAccounts();
  })();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = tokenInput.value.trim();
    const code = codeInput.value.trim();
    if (!token) {
      setError('请先粘贴 GitHub Token');
      tokenInput.focus();
      return;
    }
    submit.disabled = true;
    submit.innerHTML = '<span class="spinner"></span><span>正在验证…</span>';
    try {
      const result = await api.post('/api/login', {
        token,
        remember: rememberEl.checked,
        repoUrl: repoInput.value.trim(),
      });
      if (code) {
        if (result.needSetup) {
          state.pendingCode = code;
          ctx.onLogin(result);
          return;
        }
        try {
          const redeemRes = await api.post('/api/redeem', { code });
          toast(redeemRes.role === 'captain' ? '已获得队长权限（全队管理）' : '已获得组长权限', { variant: 'success' });
        } catch (redeemErr) {
          setError(`兑换码未生效：${redeemErr.message}`);
          submit.disabled = false;
          submit.innerHTML = `${icon('github', 16)} <span>登录</span>`;
          return;
        }
      }
      ctx.onLogin(result);
    } catch (err) {
      setError(err.message || '登录失败');
      submit.disabled = false;
      submit.innerHTML = `${icon('github', 16)} <span>登录</span>`;
    }
  });

  root.querySelector('#token-help').addEventListener('click', (e) => {
    e.preventDefault();
    openModal({
      title: '获取 GitHub Token',
      body: `
        <ol style="padding-left:18px;line-height:1.9;font-size:13px;color:var(--text-2);margin:0">
          <li>打开 GitHub → <b>Settings</b> → <b>Developer settings</b></li>
          <li>选择 <b>Personal access tokens</b> → <b>Tokens (classic)</b> → Generate new token</li>
          <li>勾选 <code>repo</code> 权限（私有仓库读写必需）</li>
          <li>生成后复制 Token，粘贴到登录框</li>
        </ol>
        <div class="alert alert--info" style="margin-top:14px">${icon('info', 15)}
          <span>细粒度 Token 也可以：在 Repository access 中选择 <b>Rm-Homework</b>，并把 <b>Contents</b> 设为 Read and write。</span>
        </div>`,
      footer: `<button class="btn btn--ghost" data-close>关闭</button>
               <button class="btn btn--primary" data-open>打开 GitHub Token 页面</button>`,
      onMount(h) {
        h.el.querySelector('[data-close]').addEventListener('click', h.close);
        h.el.querySelector('[data-open]').addEventListener('click', () => {
          const url = 'https://github.com/settings/tokens/new?scopes=repo&description=RM-Homework';
          if (window.rmh?.openExternal) window.rmh.openExternal(url);
          else window.open(url, '_blank');
        });
      },
    });
  });

  root.querySelectorAll('[data-demo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const result = await api.post('/api/demo/login', { login: btn.getAttribute('data-demo') });
        ctx.onLogin(result);
      } catch (err) {
        toast(err.message, { variant: 'error' });
        btn.disabled = false;
      }
    });
  });
  root.querySelector('#device-login').addEventListener('click', async () => {
    const settings = await api.get('/api/settings').catch(() => null);
    let clientId = (settings && settings.oauthClientId) || '';
    const start = async (id) => {
      try {
        const flow = await api.post('/api/device/start', { clientId: id });
        showDeviceModal(flow);
      } catch (err) {
        toast(err.message, { variant: 'error', title: '无法启动设备码登录', timeout: 6000 });
      }
    };
    if (!clientId) {
      openModal({
        title: '配置 OAuth App',
        sub: '设备码登录需要一次性的 Client ID',
        body: `
          <div class="field">
            <label class="field__label">OAuth App Client ID</label>
            <input class="input" id="oauth-client" placeholder="例如 Ov23li…" />
            <div class="field__hint">
              在 GitHub → Settings → Developer settings → OAuth Apps 新建应用，
              回调地址可填任意值（设备码流程不使用回调）。创建后把 <b>Client ID</b> 填在这里。
            </div>
          </div>`,
        footer: `<button class="btn btn--ghost" data-cancel>取消</button><button class="btn btn--primary" data-go>保存并继续</button>`,
        onMount(h) {
          h.el.querySelector('[data-cancel]').addEventListener('click', h.close);
          h.el.querySelector('[data-go]').addEventListener('click', async () => {
            const val = h.el.querySelector('#oauth-client').value.trim();
            if (!val) return;
            await api.patch('/api/settings', { oauthClientId: val }).catch(() => {});
            h.close();
            start(val);
          });
        },
      });
      return;
    }
    start(clientId);
  });

  function showDeviceModal(flow) {
    const m = openModal({
      title: 'GitHub 设备码登录',
      sub: '在浏览器中输入下方代码并授权',
      closable: true,
      body: `
        <div class="code-box">
          <span class="code-box__value" id="device-code">${escapeHtml(flow.user_code)}</span>
          <button class="btn btn--sm" id="copy-code">${icon('copy', 13)} 复制</button>
        </div>
        <div class="row" style="margin-top:14px;gap:8px">
          <button class="btn btn--blue" id="open-verify">${icon('external', 14)} 打开授权页面</button>
          <span class="tiny muted" id="device-status">等待授权…</span>
        </div>`,
      onMount(h) {
        h.el.querySelector('#copy-code').addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(flow.user_code);
            toast('已复制授权码', { variant: 'success' });
          } catch {
            toast('复制失败，请手动选择', { variant: 'warn' });
          }
        });
        h.el.querySelector('#open-verify').addEventListener('click', () => {
          if (window.rmh?.openExternal) window.rmh.openExternal(flow.verification_uri);
          else window.open(flow.verification_uri, '_blank');
        });
        h.el.querySelector('#device-status').textContent = `等待授权（${Math.round(flow.expires_in / 60)} 分钟内有效）…`;

        let stopped = false;
        const stop = () => {
          stopped = true;
        };
        h.el.addEventListener('rmh-close', stop);
        const poll = async () => {
          if (stopped || !h.el.isConnected) return;
          try {
            const res = await api.post('/api/device/poll', { clientId: flow.client_id, deviceCode: flow.device_code });
            if (res.accessToken) {
              h.close();
              const result = await api.post('/api/login', {
                token: res.accessToken,
                remember: rememberEl.checked,
                repoUrl: repoInput.value.trim(),
              });
              ctx.onLogin(result);
              return;
            }
            if (res.error === 'slow_down') {
              /* continue */
            } else if (res.error && res.error !== 'authorization_pending' && res.error !== 'expired_token') {
              h.el.querySelector('#device-status').textContent = `失败：${res.error_description || res.error}`;
              return;
            }
          } catch {
            /* 网络抖动，继续 */
          }
          setTimeout(poll, Math.max(5, flow.interval || 5) * 1000);
        };
        setTimeout(poll, Math.max(5, flow.interval || 5) * 1000);
      },
    });
    return m;
  }

  setTimeout(() => tokenInput.focus(), 60);
  return root;
}

/**
 * 仓库初始化向导：创建私有仓库 Rm-Homework 并写入模板。
 */
export function renderSetup(ctx) {
  const { api, state } = ctx;
  const pendingCode = state.pendingCode || '';
  const root = document.createElement('div');
  root.className = 'login';
  root.innerHTML = `
    <section class="login__brand">
      <div class="login__brand-top">
        <div class="sidebar__logo-mark">${icon('target', 21)}</div>
        <div class="sidebar__logo-text"><b style="font-size:15px">RM HOMEWORK</b><span>TEAM CONSOLE · 2026 SEASON</span></div>
      </div>
      <div class="login__headline">
        <div class="chip" style="margin-bottom:16px">${icon('layers', 12)} 首次使用 · 初始化</div>
        <h1>创建团队的<br /><em>作业仓库</em></h1>
        <p>
          还没有找到作业仓库。输入组长兑换码后，本应用会在你的 GitHub 账号下创建一个私有仓库
          <code style="font-family:var(--mono);color:#ffb3b9">Rm-Homework</code>，并写入分组配置与前三周的任务模板。
        </p>
        <div class="login__features" style="grid-template-columns:1fr 1fr">
          <div class="login__feature"><b>${icon('users', 13)} 三分组</b><span>算法 / 机械 / 嵌入式，自动生成目录。</span></div>
          <div class="login__feature"><b>${icon('shield', 13)} 私有仓库</b><span>仅战队成员可见，权限由 GitHub 管理。</span></div>
        </div>
      </div>
      <div class="login__brand-foot"><span>${icon('github', 13)} 仓库：${escapeHtml(state.me?.repo?.owner || '')}/Rm-Homework</span></div>
    </section>
    <section class="login__panel">
      <div class="login__card">
        <div class="login__title">初始化 Rm-Homework</div>
        <div class="login__desc">需要一次组长兑换码来确认身份。初始化完成后你将成为组长，可继续添加组员与发布作业。</div>

        <div class="field">
          <label class="field__label">组长兑换码 ${icon('lock', 13)}</label>
          <input class="input" id="setup-code" type="password" placeholder="输入兑换码" value="${escapeHtml(pendingCode)}" />
        </div>
        <div class="field">
          <label class="field__label">仓库名称</label>
          <input class="input" id="setup-repo" value="${escapeHtml((state.me && state.me.repo && state.me.repo.name) || 'SUAT-Rm-Homework')}" spellcheck="false" />
          <div class="field__hint">将在 <b>${escapeHtml(state.me?.repo?.owner || '你的账号')}</b> 下创建同名私有仓库。若仓库已存在，会直接连接。</div>
        </div>
        <div class="field">
          <label class="field__label">可见性</label>
          <select class="select" id="setup-private">
            <option value="1" selected>私有（推荐）</option>
            <option value="0">公开</option>
          </select>
        </div>
        <div id="setup-error" class="field__error" style="min-height:18px;margin-bottom:8px"></div>
        <button class="btn btn--primary btn--block btn--lg" id="setup-go">${icon('zap', 16)} <span>创建并初始化</span></button>
        <button class="btn btn--ghost btn--block" id="setup-back" style="margin-top:9px">返回登录</button>
        <div class="login__legal">
          创建仓库需要 Token 具备 <b>repo</b>（经典）或 <b>Administration: Read and write</b>（细粒度）权限。
        </div>
      </div>
    </section>
  `;

  const errEl = root.querySelector('#setup-error');
  root.querySelector('#setup-back').addEventListener('click', () => {
    state.pendingCode = '';
    ctx.app.logout();
  });
  root.querySelector('#setup-go').addEventListener('click', async () => {
    const code = root.querySelector('#setup-code').value.trim();
    const repoName = root.querySelector('#setup-repo').value.trim();
    const isPrivate = root.querySelector('#setup-private').value === '1';
    if (!code) {
      errEl.textContent = '请输入组长兑换码';
      return;
    }
    const btn = root.querySelector('#setup-go');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span>正在创建仓库并写入模板…</span>';
    errEl.textContent = '';
    try {
      await api.post('/api/bootstrap', { code, repoName, isPrivate });
      state.pendingCode = '';
      toast('仓库初始化完成', { variant: 'success' });
      await ctx.onDone({ warnings: [] });
    } catch (err) {
      errEl.textContent = err.message || '初始化失败';
      btn.disabled = false;
      btn.innerHTML = `${icon('zap', 16)} <span>创建并初始化</span>`;
    }
  });

  setTimeout(() => root.querySelector('#setup-code').focus(), 60);
  return root;
}
