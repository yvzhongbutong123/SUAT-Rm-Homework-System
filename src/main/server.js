'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');
const { HttpError } = require('./util');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

class LocalServer {
  constructor({ app, logger, staticDir, staticAssets, version }) {
    this.app = app;
    this.logger = logger;
    this.staticDir = staticDir;
    this.staticAssets = staticAssets || null;
    this.version = version;
    this.apiKey = null;
    this.server = null;
    this.port = 0;
    this.routes = [];
    this.registerRoutes();
  }

  route(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp(
      '^' +
        pattern.replace(/:[A-Za-z0-9_]+/g, (m) => {
          keys.push(m.slice(1));
          return '([^/]+)';
        }) +
        '$',
    );
    this.routes.push({ method, regex, keys, handler });
  }

  registerRoutes() {
    const app = this.app;
    const get = (p, h) => this.route('GET', p, h);
    const post = (p, h) => this.route('POST', p, h);
    const patch = (p, h) => this.route('PATCH', p, h);
    const del = (p, h) => this.route('DELETE', p, h);

    get('/api/health', async () => ({ ok: true, version: this.version }));
    get('/api/me', async () => app.me());
    get('/api/update/check', async () => app.checkForUpdate());
    post('/api/login', async (ctx) =>
      app.login({
        token: ctx.body.token,
        repoUrl: ctx.body.repoUrl,
        remember: ctx.body.remember,
        accountLogin: ctx.body.accountLogin,
      }),
    );
    post('/api/demo/login', async (ctx) => app.demoLogin({ login: ctx.body.login, role: ctx.body.role }));
    post('/api/logout', async (ctx) => app.logout({ forget: !!ctx.body.forget }));
    get('/api/accounts', async () => app.listAccounts());
    post('/api/accounts/remove', async (ctx) => app.removeAccount(ctx.body.login));
    post('/api/accounts/clear', async () => app.clearAccounts());
    post('/api/redeem', async (ctx) => app.redeem(ctx.body.code));
    post('/api/bootstrap', async (ctx) => app.bootstrap(ctx.body));
    post('/api/device/start', async (ctx) => app.startDeviceFlow(ctx.body));
    post('/api/device/poll', async (ctx) => app.pollDeviceFlow(ctx.body));
    get('/api/setup/state', async () => app.me());

    get('/api/weeks', async () => app.listWeeks());
    get('/api/weeks/:week', async (ctx) => app.getWeek(ctx.params.week));
    post('/api/submissions/:week', async (ctx) => app.submitFolder(ctx.params.week, ctx.body.folderPath));

    get('/api/admin/weeks/next', async () => app.nextWeek());
    get('/api/admin/weeks/:week/view', async (ctx) => app.getWeekView(ctx.params.week));
    get('/api/admin/weeks/:week/editor', async (ctx) => app.getWeekEditor(ctx.params.week));
    post('/api/admin/weeks', async (ctx) => app.saveWeek(ctx.body));
    post('/api/admin/weeks/current', async (ctx) => app.setCurrentWeek(ctx.body.week));

    post('/api/upload/begin', async () => app.beginUpload());
    post('/api/upload/chunk', async (ctx) => {
      const session = ctx.query.get('session');
      const rel = ctx.query.get('rel');
      const buffer = await readBody(ctx.req, 120 * 1024 * 1024);
      return app.writeUploadChunk(session, rel, buffer);
    });
    post('/api/upload/commit', async (ctx) => app.commitUpload(ctx.body.session, ctx.body.week));

    get('/api/notifications', async () => app.getNotifications());
    post('/api/notifications/read', async (ctx) => app.markNotificationsRead(ctx.body.keys));

    get('/api/admin/overview', async (ctx) => app.adminOverview(ctx.query.get('week') || null));
    get('/api/admin/submission', async (ctx) =>
      app.getSubmissionDetail(ctx.query.get('week'), ctx.query.get('login')),
    );
    post('/api/admin/grade', async (ctx) => app.grade(ctx.body));
    post('/api/admin/export', async (ctx) => app.exportSubmission(ctx.body.week, ctx.body.member, ctx.body.destZip));
    get('/api/admin/members', async () => app.listMembers());
    post('/api/admin/members', async (ctx) => app.setMember(ctx.body.login, ctx.body));
    delete('/api/admin/members/:login', async (ctx) => app.removeMember(ctx.params.login));

    get('/api/settings', async () => app.getSettings());
    patch('/api/settings', async (ctx) => app.updateSettings(ctx.body));
    get('/api/git/status', async (ctx) => app.gitStatus(ctx.query.get('force') === '1'));
    post('/api/sync', async () => app.sync());
    get('/api/system/info', async () => ({
      version: this.version,
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron || null,
      port: this.port,
    }));
  }

