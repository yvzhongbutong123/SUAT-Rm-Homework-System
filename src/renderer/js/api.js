/**
 * 与本地服务通信。API Key 来自 preload（或 URL 参数，便于浏览器调试）。
 */

const key = (() => {
  try {
    if (window.rmh && window.rmh.apiKey) return window.rmh.apiKey;
  } catch {
    /* ignore */
  }
  return new URLSearchParams(location.search).get('k') || '';
})();

export class ApiError extends Error {
  constructor(message, payload) {
    super(message);
    this.name = 'ApiError';
    this.payload = payload || {};
    this.code = payload && payload.code;
    this.status = payload && payload.status;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'x-rmh-key': key };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(`无法连接本地服务：${err.message}`);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(`服务响应异常 (${res.status})`);
  }
  if (!res.ok || !json.ok) {
    throw new ApiError(json.error || `请求失败 (${res.status})`, { ...json, status: res.status });
  }
  return json.data;
}

export const api = {
  key,
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: body || {} }),
  patch: (path, body) => request(path, { method: 'PATCH', body: body || {} }),
  del: (path) => request(path, { method: 'DELETE' }),
  request,
};
