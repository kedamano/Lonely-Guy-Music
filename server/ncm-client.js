'use strict';
/**
 * 本地 NeteaseCloudMusicApi（NCM）封装，供跨源兜底链使用。
 *
 * 组合根 server/index.js 在 NCM 就绪/换端口时注入 base 与开关，
 * 本模块不反向 require index.js（避免循环依赖）。
 *
 * 只使用全局 fetch；Cookie 由账号模块提供，绝不打印或写入日志。
 */

let base = '';
let enabled = false;
let cookieProvider = null;

function normalizeBase(v) {
  return String(v || '').replace(/\/+$/, '');
}

function setNcmBase(v) {
  base = normalizeBase(v);
}

function setNcmEnabled(v) {
  enabled = !!v;
}

function setCookieProvider(fn) {
  cookieProvider = typeof fn === 'function' ? fn : null;
}

function isReady() {
  return enabled && !!base;
}

function cookieHeader() {
  if (!cookieProvider) return '';
  try {
    return String(cookieProvider() || '');
  } catch (_) {
    return '';
  }
}

async function getJson(pathAndQuery, { timeout = 8000 } = {}) {
  if (!isReady()) {
    const e = new Error('网易云 API 不可用（离线模式）');
    e.soft = true;
    throw e;
  }
  const headers = { Accept: 'application/json' };
  const cookie = cookieHeader();
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(`${base}${pathAndQuery}`, {
    headers,
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`网易云 API 返回 HTTP ${r.status}`);
  return r.json();
}

/**
 * 搜索歌曲。
 * @returns {Promise<Array<{id,name,artist,album,albumPic,duration,vip}>>}
 */
async function searchSongs(keyword, limit = 10, offset = 0) {
  const j = await getJson(`/search?keywords=${encodeURIComponent(keyword)}&limit=${limit}&offset=${offset}&type=1`);
  const songs = (j && j.result && j.result.songs) || [];
  return songs.map((s) => {
    const ar = s.ar || s.artists || [];
    const al = s.al || s.album || {};
    return {
      id: String(s.id || ''),
      name: String(s.name || ''),
      artist: ar.map((a) => a && a.name).filter(Boolean).join('/'),
      album: String(al.name || ''),
      albumPic: String(al.picUrl || ''),
      duration: Number(s.dt || s.duration || 0) || 0,
      vip: Number(s.fee || 0) === 1,
    };
  }).filter((s) => s.id && s.name);
}

/**
 * 获取匿名/登录态播放地址。
 * 匿名请求通常只能拿到 128k；返回 null 表示无版权/需要付费。
 */
async function songUrl(id, br = 128000) {
  const j = await getJson(`/song/url?id=${encodeURIComponent(id)}&br=${encodeURIComponent(br)}`);
  const d = j && j.data && j.data[0];
  if (!d || !d.url) return null;
  return {
    url: String(d.url),
    bitRate: Number(d.br ? d.br / 1000 : (br / 1000)) || 128,
    ext: String(d.type || 'mp3').toLowerCase(),
    duration: Number(d.time || 0) || 0,
    size: Number(d.size || 0) || 0,
  };
}

module.exports = {
  setNcmBase,
  setNcmEnabled,
  setCookieProvider,
  isReady,
  searchSongs,
  songUrl,
};
