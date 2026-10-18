'use strict';
/**
 * 多平台搜索门面（单平台）。
 *
 * 适配器负责「怎么问上游」，本模块负责统一后处理：
 *   清洗文本 → 丢弃超短片段 → 标记 VIP/变体 → 平台内去重排序 → 5 分钟缓存。
 *
 * 平台与数据来源：
 *   wy (网易云)   —— 由 NCM 反代处理，不经过本模块
 *   tx (QQ)       —— 官方匿名接口，失败降级 vkeys
 *   kg (酷狗)     —— song_search_v2
 *   kw (酷我)     —— search.kuwo.cn/r.s（伪 JSON）
 *   mg (咪咕)     —— H5 search_all.do
 *   qs (汽水)     —— 无公开接口，委托洛雪音源脚本
 *
 * 统一曲目结构（渲染层只认这一套）：
 *   { id, platform, platformId, name, artist, album, albumPic, duration, playable, vip, variant, musicInfo }
 * - id 带平台前缀（tx:xxx / kg:xxx），避免与网易云纯数字 id 冲突
 * - musicInfo 是取链需要的平台特定字段，原样回传
 */
const { META, getAdapter } = require('./platforms');
const { rankAndDedupe, cleanText, hashKey } = require('./song-utils');
const { resolveSearch } = require('./source-manager');

const SEARCH_TTL = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 100;
const SEARCH_CACHE_TASK = 'search';

const PLATFORMS = META; // 兼容旧导出

const searchCache = new Map(); // key -> { data, exp }
const inflight = new Map(); // key -> Promise
const stats = { hits: 0, misses: 0 };

function platformList() {
  return Object.values(META).map((p) => {
    let available = true;
    let reason = '';
    if (p.viaSource) {
      available = sourceSupports(p.key);
      if (!available) reason = '需导入支持该平台搜索的洛雪音源';
    }
    return {
      key: p.key,
      label: p.label,
      playlist: !!p.playlist,
      searchable: !!p.searchable,
      viaSource: !!p.viaSource,
      playback: p.playback,
      available,
      reason,
    };
  });
}

/** 已导入并启用、且声明了 search 能力的洛雪音源是否覆盖该平台 */
function sourceSupports(platform) {
  try {
    // 延迟 require：避免测试里反复初始化 source-manager 的副作用
    // eslint-disable-next-line global-require
    const sm = require('./source-manager');
    if (typeof sm.platformsWithAction !== 'function') return false;
    return sm.platformsWithAction(SEARCH_CACHE_TASK).includes(platform);
  } catch (_) {
    return false;
  }
}

/** 洛雪音源 search 返回的原始曲目 → 统一曲目结构 */
function normalizeFromSource(it, platform) {
  const name = cleanText(it.name || it.songName || it.songname || '');
  const singer = it.singer;
  const artist = Array.isArray(singer)
    ? singer.filter(Boolean).join('/')
    : cleanText(singer || it.artist || '');
  const rawId = String(
    it.songmid || it.songId || it.songid || it.hash || it.id
    || (it.musicInfo && (it.musicInfo.copyrightId || it.musicInfo.songId || it.musicInfo.id)) || ''
  );
  const album = cleanText(it.album || it.albumName || '');
  const pic = String(it.img || it.albumPic || it.pic || '');
  const sec = Number(it.interval || 0);
  const duration = sec > 10000 ? sec : sec * 1000;
  // 音源返回空 id 时用内容哈希兜底，避免多首歌都变成 `mg:` 互相覆盖
  const id = rawId || `gen-${hashKey(`${name}|${artist}|${album}|${duration}`)}`;
  return {
    id: `${platform}:${id}`,
    platform,
    platformId: id,
    name: name || '未知曲目',
    artist: artist || '未知艺人',
    album,
    albumPic: pic,
    duration,
    playable: true,
    vip: !!(it.vip || it.pay),
    sourceApi: 'source',
    qualityHints: {},
    // musicInfo 原样保留：取链时直接回传给洛雪音源（来源与去向是同一份脚本）
    musicInfo: it.musicInfo || it,
  };
}

