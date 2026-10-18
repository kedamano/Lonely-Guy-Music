// API 客户端：同源 /api/*（在线反代网易云 / 离线内置示例 / 音源系统），结构对渲染层透明
const BASE = '/api';
const TIMEOUT = 15000;

/* ---------------- 读缓存 ----------------
 * 页面来回切换（发现 ↔ 音乐馆 ↔ 歌单）时同一份数据会被反复请求，
 * 每次都要走一趟网易云，点击就变成「等一两秒」。这里做两层：
 *   1. TTL 内直接命中内存，点击瞬间出内容；
 *   2. 同一 key 并发请求只发一次（in-flight 合并），避免连点重复打接口。
 * 写操作（收藏/订阅/登录/音源变更）会清空相关缓存，见 invalidate()。
 */
const CACHE_TTL = 60 * 1000;
const CACHE_MAX = 40; // 歌单曲目列表较大，限制条目数避免吃内存
const cache = new Map();
const inflight = new Map();

function invalidate(prefix = '') {
  if (!prefix) { cache.clear(); return; }
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

function memo(key, fn, ttl = CACHE_TTL) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttl) {
    return Promise.resolve(hit.data);
  }
  if (inflight.has(key)) return inflight.get(key);
  const p = fn()
    .then((data) => {
      inflight.delete(key);
      cache.set(key, { at: Date.now(), data });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); // 超限淘汰最早写入
      return data;
    })
    .catch((e) => { inflight.delete(key); throw e; });
  inflight.set(key, p);
  return p;
}

function signal(extra, timeout = TIMEOUT) {
  const list = [];
  try { list.push(AbortSignal.timeout(timeout)); } catch (_) { /* 老内核无 timeout */ }
  if (extra) list.push(extra);
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(list);
  // 兼容：手动把外部取消桥接到内部控制器
  const ctrl = new AbortController();
  for (const s of list) {
    if (s.aborted) { ctrl.abort(s.reason); break; }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

async function request(path, params, opts = {}) {
  const qs = params ? '?' + new URLSearchParams(params) : '';
  const res = await fetch(BASE + path + qs, { signal: signal(opts.signal, opts.timeout || TIMEOUT) });
  const mode = res.headers.get('X-Api-Mode');
  if (mode) api.lastMode = mode;
  if (!res.ok) {
    // 专用路由（账号/曲库）出错时回 { code, msg }，网易云透传则未必是 JSON
    const j = await res.json().catch(() => null);
    throw new Error((j && j.msg) || 'HTTP ' + res.status);
  }
  return res.json();
}

// 专用路由统一返回 { code, data }，透传路由直接返回网易云响应体
const dataOf = (p) => p.then((r) => (r && Object.prototype.hasOwnProperty.call(r, 'data') ? r.data : r));

async function post(path, body, timeout = TIMEOUT) {
  const opts = typeof timeout === 'number' ? { timeout } : (timeout || {});
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal(opts.signal, opts.timeout || TIMEOUT),
  });
  const j = await res.json().catch(() => ({ code: res.status, msg: 'invalid response' }));
  if (j.code !== 0) throw new Error(j.msg || 'API error');
  return j.data;
}

