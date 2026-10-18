'use strict';
/**
 * 酷我音乐适配器。
 *
 * 搜索：search.kuwo.cn/r.s 返回「伪 JSON」（单引号、无引号键、HTML 实体），
 *       由 loose-json 安全解析；`correct=1&vipver=1` 必须带，否则排序会把 KTV/伴奏顶到前面。
 * 取链：antiserver.kuwo.cn/anti.s 匿名可用，但原曲/VIP 可能返回
 *       181,521 字节的 11 秒试听占位，交给 audio-probe 统一识别。
 */
const { cleanText } = require('../song-utils');
const { parseLooseJson } = require('../loose-json');
const { DESKTOP_UA } = require('./http');
const { requestAsync } = require('../source-manager');

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return obj[k];
  }
  return '';
}

function parseFormats(raw) {
  const s = String(raw || '').toLowerCase();
  const hints = {};
  if (/flac|ape|wav/.test(s)) hints.flac = 1;
  if (/320|mp3h/.test(s)) hints['320'] = 1;
  if (/128|mp3|aac|m4a/.test(s)) hints['128'] = 1;
  return hints;
}

/** 酷我封面：hts_MVPIC 偶为空，web_albumpic_short 是相对路径 */
function albumPicOf(x) {
  const full = String(pick(x, 'hts_MVPIC', 'MVPIC', 'pic') || '');
  if (/^https?:\/\//i.test(full)) return full;
  let rel = String(pick(x, 'web_albumpic_short', 'web_albumpic', 'PICPATH') || '').trim();
  if (!rel) return full;
  if (/^https?:\/\//i.test(rel)) return rel;
  rel = rel.replace(/^\/+/, '').replace(/^120\//, '500/');
  return `https://img4.kuwo.cn/star/albumcover/${rel}`;
}

function mapSong(x) {
  const rid = String(pick(x, 'MUSICRID', 'musicrid', 'RID', 'rid')).replace(/^MUSIC_/i, '');
  const name = cleanText(pick(x, 'NAME', 'SONGNAME', 'name', 'songname'));
  const artist = cleanText(pick(x, 'ARTIST', 'SINGER', 'artist', 'singer'));
  const album = cleanText(pick(x, 'ALBUM', 'album'));
  const sec = Number(pick(x, 'DURATION', 'duration') || 0) || 0;
  const pic = albumPicOf(x);
  // 酷我的 PAY 是 DRM 位掩码（几乎每首都有值），fpay=1 才代表付费曲目
  const vip = String(pick(x, 'fpay', 'FPAY') || '') === '1';

  return {
    id: `kw:${rid}`,
    platform: 'kw',
    platformId: rid,
    name: name || '未知曲目',
    artist: artist || '未知艺人',
    album,
    albumPic: pic,
    duration: sec * 1000,
    playable: !!rid,
    vip,
    qualityHints: parseFormats(pick(x, 'FORMATS', 'formats')),
    musicInfo: {
      rid,
      MUSICRID: rid ? `MUSIC_${rid}` : '',
      name,
      singer: artist,
      albumName: album,
      interval: sec,
      img: pic,
    },
  };
}

async function search(keyword, page = 1, limit = 30) {
  const url = 'https://search.kuwo.cn/r.s'
    + `?all=${encodeURIComponent(keyword)}&ft=music&itemset=web_2013&client=kt`
    + `&pn=${page}&rn=${limit}&rformat=json&encoding=utf8&correct=1&vipver=1`;
  const r = await requestAsync(url, {
    timeout: 12000,
    headers: {
      'User-Agent': DESKTOP_UA,
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://www.kuwo.cn/',
    },
  });
  if (r.statusCode >= 400) throw new Error(`酷我返回 HTTP ${r.statusCode}`);
  const parsed = parseLooseJson(r.raw ? r.raw.toString('utf8') : r.body);
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed.abslist || parsed.list || (parsed.data && parsed.data.list) || []);
  if (!Array.isArray(arr)) throw new Error('酷我搜索返回结构异常');

  const list = arr.map(mapSong).filter((t) => t.name && t.platformId);
  const total = Number((parsed && (parsed.TOTAL || parsed.total)) || 0) || 0;
  return {
    list,
    total: total || page * limit + (list.length >= limit ? limit : 0),
    hasMore: total > 0 ? page * limit < total : list.length >= limit,
  };
}

// ============== 原生取链 ==============

/** anti.s 返回纯 URL 或 JSON，统一取出地址 */
function extractUrl(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s.split(/\s+/)[0];
  try {
    const j = JSON.parse(s);
    if (typeof j === 'string') return j;
    if (j && typeof j.url === 'string') return j.url;
    if (j && j.data && typeof j.data.url === 'string') return j.data.url;
  } catch (_) { /* 不是 JSON，继续按 url= 解析 */ }
  const m = /(?:^|[?&])url=([^&\s]+)/i.exec(s);
  return m ? decodeURIComponent(m[1]) : '';
}

async function resolve(musicInfo = {}, quality = '320') {
  const rid = String(musicInfo.rid || musicInfo.MUSICRID || '')
    .replace(/^MUSIC_/i, '');
  if (!rid) throw new Error('酷我取链缺少 rid');

  const url = `https://antiserver.kuwo.cn/anti.s?type=convert_url&format=mp3&response=url&rid=MUSIC_${encodeURIComponent(rid)}`;
  const r = await requestAsync(url, {
    timeout: 12000,
    headers: {
      'User-Agent': DESKTOP_UA,
      Accept: '*/*',
      Referer: 'https://www.kuwo.cn/',
    },
  });
  if (r.statusCode >= 400) throw new Error(`酷我取链返回 HTTP ${r.statusCode}`);
  const playUrl = extractUrl(r.raw ? r.raw.toString('utf8') : r.body);
  if (!playUrl) {
    const e = new Error('酷我未返回播放地址（该曲可能是付费/无版权曲目）');
    e.soft = true;
    throw e;
  }
  return {
    url: playUrl,
    bitRate: quality === '128' ? 128 : 128, // anti.s 只给 mp3，实际码率由 probe 校验
    ext: 'mp3',
    duration: 0,
    from: 'kuwo-native',
    matched: null,
  };
}

module.exports = {
  key: 'kw',
  search,
  resolve,
  __test: { mapSong, parseFormats, extractUrl, albumPicOf },
};
