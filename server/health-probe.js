'use strict';
/**
 * 平台健康主动探测。
 *
 * 为什么需要：非官方接口随时会变，坏掉是常态而不是意外。以前只有用户点播放才发现，
 * 而且报错长得和「这首歌没源」一模一样。这里把它拆开：
 *   - search：该平台能否召回结果；
 *   - url：能否为召回到的第一首歌取到播放地址（走的就是播放用的那条链，结论可直接复现）。
 * 结果落盘 userData/health.json，重启后现场还在；状态迁移记一条日志，便于回答「从什么时候开始坏」。
 *
 * 三条纪律：
 *   1. 探测失败绝不抛出到调用方 —— 监控自己不能变成故障源；
 *   2. 网易云离线（ENABLE_NCM=0 或子进程没起来）时不探测、不报警，
 *      否则测试与离线模式会被一堆「不可用」的横幅刷屏；
 *   3. 只有该平台自己出问题才记 down/warn。付费墙、需要登录态、依赖用户没导入的音源
 *      都不是「平台坏了」，标成 warn/unknown 并在界面上说清原因。
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const platformSearch = require('./platform-search');
const platformUrl = require('./platform-url');
const ncm = require('./ncm-client');
const { META } = require('./platforms');

const LOG_MAX = 40;
const STAGE_TIMEOUT = 20000;
// 固定探测词：结果稳定、各大平台都有免费收录，也便于跨轮次对比
const PROBE_KEYWORD = '晴天';

// 网易云排在最前：它是跨源兜底的最后一环，坏掉影响面最大
const PLATFORMS = ['wy', 'tx', 'kg', 'kw', 'mg', 'qs'];

let FILE = '';
let cfg = { enabled: true, intervalMinutes: 30 };
let results = {}; // key -> { state, checkedAt, stages, note, lastOkAt }
let log = []; // [{ at, platform, from, to, reason }]
let onlineRef = () => false;
let lastCycleAt = 0;
let probing = null; // 手动触发时复用同一个 Promise，避免两轮探测互相打脸

const events = new EventEmitter();

function init(dataDir, { online } = {}) {
  FILE = path.join(dataDir, 'health.json');
  if (typeof online === 'function') onlineRef = online;
  read();
}

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (j && typeof j === 'object') {
      cfg = { ...cfg, ...(j.config || {}) };
      results = j.current && typeof j.current === 'object' ? j.current : {};
      log = Array.isArray(j.log) ? j.log.slice(0, LOG_MAX) : [];
      lastCycleAt = Number(j.lastCycleAt) || 0;
    }
  } catch (_) { /* 首次运行或文件损坏，按空表处理 */ }
}

function write() {
  try {
    fs.writeFileSync(FILE, JSON.stringify({ config: cfg, current: results, log, lastCycleAt }, null, 2));
  } catch (e) {
    console.warn('[health] 状态落盘失败:', e.message);
  }
}

/* ---------------- 工具 ---------------- */

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`探测超时（${Math.round(ms / 1000)}s）`)), ms); }),
  ]);
}

/** 跑一级探测，返回 { ok, ms, detail, error }；永不抛出 */
async function timed(fn) {
  const at = Date.now();
  try {
    const r = await withTimeout(fn(), STAGE_TIMEOUT);
    return { ok: true, ms: Date.now() - at, detail: String((r && r.detail) || '').slice(0, 160), error: '' };
  } catch (e) {
    return { ok: false, ms: Date.now() - at, detail: '', error: String((e && e.message) || e || '未知错误').slice(0, 200) };
  }
}

function normalizeRow(r, platform) {
  if (!r) return null;
  return {
    name: r.name || '',
    artist: r.artist || '',
    duration: Number(r.duration || 0) || 0,
    musicInfo: r.musicInfo || (platform === 'wy' ? { id: String(r.id || '') } : r),
    platformId: String(r.id || r.songmid || r.hash || ''),
  };
}

/* ---------------- 单平台探测 ---------------- */

async function searchRows(key) {
  if (key === 'wy') {
    const list = await ncm.searchSongs(PROBE_KEYWORD, 5, 0);
    if (!Array.isArray(list) || !list.length) throw new Error('网易云搜索没有返回结果');
    return list.map((r) => normalizeRow(r, 'wy'));
  }
  const data = await platformSearch.searchPlatform(key, PROBE_KEYWORD, 1, 5);
  const list = (data && data.list) || [];
  if (!list.length) throw new Error('搜索没有返回结果');
  return list.map((r) => normalizeRow(r, key));
}

/**
 * 探某一个平台。
 * 无原生取链能力的平台（咪咕靠跨源兜底、汽水靠音源）不探 url 级：
 * 它们「取不到链」是设计如此，报成故障只会制造噪音。
 */
async function probePlatform(key) {
  const meta = META[key] || {};
  const search = await timed(async () => {
    const rows = await searchRows(key);
    return { rows, detail: `${rows.length} 条结果，首条《${rows[0].name}》` };
  });
  const sample = search.rows && search.rows[0];
  const stages = { search };
  let state;
  let note = '';

  if (!search.ok) {
    state = 'down';
  } else if (meta.playback === 'source') {
    state = 'ok';
    note = '播放依赖自定义音源，本次未探测取链';
  } else if (meta.playback === 'fallback') {
    state = 'ok';
    note = '该平台无原生取链，播放走跨源兜底';
  } else {
    const url = await timed(async () => {
      const r = await platformUrl.resolvePlatformUrl({
        platform: key,
        musicInfo: sample.musicInfo || {},
        name: sample.name,
        artist: sample.artist,
        duration: sample.duration,
        quality: '320',
        // 只探该平台自己：带上备选与跨源兜底会把别人的可用性也算进来，结论就失真了
        alternatives: [],
        noFallback: true,
      });
      if (!r || !r.url) throw new Error('取链没有返回地址');
      return { detail: `来自 ${r.from || '原生'}${r.bitRate ? ` · ${r.bitRate}k` : ''}` };
    });
    stages.url = url;
    if (url.ok) {
      state = 'ok';
    } else if (/登录|cookie|需付费|VIP/i.test(url.error)) {
      state = 'warn';
      note = url.error;
    } else {
      state = 'warn';
    }
  }
  return finalize(key, state, stages, sample, note);
}

