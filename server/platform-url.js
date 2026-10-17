'use strict';
/**
 * 平台原生取链：不依赖洛雪音源，直接走各平台公开接口。
 *
 * 为什么需要这一层（实测结论）：
 *   - 酷狗 `m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=xxx` 匿名即返回完整音频直链，
 *     不需要 signature、不需要 cookie（实测 206 audio/mpeg，全长 2.8MB）
 *   - QQ 的 vkey 与 uin+guid 强绑定，匿名 purl 恒为空（实测 104003 / 1000），必须登录态
 *
 * 因此策略是：
 *   1) 酷狗曲目 → 原生直链（多 hash 依次尝试：flac → 320 → 128）
 *   2) QQ 曲目  → 有 cookie 走 vkey；无 cookie 时跨平台兜底，按「歌名 + 歌手 + 时长」
 *      到酷狗检索同一首，用酷狗直链播放
 *
 * 取链结果进内存缓存（TTL 25 分钟），避免同一首歌反复请求上游。
 */
const fs = require('fs');
const path = require('path');
const { requestAsync } = require('./source-manager');
const { searchPlatform } = require('./platform-search');

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CACHE_TTL = 25 * 60 * 1000;
const CACHE_MAX = 400;
const PLAYABLE_EXT = new Set(['mp3', 'm4a', 'flac', 'aac', 'wav', 'ogg', 'opus']);

const cache = new Map(); // key -> { data, exp }
// 平台健康度：连续失败达到阈值后前端可提示「该平台取链受限」
const health = { tx: { fails: 0, lastError: '', lastOk: 0 }, kg: { fails: 0, lastError: '', lastOk: 0 } };

// ============== 工具 ==============

async function getJson(url, headers = {}, timeout = 12000) {
  const r = await requestAsync(url, {
    timeout,
    headers: { 'User-Agent': MOBILE_UA, Accept: 'application/json, text/plain, */*', ...headers },
  });
  if (r.statusCode >= 400) throw new Error(`上游返回 HTTP ${r.statusCode}`);
  const body = r.body;
  if (body && typeof body === 'object') return body;
  const text = String(body || '');
  try { return JSON.parse(text); } catch { throw new Error('上游返回的不是合法 JSON'); }
}

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

// ============== 酷狗原生取链 ==============

/**
 * 单 hash 取链。返回 null 表示该 hash 不可用（下架/加密/无版权），抛错表示网络异常。
 */
