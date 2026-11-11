'use strict';

/**
 * 应用自身的版本检查：从 SUAT-Rm-Homework-System 仓库读取 version.json。
 * 仓库里放一个 version.json：
 * {
 *   "version": "1.0.0",
 *   "notes": "本次更新内容",
 *   "url": "https://github.com/.../releases/latest/download/RM-Homework-1.0.0.exe"
 * }
 */

const OWNER = 'yvzhongbutong123';
const REPO = 'SUAT-Rm-Homework-System';
const BRANCH = 'main';

function parseVersion(v) {
  return String(v || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n));
}

/** 返回 1 表示 a 比 b 新，-1 表示旧，0 相同。 */
function compareVersions(a, b) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i += 1) {
    const x = av[i] || 0;
    const y = bv[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function fetchVersionInfo(token) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/version.json?ref=${BRANCH}`;
  const headers = {
    'User-Agent': 'RMHomework-Updater',
    Accept: 'application/vnd.github+json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (res.status === 404) {
    throw new Error('更新仓库中还没有 version.json（请先推送 1.0 版本）');
  }
  if (!res.ok) {
    throw new Error(`读取更新仓库失败：HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = Buffer.from(data.content || '', 'base64').toString('utf8');
  return JSON.parse(text);
}

async function checkUpdate(currentVersion, token) {
  const info = await fetchVersionInfo(token);
  const latest = String(info.version || '').trim();
  const hasUpdate = latest ? compareVersions(latest, currentVersion) > 0 : false;
  return {
    current: currentVersion,
    latest,
    hasUpdate,
    notes: info.notes || '',
    url: info.url || '',
    repo: `${OWNER}/${REPO}`,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = { checkUpdate, compareVersions, OWNER, REPO, BRANCH };
