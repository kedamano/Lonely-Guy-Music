'use strict';
/**
 * 托管下载：把在线歌曲落到本地目录，并登记进本地曲库做到离线可播。
 *
 * 与旧实现（渲染层 fetch 整个文件 → 弹保存框）的三点区别：
 *   1. 落盘在后端做，流式写文件，不再把整首歌读进渲染进程内存再 Array.from 传一遍；
 *   2. 下载成功后调用 library.addPaths 登记，断网/上游全挂时这一首照样能播、能进收藏；
 *   3. 音频旁边同目录落一份 .lrc 与封面，播放时按 id 回读（本地曲目原本完全不读歌词，
 *      离线歌没有歌词等于没法跟着唱，所以歌词页要能读本地文件）。
 *
 * 安全边界：
 *   - 只接受 http(s) 地址，且写盘路径永远由本模块拼接（目录 + 清洗过的文件名），
 *     渲染层传任何路径都只用来做目录选择，不参与文件名 → 无路径穿越面；
 *   - 文件绝对路径不下发渲染层，曲目继续走 /api/local?id= 寻址。
 */

const fs = require('fs');
const path = require('path');
const platformUrl = require('./platform-url');
const ncm = require('./ncm-client');
const sourceManager = require('./source-manager');
const library = require('./library');