/** 统一后处理：清洗、丢片段、标记变体、平台内去重与排序 */
function postProcessList(list, { keyword = '' } = {}) {
  return rankAndDedupe(list, { keyword });
}

function cacheKeyOf(platform, keyword, page, limit) {
  return `${platform}|${page}|${limit}|${keyword}`;
}

function cacheGet(key) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (hit.exp <= Date.now()) { searchCache.delete(key); return null; }
  return hit.data;
}

function cacheSet(key, data) {
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next();
    if (!oldest.done) searchCache.delete(oldest.value);
  }
  searchCache.set(key, { data, exp: Date.now() + SEARCH_TTL });
}

async function runSearch(key, kw, p, n) {
  const meta = META[key];
  let raw;

  if (meta.viaSource) {
    const r = await resolveSearch({ sourcePlatform: key, keyword: kw, page: p, limit: n });
    raw = {
      list: (r.list || []).map((it) => normalizeFromSource(it, key)).filter((t) => t.name),
      hasMore: (r.list || []).length >= n,
      sourceApi: 'source',
    };
  } else {
    const adapter = getAdapter(key);
    if (!adapter || typeof adapter.search !== 'function') {
      throw new Error(`不支持的平台：${key}`);
    }
    try {
      raw = await adapter.search(kw, p, n);
    } catch (e) {
      // 咪咕原生接口偶尔限流：有支持 mg 的洛雪音源时降级
      if (key !== 'mg') throw e;
      const r = await resolveSearch({ sourcePlatform: 'mg', keyword: kw, page: p, limit: n });
      raw = {
        list: (r.list || []).map((it) => normalizeFromSource(it, 'mg')).filter((t) => t.name),
        hasMore: (r.list || []).length >= n,
        sourceApi: 'source',
      };
    }
  }

  const list = postProcessList(raw.list || [], { keyword: kw });
  const hasMore = typeof raw.hasMore === 'boolean' ? raw.hasMore : list.length >= n;
  return {
    list,
    total: Number(raw.total || 0) || p * n + (hasMore ? n : 0),
    hasMore,
    page: p,
    limit: n,
    platform: key,
    ...(raw.sourceApi ? { sourceApi: raw.sourceApi } : {}),
  };
}

async function searchPlatform(platform, keyword, page = 1, limit = 30) {
  const key = String(platform || '').toLowerCase();
  if (!META[key]) throw new Error(`不支持的平台：${platform}`);
  if (key === 'wy') throw new Error('网易云搜索走 /api/search');
  const kw = String(keyword || '').trim();
  if (!kw) return { list: [], total: 0, page, limit, platform: key, hasMore: false };
  const p = Math.max(1, Number(page) || 1);
  const n = Math.min(60, Math.max(1, Number(limit) || 30));

  const ck = cacheKeyOf(key, kw, p, n);
  const cached = cacheGet(ck);
  if (cached) {
    stats.hits++;
    return cached;
  }

  const running = inflight.get(ck);
  if (running) return running;

  stats.misses++;
  const task = runSearch(key, kw, p, n)
    .then((data) => {
      // 失败不缓存；成功后空结果也缓存，避免反复打上游
      cacheSet(ck, data);
      return data;
    })
    .finally(() => { inflight.delete(ck); });
  inflight.set(ck, task);
  return task;
}

function getSearchCacheStats() {
  return { entries: searchCache.size, hits: stats.hits, misses: stats.misses };
}

function clearSearchCache() {
  searchCache.clear();
  stats.hits = 0;
  stats.misses = 0;
}

module.exports = {
  searchPlatform,
  platformList,
  PLATFORMS,
  normalizeFromSource,
  postProcessList,
  getSearchCacheStats,
  clearSearchCache,
};
