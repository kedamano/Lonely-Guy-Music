'use strict';
/**
 * 默认音源 + 洛雪音源列表定时探测。
 *
 * 为什么需要：用户那张截图里 5 个社区音源（六音 / LX官方 / Flower / Huibq / JuheApi）
 * 就是当前能用的「默认曲库」。但它们是第三方脚本，随时会换地址甚至失效——
 * 以前只能用户手动去站长页复制再导入，一旦音源挂了就整片放不出来。
 *
 * 这里做两件事：
 *   1. 把这批音源作为「出厂默认」内置：首次启动自动导入并启用，开箱即听，不必手动粘贴；
 *   2. 定时探测 lxmusic.ijinshan.com 的音源列表页，发现新地址/新音源就同步更新，
 *      让「默认曲库」始终是最新版，而不是一次写死。
 *
 * 三条纪律：
 *   1. 探测失败绝不抛出到调用方 —— 监控自己不能变成故障源；
 *   2. 自动导入失败时只记 warn 不阻断启动，离线/脚本失效都不应挡住软件；
 *   3. 只动「默认音源」这一组。用户自己导入的音源不受影响。
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const sourceManager = require('./source-manager');
// 版本号单一来源：以前把 UA 里的版本写死，发版时容易漏改
const APP_VERSION = require('../package.json').version;

const PROBE_URL = 'https://lxmusic.ijinshan.com/sound-source/index.html';
const PAGE_UPDATE_RE = /攻略更新于\s*(\d{4}\/\d{1,2}\/\d{1,2})/;
// pdone 仓库的 latest.js 直链：捕获「main/<key>/latest.js」相对路径
const FULL_RE = /(?:https?:\/\/)?raw\.githubusercontent\.com\/pdone\/lx-music-source\/([^\s"'<>]+?\/latest\.js)/gi;

// 已知音源的展示名（探到的 key 若不在表里，回退用 key 本身）
const KNOWN_NAMES = {
  sixyin: '六音音源', lx: 'LX官方源', flower: 'Flower音源', huibq: 'Huibq音源', juhe: 'JuheApi音源',
};

// 1.4.1 起内置的出厂默认音源（首次启动自动导入）；此后由定时探测同步最新地址
const DEFAULT_SOURCES = [
  { key: 'sixyin', name: '六音音源', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/sixyin/latest.js', maintainer: '社区（六音）' },
  { key: 'lx', name: 'LX官方源', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/lx/latest.js', maintainer: '社区（pdone 仓库）' },
  { key: 'flower', name: 'Flower音源', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/flower/latest.js', maintainer: '社区（Flower）' },
  { key: 'huibq', name: 'Huibq音源', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/huibq/latest.js', maintainer: '社区（Huibq）' },
  { key: 'juhe', name: 'JuheApi音源', url: 'https://raw.githubusercontent.com/pdone/lx-music-source/main/juhe/latest.js', maintainer: '社区（JuheApi）' },
];

const PROBE_INTERVALS = [
  { key: '0', label: '不自动' },
  { key: '360', label: '6 小时' },
  { key: '720', label: '12 小时' },
  { key: '1440', label: '每天' },
];

let FILE = '';
let cfg = { enabled: true, intervalMinutes: 360 };
let data = {
  lastProbeAt: 0,
  lastProbeError: '',
  updatedAt: '',
  discovered: [], // [{ key, name, url, maintainer, checkedAt }]
};
let imported = {}; // id|key -> { url, at, id, key }
let sm = null;
let onlineRef = () => false;
let probing = null;
let timer = null;
const events = new EventEmitter();

function init(dataDir, { online } = {}) {
  FILE = path.join(dataDir, 'sound-sources.json');
  if (typeof online === 'function') onlineRef = online;
  read();
}

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (j && typeof j === 'object') {
      cfg = { ...cfg, ...(j.config || {}) };
      data = { ...data, ...(j.state || {}) };
      imported = j.imported && typeof j.imported === 'object' ? j.imported : {};
    }
  } catch (_) { /* 首次运行或文件损坏，按空表处理 */ }
}

function write() {
  try {
    fs.writeFileSync(FILE, JSON.stringify({ config: cfg, state: data, imported }, null, 2));
  } catch (e) {
    console.warn('[sound-sources] 状态落盘失败:', e.message);
  }
}

/* ---------------- 解析音源列表页 ---------------- */

/**
 * 从页面 HTML 里抽取所有 pdone 仓库的 latest.js 直链。
 * 不依赖 DOM：用正则直接抓 raw.githubusercontent.com 的裸链接，健壮且零依赖。
 * @returns {{updatedAt:string, sources:Array<{key:string,name:string,url:string,maintainer:string}>}}
 */
function parsePage(html) {
  const updatedAt = (html.match(PAGE_UPDATE_RE) || [])[1] || '';
  const sources = [];
  const seen = new Set();
  let m;
  FULL_RE.lastIndex = 0;
  while ((m = FULL_RE.exec(html))) {
    const rel = m[1];
    const key = rel.split('/')[1];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sources.push({
      key,
      name: KNOWN_NAMES[key] || key,
      url: 'https://raw.githubusercontent.com/pdone/lx-music-source/' + rel,
      maintainer: '',
    });
  }
  return { updatedAt, sources };
}

async function fetchLatest() {
  const resp = await sourceManager.requestAsync(PROBE_URL, {
    method: 'GET',
    timeout: 30000,
    headers: {
      'User-Agent': `Mozilla/5.0 (compatible; GumanMusic/${APP_VERSION})`,
      Accept: 'text/html,application/xhtml+xml',
    },
    redirectLimit: 5,
  });
  if (resp.statusCode !== 200) throw new Error('音源列表页返回 HTTP ' + resp.statusCode);
  const body = typeof resp.body === 'string' ? resp.body : String(resp.body || '');
  return parsePage(body);
}

