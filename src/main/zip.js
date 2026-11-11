'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/**
 * 无依赖 ZIP 写入器（deflate）。
 * 用于组长「一键下载某个组员的作业文件夹」。
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosDateTime(date) {
  const d = date || new Date();
  const year = Math.max(1980, d.getFullYear());
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const day = (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, day };
}

function collectFiles(root) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const relDir = stack.pop();
    const absDir = path.join(root, relDir);
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const rel = relDir ? path.join(relDir, entry.name) : entry.name;
      const abs = path.join(root, rel);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(rel);
      else if (entry.isFile()) {
        const st = fs.statSync(abs);
        out.push({ abs, name: rel.split(path.sep).join('/'), size: st.size, mtime: st.mtime });
      }
    }
  }
  return out;
}

/**
 * @param {string} srcDir
 * @param {string} destZipPath
 * @param {{prefix?: string}} [opts]
 */
async function zipDirectory(srcDir, destZipPath, opts = {}) {
  const files = collectFiles(srcDir);
  const chunks = [];
  const central = [];
  let offset = 0;
  const prefix = opts.prefix ? opts.prefix.replace(/\\/g, '/').replace(/\/+$/, '') + '/' : '';

  for (const file of files) {
    const data = fs.readFileSync(file.abs);
    const crc = crc32(data);
    let method = 8;
    let compressed;
    try {
      compressed = zlib.deflateRawSync(data, { level: 6 });
    } catch {
      compressed = data;
      method = 0;
    }
    if (compressed.length >= data.length) {
      compressed = data;
      method = 0;
    }
    const nameBuf = Buffer.from(prefix + file.name, 'utf8');
    const { time, day } = dosDateTime(file.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, compressed);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(day, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(compressed.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nameBuf]));

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  await fs.promises.mkdir(path.dirname(destZipPath), { recursive: true });
  const tmp = destZipPath + '.part';
  await fs.promises.writeFile(tmp, Buffer.concat([...chunks, centralBuf, end]));
  await fs.promises.rename(tmp, destZipPath);
  return { files: files.length, bytes: fs.statSync(destZipPath).size };
}

module.exports = { zipDirectory, crc32 };