function finalize(key, state, stages, sample, note = '') {
  const prev = results[key];
  const entry = {
    key,
    label: (META[key] && META[key].label) || key,
    state,
    checkedAt: Date.now(),
    ms: Object.values(stages).reduce((s, x) => s + (x && x.ms ? x.ms : 0), 0),
    stages,
    sample: sample ? { name: sample.name, artist: sample.artist } : null,
    note: note || '',
    // 上次成功时间：即使现在坏了，用户也能看到「什么时候还是好的」
    lastOkAt: state === 'ok' ? Date.now() : (prev && prev.lastOkAt) || 0,
  };
  results[key] = entry;
  if (!prev || prev.state !== state) {
    const failing = stages.url && !stages.url.ok ? stages.url : (stages.search.ok ? null : stages.search);
    log.unshift({
      at: Date.now(),
      platform: key,
      from: prev ? prev.state : 'unknown',
      to: state,
      reason: String((failing && failing.error) || note || '').slice(0, 200),
    });
    log = log.slice(0, LOG_MAX);
    events.emit('change', entry);
  }
  write();
  return entry;
}

/* ---------------- 一轮探测 ---------------- */

/**
 * 并发探测全部平台，每平台独立兜错：一个卡住不能拖住整轮。
 * force=true（手动/测试）时忽略「网易云离线」跳过，以便在离线宿主上验证探测与落盘链路。
 */
async function checkAll({ force = false } = {}) {
  if (probing) return probing;
  if (!cfg.enabled && !force) return snapshot();
  if (!force && !onlineRef()) return snapshot();
  probing = (async () => {
    const started = Date.now();
    // 搜索有 5 分钟缓存，探测必须回源，否则「坏没坏」读到的是上一轮的旧结果
    platformSearch.clearSearchCache();
    platformUrl.clearCache();
    const list = await Promise.all(PLATFORMS.map((k) => probePlatform(k).catch((e) => {
      finalize(k, 'unknown', {}, null, `探测异常：${e && e.message}`);
      return results[k];
    })));
    lastCycleAt = Date.now();
    const out = { at: lastCycleAt, ms: Date.now() - started, platforms: list };
    write();
    events.emit('cycle', out);
    return out;
  })();
  probing = probing.finally(() => { probing = null; });
  return probing;
}

function worst(list) {
  const rank = { down: 3, warn: 2, unknown: 1, ok: 0 };
  return list.reduce((a, b) => (rank[b.state] > rank[a.state] ? b : a), list[0]);
}

function snapshot() {
  const all = Object.values(results);
  const broken = all.filter((r) => r.state === 'down');
  const warn = all.filter((r) => r.state === 'warn');
  const nextAt = cfg.enabled && cfg.intervalMinutes > 0 && lastCycleAt
    ? lastCycleAt + cfg.intervalMinutes * 60000 : 0;
  return {
    config: { ...cfg },
    probed: all.length,
    lastCycleAt,
    nextAt,
    probing: !!probing,
    // 横幅只在真实在线时给结论；worst 只取最严重的那一个平台，一句话讲清楚
    alert: onlineRef() && broken.length
      ? (() => {
        const w = worst(broken);
        const stage = (w.stages && w.stages.url && !w.stages.url.ok && w.stages.url.error)
          || (w.stages && w.stages.search && w.stages.search.error) || w.note || '';
        return { key: w.key, label: w.label, reason: String(stage).slice(0, 120), since: w.checkedAt, count: broken.length };
      })()
      : null,
    platforms: all.map((r) => ({ ...r })),
    log: log.slice(0, LOG_MAX),
    summary: { broken: broken.length, warn: warn.length },
  };
}

function saveConfig(input = {}) {
  const next = { ...cfg };
  if (typeof input.enabled === 'boolean') next.enabled = input.enabled;
  const iv = Number(input.intervalMinutes);
  if (Number.isFinite(iv)) next.intervalMinutes = Math.min(1440, Math.max(0, Math.round(iv)));
  cfg = next;
  write();
  schedule();
  return { ...cfg };
}

/* ---------------- 定时器 ---------------- */

let timer = null;
function schedule() {
  if (timer) { clearInterval(timer); timer = null; }
  if (!cfg.enabled || cfg.intervalMinutes <= 0) return;
  timer = setInterval(() => { checkAll().catch(() => {}); }, cfg.intervalMinutes * 60000);
  // 定时器不能让进程保活（纯 node 调试模式下退出会被它拖住）
  if (typeof timer.unref === 'function') timer.unref();
}

/** 启动后延后再探：NCM 子进程与音源脚本都在抢起步资源，太早探会全是超时 */
function start({ delayMs = 90000 } = {}) {
  schedule();
  const t = setTimeout(() => { checkAll().catch(() => {}); }, delayMs);
  if (typeof t.unref === 'function') t.unref();
}

module.exports = { init, checkAll, snapshot, saveConfig, start, schedule, events, PLATFORMS, PROBE_KEYWORD };
