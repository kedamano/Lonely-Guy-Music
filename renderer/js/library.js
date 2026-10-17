// 本地曲库。
// Electron：把绝对路径交给后端登记到 userData/library.json，播放走 /api/local?id=，
//           刷新、重启都还在（旧的 blob: 方案一刷新就整批丢失）。
// 纯浏览器：拿不到绝对路径，只能退回 objectURL 会话级曲库，功能不阻塞开发调试。
import { api } from './api.js';

const AUDIO_RE = /\.(mp3|flac|wav|ogg|oga|m4a|m4b|aac|opus|ape|wma|aiff?|dsf)$/i;

let items = [];
let loaded = false;
let inflight = null;

// preload 暴露了 filePath 才说明运行在 Electron，才能取到真实路径
function serverMode() { return !!window.gm?.filePath; }

function light(t) {
  return {
    id: String(t.id), name: t.name || '未知曲目', artist: t.artist || '本地音乐',
    album: t.album || (t.ext || '').toUpperCase(), albumPic: t.albumPic || '',
    duration: Number(t.duration) || 0, source: 'local', url: t.url,
  };
}

function normalizePath(file) {
  try {
    const p = window.gm.filePath(file);
    if (typeof p === 'string' && p) return p;
  } catch (_) { /* 某些 Electron 版本 File.path 已移除，只认 filePath */ }
  return '';
}

async function load() {
  if (!serverMode()) { loaded = true; return items; }
  if (loaded) return items;
  if (!inflight) {
    inflight = api.library()
      .then((list) => { items = (list || []).map(light); loaded = true; return items; })
      .catch(() => { items = []; loaded = true; return items; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** 会话级导入（浏览器环境） */
function addSessionFiles(files) {
  const added = [];
  for (const f of files) {
    if (!f.type.startsWith('audio') && !AUDIO_RE.test(f.name)) continue;
    const url = URL.createObjectURL(f);
    const t = light({
      id: 'local:' + url, name: f.name.replace(/\.[^.]+$/, ''), artist: '本地文件',
      ext: (f.name.split('.').pop() || ''), duration: 0, url,
    });
    const i = items.findIndex((x) => x.url === url);
    if (i >= 0) items.splice(i, 1);
    items.unshift(t);
    added.push(t);
  }
  return { added, skipped: files.length - added.length };
}

export const library = {
  all() { return items; },
  count() { return items.length; },
  ready() { return loaded; },
  load,
  isServer: serverMode,

  /** FileList / File[] → 曲目 */
  async addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return { added: [], skipped: 0 };
    if (!serverMode()) return addSessionFiles(files);
    const paths = [];
    let skipped = 0;
    for (const f of files) {
      const p = normalizePath(f);
      if (!p || !AUDIO_RE.test(p)) { skipped++; continue; }
      paths.push(p);
    }
    if (!paths.length) return { added: [], skipped };
    const r = await api.libAdd(paths);
    (r.added || []).forEach((t) => {
      if (!items.some((x) => x.id === t.id)) items.unshift(light(t));
    });
    return { added: (r.added || []).map(light), skipped: skipped + (r.skipped || 0) };
  },

  /** 目录扫描（Electron 专用，由后端递归） */
  async scan(dir) {
    if (!serverMode()) throw new Error('浏览器环境无法扫描目录，请改用文件选择');
    const r = await api.libScan(dir);
    (r.added || []).forEach((t) => {
      if (!items.some((x) => x.id === t.id)) items.unshift(light(t));
    });
    return { added: (r.added || []).map(light), skipped: r.skipped || 0 };
  },

  async addPaths(paths) {
    const r = await api.libAdd(paths);
    (r.added || []).forEach((t) => {
      if (!items.some((x) => x.id === t.id)) items.unshift(light(t));
    });
    return { added: (r.added || []).map(light), skipped: r.skipped || 0 };
  },

  async remove(item) {
    const i = items.findIndex((x) => x.id === item.id);
    if (i < 0) return false;
    items.splice(i, 1);
    if (!serverMode()) return true;
    try { await api.libRemove(item.id); } catch (_) { /* 清单已内存移除，落盘失败不阻塞 UI */ }
    return true;
  },

  async clear() {
    const all = items.slice();
    for (const it of all) await this.remove(it);
  },

  /** 时长回写：曲目统一用毫秒（与网易云 dt 一致），避免每次进页面重扫 metadata */
  async reportDuration(item, ms) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    item.duration = Math.round(ms);
    if (!serverMode()) return;
    try { await api.libMeta({ id: item.id, duration: Math.round(ms) }); } catch (_) { /* 非关键路径 */ }
  },

  /** 本地曲目是否还能播放（历史/收藏里的 blob: 记录刷新后会失效） */
  containsUrl(url) { return !!url && items.some((t) => t.url === url); },
  find(id) { return items.find((t) => String(t.id) === String(id)) || null; },
};
