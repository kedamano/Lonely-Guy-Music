'use strict';
/**
 * 平台取链编排：原生直链优先，失败后跨源找同曲。
 *
 * 为什么需要这一层（实测结论）：
 *   - 酷狗 `m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=xxx` 匿名即返回完整音频直链，
 *     不需要 signature、不需要 cookie（实测 206 audio/mpeg，全长 2.8MB）
 *   - QQ 的 vkey 与 uin+guid 强绑定，匿名 purl 恒为空（实测 104003 / 1000），必须登录态
 *
 * 因此策略是：
 *   1) 酷狗曲目 → 原生直链（多 hash 依次尝试：flac → 320 → 128）
 *   2) QQ 曲目  → 有 cookie 走 vkey；无 cookie 时跨平台兜底
 *   3) 兜底按「歌名 + 歌手 + 时长」到其他平台检索同一首
 *
 * 取链结果进内存缓存（TTL 25 分钟），避免同一首歌反复请求上游。
 * 缓存键包含音质，切换音质会重新取链。
 */
const fs = require('fs');
const kugou = require('./platforms/kugou');
const kuwo = require('./platforms/kuwo');
const qq = require('./platforms/qq');
const ncm = require('./ncm-client');
const { searchPlatform } = require('./platform-search');
const { probeAudio, validateProbe, parseContentRange, mp3Probe, PLACEHOLDER_BYTES } = require('./audio-probe');
const {
  normName,
  similarity,
  artistTokens,
  variantTag,
  sameSong,
  mergeTracks,
  hashKey,
} = require('./song-utils');

const CACHE_TTL = 25 * 60 * 1000;
const CACHE_MAX = 400;

const cache = new Map(); // key -> { data, exp }
// 负缓存：校验失败的地址 60 秒内不再重复探测（避免每次播放都等 4.5s 超时）
const negative = new Map(); // key -> { message, exp }
const NEGATIVE_TTL = 60 * 1000;
// 平台健康度：连续失败达到阈值后前端可提示「该平台取链受限」
const health = {
  tx: { fails: 0, lastError: '', lastOk: 0 },
  kg: { fails: 0, lastError: '', lastOk: 0 },
  kw: { fails: 0, lastError: '', lastOk: 0 },
};

// ============== 工具 ==============

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.exp <= Date.now()) { cache.delete(key); return null; }
  return hit.data;
}

function cacheSet(key, data) {
  if (cache.size >= CACHE_MAX) {
    // 简单淘汰：删掉最早插入的一条
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { data, exp: Date.now() + CACHE_TTL });
}

function negativeGet(key) {
  const hit = negative.get(key);
  if (!hit) return null;
  if (hit.exp <= Date.now()) { negative.delete(key); return null; }
  return hit.message;
}

function negativeSet(key, message) {
  if (negative.size >= CACHE_MAX) {
    const oldest = negative.keys().next();
    if (!oldest.done) negative.delete(oldest.value);
  }
  negative.set(key, { message, exp: Date.now() + NEGATIVE_TTL });
}

/**
 * 取链结果校验。
 * 酷狗直链由 playInfo 的 timeLength 背书，只比对时长；其他来源（QQ vkey / 音源）
 * 先探测前 64KB，识别 HTML 错误页、酷我 181521 字节试听占位与异常码率。
 */
async function validateResolved(result, { expectedDurationMs = 0 } = {}) {
  if (!result || !result.url) return { ok: false, reason: '取链结果缺少地址' };

  const from = String(result.from || '');
  const expected = Number(expectedDurationMs || 0);
  if (from.startsWith('kugou')) {
    const got = Number(result.duration || 0);
    if (expected > 0 && got > 0 && Math.abs(got - expected) > 20000) {
      return { ok: false, reason: '酷狗返回的音频时长与曲目不符' };
    }
    return { ok: true, trusted: true, format: result.ext || null, totalBytes: null };
  }

  return probeAudio(result.url, { expectedDurationMs: expected });
}

