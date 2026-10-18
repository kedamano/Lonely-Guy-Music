'use strict';
/**
 * 聚合搜索与备选来源。
 *
 * 聚合搜索把多个平台的结果合并成一行：同一首歌只出现一次，主来源选「能播、非 VIP、
 * 信息全」的一条，其余平台进 sources[]，供播放失败时自动换源。
 *
 * 单平台搜索本身已有 5 分钟缓存，这里再缓存合并后的结果，避免翻页/切平台时重复合并。
 * 聚合缓存不跨用户（本应用是单机客户端），音源变更时由组合根调用 clearCache。
 */
const ncm = require('./ncm-client');
const { searchPlatform, postProcessList, platformList } = require('./platform-search');
const {
  mergeTracks,
  rankAndDedupe,
  cleanText,
  stripBrackets,
  artistTokens,
  similarity,
  sameSong,
  hashKey,
} = require('./song-utils');
const { META } = require('./platforms');

const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 100;
const PLATFORM_TIMEOUT_MS = 6000;
const DEFAULT_SOURCES = ['wy', 'tx', 'kg', 'kw'];
const ALTERNATIVE_SOURCES = ['wy', 'tx', 'kg', 'kw', 'mg'];
const MAX_ALTERNATIVES = 12;

const cache = new Map(); // key -> { data, exp }
const inflight = new Map();
const stats = { hits: 0, misses: 0 };

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout])
    .finally(() => { if (timer) clearTimeout(timer); });
}

// ============== 缓存 ==============

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.exp <= Date.now()) { cache.delete(key); return null; }
  return hit.data;
}

function cacheSet(key, data) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { data, exp: Date.now() + CACHE_TTL });
}

function cacheStats() {
  return { entries: cache.size, hits: stats.hits, misses: stats.misses };
}

function clearCache() {
  cache.clear();
  stats.hits = 0;
  stats.misses = 0;
}

// ============== 单平台召回 ==============

/** 网易云搜索：走本地 NCM，返回统一曲目结构（平台搜索门面不处理 wy） */
async function searchNetease(keyword, page, limit) {
  if (!ncm.isReady()) throw new Error('网易云 API 不可用（离线模式）');
  const offset = (page - 1) * limit;
  const songs = await ncm.searchSongs(keyword, limit, offset);
  const list = songs.map((s) => ({
    id: `wy:${s.id}`,
    platform: 'wy',
    platformId: s.id,
    name: s.name,
    artist: s.artist || '未知艺人',
    album: s.album || '',
    albumPic: s.albumPic || '',
    duration: Number(s.duration || 0) || 0,
    playable: true,
    vip: !!s.vip,
    variant: null,
    sourceApi: 'ncm',
    qualityHints: {},
    // 取链只需要 id；保留网易云原始字段便于将来扩展
    musicInfo: { id: s.id },
  }));
  return { list: postProcessList(list, { keyword }), hasMore: songs.length >= limit, total: 0 };
}

async function searchOne(key, keyword, page, limit) {
  if (key === 'wy') return searchNetease(keyword, page, limit);
  return searchPlatform(key, keyword, page, limit);
}

/** 第 1 页额外跑一次「去括号」变体，提升带 (Live)/(伴奏) 尾缀的召回 */
function queryVariants(keyword, page) {
  const base = cleanText(keyword);
  const out = [base];
  if (Number(page) === 1) {
    const bare = stripBrackets(base);
    if (bare && bare !== base) out.push(bare);
  }
  return out;
}

async function collectPlatform(key, variants, page, limit) {
  const started = Date.now();
  const results = await Promise.allSettled(
    variants.map((kw) => withTimeout(searchOne(key, kw, page, limit), PLATFORM_TIMEOUT_MS, META[key].label))
  );
  const ok = results.filter((r) => r.status === 'fulfilled');
  if (!ok.length) {
    const first = results[0] && results[0].reason;
    throw (first || new Error('搜索失败'));
  }

  // 多路查询合并后统一去重排序
  const merged = rankAndDedupe(
    ok.flatMap((r) => r.value.list || []),
    { keyword: variants[0] },
  );
  const hasMore = ok.some((r) => r.value.hasMore);
  return {
    list: merged.slice(0, Math.max(limit * 2, limit)),
    hasMore,
    tookMs: Date.now() - started,
  };
}

// ============== 对外：聚合搜索 ==============

/**
 * @param {object} o
 * @param {string} o.keyword
 * @param {number} [o.page=1]
 * @param {number} [o.limit=30]
 * @param {string[]} [o.sources] 平台白名单（默认 wy,tx,kg,kw）
 * @returns {Promise<object>} { list, page, limit, hasMore, platforms, queryVariants, errors, cached, tookMs }
 */
