'use strict';

const path = require('node:path');
const { GitRepoStorage } = require('./providers/git-repo');
const { DemoStorage } = require('./providers/demo');

/**
 * 存储工厂。
 * 业务层只依赖下列统一接口（由 FsStore + provider 提供）：
 *   ensure / pull / mutate / readJson / writeFilesRaw / listDir / ...
 * 想接入新的后端（例如 OSS 直存、自建服务器），在这里加一个 provider 即可。
 */
function createStorage({ mode, dataDir, git, logger, config }) {
  if (mode === 'demo') {
    return new DemoStorage({ rootDir: path.join(dataDir, 'demo-repo'), logger });
  }
  return new GitRepoStorage({
    rootDir: path.join(dataDir, 'repo'),
    logger,
    git,
    config,
  });
}

module.exports = { createStorage };