const AUDIO_CT = {
  mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav',
};
const ILLEGAL = /[\\/:*?"<>|]/g;
const FETCH_TIMEOUT = 120000;

let FILE = '';
let DIR = '';
let cfg = {
  dir: '',                 // 空 = userData/downloads
  naming: 'name-artist',   // name-artist / artist-name / name
  quotaMb: 4096,           // 0 = 不限制；超限按最早下载清理
  withLyric: true,
  withCover: true,
};
let items = []; // [{ id, libraryId, name, artist, album, platform, remoteId, file, lrc, pic, size, duration, at }]
let tasks = []; // 进行中/最近的任务，渲染层轮询
let seq = 0;
const AUDIO_EXT = new Set(['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'ape', 'wma']);

function init(dataDir) {
  FILE = path.join(dataDir, 'downloads.json');
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (j && typeof j === 'object') {
      cfg = { ...cfg, ...(j.config || {}) };
      items = Array.isArray(j.items) ? j.items : [];
    }
  } catch (_) { /* 首次运行按空表 */ }
  applyDir();
  // 上次退出时还在下载的任务不留残留状态
  tasks = [];
  pruneMissing();
}

function applyDir() {
  const base = cfg.dir && path.isAbsolute(cfg.dir)
    ? cfg.dir
    : path.join(path.dirname(FILE), 'downloads');
  DIR = base;
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch (e) {
    console.warn('[download] 下载目录不可用:', e.message);
  }
}

function save() {
  try {
    fs.writeFileSync(FILE, JSON.stringify({ config: cfg, items }, null, 2));
  } catch (e) {
    console.warn('[download] 清单落盘失败:', e.message);
  }
}

function saveConfig(input = {}) {
  const next = { ...cfg };
  const prevQuota = next.quotaMb;
  if (typeof input.naming === 'string' && ['name-artist', 'artist-name', 'name'].includes(input.naming)) next.naming = input.naming;
  const q = Number(input.quotaMb);
  if (Number.isFinite(q)) next.quotaMb = Math.min(1024 * 64, Math.max(0, Math.round(q)));
  if (typeof input.withLyric === 'boolean') next.withLyric = input.withLyric;
  if (typeof input.withCover === 'boolean') next.withCover = input.withCover;
  const wasDir = next.dir;
  if (typeof input.dir === 'string' && (!input.dir || path.isAbsolute(input.dir))) next.dir = input.dir;
  cfg = next;
  applyDir();
  if (cfg.dir !== wasDir) moveAll(wasDir, cfg.dir);
  // 把配额调小要立刻见效，而不是等下次下载才发现已经超了
  if (cfg.quotaMb !== prevQuota) prune();
  save();
  return publicConfig();
}

function publicConfig() {
  return { ...cfg, activeDir: DIR };
}

/* ---------------- 文件名 ---------------- */

function safeName(s) {
  return String(s || '').replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '未知曲目';
}

function baseName(track) {
  const name = safeName(track.name);
  const artist = safeName(track.artist || '未知艺人');
  if (cfg.naming === 'name') return name;
  if (cfg.naming === 'artist-name') return `${artist} - ${name}`;
  return `${name} - ${artist}`;
}

/** 同名不覆盖：已有下载记录时补序号，没有记录的同名文件视为「就是这一首」直接复用 */
function uniqueBase(base, ext) {
  let candidate = base;
  for (let i = 1; i < 100; i++) {
    const file = `${candidate}.${ext}`;
    if (!fs.existsSync(path.join(DIR, file))) return candidate;
    if (!findByFile(file)) return candidate; // 不是我们下的文件，交给它自己处理
    candidate = i === 1 ? `${base} (2)` : `${base} (${i + 1})`;
  }
  return `${base} (${Date.now()})`;
}

function findByFile(file) {
  return items.find((it) => it.file === file) || null;
}
function findByTrack(track) {
  const platform = track.platform || 'wy';
  const rid = String(track.remoteId || track.id || '');
  return items.find((it) => it.platform === platform && String(it.remoteId) === rid)
    || items.find((it) => it.name === track.name && it.artist === track.artist);
}

function pruneMissing() {
  const before = items.length;
  items = items.filter((it) => it.file && fs.existsSync(path.join(DIR, it.file)));
  if (items.length !== before) save();
}

/* ---------------- 地址解析 ---------------- */

function isLocalProxy(u) {
  return typeof u === 'string' && (u.startsWith('/api/') || /^https?:\/\/(127\.0\.0\.1|localhost|::1)(:|\/)/i.test(u));
}

/** 渲染层交出的候选地址（同源代理串）→ 真实 http 地址 */
function realUrl(candidate) {
  const u = String(candidate || '');
  if (u.startsWith('/api/proxy?')) {
    try {
      const q = new URLSearchParams(u.slice(u.indexOf('?') + 1));
      return q.get('url') || '';
    } catch (_) { return ''; }
  }
  if (/^https?:\/\//.test(u)) return u;
  return '';
}

/**
 * 依次尝试解析出可下载的 http 地址。
 * 先走服务端成熟的四级取链（质量更好、带缓存），拿不到再用渲染层播放用的地址兜底 ——
 * 后者是离线示例曲库唯一能走通的路径，也是音源取链在生产环境失败的保险。
 */
async function resolveAudio(track, candidates, quality) {
  const platform = track.platform || 'wy';
  const errors = [];
  if (platform === 'wy' && ncm.isReady()) {
    try {
      const u = await ncm.songUrl(track.remoteId || track.id, quality === 'flac' ? 999000 : (Number(quality) || 320) * 1000);
      if (u && u.url) return { url: u.url, ext: u.ext || 'mp3', bitRate: u.bitRate || 0, size: u.size || 0, from: 'ncm' };
      errors.push('网易云未返回地址（可能是付费/无版权）');
    } catch (e) { errors.push(`网易云：${e.message}`); }
  } else if (platform !== 'wy') {
    try {
      const r = await platformUrl.resolvePlatformUrl({
        platform,
        musicInfo: track.musicInfo || {},
        name: track.name,
        artist: track.artist,
        duration: track.duration,
        quality: String(quality || '320'),
        alternatives: Array.isArray(track.sources) ? track.sources : [],
      });
      if (r && r.url) return { url: r.url, ext: r.ext || 'mp3', bitRate: r.bitRate || 0, size: 0, from: r.from || 'platform' };
      errors.push('平台接口未返回地址');
    } catch (e) { errors.push(`平台：${e.message}`); }
  }
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const u = realUrl(c);
    if (!u) continue;
    const ext = (u.match(/\.(mp3|flac|m4a|ogg|wav|aac|opus)(\?|$)/i) || [])[1] || 'mp3';
    return { url: u, ext: ext.toLowerCase(), bitRate: 0, size: 0, from: 'player' };
  }
  const e = new Error(errors.filter(Boolean).join('；') || '没有可用的下载地址');
  e.retryable = true;
  throw e;
}

/* ---------------- 歌词 / 封面 ---------------- */

function pickLyric(r) {
  if (!r) return '';
  if (typeof r === 'string') return r;
  return String(r.lyric || r.lrc || r.raw || '');
}

async function fetchLyric(track) {
  const platform = track.platform || 'wy';
  if (platform === 'wy') {
    if (!ncm.isReady()) return track.lyricText ? String(track.lyricText) : '';
    try {
      const { lrc, tlyric } = await ncm.lyric(track.remoteId || track.id);
      return tlyric ? `${lrc}\n[译文]\n${tlyric}` : lrc;
    } catch (e) {
      return track.lyricText ? String(track.lyricText) : '';
    }
  }
  try {
    const r = await sourceManager.resolveAction({
      sourcePlatform: platform,
      action: 'lyric',
      musicInfo: track.musicInfo || {},
    });
    const text = pickLyric(r);
    if (text.trim()) return text;
  } catch (_) { /* 没音源或音源不支持歌词，退回渲染层已解析的歌词 */ }
  return track.lyricText ? String(track.lyricText) : '';
}

/** 写 LRC 前先剥一次控制字符：歌词里的零宽空格会让某些播放器整行失配 */
function cleanLrc(text) {
  return String(text || '').replace(/[\u200B-\u200D\uFEFF]/g, '').slice(0, 200000);
}

async function fetchCover(url, target) {
  const http = realUrl(url);
  if (!http || !/^https?:\/\//.test(http) || isLocalProxy(http)) return '';
  try {
    const r = await fetch(http, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return '';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 8 * 1024 * 1024) return '';
    fs.writeFileSync(target, buf);
    return path.basename(target);
  } catch (_) {
    return '';
  }
}

/* ---------------- 任务表 ---------------- */

function newTask(track) {
  const t = {
    id: `dl${++seq}`,
    name: String(track.name || '').slice(0, 200),
    artist: String(track.artist || '').slice(0, 200),
    state: 'queued',
    received: 0,
    total: 0,
    at: Date.now(),
    error: '',
    file: '',
    exists: false,
  };
  tasks.unshift(t);
  while (tasks.length > 12) tasks.pop();
  return t;
}

function snapshotTasks() {
  return tasks.map((t) => ({ ...t }));
}

/* ---------------- 下载主体 ---------------- */

/**
 * 下载一首歌。返回 taskId，进度靠 listTasks 轮询；
 * 同一首已在下载中则直接复用（渲染层连点不会排队十个任务）。
 */
function start(track, { candidates = [], quality = '320', overwrite = false } = {}) {
  if (!track || !track.name) {
    const e = new Error('缺少曲目信息');
    e.code = 400;
    throw e;
  }
  const running = tasks.find((t) => (t.state === 'queued' || t.state === 'downloading')
    && t.name === track.name && t.artist === (track.artist || ''));
  if (running && !overwrite) return running.id;
  const hit = findByTrack({ platform: track.platform || 'wy', remoteId: track.id, name: track.name, artist: track.artist || '' });
  if (hit && !overwrite) {
    const reuse = newTask(track);
    reuse.state = 'done';
    reuse.exists = true;
    reuse.file = hit.file;
    reuse.received = hit.size || 0;
    reuse.total = hit.size || 0;
    return reuse.id;
  }
  const task = newTask(track);
  run(task, { ...track, platform: track.platform || 'wy', remoteId: track.id }, candidates, quality).catch((e) => {
    if (e && e.canceled) { task.state = 'canceled'; task.error = '已取消'; return; }
    task.state = 'error';
    task.error = String((e && e.message) || e).slice(0, 200);
    task.retryable = !!(e && e.retryable);
  });
  return task.id;
}

async function run(task, track, candidates, quality) {
  task.state = 'downloading';
  const audio = await resolveAudio(track, candidates, quality);
  const ext = AUDIO_EXT.has(audio.ext) ? audio.ext : 'mp3';
  const base = uniqueBase(baseName(track), ext);
  const file = `${base}.${ext}`;
  const target = path.join(DIR, file);
  const tmp = path.join(DIR, `.${task.id}.part`);
  task.file = file;

  let res;
  const controller = new AbortController();
  task.signal = controller.signal;
  task.abort = () => controller.abort();
  try {
    res = await fetch(audio.url, {
      // 大文件可能走很久：signal 负责「取消」，超时负责「上游挂死」，两者叠加
      signal: AbortSignal.any
        ? AbortSignal.any([controller.signal, AbortSignal.timeout(FETCH_TIMEOUT)])
        : controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
    const ct = String(res.headers.get('content-type') || '');
    // 上游把错误页当音频返回（登录页/限流页）时不能落盘，否则得到一首"损坏的本地歌曲"
    if (/text\/html|application\/json/i.test(ct)) throw new Error('上游返回的不是音频');
    task.total = Number(res.headers.get('content-length') || audio.size || 0) || 0;
    task.retryable = false;

    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      const nodeStream = require('stream').Readable.fromWeb(res.body);
      nodeStream.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      nodeStream.on('data', (chunk) => {
        if (controller.signal.aborted) { nodeStream.destroy(new Error('aborted')); return; }
        task.received += chunk.length;
      });
      nodeStream.pipe(out);
    });
    const st = fs.statSync(tmp);
    // 试听占位与极小文件一律丢弃（酷我 181521 字节的占位就是这个坑）
    if (st.size < 64 * 1024) throw new Error('下载内容过小，判定为试听占位');
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.existsSync(tmp) && fs.unlinkSync(tmp); } catch (_) { /* 残留清理失败不影响报错 */ }
    // fetch 被 abort 时抛的是无 message 的 AbortError，直接显示会变成「下载失败：」
    if (controller.signal.aborted || (e && e.name === 'AbortError')) {
      const c = new Error('已取消');
      c.canceled = true;
      throw c;
    }
    throw e;
  }

  const entry = {
    id: 'dl_' + base.replace(/\s/g, '_'),
    libraryId: '',
    name: String(track.name || base),
    artist: String(track.artist || ''),
    album: String(track.album || ''),
    platform: track.platform || 'wy',
    remoteId: String(track.remoteId || track.id || ''),
    file,
    lrc: '',
    pic: '',
    size: fs.statSync(target).size,
    duration: Number(track.duration || 0) || 0,
    bitRate: audio.bitRate || 0,
    at: Date.now(),
  };

  if (cfg.withLyric) {
    try {
      const text = cleanLrc(await fetchLyric(track));
      if (text.trim()) {
        const lrcFile = `${base}.lrc`;
        fs.writeFileSync(path.join(DIR, lrcFile), text, 'utf8');
        entry.lrc = lrcFile;
      }
    } catch (_) { /* 歌词缺失不阻塞下载成功 */ }
  }
  if (cfg.withCover && track.albumPic) {
    entry.pic = await fetchCover(track.albumPic, path.join(DIR, `${base}.jpg`)) || '';
  }

  const added = library.addPaths([target], {
    duration: entry.duration,
    name: entry.name,
    artist: entry.artist,
    album: entry.album,
    downloaded: true,
    // 附属文件在不在，渲染层据此决定要不要请求 /api/download/{lyric,pic}：
    // 无条件请求会让每首下载曲在控制台留下两个 404
    hasLyric: !!entry.lrc,
    hasCover: !!entry.pic,
    lyricId: entry.platform === 'wy' ? entry.remoteId : '',
    lyricText: entry.lrc ? '' : (track.lyricText || ''),
    remote: { platform: entry.platform, id: entry.remoteId },
  });
  entry.libraryId = (added.added && added.added[0] && added.added[0].id) || '';
  if (!entry.libraryId) {
    const existed = library.list().find((x) => x.url && x.name === entry.name);
    entry.libraryId = existed ? existed.id : '';
  }

  items = items.filter((it) => !(it.platform === entry.platform && String(it.remoteId) === String(entry.remoteId) && it.file !== entry.file));
  items.unshift(entry);
  save();
  const removed = prune();
  task.state = 'done';
  task.received = entry.size;
  task.total = entry.size;
  task.item = { id: entry.libraryId, file: entry.file };
  return { task, entry, removed };
}

/** 超出配额时按下载时间从早到晚删除（只删下载目录里我们自己登记的文件） */
function prune() {
  if (!cfg.quotaMb) return [];
  const limit = cfg.quotaMb * 1024 * 1024;
  let total = items.reduce((s, it) => s + (Number(it.size) || 0), 0);
  const removed = [];
  const byOld = [...items].sort((a, b) => (a.at || 0) - (b.at || 0));
  for (const it of byOld) {
    if (total <= limit) break;
    if (drop(it)) { total -= Number(it.size) || 0; removed.push(it.name || it.file); }
  }
  return removed;
}

function drop(it) {
  for (const f of [it.file, it.lrc, it.pic]) {
    if (!f) continue;
    try {
      const p = path.join(DIR, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) {
      console.warn('[download] 删除文件失败:', f, e.message);
    }
  }
  items = items.filter((x) => x !== it);
  if (it.libraryId) library.remove(it.libraryId);
  save();
  return true;
}

function remove(id) {
  const it = items.find((x) => x.id === id || x.libraryId === id);
  if (!it) return false;
  drop(it);
  return true;
}

function cancel(taskId) {
  const t = tasks.find((x) => x.id === taskId);
  if (!t || (t.state !== 'queued' && t.state !== 'downloading')) return false;
  t.state = 'canceled';
  t.error = '已取消';
  try { if (t.abort) t.abort(); } catch (_) { /* ignore */ }
  return true;
}

function clearDone() {
  tasks = tasks.filter((t) => t.state === 'queued' || t.state === 'downloading');
  return tasks.length;
}

/** 迁移下载目录：文件跟着走，清单里的相对名不变，只改 cfg.dir */
function moveAll(fromDir, toDir) {
  if (!fromDir || !toDir || fromDir === toDir) return 0;
  let moved = 0;
  applyDir();
  for (const it of items) {
    for (const f of [it.file, it.lrc, it.pic]) {
      if (!f) continue;
      const src = path.join(fromDir, f);
      const dst = path.join(DIR, f);
      try {
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.renameSync(src, dst);
          moved++;
        }
      } catch (e) {
        console.warn('[download] 迁移失败:', f, e.message);
      }
    }
  }
  // 已登记到本地曲库的绝对路径要一起改，否则离线播放会指向旧位置
  for (const it of items) {
    if (!it.libraryId) continue;
    const abs = path.join(DIR, it.file);
    try {
      if (fs.existsSync(abs)) library.addPaths([abs], {
        downloaded: true, duration: it.duration, name: it.name, artist: it.artist,
        hasLyric: !!it.lrc, hasCover: !!it.pic,
      });
    } catch (_) { /* 重新登记失败时下次启动仍会自愈 */ }
  }
  pruneMissing();
  save();
  return moved;
}

/** 供 /api/download/lyric、/api/download/pic 按曲库 id 回读本地附属文件 */
function attachments(libraryId) {
  const it = items.find((x) => x.libraryId === libraryId || x.id === libraryId);
  if (!it) return null;
  return { lrc: it.lrc ? path.join(DIR, it.lrc) : '', pic: it.pic ? path.join(DIR, it.pic) : '', entry: it };
}

function list() {
  pruneMissing();
  const total = items.reduce((s, it) => s + (Number(it.size) || 0), 0);
  return {
    config: publicConfig(),
    count: items.length,
    bytes: total,
    // 只给文件名与曲库 id：绝对路径不出后端
    items: items.map((it) => ({
      id: it.libraryId || it.id,
      // 与渲染层 trackKey 同构的平台+原始 id，前端据此标「已下载」
      key: `${it.platform}:${it.remoteId}`,
      name: it.name,
      artist: it.artist,
      platform: it.platform,
      file: it.file,
      size: it.size,
      duration: it.duration,
      hasLyric: !!it.lrc,
      hasCover: !!it.pic,
      at: it.at,
    })),
    tasks: snapshotTasks(),
  };
}

function isDownloaded(track) {
  if (!track) return false;
  return !!findByTrack({ platform: track.platform || 'wy', remoteId: track.id, name: track.name, artist: track.artist || '' });
}

module.exports = {
  init, saveConfig, publicConfig, list, start, cancel, clearDone, remove, prune,
  attachments, isDownloaded, dir: () => DIR,
  __test: { baseName, safeName, realUrl, resolveAudio, cleanLrc, uniqueBase },
};
