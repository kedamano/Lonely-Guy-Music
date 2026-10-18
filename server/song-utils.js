'use strict';
/**
 * 曲目文本归一化、相关性打分、去重与跨平台合并（纯函数）。
 *
 * 多平台搜索的上游差异很大：酷狗用 <em> 高亮、酷我是 HTML 实体 + 伪 JSON、
 * 各平台繁简体与全半角混用、同一首歌的翻唱/伴奏/DJ 版本标题只差括号里的几个字。
 * 这一层只做「可比较」的文本，不改用户看到的原始标题：
 *   - 显示文本：NFKC + 解实体 + 剥标签，保留原文的简繁
 *   - 匹配键：在显示文本基础上再做繁转简、去括号、去标点空格
 *
 * opencc-js 体积较大（约 6MB），因此懒加载 + 有界缓存；加载失败只降级不阻塞搜索。
 */

const CJK_RE = /[㐀-鿿豈-﫿]/;
const SIMP_CACHE_MAX = 4096;
const simpCache = new Map();
let openccTried = false;
let openccConverter = null;

const MIN_TRACK_MS = 30000;
const MAX_ALT_SOURCES = 8;

/** 繁转简：无 CJK 直接返回；结果缓存，避免同一歌手/专辑反复转换 */
function toSimplified(input) {
  const s = String(input == null ? '' : input);
  if (!CJK_RE.test(s)) return s;
  const hit = simpCache.get(s);
  if (hit !== undefined) return hit;
  if (!openccTried) {
    openccTried = true;
    try {
      // eslint-disable-next-line global-require
      const OpenCC = require('opencc-js');
      openccConverter = OpenCC.Converter({ from: 't', to: 'cn' });
    } catch (e) {
      openccConverter = null;
      console.warn(`[song-utils] 繁简转换不可用，已跳过：${e.message}`);
    }
  }
  let out = s;
  if (openccConverter) {
    try { out = openccConverter(s); } catch (_) { out = s; }
  }
  if (simpCache.size >= SIMP_CACHE_MAX) simpCache.delete(simpCache.keys().next().value);
  simpCache.set(s, out);
  return out;
}

const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  hellip: '…', middot: '·', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
};

/** 解码 HTML 实体（含十进制/十六进制数字实体） */
function decodeEntities(input) {
  return String(input == null ? '' : input).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      try { return String.fromCodePoint(code); } catch (_) { return m; }
    }
    const v = NAMED_ENTITIES[body.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function stripHtml(input) {
  return decodeEntities(String(input == null ? '' : input).replace(/<[^>]*>/g, ''));
}

/** 显示文本：NFKC（全角→半角）+ 解实体 + 剥标签 + 压缩空白；不做繁简转换 */
function cleanText(input) {
  return String(input == null ? '' : input)
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m) => decodeEntities(m))
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 兼容旧命名：normalizeText 与 cleanText 同义 */
const normalizeText = cleanText;