async function searchAll({ keyword, page = 1, limit = 30, sources } = {}) {
  const kw = cleanText(keyword);
  if (!kw) {
    return {
      list: [], total: 0, page: 1, limit: Number(limit) || 30, hasMore: false,
      platforms: [], queryVariants: [], errors: [], cached: false, tookMs: 0,
    };
  }

  const p = Math.max(1, Number(page) || 1);
  const n = Math.min(60, Math.max(1, Number(limit) || 30));
  const requested = Array.isArray(sources) && sources.length ? sources : DEFAULT_SOURCES;
  const keys = [...new Set(requested.map((s) => String(s || '').toLowerCase()))]
    .filter((k) => META[k] && k !== 'all');

  const ck = `all|${p}|${n}|${keys.join(',')}|${kw}`;
  const cached = cacheGet(ck);
  if (cached) {
    stats.hits++;
    return { ...cached, cached: true };
  }

  const running = inflight.get(ck);
  if (running) return running;

  stats.misses++;
  const started = Date.now();
  const variants = queryVariants(kw, p);

  const task = (async () => {
    const settled = await Promise.allSettled(
      keys.map((key) => collectPlatform(key, variants, p, n)),
    );

    const lists = [];
    const platforms = [];
    const errors = [];
    settled.forEach((r, i) => {
      const key = keys[i];
      if (r.status === 'fulfilled') {
        lists.push(...r.value.list);
        platforms.push({
          key,
          label: META[key].label,
          count: r.value.list.length,
          tookMs: r.value.tookMs,
        });
      } else {
        const message = (r.reason && r.reason.message) || '搜索失败';
        platforms.push({ key, label: META[key].label, count: 0, tookMs: 0, error: message });
        errors.push({ platform: key, label: META[key].label, message });
        if (process.env.GUMAN_DEBUG === '1') console.warn(`[aggregate] ${key} failed: ${message}`);
      }
    });

    const merged = mergeTracks(lists, { keyword: kw, limit: n });
    const data = {
      list: merged,
      total: merged.length,
      page: p,
      limit: n,
      hasMore: settled.some((r) => r.status === 'fulfilled' && r.value.hasMore),
      platforms,
      queryVariants: variants,
      errors,
      cached: false,
      tookMs: Date.now() - started,
    };
    // 全部平台失败时不缓存，便于用户稍后重试
    if (platforms.some((x) => !x.error)) cacheSet(ck, data);
    return data;
  })().finally(() => { inflight.delete(ck); });

  inflight.set(ck, task);
  return task;
}

// ============== 对外：备选来源 ==============

function availableAlternativeSources() {
  const out = ALTERNATIVE_SOURCES.filter((k) => META[k]);
  // 汽水仅在导入了支持 search 的洛雪音源时才参与
  const qs = platformList().find((p) => p.key === 'qs');
  if (qs && qs.available) out.push('qs');
  return out;
}

/**
 * 为一首歌找回其他平台的同曲来源。
 * 只做召回与相似度过滤，不探测地址；是否可播由取链环节校验。
 *
 * @param {object} o
 * @param {string} o.platform 当前平台（结果中排除该平台）
 * @param {string} o.name
 * @param {string} o.artist
 * @param {number} [o.duration]
 * @param {string[]} [o.sources]
 * @param {number} [o.limit=10] 每个平台召回数
 * @returns {Promise<{list: Array}>}
 */
async function findAlternatives({ platform, name, artist, duration, sources, limit = 10 } = {}) {
  const songName = cleanText(name);
  if (!songName) return { list: [] };
  const target = { name: songName, artist: cleanText(artist), duration: Number(duration || 0) || 0 };
  const current = String(platform || '').toLowerCase();
  const keys = (Array.isArray(sources) && sources.length ? sources : availableAlternativeSources())
    .map((s) => String(s || '').toLowerCase())
    .filter((k) => META[k] && k !== current);
  if (!keys.length) return { list: [] };

  const n = Math.min(30, Math.max(1, Number(limit) || 10));
  const main = artistTokens(target.artist)[0] || '';
  const queries = [...new Set([`${songName} ${main}`.trim(), songName].filter(Boolean))];

  const settled = await Promise.allSettled(keys.map(async (key) => {
    const pool = new Map();
    for (const q of queries) {
      try {
        const r = await withTimeout(searchOne(key, q, 1, n), PLATFORM_TIMEOUT_MS, META[key].label);
        for (const c of r.list || []) {
          if (c && c.id && !pool.has(c.id)) pool.set(c.id, c);
        }
      } catch (_) { /* 单路失败换下一个查询词 */ }
    }
    return [...pool.values()];
  }));

  const seen = new Set();
  const candidates = [];
  settled.forEach((r) => {
    if (r.status !== 'fulfilled') return;
    for (const cand of r.value) {
      const score = similarity(cand, target);
      if (score < 2) continue;
      const key = `${cand.platform}:${cand.platformId || cand.id}`;
      if (seen.has(key)) continue;
      // 与当前曲目完全同源同曲的跳过（调用方已有主来源）
      if (cand.platform === current) continue;
      seen.add(key);
      candidates.push({ ...cand, matchScore: score });
    }
  });

  candidates.sort((a, b) => b.matchScore - a.matchScore);
  const list = candidates.slice(0, MAX_ALTERNATIVES);
  return { list };
}

module.exports = {
  searchAll,
  findAlternatives,
  cacheStats,
  clearCache,
  DEFAULT_SOURCES,
  ALTERNATIVE_SOURCES,
  __test: { queryVariants, searchNetease, sameSong, hashKey },
};
