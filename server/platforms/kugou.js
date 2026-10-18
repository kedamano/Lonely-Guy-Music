'use strict';
/**
 * 酷狗音乐适配器：搜索 + 原生取链。
 *
 * 取链匿名可用（m.kugou.com getSongInfo.php 直接返回直链），
 * VIP 曲目会返回「需要付费」，此时按 hash 质量档位逐个尝试，再由上层跨源兜底。
 */
const { cleanText, artistTokens, similarity } = require('../song-utils');
const { getJson } = require('./http');

const PLAYABLE_EXT = new Set(['mp3', 'm4a', 'flac', 'aac', 'wav', 'ogg', 'opus']);

function mapSong(x) {
  const hash = String(x.FileHash || x.HQFileHash || '');
  const name = cleanText(x.SongName || x.FileName || '');
  const singer = cleanText(x.SingerName).split(/[、,&]/).map((s) => s.trim()).filter(Boolean).join('/');
  const album = cleanText(x.AlbumName);
  const pic = String(x.Image || '').replace('{size}', '480');
  const sec = Number(x.Duration || 0);
  const privilege = Number(x.Privilege || 0);
  const sqPrivilege = Number(x.SQPrivilege || 0);
  return {
    id: `kg:${hash}`,
    platform: 'kg',
    platformId: hash,
    name: name || '未知曲目',
    artist: singer || '未知艺人',
    album,
    albumPic: pic,
    duration: sec * 1000,
    playable: !!hash,
    vip: privilege >= 10 || sqPrivilege >= 10,
    qualityHints: {
      ...(x.SQFileHash ? { flac: 1 } : {}),
      ...(x.HQFileHash ? { '320': 1 } : {}),
      ...(x.FileHash ? { '128': 1 } : {}),
    },
    musicInfo: {
      hash,
      album_id: String(x.AlbumID || ''),
      name,
      singer,
      albumName: album,
      interval: sec,
      img: pic,
      // 原生取链用：三档 hash（flac / 320 / 128），供 platform-url 依次尝试
      hashes: {
        flac: String(x.SQFileHash || ''),
        '320': String(x.HQFileHash || ''),
        '128': String(x.FileHash || ''),
      },
    },
  };
}

async function search(keyword, page = 1, limit = 30) {
  const url = 'https://songsearch.kugou.com/song_search_v2'
    + `?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}`
    + '&platform=WebFilter&tag=em&filter=2&iscorrection=1';
  const j = await getJson(url, { headers: { Referer: 'https://www.kugou.com/' } });
  const d = j.data || {};
  if (!Array.isArray(d.lists)) throw new Error(j.error_msg || '酷狗搜索失败');

  const list = d.lists.map(mapSong).filter((t) => t.name && t.platformId);
  const total = Number(d.total || 0);
  return {
    list,
    total: total || (page * limit + (list.length >= limit ? limit : 0)),
    hasMore: total ? page * limit < total : list.length >= limit,
  };
}

// ============== 原生取链 ==============

/**
 * 单 hash 取链。返回 null 表示该 hash 不可用（下架/加密/无版权），抛错表示网络异常。
 */
async function kugouByHash(hash) {
  const url = `https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${encodeURIComponent(hash)}`;
  const j = await getJson(url, { headers: { Referer: 'https://m.kugou.com/' }, mobile: true });
  if (!j || !j.url) {
    const reason = j && (j.err || j.error) ? String(j.err || j.error) : '未返回播放地址';
    const e = new Error(`酷狗：${reason}`);
    e.soft = true; // 换下一个 hash 继续试
    throw e;
  }
  const ext = String(j.extName || '').toLowerCase();
  if (ext && !PLAYABLE_EXT.has(ext)) {
    const e = new Error(`酷狗返回了不可播放的格式（${ext}）`);
    e.soft = true;
    throw e;
  }
  return {
    url: String(j.url),
    bitRate: Number(j.bitRate || 0),
    ext: ext || 'mp3',
    duration: Number(j.timeLength || 0) * 1000,
    name: String(j.songName || ''),
    artist: String(j.singerName || ''),
    albumPic: String(j.img || ''),
  };
}

/** 按音质偏好排列 hash */
function hashOrder(musicInfo = {}, quality = '320') {
  const h = musicInfo.hashes || {};
  const base = String(musicInfo.hash || '');
  const hq = String(h['320'] || musicInfo.hqHash || '');
  const sq = String(h.flac || musicInfo.sqHash || '');
  const order = quality === '128' ? [base, hq, sq]
    : quality === '320' ? [hq, base, sq]
      : [sq, hq, base];
  return [...new Set(order.filter(Boolean))];
}

