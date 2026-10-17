'use strict';
/**
 * 自包含图标生成器：用 zlib 编码 PNG，再包成 ICO（ICO 可内嵌 PNG）。
 * 无需任何二进制资源文件，启动即生成。图形：近黑底 + 信号琥珀色"声场环"标记。
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const W = 256;
const BG = [14, 13, 11, 255];
const ACCENT = [255, 106, 44, 255];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function buildPng() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((W * 4 + 1) * W);
  const cx = W / 2, cy = W / 2;
  for (let y = 0; y < W; y++) {
    const off = y * (W * 4 + 1);
    raw[off] = 0; // filter none
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      let col = BG;
      if (d <= 96 && d >= 42) col = ACCENT;       // 外环
      else if (d <= 20) col = ACCENT;             // 中心点
      const p = off + 1 + x * 4;
      raw[p] = col[0]; raw[p + 1] = col[1]; raw[p + 2] = col[2]; raw[p + 3] = col[3];
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
function buildIco(png) {
  // ICO 头(6) + 目录项(16) + PNG 数据
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const dir = Buffer.alloc(16);
  dir[0] = W === 256 ? 0 : W; dir[1] = W === 256 ? 0 : W; dir[2] = 0; dir[3] = 0;
  dir.writeUInt16LE(1, 4); dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(png.length, 8);
  dir.writeUInt32LE(22, 12);
  return Buffer.concat([header, dir, png]);
}

let cache = null;
function getIconBuffers() {
  if (cache) return cache;
  const png = buildPng();
  cache = { png, ico: buildIco(png) };
  return cache;
}
function writeIcons(dir) {
  const { png, ico } = getIconBuffers();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'icon.png'), png);
  fs.writeFileSync(path.join(dir, 'icon.ico'), ico);
}
module.exports = { getIconBuffers, writeIcons, buildPng, buildIco };
