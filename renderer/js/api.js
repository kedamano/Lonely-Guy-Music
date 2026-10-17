// API 客户端：同源 /api/*（在线反代网易云 / 离线内置示例 / 音源系统），结构对渲染层透明
const BASE = '/api';
const TIMEOUT = 15000;

function signal() {
  try { return AbortSignal.timeout(TIMEOUT); } catch (_) { return undefined; }
}

async function request(path, params) {
  const qs = params ? '?' + new URLSearchParams(params) : '';
  const res = await fetch(BASE + path + qs, { signal: signal() });
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
  let sig;
  try { sig = AbortSignal.timeout(timeout); } catch (_) { sig = undefined; }
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: sig,
  });
  const j = await res.json().catch(() => ({ code: res.status, msg: 'invalid response' }));
  if (j.code !== 0) throw new Error(j.msg || 'API error');
  return j.data;
}

export const api = {
  lastMode: 'offline',
  _hasSources: null,
  _hasSourcesAt: 0,
  invalidateSources() { this._hasSources = null; this._hasSourcesAt = 0; },
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
  personalized: () => request('/personalized'),
  // 音乐馆：offset 用于服务端分页（total 在返回里，前端算页数）
  topPlaylists: (cat = '全部', limit = 30, offset = 0) => request('/top/playlist', { cat, limit, offset }),
  playlistDetail: (id) => request('/playlist/detail', { id }),
  playlistTracks: (id) => request('/playlist/track/all', { id }),
  // 搜索：offset 用于服务端分页（歌曲/歌单总数在 result.songCount / playlistCount）
  search: (keywords, type = 1, limit = 30, offset = 0) => request('/search', { keywords, type, limit, offset }),
  songUrl: (id) => request('/song/url', { id }),
  lyric: (id) => request('/lyric', { id }),
  // 歌词译文兜底：key 只存后端，渲染层拿不到
  translateState: () => dataOf(request('/translate/state')),
  translateSave: (payload) => post('/translate/config', payload),
  // 歌词译文兜底：网易云没给 tlyric 时才按需调用（服务端按 歌曲+原文+目标语言 缓存）
  translate: (id, lines, to = 'zh') => post('/translate', { id, lines, to }, 30000),
  songDetail: (id) => request('/song/detail', { id }),
  album: (id) => request('/album', { id }),
  artistTop: (id) => request('/artists', { id }),
  recommendSongs: () => request('/recommend/songs'),
  recommendResource: () => request('/recommend/resource'),
  personalizedNewsong: () => request('/personalized/newsong'),
  // 歌单订阅（收藏）：t=1 收藏，t=0 取消；需登录 cookie（由后端注入）
  subscribePlaylist: (id, t = 1) => request('/playlist/subscribe', { id, t }),
  // 账号下的歌单：subscribed=false 是我创建的，true 是我收藏的别人的。
  // 早先用 /playlist/subs，该路由在当前 NeteaseCloudMusicApi 版本上是 404，云端区块一直静默空掉。
  userPlaylists: (uid, limit = 100) => request('/user/playlist', { uid, limit, offset: 0 }),
  // 听歌记录回写：喂给网易云，云端每日推荐才会跟着本地收听走
  scrobble: (id, time, sourceid) => request('/scrobble', { id, time, sourceid: sourceid || id }),

  // 账号：凭证保存在后端 userData，渲染层只拿到昵称/头像，拿不到 cookie
  accountState: () => dataOf(request('/account/state')),
  qrStart: () => dataOf(request('/account/qr/start')),
  qrCheck: (key) => dataOf(request('/account/qr/check', { key })),
  accountRefresh: () => post('/account/refresh', {}),
  logout: () => post('/account/logout', {}),

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