  async start(host = '127.0.0.1') {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, host, () => resolve());
    });
    this.port = this.server.address().port;
    this.logger.info(`本地服务已启动: http://${host}:${this.port}`);
    return this.port;
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  }

  async handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = decodeURIComponent(url.pathname);

    try {
      if (pathname.startsWith('/api/')) {
        const providedKey = req.headers['x-rmh-key'] || url.searchParams.get('k');
        if (!this.apiKey || providedKey !== this.apiKey) {
          return this.sendJson(res, 403, { ok: false, error: '无效的客户端凭证' });
        }

        // 作业 ZIP 下载（浏览器模式直接下载，流式返回）
        if (req.method === 'GET' && pathname === '/api/admin/export') {
          const week = url.searchParams.get('week');
          const member = url.searchParams.get('member') || url.searchParams.get('login');
          const out = await this.app.exportSubmission(week, member, null);
          const filename = `${week}-${member}.zip`;
          res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'Cache-Control': 'no-store',
          });
          fs.createReadStream(out.path).pipe(res);
          return;
        }

        const route = this.routes.find((r) => r.method === req.method && r.regex.test(pathname));
        if (!route) return this.sendJson(res, 404, { ok: false, error: `接口不存在: ${req.method} ${pathname}` });
        const match = route.regex.exec(pathname);
        const params = {};
        route.keys.forEach((k, i) => {
          params[k] = match[i + 1];
        });
        let body = {};
        if (req.method !== 'GET' && req.method !== 'DELETE' && pathname !== '/api/upload/chunk') {
          const raw = await readBody(req);
          if (raw && raw.length) {
            try {
              body = JSON.parse(raw.toString('utf8'));
            } catch {
              throw new HttpError(400, '请求体不是合法的 JSON');
            }
          }
        }
        const ctx = { req, params, query: url.searchParams, body };
        const data = await route.handler(ctx);
        this.logger.debug(`${req.method} ${pathname} -> 200 (${Date.now() - started}ms)`);
        return this.sendJson(res, 200, { ok: true, data });
      }

      await this.serveStatic(pathname, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) this.logger.error(`${req.method} ${pathname} -> ${status}: ${err.stack || err.message}`);
      else this.logger.warn(`${req.method} ${pathname} -> ${status}: ${err.message}`);
      this.sendJson(res, status, {
        ok: false,
        error: err.message || '服务器内部错误',
        ...(err.extra || {}),
      });
    }
  }

  async serveStatic(pathname, res) {
    let rel = pathname === '/' ? '/index.html' : pathname;
    const ext = path.extname(rel).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:",
    };

    // 内嵌资源（浏览器 / 单文件 exe 模式）
    if (this.staticAssets) {
      const buf = this.staticAssets[rel] || this.staticAssets[rel.replace(/^\/+/, '')];
      if (buf) {
        res.writeHead(200, headers);
        res.end(buf);
        return;
      }
    }

    const abs = path.resolve(this.staticDir, '.' + rel);
    if (!abs.startsWith(path.resolve(this.staticDir) + path.sep) && abs !== path.resolve(this.staticDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const st = await fsp.stat(abs).catch(() => null);
    if (!st || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, headers);
    fs.createReadStream(abs).pipe(res);
  }

  async stop() {
    if (this.server) await new Promise((r) => this.server.close(r));
  }
}

module.exports = { LocalServer };