/**
 * 并发试多个 hash，返回第一个成功的。
 * 酷狗对 VIP 曲目会返回「需要付费」，这类失败很快且互不影响，并发比串行快数倍。
 */
async function raceHashes(entries) {
  if (!entries.length) return null;
  const ps = entries.map((e) => kugouByHash(e.hash).then((v) => (
    v && v.url ? { ...v, hash: e.hash, meta: e.meta || null } : Promise.reject(new Error('empty'))
  )));
  try {
    return await Promise.any(ps);
  } catch (_) {
    return null;
  }
}

/**
 * 检索同名曲目的其他收录版本。
 * 原版常为 VIP（连 128k 都报付费），但同一首歌往往有翻唱/合集等免费收录。
 *
 * 必须多路检索：`歌名 + 歌手` 召回被歌手锁死，只会返回该歌手的 VIP 版本；
 * 追加纯歌名一路才能捞到翻唱版（实测「晴天」纯歌名能搜到可播放的翻唱，带歌手则全是付费）。
 */
async function collectCandidates(name, artist, duration, { limit = 10, strict = true } = {}) {
  if (!name) return [];
  // 延迟 require：platform-search 的搜索门面会调用本适配器，顶层互相 require 会成环
  // eslint-disable-next-line global-require
  const { searchPlatform } = require('../platform-search');
  const main = artistTokens(artist)[0] || '';
  const queries = [...new Set([`${name} ${main}`.trim(), name].filter(Boolean))];

  const pool = new Map();
  await Promise.all(queries.map(async (q) => {
    try {
      const r = await searchPlatform('kg', q, 1, 12);
      for (const c of (r.list || [])) if (c && c.id && !pool.has(c.id)) pool.set(c.id, c);
    } catch (_) { /* 单路失败不影响另一路 */ }
  }));

  return [...pool.values()]
    .map((c) => ({ cand: c, score: similarity(c, { name, artist, duration }) }))
    .filter((x) => x.score >= (strict ? 7 : 2))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** 把候选摊平成 hash 列表并发试，返回首个可用直链 */
async function tryCandidates(cands, quality) {
  const entries = [];
  for (const { cand, score } of cands) {
    for (const hash of hashOrder(cand.musicInfo, quality).slice(0, 2)) {
      entries.push({ hash, meta: { cand, score } });
    }
  }
  return raceHashes(entries.slice(0, 10));
}

/**
 * 酷狗取链（尽力而为）：
 *   1) 本曲三档 hash 并发（flac → 320 → 128）
 *   2) 全失败（多为 VIP 曲）→ 严格召回同名版本
 *   3) 仍失败 → 宽松召回（同名即可，按时长接近度排序）
 */
async function bestEffort(musicInfo = {}, { quality = '320', name, artist, duration } = {}) {
  const ownHashes = hashOrder(musicInfo, quality);
  if (ownHashes.length) {
    const own = await raceHashes(ownHashes.map((hash) => ({ hash })));
    if (own) return { ...own, from: 'kugou-native', matched: null };
  }

  const pack = (hit, loose) => {
    const m = hit.meta;
    return {
      ...hit,
      from: loose ? 'kugou-loose' : 'kugou-alt',
      matched: m ? { name: m.cand.name, artist: m.cand.artist, score: m.score, id: m.cand.id, loose: !!loose } : null,
    };
  };

  const strictCands = await collectCandidates(name, artist, duration, { strict: true });
  const strictHit = await tryCandidates(strictCands, '128');
  if (strictHit) return pack(strictHit, false);

  const looseCands = await collectCandidates(name, artist, duration, { strict: false });
  const looseHit = await tryCandidates(looseCands, '128');
  if (looseHit) return pack(looseHit, true);

  const err = ownHashes.length
    ? new Error('酷狗未返回可用地址（该曲可能是付费/无版权曲目）')
    : new Error('酷狗取链缺少 hash（曲目信息不完整）');
  err.soft = true;
  throw err;
}

module.exports = {
  key: 'kg',
  search,
  kugouByHash,
  hashOrder,
  raceHashes,
  collectCandidates,
  tryCandidates,
  bestEffort,
  // 兼容旧命名
  collectKugouCandidates: collectCandidates,
  kugouBestEffort: bestEffort,
  __test: { mapSong },
};