/** 去掉 (...)（含全角）、[...]、【...】 以及未闭合的尾部括号内容 */
function stripBrackets(input) {
  let s = String(input == null ? '' : input);
  s = s.replace(/[（(][^）)]*[）)]/g, ' ');
  s = s.replace(/\[[^\]]*\]/g, ' ');
  s = s.replace(/【[^】]*】/g, ' ');
  s = s.replace(/[（(][^）)]*$/, ' ');
  s = s.replace(/\[[^\]]*$/, ' ');
  s = s.replace(/【[^】]*$/, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** 匹配键：繁转简 + 去括号 + 去标点空白 + 小写 */
function normName(input) {
  return toSimplified(stripBrackets(cleanText(input)))
    .replace(/[\s\-_·、,，.。!！?？:：;；&'"“”‘’()（）[\]【】/\\|]/g, '')
    .toLowerCase();
}

/** 歌手拆分：保留原始大小写与空格，供展示/搜索词复用 */
function artistTokens(input) {
  const raw = Array.isArray(input) ? input.join('/') : String(input == null ? '' : input);
  return raw
    .split(/[/、,&;；|]/)
    .map((t) => toSimplified(cleanText(t)))
    .filter(Boolean);
}

/** 主歌手：第一个 token（搜索召回时锁得太死，跨源匹配会另加纯歌名一路） */
function mainArtist(input) {
  return artistTokens(input)[0] || '';
}

// 版本标记：只标记、不隐藏。排序时降权；用户搜索词本身包含该标记时降权取消。
const VARIANT_RULES = [
  { tag: '伴奏', re: /(伴奏|karaoke|off\s*-?\s*vocal)/i },
  { tag: '纯音乐', re: /(纯音乐|instrumental|钢琴版|吉他版|古筝版)/i },
  { tag: 'DJ', re: /(\bdj\b|\bremix\b|环绕|\b8d\b|\b3d\b|降调|升调|加速|慢速|倍速)/i },
  { tag: 'Live', re: /(\blive\b|演唱会)/i },
  { tag: '翻唱', re: /(翻唱|\bcover\b)/i },
  { tag: '片段', re: /(片段|铃声|试听版)/i },
  { tag: '合唱', re: /(合唱)/i },
  { tag: '独唱', re: /(独唱)/i },
  { tag: '女声', re: /(女声)/i },
  { tag: '男声', re: /(男声)/i },
  { tag: '童声', re: /(童声)/i },
  { tag: 'Acoustic', re: /(acoustic|unplugged)/i },
  { tag: 'Demo', re: /(\bdemo\b)/i },
];
const VARIANT_RE = new RegExp(VARIANT_RULES.map((r) => r.re.source).join('|'), 'i');

/** 返回规范版本标签（如 'Live' / '伴奏'），无标记返回 null */
function variantTag(name, artist = '') {
  const text = `${cleanText(name)} ${cleanText(artist)}`;
  for (const rule of VARIANT_RULES) {
    if (rule.re.test(text)) return rule.tag;
  }
  return null;
}

const normToken = (t) => toSimplified(String(t || '')).replace(/\s/g, '').toLowerCase();

/** 候选曲目与目标曲目的相似度打分（沿用取链兜底的打分口径） */
function similarity(cand, target) {
  const a = normName(cand && cand.name);
  const b = normName(target && target.name);
  if (!a || !b) return -1;
  let score = 0;
  if (a === b) score += 6;
  else if (a.includes(b) || b.includes(a)) score += 3;
  else return -1; // 歌名都不沾边，直接淘汰

  const tokens = artistTokens(target && target.artist).map(normToken).filter(Boolean);
  const candArtist = artistTokens(cand && cand.artist).map(normToken).join('');
  if (tokens.some((t) => t && candArtist.includes(t))) score += 4;

  const cd = Number((cand && cand.duration) || 0);
  const td = Number((target && target.duration) || 0);
  if (cd && td) {
    const diff = Math.abs(cd - td) / 1000;
    if (diff <= 8) score += 4;
    else if (diff <= 20) score += 1;
    else if (diff <= 60) score -= 1;
    else score -= 4;
  }

  if (variantTag(cand && cand.name, cand && cand.artist)) score -= 2;
  return score;
}

/** 搜索词相关性：歌名优先，其次歌手；用于平台内排序与聚合组排序 */
function relevance(track, keyword) {
  const q = normName(keyword);
  const name = normName(track && track.name);
  const artist = normName(track && track.artist);
  if (!q) return 0;
  let score = 0;
  if (name && name === q) score += 14;
  else if (name && (q.includes(name) || name.includes(q))) score += 9;
  else {
    // 歌名不完整命中时，按共同字符比例给一个弱分（最多 6）
    let hit = 0;
    for (const ch of new Set(name)) if (q.includes(ch)) hit++;
    score += name ? Math.min(6, Math.round((hit / name.length) * 6)) : 0;
  }
  if (artist && q.includes(artist)) score += 6;
  else {
    const tokens = artistTokens(track && track.artist).map(normToken).filter(Boolean);
    if (tokens.some((t) => q.includes(t))) score += 5;
  }
  const v = track && (track.variant || variantTag(track.name, track.artist));
  // 用户明确搜「Live / 伴奏 / DJ」时不要惩罚对应版本
  if (v && !VARIANT_RE.test(cleanText(keyword))) score -= 3;
  return score;
}

function durationBucket(ms, size = 2000) {
  const n = Number(ms || 0);
  return n > 0 ? Math.round(n / size) : 0;
}

/** 同一平台的精确去重键：歌名 + 主歌手 + 2 秒时长桶 */
function songKey(track) {
  return `${normName(track && track.name)}|${normToken(mainArtist(track && track.artist))}|${durationBucket(track && track.duration)}`;
}

/** 跨平台同曲判断：归一化歌名相同 + 歌手有交集 + 时长差 ≤8 秒 */
function sameSong(a, b) {
  if (!a || !b) return false;
  const an = normName(a.name);
  const bn = normName(b.name);
  if (!an || an !== bn) return false;

  const at = artistTokens(a.artist).map(normToken).filter(Boolean);
  const bt = artistTokens(b.artist).map(normToken).filter(Boolean);
  if (at.length && bt.length) {
    const overlap = at.some((x) => bt.some((y) => x.includes(y) || y.includes(x)));
    if (!overlap) return false;
  }

  const ad = Number(a.duration || 0);
  const bd = Number(b.duration || 0);
  if (ad && bd && Math.abs(ad - bd) > 8000) return false;
  return true;
}

/** FNV-1a → base36：稳定短 id（聚合行 / 音源缺 id 时的兜底） */
function hashKey(input) {
  let h = 2166136261;
  for (const ch of String(input == null ? '' : input)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** 主来源打分：能播、非 VIP、平台原生质量、封面/时长信息越全越靠前 */
function sourceScore(track, opts = {}) {
  const t = track || {};
  const platform = String(t.platform || '');
  let score = 0;
  if (t.playable !== false) score += 4;
  if (t.playable !== false && !t.vip) score += 8;
  const pref = { wy: 5, kg: 4, tx: 3, kw: 3, mg: 1, qs: 0 };
  score += pref[platform] !== undefined ? pref[platform] : 0;
  // 配了 QQ 登录态时，QQ 原生音质最好，主来源优先给 QQ
  if (platform === 'tx' && opts.txAuth) score += 3;
  if (Number(t.duration || 0) > 0) score += 1;
  const qh = t.qualityHints || {};
  if (qh.flac || qh.flac24bit) score += 2;
  else if (qh['320']) score += 1;
  if (t.albumPic) score += 0.5;
  if (t.variant) score -= 2;
  if (t.vip) score -= 6;
  if (t.playable === false) score -= 3;
  return score;
}

/** 平台内去重 + 排序：保留信息更全的一条，变体保留但降权 */
function rankAndDedupe(list, { keyword = '', dropShort = true } = {}) {
  const seen = new Map();
  const out = [];
  (Array.isArray(list) ? list : []).forEach((raw, i) => {
    if (!raw || !raw.name) return;
    const t = { ...raw };
    t.name = cleanText(t.name) || '未知曲目';
    t.artist = cleanText(t.artist) || '未知艺人';
    t.album = cleanText(t.album || '');
    t.duration = Number(t.duration || 0) || 0;
    if (dropShort && t.duration > 0 && t.duration < MIN_TRACK_MS) return;
    if (t.vip == null) t.vip = false;
    if (t.playable == null) t.playable = true;
    if (!t.variant) t.variant = variantTag(t.name, t.artist);
    // 排序用相关度（已含变体降权）；sourceScore 只用于同曲重复收录时挑信息更全的一条。
    // 不能把 VIP 降权混进排序：原曲常是 VIP，会把免费翻唱顶到原曲前面。
    t.score = relevance(t, keyword);
    t.pickScore = sourceScore(t);

    const key = `${t.platform || ''}|${songKey(t)}`;
    const prev = seen.get(key);
    if (prev) {
      // 同平台重复收录：保留分更高的一条；分数相同保留字段更全/更长的
      const better = t.pickScore > prev.pickScore
        || (t.pickScore === prev.pickScore && !t.vip && prev.vip)
        || (t.pickScore === prev.pickScore && t.duration > prev.duration);
      if (better) {
        t._i = prev._i;
        out[prev._out] = t;
        seen.set(key, { ...t, _out: prev._out });
      }
      return;
    }
    t._i = i;
    seen.set(key, { ...t, _out: out.length });
    out.push(t);
  });
  out.sort((a, b) => (b.score - a.score) || (a._i - b._i));
  out.forEach((t) => { delete t._i; delete t.pickScore; });
  return out;
}

/**
 * 跨平台合并：同一首歌只留一行，主来源按 sourceScore 选择，其余进 sources[]。
 * 输入应是各平台已排序的曲目；分组时与组内主来源比较（sameSong）。
 */
function mergeTracks(list, { keyword = '', limit = 60, txAuth = false } = {}) {
  const groups = [];
  (Array.isArray(list) ? list : []).forEach((raw) => {
    if (!raw || !raw.name) return;
    const src = { ...raw };
    src.name = cleanText(src.name) || '未知曲目';
    src.artist = cleanText(src.artist) || '未知艺人';
    src.album = cleanText(src.album || '');
    src.duration = Number(src.duration || 0) || 0;
    // 与平台内后处理一致：30 秒以下的铃声/试听片段不进入聚合结果
    if (src.duration > 0 && src.duration < MIN_TRACK_MS) return;
    if (src.vip == null) src.vip = false;
    if (src.playable == null) src.playable = true;
    if (!src.variant) src.variant = variantTag(src.name, src.artist);
    src.score = sourceScore(src, { txAuth });

    const group = groups.find((g) => sameSong(g.primary, src));
    if (group) {
      group.items.push(src);
      // 主来源取分最高者；同分保留先出现的
      if (src.score > group.primary.score) group.primary = src;
    } else {
      groups.push({ primary: src, items: [src], first: groups.length });
    }
  });

  const merged = groups.map((g) => {
    // 同一平台只保留一条（以分数最高者为准）
    const byPlatform = new Map();
    g.items.forEach((it) => {
      const k = `${it.platform || ''}:${it.platformId || it.id || ''}`;
      const old = byPlatform.get(k);
      if (!old || it.score > old.score) byPlatform.set(k, it);
    });
    const sources = [...byPlatform.values()]
      .sort((a, b) => (b.score - a.score))
      .slice(0, MAX_ALT_SOURCES);
    const primary = sources[0];
    const out = {
      ...primary,
      id: `agg:${hashKey(songKey(primary))}`,
      merged: sources.length > 1,
      sourceCount: sources.length,
      sources,
    };
    out._groupScore = relevance(primary, keyword) * 10
      + Math.min(sources.length, 5) * 2
      - (primary.variant ? 3 : 0)
      - (primary.vip ? 2 : 0);
    out._first = g.first;
    return out;
  });

  merged.sort((a, b) => (b._groupScore - a._groupScore) || (a._first - b._first));
  const sliced = merged.slice(0, Math.max(1, Number(limit) || 60));
  sliced.forEach((t) => { delete t._groupScore; delete t._first; delete t.score; });
  sliced.forEach((t) => t.sources.forEach((s) => { delete s.score; }));
  return sliced;
}

/** 搜索词变体：原词 + 去括号；标题带分隔符时补两种词序 */
function buildQueryVariants(keyword, { name, artist } = {}) {
  const add = (arr, v) => {
    const s = cleanText(v);
    if (s && !arr.includes(s)) arr.push(s);
  };
  const out = [];
  if (name) {
    const n = cleanText(name);
    const a = cleanText(artist || '');
    if (n && a) add(out, `${n} ${a}`);
    if (n && a) add(out, `${a} ${n}`);
    add(out, stripBrackets(n));
    return out.slice(0, 3);
  }

  const q = cleanText(keyword);
  add(out, q);
  add(out, stripBrackets(q));
  const sep = /\s+[-/–—|]\s+/.test(q);
  if (sep) {
    const parts = q.split(/\s+[-/–—|]\s+/).filter(Boolean);
    if (parts.length === 2) { add(out, parts[1]); add(out, `${parts[1]} ${parts[0]}`); }
  } else {
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) add(out, [...tokens.slice(1), tokens[0]].join(' '));
  }
  return out.slice(0, 3);
}

module.exports = {
  MIN_TRACK_MS,
  MAX_ALT_SOURCES,
  toSimplified,
  decodeEntities,
  stripHtml,
  cleanText,
  normalizeText,
  stripBrackets,
  normName,
  artistTokens,
  mainArtist,
  VARIANT_RE,
  VARIANT_RULES,
  variantTag,
  similarity,
  relevance,
  durationBucket,
  songKey,
  sameSong,
  hashKey,
  sourceScore,
  rankAndDedupe,
  mergeTracks,
  buildQueryVariants,
};