export const api = {
  lastMode: 'offline',
  /** 清空读缓存：登录态切换、订阅/收藏变化、音源变更后调用 */
  invalidate,
  _hasSources: null,
  _hasSourcesAt: 0,
  invalidateSources() {
    this._hasSources = null;
    this._hasSourcesAt = 0;
    // 通知搜索页刷新平台可用性（汽水是否可搜取决于音源能力）
    try { window.dispatchEvent(new CustomEvent('guman:sources-changed')); } catch (_) { /* ignore */ }
  },
  async hasEnabledSources() {
    // 缓存 10s，避免每首歌都探测；音源可能仍在异步初始化，因此不做长期缓存
    if (this._hasSources !== null && Date.now() - this._hasSourcesAt < 10000) return this._hasSources;
    try {
      const r = await request('/sources');
      this._hasSources = (r.data || []).some((s) => s.enabled && s.inited && !s.error);
      this._hasSourcesAt = Date.now();
    } catch (_) {
      this._hasSources = false;
    }
    return this._hasSources;
  },
  async mode() {
    try {
      const r = await fetch(BASE + '/__mode', { signal: signal() });
      const j = await r.json();
      this.lastMode = j.online ? 'online' : 'offline';
      return j;
    } catch { return { online: false }; }
  },
  personalized: () => memo('personalized', () => request('/personalized')),
  // 音乐馆：offset 用于服务端分页（total 在返回里，前端算页数）
  topPlaylists: (cat = '全部', limit = 30, offset = 0) =>
    memo(`top:${cat}:${limit}:${offset}`, () => request('/top/playlist', { cat, limit, offset })),
  playlistDetail: (id) => memo('pldetail:' + id, () => request('/playlist/detail', { id })),
  playlistTracks: (id) => memo('pltracks:' + id, () => request('/playlist/track/all', { id }), 5 * 60 * 1000),
  // 搜索：offset 用于服务端分页（歌曲/歌单总数在 result.songCount / playlistCount）
  // 搜索不做前端 memo：后端已有 5 分钟缓存，且输入时应始终拿到最新结果/支持 abort
  search: (keywords, type = 1, limit = 30, offset = 0, opts = {}) =>
    request('/search', { keywords, type, limit, offset }, opts),
  // 多平台搜索：直接按平台检索（wy 走上面，tx/kg/kw/mg 走这里）
  platformList: () => dataOf(request('/platform/list')),
  platformSearch: (platform, keywords, page = 1, limit = 30, opts = {}) =>
    dataOf(request('/platform/search', { platform, keywords, page, limit }, opts)),
  // 聚合搜索：多平台合并为一首一行，带 sources[] 备选
  platformSearchAll: (keywords, page = 1, limit = 30, sources = '', opts = {}) =>
    dataOf(request('/platform/search-all', {
      keywords, page, limit, ...(sources ? { sources } : {}),
    }, opts)),
  // 备选来源（换源播放）：按歌名 + 歌手跨平台召回
  platformAlternatives: (payload) => post('/platform/alternatives', payload, 20000),
  // 平台原生取链（酷狗匿名直链 / QQ 登录态或跨平台兜底）
  platformUrl: (payload) => post('/platform/url', payload, 30000),
  platformHealth: () => dataOf(request('/platform/health')),
  // 后端内存缓存（封面 LRU / 取链缓存）：设置页存储区展示与清理
  cacheStats: () => dataOf(request('/cache/stats')),
  clearCache: () => post('/cache/clear', {}),
  songUrl: (id) => request('/song/url', { id }),
  lyric: (id) => memo('lyric:' + id, () => request('/lyric', { id }), 10 * 60 * 1000),
  // 歌词译文兜底：key 只存后端，渲染层拿不到
  translateState: () => dataOf(request('/translate/state')),
  translateSave: (payload) => post('/translate/config', payload),
  // 歌词译文兜底：网易云没给 tlyric 时才按需调用（服务端按 歌曲+原文+目标语言 缓存）
  translate: (id, lines, to = 'zh') => post('/translate', { id, lines, to }, 30000),
  songDetail: (ids) => request('/song/detail', { ids: Array.isArray(ids) ? ids.join(',') : ids }),
  album: (id) => memo('album:' + id, () => request('/album', { id })),
  artistTop: (id) => memo('artist:' + id, () => request('/artists', { id })),
  recommendSongs: () => memo('rec:songs', () => request('/recommend/songs')),
  recommendResource: () => memo('rec:resource', () => request('/recommend/resource')),
  personalizedNewsong: () => memo('rec:newsong', () => request('/personalized/newsong')),
  // 歌单订阅（收藏）：t=1 收藏，t=0 取消；需登录 cookie（由后端注入）
  // 订阅状态写在歌单详情里，成功后要让它和个性化推荐的缓存失效
  subscribePlaylist: (id, t = 1) => request('/playlist/subscribe', { id, t })
    .then((r) => { invalidate('pldetail:' + id); invalidate('personalized'); return r; }),
  // 账号下的歌单：subscribed=false 是我创建的，true 是我收藏的别人的。
  // 早先用 /playlist/subs，该路由在当前 NeteaseCloudMusicApi 版本上是 404，云端区块一直静默空掉。
  userPlaylists: (uid, limit = 100) => request('/user/playlist', { uid, limit, offset: 0 }),
  // 听歌记录回写：喂给网易云，云端每日推荐才会跟着本地收听走
  scrobble: (id, time, sourceid) => request('/scrobble', { id, time, sourceid: sourceid || id }),

  // 账号：凭证保存在后端 userData，渲染层只拿到昵称/头像，拿不到 cookie
  accountState: () => dataOf(request('/account/state')),
  qrStart: () => dataOf(request('/account/qr/start')),
  qrCheck: (key) => dataOf(request('/account/qr/check', { key })),
  sendCaptcha: (phone) => post('/account/captcha', { phone }),
  loginCellphone: (phone, captcha) => post('/account/login/cellphone', { phone, captcha }, 25000),
  loginEmail: (email, password) => post('/account/login/email', { email, password }, 25000),
  accountRefresh: () => post('/account/refresh', {}),
  logout: () => post('/account/logout', {}),
  // 云端歌单：uid 来自登录态；/likelist 只返回 id 列表
  likeList: (uid) => request('/likelist', { uid }),

  // 本地曲库（跨会话：后端按绝对路径登记，播放走 /api/local?id=）
  library: () => dataOf(request('/library')),
  libAdd: (paths) => post('/library/add', { paths }),
  libScan: (dir) => post('/library/scan', { dir }, 30000),
  libRemove: (id) => post('/library/remove', { id }),
  libMeta: (payload) => post('/library/meta', payload),

  // 音源系统
  sources: () => request('/sources').then((r) => ({ list: r.data, config: r.config })),
  loadSource: (opts) => post('/sources/load', opts, 30000),
  toggleSource: (id, enabled) => post('/sources/toggle', { id, enabled }),
  removeSource: (id) => post('/sources/remove', { id }),
  setQuality: (quality) => post('/sources/quality', { quality }),
  setProxy: (proxy) => post('/sources/proxy', { proxy }),
  resolveMusicUrl: (sourcePlatform, musicInfo, quality, sourceId) =>
    post('/sources/resolve', { sourcePlatform, musicInfo, quality, sourceId }, 20000),
  // 音源歌词：非网易云平台（tx/kg）拿不到网易云歌词接口，交给音源脚本解析
  sourceLyric: (sourcePlatform, musicInfo, sourceId) =>
    post('/sources/action', { sourcePlatform, action: 'lyric', musicInfo, sourceId }, 20000),
};

