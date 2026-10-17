'use strict';
/**
 * 自包含图标生成器：用 zlib 编码 PNG，再包成 ICO（ICO 可内嵌 PNG）。
 * 无需任何二进制资源文件，启动即生成。图形：近黑底 + 信号琥珀色"声场环"标记。
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const BASE = 256;
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
// 任意尺寸渲染：几何半径按 256 基准等比缩放（macOS 需要 512+ 的 PNG 才能生成 icns）
function buildPng(size = 512) {
  const W = Math.max(16, Math.round(size));
  const k = W / BASE;
  const rOuter = 96 * k, rInner = 42 * k, rCore = 20 * k;
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
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      let col = BG;
      if (d <= rOuter && d >= rInner) col = ACCENT; // 外环
      else if (d <= rCore) col = ACCENT;            // 中心点
      const p = off + 1 + x * 4;
      raw[p] = col[0]; raw[p + 1] = col[1]; raw[p + 2] = col[2]; raw[p + 3] = col[3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * 多尺寸 ICO：Windows 在不同位置（任务栏 / 资源管理器 / 大图标视图）取不同尺寸，
 * 只塞一张 256 会被系统缩放出锯齿。
 */
function buildIco(entries) {
  const list = Array.isArray(entries) ? entries : [{ size: 256, png: entries }];
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(list.length, 4);
  const dirs = [];
  let offset = 6 + 16 * list.length;
  list.forEach(({ size, png }) => {
    const dir = Buffer.alloc(16);
    dir[0] = size >= 256 ? 0 : size;
    dir[1] = size >= 256 ? 0 : size;
    dir[2] = 0; dir[3] = 0;
    dir.writeUInt16LE(1, 4); dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(png.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += png.length;
    dirs.push(dir);
  });
  return Buffer.concat([header, ...dirs, ...list.map((e) => e.png)]);
}

let cache = null;
function getIconBuffers() {
  if (cache) return cache;
  const png = buildPng(512); // mac / linux 图标（electron-builder 会转 icns）
  const ico = buildIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, png: buildPng(size) })));
  cache = { png, ico };
  return cache;
}
function writeIcons(dir) {
  const { png, ico } = getIconBuffers();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'icon.png'), png);
  fs.writeFileSync(path.join(dir, 'icon.ico'), ico);
}
module.exports = { getIconBuffers, writeIcons, buildPng, buildIco };