async function kugouByHash(hash) {
  const url = `https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${encodeURIComponent(hash)}`;
  const j = await getJson(url, { Referer: 'https://m.kugou.com/' });
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
async function collectKugouCandidates(name, artist, duration, { limit = 10, strict = true } = {}) {
  if (!name) return [];
  const mainArtist = artistTokens(artist)[0] || '';
  const queries = [...new Set([`${name} ${mainArtist}`.trim(), name].filter(Boolean))];

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
async function kugouBestEffort(musicInfo = {}, { quality = '320', name, artist, duration } = {}) {
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

  const strictCands = await collectKugouCandidates(name, artist, duration, { strict: true });
  const strictHit = await tryCandidates(strictCands, '128');
  if (strictHit) return pack(strictHit, false);

  const looseCands = await collectKugouCandidates(name, artist, duration, { strict: false });
  const looseHit = await tryCandidates(looseCands, '128');
  if (looseHit) return pack(looseHit, true);

  const err = ownHashes.length
    ? new Error('酷狗未返回可用地址（该曲可能是付费/无版权曲目）')
    : new Error('酷狗取链缺少 hash（曲目信息不完整）');
  err.soft = true;
  throw err;
}

// ============== 跨平台兜底：QQ → 酷狗同曲 ==============

function normName(s) {
  return String(s || '')
    .replace(/[（(][^）)]*[）)]/g, '')   // 去掉括号内容（feat./伴奏/remix 等）
    .replace(/[（(].*$/, '')
    .replace(/[\s\-_·、,，.。!！?？'"“”‘’()（）\[\]【】/\\]/g, '')
    .toLowerCase();
}

function artistTokens(s) {
  return String(s || '')
    .split(/[/、,&;；]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

// 变体标记：这些版本虽可播放，但与用户点选的原曲有听感差异，排序时需要降权
const VARIANT_RE = /(伴奏|纯音乐|instrumental|\bdj\b|remix|环绕|\b8d\b|\b3d\b|降调|升调|加速|慢速|倍速|live|演唱会|翻唱|cover|片段|铃声|钢琴|吉他|古筝|女声|男声|童声|合唱|独唱)/i;

/** 候选曲目与目标曲目的相似度打分 */
function similarity(cand, target) {
  const a = normName(cand.name);
  const b = normName(target.name);
  if (!a || !b) return -1;
  let score = 0;
  if (a === b) score += 6;
  else if (a.includes(b) || b.includes(a)) score += 3;
  else return -1; // 歌名都不沾边，直接淘汰

  const tokens = artistTokens(target.artist);
  const candArtist = String(cand.artist || '').toLowerCase().replace(/\s/g, '');
  const artistHit = tokens.some((t) => t && candArtist.includes(t.replace(/\s/g, '')));
  if (artistHit) score += 4;

  const cd = Number(cand.duration || 0);
  const td = Number(target.duration || 0);
  if (cd && td) {
    const diff = Math.abs(cd - td) / 1000;
    if (diff <= 8) score += 4;
    else if (diff <= 20) score += 1;
    else if (diff <= 60) score -= 1;
    else score -= 4;
  }

  // 变体降权（DJ/伴奏/Live/女声版…）：能播但听感不同，有原版时优先原版
  if (VARIANT_RE.test(String(cand.name || ''))) score -= 2;
  return score;
}

/**
 * 到酷狗找同一首歌。用于 QQ 无法取链时兜底。
 * 命中后返回 { url, ... , matched: { name, artist, score } }，找不到返回 null
 */
async function fallbackToKugou({ name, artist, duration }) {
  if (!name) return null;

  const pack = (hit, loose) => {
    const { cand, score } = hit.meta;
    return {
      ...hit,
      from: 'kugou-fallback',
      matched: { name: cand.name, artist: cand.artist, score, id: cand.id, loose: !!loose },
    };
  };

  const strictHit = await tryCandidates(
    await collectKugouCandidates(name, artist, duration, { strict: true }), '128',
  );
  if (strictHit && strictHit.meta) return pack(strictHit, false);

  const looseHit = await tryCandidates(
    await collectKugouCandidates(name, artist, duration, { strict: false }), '128',
  );
  if (looseHit && looseHit.meta) return pack(looseHit, true);
  return null;
}

// ============== QQ 原生取链（需登录态） ==============

/** QQ vkey 必须 POST，单独实现 */
async function qqVkeyPost(musicInfo, auth, quality) {
  const mid = String(musicInfo.songmid || '');
  if (!mid) throw new Error('QQ 取链缺少 songmid');
  if (!auth || !auth.uin || !auth.qmKeyst) throw new Error('未配置 QQ 登录态');

  const guid = String(1000000000 + Math.floor(Math.random() * 8999999999));
  const q = quality === 'flac' ? 'F000' : quality === '128' ? 'M500' : 'M800';
  const ext = quality === 'flac' ? 'flac' : 'mp3';
  const body = {
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: {
        guid,
        songmid: [mid],
        songtype: [0],
        uin: String(auth.uin),
        loginflag: 1,
        platform: '20',
        filename: [`${q}${mid}${mid}.${ext}`],
      },
    },
    comm: { uin: Number(auth.uin) || 0, format: 'json', ct: 24, cv: 0 },
  };
  const r = await requestAsync('https://u.y.qq.com/cgi-bin/musicu.fcg?format=json', {
    method: 'POST',
    timeout: 12000,
    headers: {
      'User-Agent': DESKTOP_UA,
      'Content-Type': 'application/json',
      Referer: 'https://y.qq.com/',
      Cookie: `uin=${auth.uin}; qm_keyst=${auth.qmKeyst}`,
    },
    body: JSON.stringify(body),
  });
  let j = r.body;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch { throw new Error('QQ 接口返回非法 JSON'); } }
  const d = j && j.req_0 && j.req_0.data;
  const info = d && d.midurlinfo && d.midurlinfo[0];
  const purl = info && info.purl;
  if (!purl) throw new Error(`QQ 未返回播放地址（${(info && info.errtype) || (j && j.req_0 && j.req_0.code) || '未知'}）`);
  const sip = (d.sip && d.sip[0]) || 'https://dl.stream.qqmusic.qq.com/';
  return {
    url: sip + purl,
    bitRate: quality === 'flac' ? 900 : quality === '128' ? 128 : 320,
    ext,
    duration: 0,
    from: 'qq-native',
    matched: null,
  };
}

// ============== 对外入口 ==============

/**
 * 解析平台曲目的播放地址。
 * @param {object} p
 * @param {'tx'|'kg'} p.platform
 * @param {object} p.musicInfo  搜索结果里的 musicInfo（含 hash/hashes/songmid）
 * @param {string} p.name       歌名（兜底匹配用）
 * @param {string} p.artist     歌手
 * @param {number} p.duration   时长（毫秒）
 * @param {string} p.quality    期望音质
 */
async function resolvePlatformUrl({ platform, musicInfo = {}, name, artist, duration, quality = '320' }) {
  const key = `${platform}:${musicInfo.hash || musicInfo.songmid || `${name}|${artist}`}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  let result = null;
  let lastErr = null;

  if (platform === 'kg') {
    try {
      result = await kugouBestEffort(musicInfo, { quality, name, artist, duration });
    } catch (e) {
      lastErr = e;
    }
  } else if (platform === 'tx') {
    const auth = readAuth().tx;
    if (auth && auth.uin && auth.qmKeyst) {
      try {
        result = await qqVkeyPost(musicInfo, auth, quality);
      } catch (e) {
        lastErr = e;
      }
    }
    if (!result) {
      // 无登录态 / vkey 失败 → 跨平台兜底
      try {
        result = await fallbackToKugou({ name, artist, duration });
        if (!result && !lastErr) {
          lastErr = new Error('QQ 需登录态取链，且未在酷狗找到同一首');
          lastErr.soft = true; // 曲目属性，不是平台故障
        }
      } catch (e) {
        lastErr = e;
      }
    }
  } else {
    throw new Error(`不支持的平台：${platform}`);
  }

  if (!result) {
    // soft 失败（付费/无版权/未登录）属曲目属性，不计入平台健康度
    if (!(lastErr && lastErr.soft)) markFail(platform, lastErr);
    throw lastErr || new Error('取链失败');
  }
  markOk(platform);
  cacheSet(key, result);
  return result;
}

function getHealth() {
  return JSON.parse(JSON.stringify(health));
}

function clearCache() {
  cache.clear();
}

/** 当前取链缓存条目数（设置页展示「内存缓存」用） */
function cacheSize() {
  return cache.size;
}

module.exports = {
  resolvePlatformUrl,
  fallbackToKugou,
  kugouBestEffort,
  getHealth,
  clearCache,
  cacheSize,
  setAuthPath,
  __test: { similarity, normName, kugouByHash },
};