// 归一化：歌单对象 → 统一字段。
// 注意不同接口封面字段名不同：/personalized 用 picUrl，/top/playlist 与搜索歌单用 coverImgUrl，
// 早年只读 picUrl 导致音乐馆/歌单搜索封面全部走占位图——这里统一收敛。
export function normalizePlaylist(p) {
  if (!p) return p;
  return {
    id: p.id,
    name: p.name || '未命名歌单',
    picUrl: p.picUrl || p.coverImgUrl || '',
    playCount: p.playCount,
    creator: p.creator,
  };
}

// 归一化：网易云曲目 → 统一曲目对象
export function normalizeTrack(t) {
  const artists = (t.ar || t.artists || []).map((a) => a.name).join('/') || '未知艺人';
  const album = (t.al && t.al.name) || (t.album && t.album.name) || '';
  // 封面回退链：专辑图 → 艺人图（网易云部分歌曲无专辑封面字段）
  const albumPic = (t.al && t.al.picUrl) || (t.album && t.album.picUrl)
    || (t.ar && t.ar[0] && t.ar[0].picUrl)
    || (t.artists && t.artists[0] && t.artists[0].img1v1Url) || '';
  return {
    id: String(t.id),
    name: t.name || '未知曲目',
    artist: artists,
    album,
    albumPic,
    duration: t.dt || t.duration || 0,
    source: 'online',
  };
}

export function formatCount(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}
