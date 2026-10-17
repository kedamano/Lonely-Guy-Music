'use strict';
/**
 * 本地音乐清单（跨会话持久化）
 * - 导入的音频以「绝对路径 + 不透明 id」登记到 userData/library.json；
 *   渲染层只用 id 访问 /api/local?id=，路径不出后端，也不接受任意路径 → 无路径穿越面。
 * - 为什么不用 objectURL：blob: 无法跨刷新持久化，用户导入的曲库会整批丢失。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUDIO_EXT = new Set(['mp3', 'flac', 'wav', 'ogg', 'oga', 'm4a', 'm4b', 'aac', 'opus', 'ape', 'wma', 'aiff', 'aif', 'dsf']);
const MIME = {
  mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
  m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg',
  ape: 'audio/x-ape', wma: 'audio/x-ms-wma', aiff: 'audio/aiff', aif: 'audio/aiff', dsf: 'audio/x-dsf',
};
const MAX_FILES = 2000;
const MAX_DEPTH = 4;

let FILE = '';
let items = []; // [{id, path, name, artist, ext, size, duration, addedAt}]

function init(dataDir) {
  FILE = path.join(dataDir, 'library.json');
  try {
    if (fs.existsSync(FILE)) {
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      items = Array.isArray(j.items) ? j.items : [];
      const alive = items.filter((it) => it.path && fs.existsSync(it.path));
      const gone = items.length - alive.length;
      items = alive;
      console.log(`[library] 已恢复本地曲库 ${items.length} 首` + (gone ? `（${gone} 个文件已移动或删除，自动移除）` : ''));
    }
  } catch (e) {
    console.warn('[library] 读取本地曲库失败，按空库处理:', e.message);
    items = [];
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ items }, null, 2));
  } catch (e) {
    console.warn('[library] 保存本地曲库失败:', e.message);
  }
}

function extOf(p) {
  return String(path.extname(p) || '').replace('.', '').toLowerCase();
}
function isAudio(p) {
  return AUDIO_EXT.has(extOf(p));
}

// 文件名惯例「艺人 - 歌名」/「歌名」
function parseName(p) {
  const base = path.basename(p, path.extname(p)).replace(/^\s*\d{1,3}\s*[-_.]\s*/, '').trim();
  const m = base.split(/\s+-\s+/);
  if (m.length >= 2) return { name: m.slice(1).join(' - ').trim() || base, artist: m[0].trim() };
  return { name: base || path.basename(p), artist: '' };
}

function idOf(p) {
  return 'lb_' + crypto.createHash('sha1').update(path.resolve(p)).digest('hex').slice(0, 12);
}

function addPaths(paths) {
  const added = [];
  let skipped = 0;
  for (const raw of paths || []) {
    const p = String(raw || '');
    if (!p || !isAudio(p)) { skipped++; continue; }
    let st;
    try {
      st = fs.statSync(p);
    } catch (_) { skipped++; continue; }
    if (!st.isFile()) { skipped++; continue; }
    const id = idOf(p);
    const exist = items.find((it) => it.id === id);
    if (exist) {
      if (exist.path !== p) exist.path = p; // 同内容改名后跟着走
      continue;
    }
    const { name, artist } = parseName(p);
    items.unshift({
      id, path: p, name, artist, ext: extOf(p),
      size: st.size, duration: 0, addedAt: Date.now(),
    });
    added.push(publicOf(id));
  }
  save();
  return { added, skipped };
}

function scanDir(dir, limit = 800) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > MAX_DEPTH || out.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && isAudio(full)) out.push(full);
    }
  };
  try {
    if (!fs.statSync(dir).isDirectory()) return [];
  } catch (_) { return []; }
  walk(dir, 0);
  return out;
}

function remove(id) {
  const i = items.findIndex((it) => it.id === id);
  if (i < 0) return false;
  items.splice(i, 1);
  save();
  return true;
}

function clear() {
  items = [];
  save();
}

/** 上报时长（渲染层用 <audio> 读 metadata 后回写），避免每次重扫 */
function setMeta(id, { duration, name, artist }) {
  const it = items.find((x) => x.id === id);
  if (!it) return null;
  if (Number.isFinite(duration) && duration > 0) it.duration = Math.round(duration);
  if (name) it.name = String(name).slice(0, 200);
  if (artist) it.artist = String(artist).slice(0, 200);
  save();
  return publicOf(id);
}

// 路径绝不返回给渲染层：只用 id 寻址
function publicOf(id) {
  const it = items.find((x) => x.id === id);
  if (!it) return null;
  const { path: _drop, ...rest } = it;
  return { ...rest, url: `/api/local?id=${encodeURIComponent(it.id)}`, source: 'local' };
}

function list() {
  return items.map((it) => publicOf(it.id)).filter(Boolean);
}

/** 供 /api/local 流式播放：id → 真实路径（白名单式查找） */
function resolve(id) {
  const it = items.find((x) => x.id === id);
  if (!it) return null;
  try {
    if (!fs.existsSync(it.path) || !fs.statSync(it.path).isFile()) return null;
  } catch (_) { return null; }
  return { path: it.path, mime: MIME[extOf(it.path)] || 'application/octet-stream', id: it.id };
}

module.exports = { init, addPaths, scanDir, remove, clear, setMeta, list, resolve, isAudio };
