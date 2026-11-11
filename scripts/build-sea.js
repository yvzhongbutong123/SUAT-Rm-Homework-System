'use strict';

/**
 * 构建独立 exe（Node SEA，不依赖 Chromium / Electron）。
 * 产物：dist/RM-Homework-1.0.1.exe
 *
 * 说明：沙箱内无法使用 esbuild 的 JS API（内部 spawn 管道会 EPERM），
 * 因此这里直接调用 esbuild.exe 并通过临时文件提供内嵌资源。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const OUT_EXE = path.join(DIST, `RM-Homework-${require('../package.json').version}.exe`);
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? path.join(base, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...walk(dir, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function run(file, args) {
  execFileSync(file, args, { cwd: ROOT, stdio: 'inherit' });
}

async function main() {
  fs.mkdirSync(BUILD, { recursive: true });
  fs.mkdirSync(DIST, { recursive: true });

  // 1) 前端资源 -> 临时模块
  const files = walk(RENDERER).filter((f) => !f.endsWith('package.json'));
  const entries = files.map((rel) => {
    const b64 = fs.readFileSync(path.join(RENDERER, rel)).toString('base64');
    return `  ${JSON.stringify('/' + rel.split(path.sep).join('/'))}: Buffer.from(${JSON.stringify(b64)}, 'base64'),`;
  });
  const embeddedPath = path.join(ROOT, 'src', 'web', 'embedded-assets.js');
  fs.writeFileSync(embeddedPath, `module.exports = {\n${entries.join('\n')}\n};\n`, 'utf8');
  console.log(`内嵌前端资源 ${files.length} 个文件`);

  // 2) esbuild 打包（直接调用二进制，避免 JS API 的 spawn）
  const esbuildBin = path.join(ROOT, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');
  run(esbuildBin, [
    path.join(ROOT, 'src', 'web', 'start.js'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    `--outfile=${path.join(BUILD, 'sea-bundle.cjs')}`,
    '--log-level=warning',
  ]);
  fs.rmSync(embeddedPath, { force: true });
  console.log('esbuild 打包完成');

  // 3) SEA blob
  const seaConfig = path.join(BUILD, 'sea-config.json');
  fs.writeFileSync(
    seaConfig,
    JSON.stringify(
      {
        main: 'build/sea-bundle.cjs',
        output: 'build/sea-prep.blob',
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      },
      null,
      2,
    ),
    'utf8',
  );
  run(process.execPath, ['--experimental-sea-config', seaConfig]);
  console.log('SEA blob 生成完成');

  // 4) 注入 node.exe
  fs.copyFileSync(process.execPath, OUT_EXE);
  run(process.execPath, [
    path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js'),
    OUT_EXE,
    'NODE_SEA_BLOB',
    path.join(BUILD, 'sea-prep.blob'),
    '--sentinel-fuse',
    FUSE,
  ]);
  console.log(`已生成 ${OUT_EXE}（${(fs.statSync(OUT_EXE).size / 1024 / 1024).toFixed(1)} MB）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
