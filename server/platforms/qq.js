'use strict';
/**
 * QQ 音乐适配器。
 *
 * 搜索：官方匿名接口 `c.y.qq.com/soso/fcgi-bin/client_search_cp`（new_json=1），
 *       返回真实总数、media_mid、付费标记与三档文件大小；失败时降级到 vkeys 公共 API。
 * 取链：vkey 与 uin+qm_keyst 强绑定，必须登录态；没有登录态时由上层走跨源兜底链。
 */
const { cleanText } = require('../song-utils');
const { getJson, postJson, toMs, DESKTOP_UA } = require('./http');

const SOURCE_OFFICIAL = 'qq-official';
const SOURCE_VKEYS = 'qq-vkeys';

function albumPic(albumMid) {
  return albumMid ? `https://y.gtimg.cn/music/photo_new/T002R480x480M000${albumMid}.jpg` : '';
}

function qualityHintsFrom(x) {
  const hints = {};
  const size128 = Number(x.size128 || (x.file && x.file.size_128mp3) || 0);
  const size320 = Number(x.size320 || (x.file && x.file.size_320mp3) || 0);
  const sizeFlac = Number(x.sizeflac || (x.file && x.file.size_flac) || 0);
  if (size128 > 0) hints['128'] = size128;
  if (size320 > 0) hints['320'] = size320;
  if (sizeFlac > 0) hints.flac = sizeFlac;
  return hints;
}

/** 官方搜索单条 → 统一曲目 */
function mapOfficial(x) {
  const mid = String(x.songmid || x.mid || '');
  const mediaMid = String(x.media_mid || (x.file && x.file.media_mid) || mid);
  const albumMid = String(x.albummid || (x.album && x.album.mid) || '');
  const singer = Array.isArray(x.singer)
    ? x.singer.map((a) => a && a.name).filter(Boolean).join('/')
    : String(x.singer || '');
  const name = cleanText(x.songname || x.title || x.name || '');
  const album = cleanText(x.albumname || (x.album && x.album.name) || '');
  const interval = Number(x.interval || 0);
  const payplay = Number((x.pay && x.pay.payplay) || x.payplay || 0);
  const pic = albumPic(albumMid);

  return {
    id: `tx:${mid}`,
    platform: 'tx',
    platformId: mid,
    name: name || '未知曲目',
    artist: singer || '未知艺人',
    album,
    albumPic: pic,
    duration: interval * 1000,
    playable: !!mid,
    vip: payplay > 0,
    sourceApi: SOURCE_OFFICIAL,
    qualityHints: qualityHintsFrom(x),
    musicInfo: {
      songmid: mid,
      media_mid: mediaMid,
      songId: String(x.songid || x.id || ''),
      name,
      singer,
      albumName: album,
      interval,
      img: pic,
    },
  };
}