/* ---------------- 当前默认音源集合 ---------------- */

/**
 * 合并「出厂默认」与「探测发现」：探测到的新地址覆盖旧地址，
 * 页面上出现的新音源也会被纳入默认集（保证「及时更新最新音源」）。
 */
function getDefaults() {
  const byKey = new Map(DEFAULT_SOURCES.map((s) => [s.key, { ...s }]));
  for (const d of data.discovered) {
    if (byKey.has(d.key)) byKey.get(d.key).url = d.url;
    else byKey.set(d.key, { key: d.key, name: d.name, url: d.url, maintainer: d.maintainer || '' });
  }
  return Array.from(byKey.values());
}

/* ---------------- 自动导入默认音源 ---------------- */

function idOf(name) {
  return sourceManager.safeId(name);
}

/**
 * 把默认音源导入并启用（若尚未导入，或地址已变则更新）。
 * 幂等：已导入且地址未变的会跳过，避免每次启动都重新下载脚本。
 * 单个失败只记 warn，不阻断其它音源与启动流程。
 */
async function ensureImported({ force = false } = {}) {
  if (!sm) return { imported: [], updated: [], skipped: [] };
  const defaults = getDefaults();
  const cfgSources = (sm.getConfig().sources || []).map((s) => s.id);
  const haveId = (id) => cfgSources.includes(id);
  const importedList = [];
  const updatedList = [];
  const skipped = [];

  for (const d of defaults) {
    const id = idOf(d.name);
    const rec = imported[id] || imported[d.key] || {};
    if (!force && haveId(id) && rec.url === d.url) {
      skipped.push(d.key);
      continue;
    }
    try {
      const r = await sm.addSource({ url: d.url });
      const rid = r.id;
      const entry = { url: d.url, at: Date.now(), id: rid, key: d.key };
      imported[rid] = entry;
      imported[id] = entry;
      imported[d.key] = entry;
      if (rec.url) updatedList.push(d.key);
      else importedList.push(d.key);
    } catch (e) {
      console.warn(`[sound-sources] 自动导入「${d.name}」失败：${e.message}`);
    }
  }
  write();
  events.emit('change', snapshot());
  return { imported: importedList, updated: updatedList, skipped };
}

/* ---------------- 一次探测 ---------------- */

async function probe(force = false) {
  if (probing) return probing;
  if (!cfg.enabled && !force) return snapshot();
  probing = (async () => {
    try {
      const page = await fetchLatest();
      data.updatedAt = page.updatedAt;
      const map = new Map(data.discovered.map((s) => [s.key, s]));
      for (const s of page.sources) {
        const existing = map.get(s.key);
        if (!existing || existing.url !== s.url) {
          map.set(s.key, { ...s, maintainer: (existing && existing.maintainer) || s.maintainer, checkedAt: Date.now() });
        }
      }
      data.discovered = Array.from(map.values());
      data.lastProbeError = '';
      data.lastProbeAt = Date.now();
      write();
      events.emit('probe', snapshot());
      // 探测到最新地址后顺手同步导入，保证开箱默认曲库始终最新
      const result = await ensureImported({ force: false });
      return { ...snapshot(), sync: result };
    } catch (e) {
      data.lastProbeError = String((e && e.message) || e);
      write();
      throw e;
    } finally {
      probing = null;
    }
  })();
  return probing;
}

/* ---------------- 快照 / 配置 ---------------- */

function snapshot() {
  const defaults = getDefaults();
  const cfgSources = sm ? (sm.getConfig().sources || []).map((s) => s.id) : [];
  const ids = new Set(cfgSources);
  const sources = defaults.map((d) => {
    const rec = imported[d.key] || imported[idOf(d.name)] || {};
    const importedFlag = !!(rec.id && ids.has(rec.id));
    return {
      key: d.key,
      name: d.name,
      url: d.url,
      maintainer: d.maintainer,
      imported: importedFlag,
      upToDate: importedFlag && rec.url === d.url,
      lastUrl: rec.url || '',
      importedAt: rec.at || 0,
    };
  });
  return {
    config: { ...cfg },
    lastProbeAt: data.lastProbeAt,
    lastProbeError: data.lastProbeError,
    updatedAt: data.updatedAt,
    probing: !!probing,
    autoEnabled: cfg.enabled,
    sources,
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

function schedule() {
  if (timer) { clearInterval(timer); timer = null; }
  if (!cfg.enabled || cfg.intervalMinutes <= 0) return;
  timer = setInterval(() => { probe().catch(() => {}); }, cfg.intervalMinutes * 60000);
  if (typeof timer.unref === 'function') timer.unref();
}

/** 启动后延后再探：音源脚本与 NCM 子进程都在抢起步资源，太早探会全是超时 */
function start({ delayMs = 120000 } = {}) {
  schedule();
  const t = setTimeout(() => { probe().catch(() => {}); }, delayMs);
  if (typeof t.unref === 'function') t.unref();
}

function attach(sourceManagerInstance) { sm = sourceManagerInstance; }

module.exports = {
  init,
  attach,
  start,
  schedule,
  probe,
  ensureImported,
  snapshot,
  saveConfig,
  parsePage,
  getDefaults,
  PROBE_URL,
  DEFAULT_SOURCES,
  PROBE_INTERVALS,
  events,
  __test: {
    getImported: () => imported,
    getState: () => data,
    getConfig: () => cfg,
    reset: () => { data = { lastProbeAt: 0, lastProbeError: '', updatedAt: '', discovered: [] }; imported = {}; cfg = { enabled: true, intervalMinutes: 360 }; },
  },
};
