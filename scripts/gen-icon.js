'use strict';

/**
 * 生成应用图标（无第三方依赖）：手写 PNG + ICO。
 * 输出：assets/icon.png（256）、assets/icon.ico（多尺寸）
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/* ----------------------------- PNG ----------------------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ----------------------------- 绘制 ----------------------------- */

function clamp(v, a = 0, b = 1) {
  return Math.max(a, Math.min(b, v));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

/** 圆角矩形有符号距离（内部为负）。 */
function roundedRectSdf(x, y, cx, cy, w, h, r) {
  const dx = Math.abs(x - cx) - (w / 2 - r);
  const dy = Math.abs(y - cy) - (h / 2 - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(ax, ay) - r;
}

/** 正六边形有符号距离（平顶）。 */
function hexagonSdf(x, y, cx, cy, r) {
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  const k = 0.8660254; // sqrt(3)/2
  const d1 = k * dx + 0.5 * dy;
  const d2 = -0.5 * dx + k * dy;
  const maxD = Math.max(d1, d2);
  return maxD - r * k;
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const scale = size / 256;

  // 图层参数（按 256 设计，缩放到目标尺寸）
  const bgHalf = 118 * scale;
  const bgRadius = 54 * scale;
  const hexR = 88 * scale;
  const ringR = 34 * scale;
  const ringW = 7 * scale;
  const crossLen = 74 * scale;
  const crossW = 7 * scale;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      // 背景圆角方块：深蓝黑渐变
      const bgSdf = roundedRectSdf(px, py, c, c, bgHalf * 2, bgHalf * 2, bgRadius);
      if (bgSdf < 0) {
        const t = clamp((px / size) * 0.5 + (py / size) * 0.5);
        r = mix(26, 10, t);
        g = mix(34, 14, t);
        b = mix(54, 22, t);
        // 顶部高光
        const glow = clamp(1 - Math.hypot(px - c * 0.8, py - c * 0.55) / (size * 0.75));
        r += glow * 10;
        g += glow * 8;
        b += glow * 18;
        a = 255;
      }

      // 外发光（红色）
      const hexSdf = hexagonSdf(px, py, c, c, hexR);
      const glowA = clamp(1 - Math.abs(hexSdf) / (16 * scale)) * clamp(-bgSdf / (10 * scale));
      if (glowA > 0 && bgSdf < 0) {
        r += 180 * glowA * 0.35;
        g += 30 * glowA * 0.25;
        b += 40 * glowA * 0.25;
      }

      // 六边形描边
      const hexEdge = Math.abs(hexSdf) - 3.2 * scale;
      if (hexEdge < 0 && bgSdf < 0) {
        const aa = clamp(0.5 - hexEdge / (1.6 * scale));
        const grad = clamp((py - (c - hexR)) / (hexR * 2));
        r = mix(r, mix(255, 196, grad), aa);
        g = mix(g, mix(86, 26, grad), aa);
        b = mix(b, mix(98, 38, grad), aa);
        a = 255;
      }

      // 中心圆环
      const ringSdf = Math.abs(Math.hypot(px - c, py - c) - ringR) - ringW / 2;
      if (ringSdf < 0 && bgSdf < 0) {
        const aa = clamp(0.5 - ringSdf / (1.4 * scale));
        r = mix(r, 245, aa);
        g = mix(g, 249, aa);
        b = mix(b, 255, aa);
      }

      // 十字准星
      const inCrossV = Math.abs(px - c) < crossW / 2 && Math.abs(py - c) < crossLen / 2;
      const inCrossH = Math.abs(py - c) < crossW / 2 && Math.abs(px - c) < crossLen / 2;
      if ((inCrossV || inCrossH) && bgSdf < 0) {
        // 圆环内部让空
        const inside = Math.hypot(px - c, py - c) < ringR - ringW / 2 - 1 * scale;
        if (!inside) {
          r = mix(r, 235, 0.92);
          g = mix(g, 240, 0.92);
          b = mix(b, 248, 0.92);
        }
      }

      // 中心点
      const dot = Math.hypot(px - c, py - c) < 8 * scale;
      if (dot) {
        r = 255;
        g = 90;
        b = 100;
      }

      // 边缘抗锯齿
      if (bgSdf > -1.5 * scale && bgSdf < 0) {
        a = 255 * clamp(-bgSdf / (1.5 * scale));
      }

      const i = (y * size + x) * 4;
      rgba[i] = Math.round(clamp(r, 0, 255));
      rgba[i + 1] = Math.round(clamp(g, 0, 255));
      rgba[i + 2] = Math.round(clamp(b, 0, 255));
      rgba[i + 3] = Math.round(clamp(a, 0, 255));
    }
  }
  return encodePng(size, size, rgba);
}

/* ----------------------------- ICO ----------------------------- */

function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + 16 * count;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

/* ----------------------------- 主流程 ----------------------------- */

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => ({ size, data: drawIcon(size) }));

fs.writeFileSync(path.join(outDir, 'icon.png'), images.find((i) => i.size === 256).data);
fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco(images.filter((i) => i.size >= 32)));
fs.writeFileSync(path.join(outDir, 'icon-128.png'), images.find((i) => i.size === 128).data);

console.log(`已生成图标：${path.join(outDir, 'icon.png')} / icon.ico`);