/** 官方接口搜索 */
async function searchOfficial(keyword, page, limit) {
  const url = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp'
    + `?format=json&w=${encodeURIComponent(keyword)}&p=${page}&n=${limit}`
    + '&t=0&aggr=1&cr=1&catZhida=1&lossless=0&flag_qc=0&platform=yqq.json';
  const j = await getJson(url, {
    headers: { Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com' },
  });
  const d = j && j.data && j.data.song;
  if (!d || !Array.isArray(d.list)) throw new Error((j && (j.message || j.msg)) || 'QQ 音乐搜索失败');
  const list = d.list.map(mapOfficial).filter((t) => t.name && t.platformId);
  const total = Number(d.totalnum || 0);
  return {
    list,
    total: total || page * limit + (list.length >= limit ? limit : 0),
    hasMore: total > 0 ? page * limit < total : list.length >= limit,
    sourceApi: SOURCE_OFFICIAL,
  };
}

/** vkeys 公共 API 降级搜索（无 media_mid/付费标记，质量以字段是否存在为准） */
async function searchVkeys(keyword, page, limit) {
  const url = `https://api.vkeys.cn/v2/music/tencent?word=${encodeURIComponent(keyword)}&num=${limit}&page=${page}`;
  const j = await getJson(url);
  if (Number(j.code) !== 200 || !Array.isArray(j.data)) {
    throw new Error(j.message || j.msg || 'QQ 音乐搜索失败（vkeys）');
  }
  const list = j.data
    .map((x) => {
      const mid = String(x.mid || '');
      const singer = Array.isArray(x.singer_list) && x.singer_list.length
        ? x.singer_list.map((a) => a && a.name).filter(Boolean).join('/')
        : String(x.singer || '');
      const name = cleanText(x.song || x.name || '');
      const interval = Math.round(toMs(x.interval) / 1000);
      const pic = String(x.cover || '');
      return {
        id: `tx:${mid || x.id}`,
        platform: 'tx',
        platformId: mid || String(x.id || ''),
        name: name || '未知曲目',
        artist: singer || '未知艺人',
        album: cleanText(x.album || ''),
        albumPic: pic,
        duration: interval * 1000,
        playable: !!mid,
        vip: false,
        sourceApi: SOURCE_VKEYS,
        qualityHints: {},
        musicInfo: {
          songmid: mid,
          media_mid: mid,
          songId: String(x.id || ''),
          name,
          singer,
          albumName: cleanText(x.album || ''),
          interval,
          img: pic,
        },
      };
    })
    .filter((t) => t.name && t.platformId);

  const hasMore = list.length >= limit;
  return {
    list,
    total: page * limit + (hasMore ? limit : 0),
    hasMore,
    sourceApi: SOURCE_VKEYS,
  };
}

/** 搜索入口：官方优先，失败或空列表时降级 vkeys */
async function search(keyword, page = 1, limit = 30) {
  try {
    const r = await searchOfficial(keyword, page, limit);
    if (r.list.length) return r;
  } catch (_) { /* 官方接口变更/限流 → 降级 */ }
  return searchVkeys(keyword, page, limit);
}

// ============== vkey 取链（需登录态） ==============

/**
 * 构造候选文件名。
 * QQ 的 filename 规则随曲目不同：常见是 `M800{media_mid}{media_mid}.mp3`，
 * 少数曲目要拼 songmid。逐个尝试，任一返回 purl 即可。
 */
function vkeyFilenames(musicInfo, prefix, ext) {
  const songmid = String(musicInfo.songmid || '');
  const mediaMid = String(musicInfo.media_mid || musicInfo.mediaMid || songmid);
  const mids = [...new Set([mediaMid, songmid].filter(Boolean))];
  const names = mids.map((mid) => `${prefix}${mid}${mid}.${ext}`);
  if (mediaMid && songmid && mediaMid !== songmid) {
    names.push(`${prefix}${mediaMid}${songmid}.${ext}`);
    names.push(`${prefix}${songmid}${mediaMid}.${ext}`);
  }
  return [...new Set(names)];
}

function vkeyParams(quality) {
  if (quality === 'flac' || quality === 'flac24bit') return { prefix: 'F000', ext: 'flac', bitRate: 900 };
  if (quality === '128') return { prefix: 'M500', ext: 'mp3', bitRate: 128 };
  return { prefix: 'M800', ext: 'mp3', bitRate: 320 };
}

/** 单次 vkey 请求；返回 null 表示该 filename 无可用 purl */
async function requestVkey(songmid, filename, auth, quality) {
  const { bitRate, ext } = vkeyParams(quality);
  const guid = String(1000000000 + Math.floor(Math.random() * 8999999999));
  const body = {
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: {
        guid,
        songmid: [songmid],
        songtype: [0],
        uin: String(auth.uin),
        loginflag: 1,
        platform: '20',
        filename: [filename],
      },
    },
    comm: { uin: Number(auth.uin) || 0, format: 'json', ct: 24, cv: 0 },
  };
  const j = await postJson('https://u.y.qq.com/cgi-bin/musicu.fcg?format=json', body, {
    timeout: 12000,
    headers: {
      'User-Agent': DESKTOP_UA,
      Referer: 'https://y.qq.com/',
      Cookie: `uin=${auth.uin}; qm_keyst=${auth.qmKeyst}`,
    },
  });
  const d = j && j.req_0 && j.req_0.data;
  const info = d && d.midurlinfo && d.midurlinfo[0];
  const purl = info && info.purl;
  if (!purl) return null;
  const sip = (d.sip && d.sip[0]) || 'https://dl.stream.qqmusic.qq.com/';
  return {
    url: sip + purl,
    bitRate,
    ext,
    duration: 0,
    from: 'qq-native',
    matched: null,
  };
}

/** 解析 QQ 曲目播放地址（要求 auth 含 uin/qmKeyst） */
async function resolveVkey(musicInfo = {}, auth, quality = '320') {
  const songmid = String(musicInfo.songmid || '');
  if (!songmid) throw new Error('QQ 取链缺少 songmid');
  if (!auth || !auth.uin || !auth.qmKeyst) throw new Error('未配置 QQ 登录态');

  const { prefix, ext } = vkeyParams(quality);
  const names = vkeyFilenames(musicInfo, prefix, ext);
  let lastErr = null;
  for (const filename of names) {
    try {
      const hit = await requestVkey(songmid, filename, auth, quality);
      if (hit) return hit;
    } catch (e) {
      lastErr = e;
    }
  }
  const err = new Error(lastErr ? lastErr.message : 'QQ 未返回播放地址（曲目可能是付费/无版权）');
  err.soft = true;
  throw err;
}

module.exports = {
  key: 'tx',
  search,
  searchOfficial,
  searchVkeys,
  resolveVkey,
  vkeyFilenames,
  __test: { mapOfficial, qualityHintsFrom },
};