/**
 * 取链缓存键：平台 + 曲目标识 + 音质。
 * 音质必须在键里——否则用户切到无损后仍会命中 128k 的旧结果。
 */
function cacheKey({ platform, musicInfo = {}, name = '', artist = '', quality = '320' }) {
  const id = musicInfo.hash || musicInfo.songmid || musicInfo.rid
    || musicInfo.contentId || musicInfo.media_mid
    || `${hashKey(`${name}|${artist}`)}`;
  return `${platform}:${id}:${quality || '320'}`;
}

function markOk(platform) {
  const h = health[platform];
  if (!h) return;
  h.fails = 0;
  h.lastOk = Date.now();
  h.lastError = '';
}

function markFail(platform, err) {
  const h = health[platform];
  if (!h) return;
  h.fails += 1;
  h.lastError = String((err && err.message) || err || '未知错误');
}

/** 平台账号 cookie（可选）：userData/platform-auth.json，结构 { tx: { uin, qmKeyst } } */
let authPath = null;
function setAuthPath(p) { authPath = p; }

function readAuth() {
  if (!authPath) return {};
  try {
    return JSON.parse(fs.readFileSync(authPath, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

// ============== 跨平台兜底：当前平台 → 同曲其他平台 ==============

/**
 * 到酷狗找同一首歌。命中后返回 { url, ... , matched: { name, artist, score } }。
 * 严格匹配失败后放宽到同名（按时长接近度排序），仍找不到返回 null。
 */
async function fallbackToKugou({ name, artist, duration }) {
  if (!name) return null;

  const pack = (hit, loose) => {
    const { cand, score } = hit.meta;
    return {
      ...hit,
      from: 'kugou-fallback',
      sourcePlatform: 'kg',
      matched: { name: cand.name, artist: cand.artist, score, id: cand.id, loose: !!loose },
    };
  };

  const strictHit = await kugou.tryCandidates(
    await kugou.collectCandidates(name, artist, duration, { strict: true }), '128',
  );
  if (strictHit && strictHit.meta) return pack(strictHit, false);

  const looseHit = await kugou.tryCandidates(
    await kugou.collectCandidates(name, artist, duration, { strict: false }), '128',
  );
  if (looseHit && looseHit.meta) return pack(looseHit, true);
  return null;
}

function ncmBr(quality) {
  if (quality === 'flac' || quality === 'flac24bit') return 999000;
  if (quality === '128') return 128000;
  return 320000;
}

function searchQueries(name, artist) {
  const main = artistTokens(artist)[0] || '';
  return [...new Set([`${name} ${main}`.trim(), name].filter(Boolean))].slice(0, 2);
}

/** 网易云同曲兜底：NCM 搜「歌名 + 歌手」→ 严格相似度 → /song/url */
async function resolveNeteaseFallback({ name, artist, duration, quality }) {
  if (!name || !ncm.isReady()) return null;

  let best = null;
  for (const q of searchQueries(name, artist)) {
    const songs = await ncm.searchSongs(q, 10);
    for (const s of songs) {
      const score = similarity(s, { name, artist, duration });
      if (score >= 7 && (!best || score > best.score)) best = { song: s, score };
    }
    if (best) break;
  }
  if (!best) return null;

  const u = await ncm.songUrl(best.song.id, ncmBr(quality));
  if (!u || !u.url) return null;
  return {
    ...u,
    from: 'wy-fallback',
    sourcePlatform: 'wy',
    matched: {
      name: best.song.name,
      artist: best.song.artist,
      score: best.score,
      id: `wy:${best.song.id}`,
    },
  };
}

/**
 * 酷我同曲兜底：严格（≥7）→ 宽松（≥2）。
 * 与酷狗兜底不同，这里先搜索拿到 rid，再走 anti.s 取链。
 */
async function resolveKuwoFallback({ name, artist, duration, quality }) {
  if (!name) return null;
  const target = { name, artist, duration };
  const queries = searchQueries(name, artist);

  for (const threshold of [7, 2]) {
    const pool = new Map();
    for (const q of queries) {
      try {
        const r = await searchPlatform('kw', q, 1, 10);
        for (const c of r.list || []) {
          if (c && c.id && !pool.has(c.id)) pool.set(c.id, c);
        }
      } catch (_) { /* 单路失败继续 */ }
    }
    const cands = [...pool.values()]
      .map((c) => ({ cand: c, score: similarity(c, target) }))
      .filter((x) => x.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    for (const { cand, score } of cands) {
      try {
        const hit = await kuwo.resolve(cand.musicInfo, quality);
        return {
          ...hit,
          from: 'kuwo-fallback',
          sourcePlatform: 'kw',
          matched: { name: cand.name, artist: cand.artist, score, id: cand.id, loose: threshold < 7 },
        };
      } catch (_) { /* 换下一个候选 */ }
    }
  }
  return null;
}

// ============== 原生取链 ==============

/** 只走当前平台原生接口；不做跨源兜底（兜底由 resolvePlatformUrl 编排） */
async function resolveNative(platform, { musicInfo = {}, quality = '320', name, artist, duration } = {}) {
  if (platform === 'kg') {
    return kugou.bestEffort(musicInfo, { quality, name, artist, duration });
  }
  if (platform === 'tx') {
    const auth = readAuth().tx;
    if (!auth || !auth.uin || !auth.qmKeyst) {
      const e = new Error('QQ 需登录态取链');
      e.soft = true;
      throw e;
    }
    return qq.resolveVkey(musicInfo, auth, quality);
  }
  if (platform === 'kw') {
    return kuwo.resolve(musicInfo, quality);
  }
  if (platform === 'wy') {
    const id = musicInfo.id || musicInfo.songId || musicInfo.platformId;
    if (!id) {
      const e = new Error('网易云取链缺少歌曲 id');
      e.soft = true;
      throw e;
    }
    if (!ncm.isReady()) {
      const e = new Error('网易云 API 不可用（离线模式）');
      e.soft = true;
      throw e;
    }
    const u = await ncm.songUrl(id, ncmBr(quality));
    if (!u || !u.url) {
      const e = new Error('网易云未返回播放地址（该曲可能是付费/无版权曲目）');
      e.soft = true;
      throw e;
    }
    return { ...u, from: 'wy-native', sourcePlatform: 'wy', matched: null };
  }
  const e = new Error(`${platform} 平台无原生取链（请通过自定义音源播放）`);
  e.soft = true;
  throw e;
}

function attemptId(platform, musicInfo = {}) {
  return `${platform}:${musicInfo.hash || musicInfo.songmid || musicInfo.rid
    || musicInfo.contentId || musicInfo.media_mid || musicInfo.id || ''}`;
}

// ============== 对外入口 ==============

/**
 * 解析平台曲目的播放地址。
 *
 * 尝试顺序：当前平台原生 → 聚合行的备选来源 → 跨源兜底（酷狗同曲）。
 * 每个结果都要通过 validateResolved：软失败（VIP/试听/未匹配）不计平台健康度。
 *
 * @param {object} p
 * @param {'tx'|'kg'|'kw'|'mg'|'qs'} p.platform
 * @param {object} p.musicInfo  搜索结果里的 musicInfo（含 hash/hashes/songmid/rid）
 * @param {string} p.name       歌名（兜底匹配用）
 * @param {string} p.artist     歌手
 * @param {number} p.duration   时长（毫秒）
 * @param {string} p.quality    期望音质
 * @param {Array}  p.alternatives 聚合行的其他来源（同 sources 结构）
 */
async function resolvePlatformUrl({
  platform,
  musicInfo = {},
  name,
  artist,
  duration,
  quality = '320',
  alternatives = [],
}) {
  const key = cacheKey({ platform, musicInfo, name, artist, quality });
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };
  const negativeMessage = negativeGet(key);
  if (negativeMessage) {
    const e = new Error(negativeMessage);
    e.soft = true;
    throw e;
  }

  const attempts = [];
  const seen = new Set();
  const push = (sourcePlatform, info, expected) => {
    const id = attemptId(sourcePlatform, info);
    if (seen.has(id)) return;
    seen.add(id);
    attempts.push({ sourcePlatform, musicInfo: info || {}, expected: Number(expected || 0) });
  };

  push(platform, musicInfo, duration);
  for (const alt of Array.isArray(alternatives) ? alternatives : []) {
    if (!alt || !alt.platform) continue;
    push(alt.platform, alt.musicInfo || alt, alt.duration || duration);
  }
  // 跨源兜底：网易云同曲 → 酷我同曲 → 酷狗同曲（当前平台本身则跳过）
  const pushSearchFallback = (sourcePlatform) => {
    if (!name) return;
    const id = `${sourcePlatform}-search:${name}|${artist}|${duration}`;
    if (seen.has(id)) return;
    seen.add(id);
    attempts.push({ sourcePlatform, fallback: sourcePlatform, expected: Number(duration || 0) });
  };
  if (platform !== 'wy' && ncm.isReady()) pushSearchFallback('wy');
  if (platform !== 'kw') pushSearchFallback('kw');
  if (platform !== 'kg') pushSearchFallback('kg');

  let lastErr = null;
  let nativeNetworkErr = null;
  let first = true;

  for (const a of attempts) {
    let result = null;
    try {
      if (a.fallback === 'kg') {
        result = await fallbackToKugou({ name, artist, duration });
      } else if (a.fallback === 'wy') {
        result = await resolveNeteaseFallback({ name, artist, duration, quality });
      } else if (a.fallback === 'kw') {
        result = await resolveKuwoFallback({ name, artist, duration, quality });
      } else {
        result = await resolveNative(a.sourcePlatform, {
          musicInfo: a.musicInfo,
          quality,
          name,
          artist,
          duration: a.expected || duration,
        });
      }
      if (!result && a.fallback) {
        const e = new Error(`未在 ${{ kg: '酷狗', wy: '网易云', kw: '酷我' }[a.fallback] || a.sourcePlatform} 找到同一首`);
        e.soft = true;
        lastErr = e;
        continue;
      }
    } catch (e) {
      lastErr = e;
      if (first && !(e && e.soft)) nativeNetworkErr = e;
      first = false;
      continue;
    }
    first = false;

    const expected = a.expected || Number(duration || 0) || Number(result.duration || 0);
    const check = await validateResolved(result, { expectedDurationMs: expected });
    if (!check.ok) {
      const e = new Error(`取链校验失败：${check.reason || '音频校验未通过'}`);
      e.soft = true;
      lastErr = e;
      continue;
    }

    markOk(platform);
    const validated = {
      ...result,
      sourcePlatform: result.sourcePlatform || a.sourcePlatform,
      validated: true,
    };
    if (check.format) validated.format = check.format;
    if (check.bitRate) validated.probedBitRate = check.bitRate;
    cacheSet(key, validated);
    return validated;
  }

  if (nativeNetworkErr) markFail(platform, nativeNetworkErr);
  const finalErr = lastErr || new Error('取链失败');
  if (finalErr.soft) negativeSet(key, finalErr.message);
  throw finalErr;
}

function getHealth() {
  return JSON.parse(JSON.stringify(health));
}

function clearCache() {
  cache.clear();
  negative.clear();
}

/** 当前取链缓存条目数（设置页展示「内存缓存」用） */
function cacheSize() {
  return cache.size;
}

module.exports = {
  resolvePlatformUrl,
  fallbackToKugou,
  kugouBestEffort: kugou.bestEffort,
  getHealth,
  clearCache,
  cacheSize,
  setAuthPath,
  __test: {
    similarity,
    normName,
    kugouByHash: kugou.kugouByHash,
    cacheKey,
    mergeTracks,
    sameSong,
    variantTag,
    validateProbe,
    parseContentRange,
    mp3Probe,
    PLACEHOLDER_BYTES,
  },
};
