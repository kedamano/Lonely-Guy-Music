/**
 * 洛雪音乐自定义音源运行时 / 管理器
 * 兼容官方自定义源脚本 API：
 *   https://lxmusic.toside.cn/desktop/custom-source
 *
 * 运行方式：在 Node vm 沙箱中执行脚本，提供 globalThis.lx 对象。
 * 脚本通过 lx.send(EVENT_NAMES.inited) 注册平台/音质，
 * 通过 lx.on(EVENT_NAMES.request) 响应 musicUrl / lyric / pic 请求。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const zlib = require('zlib');
const { URL } = require('url');

const SOURCES_DIR = process.env.GUMAN_USER_DATA
  ? path.join(process.env.GUMAN_USER_DATA, 'sources')
  : path.join(__dirname, '../userData/sources');
const INDEX_PATH = process.env.GUMAN_USER_DATA
  ? path.join(process.env.GUMAN_USER_DATA, 'sources.json')
  : path.join(__dirname, '../userData/sources.json');

const QUALITY_ORDER = ['flac24bit', 'flac', '320k', '192k', '128k'];
const VALID_QUALITIES = new Set(QUALITY_ORDER);
const VALID_SOURCES = new Set(['kw', 'kg', 'tx', 'wy', 'mg', 'qs', 'local']);

const registry = new Map(); // id -> source record
let config = { sources: [], quality: 'flac' };

function ensureDirs() {
  if (!fs.existsSync(SOURCES_DIR)) fs.mkdirSync(SOURCES_DIR, { recursive: true });
}

function loadConfig() {
  try {
    if (fs.existsSync(INDEX_PATH)) {
      config = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[source-manager] loadConfig failed:', e.message);
  }
  if (!config.sources) config.sources = [];
  if (!config.quality) config.quality = 'flac';
  if (typeof config.proxy !== 'string') config.proxy = ''; // 默认不使用代理
}

function saveConfig() {
  try {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('[source-manager] saveConfig failed:', e.message);
  }
}

function safeId(name) {
  return name.replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'source';
}

function safeFilename(name, ext = '.js') {
  const base = safeId(name) || 'source';
  let fn = base + ext;
  let i = 1;
  while (fs.existsSync(path.join(SOURCES_DIR, fn))) {
    fn = `${base}_${i}${ext}`;
    i++;
  }
  return fn;
}

function parseScriptMeta(code) {
  const meta = {
    name: '',
    description: '',
    version: '',
    author: '',
    homepage: '',
    rawScript: code,
  };
  const block = code.match(/\/\*[\s\S]*?\*\//);
  if (block) {
    const m = block[0];
    const get = (tag) => {
      const r = new RegExp(`@${tag}\\s+(.+)`);
      const x = m.match(r);
      return x ? x[1].trim() : '';
    };
    meta.name = get('name');
    meta.description = get('description');
    meta.version = get('version');
    meta.author = get('author');
    meta.homepage = get('homepage');
  }
  if (!meta.name) meta.name = '未命名音源';
  return meta;
}

function normalizeSources(sources) {
  const out = {};
  if (!sources || typeof sources !== 'object') return out;
  for (const [key, val] of Object.entries(sources)) {
    if (!VALID_SOURCES.has(key) && key !== 'local') continue;
    out[key] = {
      name: val.name || key,
      type: val.type || 'music',
      actions: Array.isArray(val.actions) ? val.actions : ['musicUrl'],
      qualitys: Array.isArray(val.qualitys) ? val.qualitys.filter((q) => VALID_QUALITIES.has(q)) : [],
    };
  }
  return out;
}

// ============== HTTP 请求（lx.request 实现，代理由用户配置驱动） ==============

// 读取用户配置的代理：仅在设置页填写后才启用。
// 默认直连——不读取 HTTP_PROXY/HTTPS_PROXY 等系统环境变量，
// 避免本机失效代理（如 clash 未运行时留下的 127.0.0.1:7890）拖垮全部音源请求。
function getProxyFor(targetUrl) {
  if (!config.proxy) return null;
  try {
    const parsed = new URL(targetUrl);
    // 用户显式配置代理后，仍尊重 NO_PROXY 例外列表
    const noProxy = (process.env.NO_PROXY || process.env.no_proxy || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    for (const np of noProxy) {
      if (np === '*' || parsed.hostname === np || parsed.hostname.endsWith('.' + np)) return null;
    }
    return new URL(config.proxy);
  } catch { return null; }
}

// 归一化并保存用户代理配置；传空 = 不使用代理（直连），保存后对新请求立即生效
function setProxy(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) {
    config.proxy = '';
    saveConfig();
    return { proxy: '' };
  }
  let normalized = raw;
  if (!/^https?:\/\//i.test(normalized)) normalized = 'http://' + normalized;
  let parsed;
  try { parsed = new URL(normalized); } catch {
    throw new Error('代理地址格式不正确，示例：http://127.0.0.1:7890');
  }
  if (!parsed.hostname) throw new Error('代理地址缺少主机名');
  if (!parsed.port) parsed.port = parsed.protocol === 'https:' ? '443' : '80';
  const value = `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
  config.proxy = value;
  saveConfig();
  return { proxy: value };
}

// 经代理建立 CONNECT 隧道，返回已连通的 socket
function tunnelViaProxy(proxy, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(proxy.port), proxy.hostname, () => {
      socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
    });
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      if (buf.includes('\r\n\r\n')) {
        socket.removeListener('data', onData);
        const statusLine = buf.split('\r\n')[0] || '';
        if (/^HTTP\/1\.[01] 200/.test(statusLine)) resolve(socket);
        else reject(new Error('代理 CONNECT 失败: ' + statusLine));
      }
    };
    socket.on('data', onData);
    socket.on('error', reject);
  });
}

function buildFormData(obj) {
  const boundary = '----LXSourceBoundary' + Math.random().toString(36).slice(2);
  let body = '';
  for (const [k, v] of Object.entries(obj)) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${k}"\r\n\r\n`;
    body += `${v}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function buildFormUrlencoded(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function requestAsync(url, options = {}) {
  let parsed;
  try { parsed = new URL(url); } catch (e) { throw new Error('invalid url: ' + url); }
  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;
  const proxy = getProxyFor(url);
  const headers = { ...(options.headers || {}) };
  let body;

  if (options.formData && typeof options.formData === 'object') {
    const fd = buildFormData(options.formData);
    body = Buffer.from(fd.body);
    headers['Content-Type'] = fd.contentType;
  } else if (options.form && typeof options.form === 'object') {
    body = Buffer.from(buildFormUrlencoded(options.form));
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (options.body) {
    body = Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body));
    if (!headers['Content-Type'] && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
    }
  }

  const reqOptions = {
    method: options.method || 'GET',
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    headers,
    timeout: options.timeout || 30000,
  };

  // 代理：https 先建 CONNECT 隧道并包裹 TLS；http 走绝对 URI
  let tlsSocket = null;
  if (proxy) {
    if (isHttps) {
      const sock = await tunnelViaProxy(proxy, parsed.hostname, Number(parsed.port) || 443);
      tlsSocket = tls.connect({ socket: sock, servername: parsed.hostname });
      reqOptions.createConnection = () => tlsSocket;
    } else {
      reqOptions.hostname = proxy.hostname;
      reqOptions.port = Number(proxy.port);
      reqOptions.path = url; // 绝对形式
      reqOptions.headers = { ...headers, Host: parsed.host };
    }
  }

  return new Promise((resolve, reject) => {
    const req = lib.request(reqOptions, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = new URL(res.headers.location, url).toString();
        res.resume(); // 丢弃重定向响应体
        requestAsync(loc, options).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const contentType = (res.headers['content-type'] || '').toLowerCase();
        let parsedBody;
        try {
          if (contentType.includes('application/json')) {
            parsedBody = JSON.parse(raw.toString('utf8'));
          } else {
            parsedBody = raw.toString('utf8');
          }
        } catch {
          parsedBody = raw.toString('utf8');
        }
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          headers: res.headers,
          body: parsedBody,
          raw,
        });
      });
    });

    req.on('error', (err) => {
      if (tlsSocket) tlsSocket.destroy();
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      if (tlsSocket) tlsSocket.destroy();
      reject(new Error('request timeout'));
    });
    if (body) req.write(body);
    req.end();
  });
}

function lxRequest(url, options, callback) {
  let cancelled = false;
  const p = requestAsync(url, options)
    .then((resp) => {
      if (cancelled) return;
      if (callback) callback(null, resp, resp.body);
    })
    .catch((err) => {
      if (cancelled) return;
      if (callback) callback(err, null, null);
    });
  return () => {
    cancelled = true;
    p.catch(() => {});
  };
}

// ============== utils ==============

function parseAesMode(mode) {
  const m = String(mode).toLowerCase();
  const size = m.match(/(128|192|256)/)?.[1] || '128';
  const type = m.includes('ecb') ? 'ecb' : 'cbc';
  return `aes-${size}-${type}`;
}

function ensureBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  return Buffer.from(String(input), 'utf8');
}

const lxUtils = {
  buffer: {
    from: (data, encoding) => {
      if (Array.isArray(data) || data instanceof Uint8Array) return Buffer.from(data);
      return Buffer.from(String(data), encoding || 'utf8');
    },
    bufToString: (buf, encoding) => ensureBuffer(buf).toString(encoding || 'utf8'),
  },
  crypto: {
    aesEncrypt: (buffer, mode, key, iv) => {
      const alg = parseAesMode(mode);
      const k = ensureBuffer(key);
      const ivBuf = iv ? ensureBuffer(iv) : null;
      const cipher = ivBuf ? crypto.createCipheriv(alg, k, ivBuf) : crypto.createCipheriv(alg, k, '');
      return Buffer.concat([cipher.update(ensureBuffer(buffer)), cipher.final()]);
    },
    aesDecrypt: (buffer, mode, key, iv) => {
      const alg = parseAesMode(mode);
      const k = ensureBuffer(key);
      const ivBuf = iv ? ensureBuffer(iv) : null;
      const decipher = ivBuf ? crypto.createDecipheriv(alg, k, ivBuf) : crypto.createDecipheriv(alg, k, '');
      return Buffer.concat([decipher.update(ensureBuffer(buffer)), decipher.final()]);
    },
    md5: (str) => crypto.createHash('md5').update(ensureBuffer(str)).digest('hex'),
    randomBytes: (size) => crypto.randomBytes(size),
    rsaEncrypt: (buffer, key) => {
      const buf = ensureBuffer(buffer);
      try {
        return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, buf);
      } catch {
        return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, buf);
      }
    },
  },
  zlib: {
    inflate: (buffer) =>
      new Promise((resolve, reject) => {
        zlib.inflate(ensureBuffer(buffer), (err, data) => (err ? reject(err) : resolve(data)));
      }),
    deflate: (buffer) =>
      new Promise((resolve, reject) => {
        zlib.deflate(ensureBuffer(buffer), (err, data) => (err ? reject(err) : resolve(data)));
      }),
  },
};

// ============== VM / 脚本执行 ==============

// 音源脚本的 console 噪音默认关闭（第三方脚本日志量大且多为调试信息）；
// 设置 GUMAN_DEBUG=1 可查看全部脚本日志，便于排查音源问题。
const SCRIPT_DEBUG = process.env.GUMAN_DEBUG === '1';
function makeScriptConsole() {
  const noop = () => {};
  const pick = (m) => (SCRIPT_DEBUG && typeof console[m] === 'function' ? console[m].bind(console) : noop);
  return {
    log: pick('log'), info: pick('info'), warn: pick('warn'), error: pick('error'), debug: pick('debug'),
    group: pick('group'), groupCollapsed: pick('group'), groupEnd: pick('groupEnd'),
    table: pick('table'), trace: pick('trace'), dir: pick('dir'), assert: pick('assert'),
    count: pick('count'), time: pick('time'), timeEnd: pick('timeEnd'), timeLog: pick('timeLog'),
  };
}

function createLxApi(record) {
  const handlers = {};
  record.handlers = handlers;

  record.initPromise = new Promise((resolve, reject) => {
    record.initResolve = resolve;
    record.initReject = reject;
  });
  record.initTimer = setTimeout(() => {
    if (!record.inited) record.initReject(new Error('音源初始化超时（30s 内未发送 inited 事件）'));
  }, 30000);

  return {
    version: '2.0',
    env: 'desktop',
    currentScriptInfo: record.meta,
    EVENT_NAMES: { inited: 'inited', request: 'request', updateAlert: 'updateAlert' },
    on: (name, handler) => {
      handlers[name] = handler;
    },
    send: (name, data) => {
      handleScriptEvent(record, name, data);
    },
    request: (url, options, callback) => lxRequest(url, options, callback),
    utils: lxUtils,
  };
}

function handleScriptEvent(record, name, data) {
  if (name === 'inited') {
    clearTimeout(record.initTimer);
    record.initedData = data || {};
    record.sources = normalizeSources(data && data.sources);
    record.openDevTools = !!data.openDevTools;
    record.status = data.status;
    record.inited = true;
    record.initResolve(data);
  } else if (name === 'updateAlert') {
    record.updateAlert = data;
  }
}

function makeSandbox(record) {
  const lx = createLxApi(record);
  const sandbox = {
    console: makeScriptConsole(),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    JSON,
    Math,
    Date,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    EvalError,
    URIError,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Function,
    Symbol,
    BigInt,
    Map,
    Set,
    WeakMap,
    WeakSet,
    ArrayBuffer,
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    DataView,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURI,
    decodeURI,
    encodeURIComponent,
    decodeURIComponent,
    escape,
    unescape,
    Infinity,
    NaN,
    undefined,
    Buffer,
    atob,
    btoa,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    process: { env: {}, version: '', platform: 'win32' },
    performance: { now: () => Date.now() },
    lx,
  };
  return sandbox;
}

function runScript(code, meta, existingId) {
  const id = existingId || safeId(meta.name);
  const record = {
    id,
    meta,
    code,
    filename: '',
    enabled: true,
    inited: false,
    initedData: null,
    sources: {},
    handlers: {},
    error: null,
    updateAlert: null,
  };

  const sandbox = makeSandbox(record);
  try {
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { timeout: 10000, filename: meta.name || 'source.js' });
  } catch (e) {
    clearTimeout(record.initTimer);
    record.error = `执行错误: ${e.message}`;
    record.inited = false;
  }
  return record;
}

async function waitInit(record) {
  if (record.error) return record;
  try {
    await record.initPromise;
    record.inited = true;
  } catch (e) {
    record.error = record.error || `初始化失败: ${e.message}`;
    record.inited = false;
  }
  return record;
}

// ============== 公开 API ==============

function getSourceSummary(record) {
  return {
    id: record.id,
    name: record.meta.name,
    description: record.meta.description,
    version: record.meta.version,
    author: record.meta.author,
    homepage: record.meta.homepage,
    filename: record.filename,
    enabled: record.enabled,
    inited: record.inited,
    error: record.error,
    sources: record.sources,
    updateAlert: record.updateAlert,
  };
}

function getSources() {
  return Array.from(registry.values()).map(getSourceSummary);
}

async function addSource({ code, url, filePath, enabled = true }) {
  let sourceCode = code;
  let origin = 'code';
  if (url) {
    const resp = await requestAsync(url, { method: 'GET', timeout: 30000 });
    if (!resp.body) throw new Error('下载音源脚本失败');
    sourceCode = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body);
    origin = 'url';
  } else if (filePath) {
    sourceCode = fs.readFileSync(filePath, 'utf8');
    origin = 'file';
  }
  if (!sourceCode || typeof sourceCode !== 'string') throw new Error('音源脚本内容为空');

  const meta = parseScriptMeta(sourceCode);
  const id = safeId(meta.name);
  if (registry.has(id)) {
    // 覆盖：删除旧文件
    const old = registry.get(id);
    if (old.filename) {
      const p = path.join(SOURCES_DIR, old.filename);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    registry.delete(id);
  }

  const filename = safeFilename(meta.name);
  fs.writeFileSync(path.join(SOURCES_DIR, filename), sourceCode, 'utf8');

  const record = runScript(sourceCode, meta, id);
  record.filename = filename;
  record.enabled = enabled;
  registry.set(id, record);
  await waitInit(record);

  const idx = config.sources.findIndex((s) => s.id === id);
  const entry = { id, filename, enabled: record.enabled, origin };
  if (idx >= 0) config.sources[idx] = entry;
  else config.sources.push(entry);
  saveConfig();

  return getSourceSummary(record);
}

async function init() {
  ensureDirs();
  loadConfig();
  registry.clear();
  const pending = [];
  for (const entry of config.sources) {
    const p = path.join(SOURCES_DIR, entry.filename);
    if (!fs.existsSync(p)) {
      console.warn('[source-manager] source file missing:', entry.filename);
      continue;
    }
    try {
      const code = fs.readFileSync(p, 'utf8');
      const meta = parseScriptMeta(code);
      const record = runScript(code, meta, entry.id);
      record.filename = entry.filename;
      record.enabled = entry.enabled !== false;
      registry.set(record.id, record);
      pending.push(waitInit(record).catch(() => {}));
    } catch (e) {
      console.error('[source-manager] load source failed:', entry.filename, e.message);
    }
  }
  const total = Array.from(registry.values()).length;
  if (total) console.log(`[source] 正在初始化 ${total} 个音源…`);
  else console.log('[source] 尚未导入任何音源（设置 → 自定义源管理 可导入）');

  // 摘要：等所有音源初始化结束后再输出准确计数（不阻塞服务启动）。
  // 第三方脚本日志默认静音，设 GUMAN_DEBUG=1 可查看详细日志。
  Promise.all(pending).then(() => {
    const all = Array.from(registry.values());
    const ok = all.filter((r) => r.inited);
    const bad = all.filter((r) => !r.inited);
    if (all.length) {
      console.log(`[source] 音源加载完成：${ok.length}/${all.length} 个可用`);
      if (bad.length) console.log(`[source] 初始化失败：${bad.map((r) => r.meta.name).join('、')}`);
    }
    console.log(`[source] 网络代理：${config.proxy || '未使用（直连）'}（可在 设置 → 网络代理 修改）`);
  });
}

function removeSource(id) {
  const rec = registry.get(id);
  if (!rec) throw new Error('音源不存在');
  if (rec.filename) {
    const p = path.join(SOURCES_DIR, rec.filename);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  registry.delete(id);
  config.sources = config.sources.filter((s) => s.id !== id);
  saveConfig();
  return { id };
}

function setSourceEnabled(id, enabled) {
  const rec = registry.get(id);
  if (!rec) throw new Error('音源不存在');
  rec.enabled = !!enabled;
  const entry = config.sources.find((s) => s.id === id);
  if (entry) entry.enabled = rec.enabled;
  saveConfig();
  return getSourceSummary(rec);
}

function setQuality(quality) {
  if (!VALID_QUALITIES.has(quality)) throw new Error('无效音质');
  config.quality = quality;
  saveConfig();
  return { quality };
}

function getConfig() {
  return { quality: config.quality, proxy: config.proxy, sources: config.sources };
}

// ============== URL / 歌词 / 封面解析 ==============

function pickQuality(requested, available) {
  if (!requested || !VALID_QUALITIES.has(requested)) requested = config.quality;
  if (available.includes(requested)) return requested;
  const idx = QUALITY_ORDER.indexOf(requested);
  for (let i = idx; i < QUALITY_ORDER.length; i++) {
    if (available.includes(QUALITY_ORDER[i])) return QUALITY_ORDER[i];
  }
  for (let i = idx - 1; i >= 0; i--) {
    if (available.includes(QUALITY_ORDER[i])) return QUALITY_ORDER[i];
  }
  return available[0] || null;
}

async function resolveAction({ sourcePlatform, action, musicInfo, quality, sourceId }) {
  if (!VALID_SOURCES.has(sourcePlatform)) throw new Error(`不支持的平台: ${sourcePlatform}`);
  if (action !== 'musicUrl' && action !== 'lyric' && action !== 'pic') throw new Error(`不支持的 action: ${action}`);

  const records = Array.from(registry.values()).filter(
    (r) => r.enabled && r.inited && !r.error && (!sourceId || r.id === sourceId)
  );

  // 记录每个音源的尝试结果，全部失败时汇总成对用户友好的错误信息
  const attempts = [];

  for (const rec of records) {
    const src = rec.sources[sourcePlatform];
    if (!src || !Array.isArray(src.actions) || !src.actions.includes(action)) continue;

    const handler = rec.handlers.request;
    if (typeof handler !== 'function') continue;

    const q = action === 'musicUrl' ? pickQuality(quality, src.qualitys || []) : null;
    if (action === 'musicUrl' && !q) {
      attempts.push({ id: rec.meta.name, err: '不支持该音质' });
      continue;
    }

    try {
      const info = action === 'musicUrl' ? { type: q, musicInfo } : { musicInfo };
      const result = await handler({ source: sourcePlatform, action, info });
      if (result == null) {
        attempts.push({ id: rec.meta.name, err: '无返回' });
        continue;
      }

      if (action === 'musicUrl') {
        if (typeof result === 'string' && result.startsWith('http')) {
          return { url: result, sourceId: rec.id, platform: sourcePlatform, quality: q };
        }
        attempts.push({ id: rec.meta.name, err: '返回的不是有效链接' });
      } else if (action === 'pic') {
        if (typeof result === 'string' && result.startsWith('http')) {
          return { url: result, sourceId: rec.id, platform: sourcePlatform, action };
        }
        attempts.push({ id: rec.meta.name, err: '返回的不是有效链接' });
      } else if (action === 'lyric') {
        return { lyric: result, sourceId: rec.id, platform: sourcePlatform, action };
      }
    } catch (e) {
      attempts.push({ id: rec.meta.name, err: e.message });
    }
  }

  if (!attempts.length) {
    throw new Error(`没有支持 ${sourcePlatform} 平台的可用音源（请检查音源是否启用、是否支持该平台）`);
  }
  if (process.env.GUMAN_DEBUG === '1') {
    attempts.forEach((a) => console.warn(`[source] ${a.id} ${action} failed: ${a.err}`));
  }
  // 汇总前 3 个失败原因，避免错误信息过长
  const detail = attempts.slice(0, 3).map((a) => `${a.id}（${a.err}）`).join('；');
  const more = attempts.length > 3 ? ` 等 ${attempts.length} 个` : '';
  throw new Error(`已尝试 ${attempts.length} 个音源均失败：${detail}${more}`);
}

async function resolveMusicUrl(opts) {
  return resolveAction({ ...opts, action: 'musicUrl' });
}

module.exports = {
  init,
  getSources,
  addSource,
  removeSource,
  setSourceEnabled,
  setQuality,
  setProxy,
  getConfig,
  resolveMusicUrl,
  resolveAction,
  QUALITY_ORDER,
  __test: { requestAsync, getProxyFor },
};
