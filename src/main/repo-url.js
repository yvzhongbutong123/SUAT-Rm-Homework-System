'use strict';

/**
 * 仓库地址解析：支持 SSH 与 HTTPS 两种写法。
 *   git@github.com:owner/repo.git
 *   https://github.com/owner/repo.git
 *   owner/repo
 */

function parseRepoUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('仓库地址为空');

  let protocol = '';
  let host = 'github.com';
  let owner = '';
  let name = '';

  let m = /^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(raw);
  if (m) {
    protocol = 'ssh';
    host = m[1];
    owner = m[2];
    name = m[3];
  } else {
    m = /^(?:https?|git):\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(raw);
    if (m) {
      protocol = 'https';
      host = m[1];
      owner = m[2];
      name = m[3];
    } else {
      m = /^([^/\s]+)\/([^/\s]+)$/.exec(raw);
      if (m) {
        protocol = 'https';
        owner = m[1];
        name = m[2];
      }
    }
  }

  name = String(name || '').replace(/\.git$/i, '');
  if (!owner || !name) {
    throw new Error('无法识别的仓库地址，应为 git@github.com:owner/repo.git 或 https://github.com/owner/repo.git');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error('仓库地址中的 owner / 仓库名不合法');
  }

  return {
    protocol,
    host,
    owner,
    name,
    sshUrl: `git@${host}:${owner}/${name}.git`,
    httpsUrl: `https://${host}/${owner}/${name}.git`,
    webUrl: `https://${host}/${owner}/${name}`,
  };
}

const DEFAULT_REPO_URL = 'git@github.com:yvzhongbutong123/SUAT-Rm-Homework.git';

module.exports = { parseRepoUrl, DEFAULT_REPO_URL };
