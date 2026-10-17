'use strict';
/**
 * 主机后端（端口动态分配，默认仅绑 127.0.0.1）
 *  - 托管渲染层 UI（renderer/），与 API 同源 → 无 CORS、webSecurity 可保持开启
 *  - /api/* 路由：在线时反代网易云 API（子进程，端口动态挑选），离线时降级为内置 mock
 *  - 在线探测：启动即拉起 NeteaseCloudMusicApi，探测可达后置 online
 *  - 音源系统：/api/sources/* 加载/管理 LX Music 自定义源脚本，/api/sources/resolve 取播放链
 *  - module.exports.ready：监听完成（端口已确定）后 resolve，供主进程 loadURL 前 await
 */

const path = require('path');
const fs = require('fs');
const net = require('net');
const express = require('express');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const mock = require('./mock');
const sourceManager = require('./source-manager');
const account = require('./account');
const library = require('./library');
const translate = require('./translate');
const platformSearch = require('./platform-search');
const platformUrl = require('./platform-url');

// 监听地址：仅本机回环。/api 会注入登录 cookie，绑 0.0.0.0 会把它暴露给整个局域网。
const HOST_BIND = process.env.HOST_BIND || '127.0.0.1';
// 端口：测试可用 HOST_PORT 指定；默认 0 = 由系统分配空闲端口。
// 曾硬编码 3000，被其它应用占用时整体无法启动（单实例锁只防自己）。
const HOST_PORT = process.env.HOST_PORT ? Number(process.env.HOST_PORT) : 0;
const NCM_PORT_ENV = process.env.NCM_PORT ? Number(process.env.NCM_PORT) : 0;
let ncmPort = NCM_PORT_ENV; // 0 = 启动时动态挑选
let ncmUrl = '';
// 实际监听端口：listen 回调中赋值，经 module.exports 暴露给主进程（loadURL 用）
let actualPort = null;
const DATA_DIR = process.env.GUMAN_USER_DATA
  ? process.env.GUMAN_USER_DATA
  : path.join(__dirname, '../userData');

// 平台账号 cookie（QQ 取链需要登录态）落在用户目录，和音源配置同级别
platformUrl.setAuthPath(path.join(DATA_DIR, 'platform-auth.json'));

const app = express();
app.use(express.json({ limit: '2mb' }));

// 只允许本机页面访问：/api 会把登录 cookie 注入上游，若放开跨域，
// 任意网页都能借 localhost 读用户的账号数据（CSRF/跨站读取）。
// 端口改为动态分配后无法预置白名单，因此按「回环地址 + 端口与实际监听端口一致」判定。
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
function isLoopbackOrigin(origin) {
  try {
    const u = new URL(origin);
    if (!LOOPBACK_HOSTS.has(u.hostname)) return false;
    return actualPort != null && String(u.port) === String(actualPort);
  } catch (_) {
    return false;
  }
}
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    if (!isLoopbackOrigin(origin)) {
      return res.status(403).json({ code: 403, msg: 'cross-origin request blocked' });
    }
    res.set('Access-Control-Allow-Origin', origin);
  }
  next();
});

// 未处理的 Promise 拒绝统一收敛为一行提示，不因一处缺陷拖垮进程。
// 注意措辞保持中性：这里也会收到主进程自身的缺陷，标注成"音源脚本错误"会误导排障
// （曾有真实的主进程 API 误用被这里吞成音源报错）。设 GUMAN_DEBUG=1 看完整堆栈。
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (process.env.GUMAN_DEBUG === '1') {
    console.warn('[unhandled]', reason);
  } else {
    console.warn(`[unhandled] 未处理的异步错误（已忽略，不影响使用）: ${msg}`);
  }
});

// 渲染层静态资源（使用 hash 路由，无需服务端 history fallback）
app.use(express.static(path.join(__dirname, '../renderer'), { index: 'index.html' }));

let online = false;

// ============== 音源系统 API ==============

app.get('/api/sources', async (req, res) => {
  try {
    res.json({ code: 0, data: sourceManager.getSources(), config: sourceManager.getConfig() });
  } catch (e) {
    res.status(500).json({ code: 500, msg: e.message });
  }
});

app.post('/api/sources/load', async (req, res) => {
  try {
    const { url, path: filePath, code } = req.body || {};
    const result = await sourceManager.addSource({ url, filePath, code });
    res.json({ code: 0, data: result });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

app.post('/api/sources/toggle', async (req, res) => {
  try {
    const { id, enabled } = req.body || {};
    const result = sourceManager.setSourceEnabled(id, enabled);
    res.json({ code: 0, data: result });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

app.post('/api/sources/remove', async (req, res) => {
  try {
    const { id } = req.body || {};
    const result = sourceManager.removeSource(id);
    res.json({ code: 0, data: result });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

app.post('/api/sources/quality', async (req, res) => {
  try {
    const { quality } = req.body || {};
    const result = sourceManager.setQuality(quality);
    res.json({ code: 0, data: result });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

// 网络代理：由用户在设置中配置，默认不使用（直连）。留空保存即关闭。
app.post('/api/sources/proxy', async (req, res) => {
  try {
    const { proxy } = req.body || {};
    const result = sourceManager.setProxy(proxy);
    res.json({ code: 0, data: result });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

app.post('/api/sources/resolve', async (req, res) => {
  try {
    const { sourcePlatform, musicInfo, quality, sourceId } = req.body || {};
    const result = await sourceManager.resolveMusicUrl({ sourcePlatform, musicInfo, quality, sourceId });
    res.json({ code: 0, data: result });
  } catch (e) {
    res.status(404).json({ code: 404, msg: e.message });
  }
});

app.post('/api/sources/action', async (req, res) => {
  try {
    const { sourcePlatform, action, musicInfo, quality, sourceId } = req.body || {};
    const result = await sourceManager.resolveAction({ sourcePlatform, action, musicInfo, quality, sourceId });
    res.json({ code: 0, data: result });
  } catch (e) {
    res.status(404).json({ code: 404, msg: e.message });
  }
});

// ============== 多平台搜索（QQ / 酷狗；网易云走 NCM 反代） ==============

app.get('/api/platform/list', (req, res) => {
  res.json({ code: 0, data: platformSearch.platformList(), online });
});

app.get('/api/platform/search', async (req, res) => {
  const { platform, keywords, page, limit } = req.query;
  try {
    const data = await platformSearch.searchPlatform(platform, keywords, page, limit);
    res.json({ code: 0, data, online });
  } catch (e) {
    res.status(502).json({ code: 502, msg: e.message || '平台搜索失败' });
  }
});

// 平台原生取链：不依赖洛雪音源，酷狗匿名可用；QQ 无登录态时跨平台兜底到酷狗
app.post('/api/platform/url', async (req, res) => {
  const { platform, musicInfo, name, artist, duration, quality } = req.body || {};
  if (!platform) return res.status(400).json({ code: 400, msg: '缺少 platform' });
  try {
    const data = await platformUrl.resolvePlatformUrl({
      platform, musicInfo, name, artist, duration, quality,
    });
    res.json({ code: 0, data, online });
  } catch (e) {
    res.status(502).json({ code: 502, msg: e.message || '平台取链失败' });
  }
});

app.get('/api/platform/health', (req, res) => {
  res.json({ code: 0, data: platformUrl.getHealth(), online });
});

// ============== 账号 API（凭证不出后端） ==============

app.get('/api/account/state', (req, res) => {
  res.json({ code: 0, data: { ...account.publicState(), online } });
});

app.get('/api/account/qr/start', async (req, res) => {
  try {
    if (!online) throw new Error('网易云接口暂不可达（离线模式无法登录）');
    const key = await account.qrKey();
    const { qrimg, qrurl } = await account.qrCreate(key);
    res.json({ code: 0, data: { key, qrimg, qrurl } });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

// 前端每 2s 轮询一次；code 803 表示登录成功
app.get('/api/account/qr/check', async (req, res) => {
  try {
    const key = String(req.query.key || '');
    if (!key) throw new Error('缺少登录密钥');
    res.json({ code: 0, data: await account.qrCheck(key) });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

// 手机号验证码登录：先发码，再登录（凭证同样只留在后端）
app.post('/api/account/captcha', async (req, res) => {
  try {
    if (!online) throw new Error('网易云接口暂不可达（离线模式无法登录）');
    res.json({ code: 0, data: await account.sendCaptcha(req.body?.phone) });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

app.post('/api/account/login/cellphone', async (req, res) => {
  try {
    if (!online) throw new Error('网易云接口暂不可达（离线模式无法登录）');
    const data = await account.loginCellphone(req.body?.phone, req.body?.captcha);
    res.json({ code: 0, data: { ...data, ...account.publicState() } });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

app.post('/api/account/login/email', async (req, res) => {
  try {
    if (!online) throw new Error('网易云接口暂不可达（离线模式无法登录）');
    const data = await account.loginEmail(req.body?.email, req.body?.password);
    res.json({ code: 0, data: { ...data, ...account.publicState() } });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

app.post('/api/account/refresh', async (req, res) => {
  try {
    await account.refreshStatus();
    res.json({ code: 0, data: account.publicState() });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

app.post('/api/account/logout', async (req, res) => {
  try {
    res.json({ code: 0, data: await account.logout() });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

// ============== 本地曲库 API（跨会话持久化） ==============

app.get('/api/library', (req, res) => {
  res.json({ code: 0, data: library.list() });
});

app.post('/api/library/add', (req, res) => {
  try {
    const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
    if (!paths.length) throw new Error('未提供文件路径');
    res.json({ code: 0, data: library.addPaths(paths) });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

app.post('/api/library/scan', (req, res) => {
  try {
    const dir = String(req.body?.dir || '');
    if (!dir) throw new Error('未提供目录');
    const files = library.scanDir(dir);
    if (!files.length) throw new Error('该目录下没有找到音频文件');
    res.json({ code: 0, data: library.addPaths(files) });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

app.post('/api/library/remove', (req, res) => {
  try {
    res.json({ code: 0, data: { removed: library.remove(String(req.body?.id || '')) } });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

app.post('/api/library/meta', (req, res) => {
  try {
    res.json({ code: 0, data: library.setMeta(String(req.body?.id || ''), req.body || {}) });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

// 歌词译文兜底：key 只存本机，响应里只有译文本身
app.get('/api/translate/state', (req, res) => res.json({ code: 0, data: translate.state() }));

app.post('/api/translate/config', (req, res) => {
  try {
    const c = translate.saveConfig(req.body || {});
    res.json({ code: 0, data: { configured: !!(c.baseUrl && c.apiKey && c.model), model: c.model, baseUrl: c.baseUrl } });
  } catch (e) {
    res.status(400).json({ code: 400, msg: e.message });
  }
});

app.post('/api/translate', async (req, res) => {
  try {
    const r = await translate.translate(req.body || {});
    res.status(r.code === 0 ? 200 : 400).json(r);
  } catch (e) {
    res.status(502).json({ code: 502, msg: e.message });
  }
});

// 本地音频同源流：id 必须在清单里（拒绝任意路径），支持 Range 以便拖拽与 Web Audio
app.get('/api/local', (req, res) => {
  const hit = library.resolve(String(req.query.id || ''));
  if (!hit) return res.status(404).end();
  let stat;
  try {
    stat = fs.statSync(hit.path);
  } catch (_) {
    return res.status(404).end();
  }
  const total = stat.size;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  let start = 0;
  let end = total - 1;
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    end = range[1] && range[2] ? Number(range[2]) : total - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= total) {
      res.status(416).set('Content-Range', `bytes */${total}`).end();
      return;
    }
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', hit.mime);
  res.setHeader('Content-Length', end - start + 1);
  res.status(start > 0 || end < total - 1 ? 206 : 200);
  if (start > 0 || end < total - 1) res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(hit.path, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});

// ============== 网易云 API 反代 ==============

// 这些路径由上方专用路由处理，或由后端自己调用上游，不走通配反代
const RESERVED = ['/api/__mode', '/api/proxy', '/api/local'];
const isReserved = (p) => RESERVED.includes(p) || p.startsWith('/api/sources') || p.startsWith('/api/account') || p.startsWith('/api/library') || p.startsWith('/api/platform');
// 登录类接口会把 cookie 放进响应体，禁止渲染层直接访问（凭证只能留在后端）
const BLOCKED = ['/login', '/logout', '/relogin', '/regvalid'];

app.all('/api/*', async (req, res, next) => {
  if (isReserved(req.path)) return next();

  const neteasePath = req.path.replace(/^\/api/, '') || '/';
  if (BLOCKED.some((p) => neteasePath === p || neteasePath.startsWith(p + '/'))) {
    return res.status(403).json({ code: 403, msg: '请使用 /api/account/* 登录接口' });
  }
  const query = new URLSearchParams(req.url.split('?')[1] || '').toString();
  const target = `${ncmUrl}${neteasePath}${query ? `?${query}` : ''}`;

  res.set('X-Api-Mode', online ? 'online' : 'offline');

  if (online) {
    try {
      const cookie = account.getCookie();
      const r = await fetch(target, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          // 登录态由后端注入，渲染层既看不到也存不了
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
      });
      const text = await r.text();
      res.status(r.status);
      res.set('Content-Type', 'application/json; charset=utf-8');
      return res.send(text);
    } catch (e) {
      // 在线反代失败，本次降级 mock
      const data = await mock.handle(neteasePath, Object.fromEntries(new URLSearchParams(query)));
      if (data) return res.json(data);
      return res.status(502).json({ code: 502, msg: 'upstream error', detail: String(e) });
    }
  }

  const data = await mock.handle(neteasePath, Object.fromEntries(new URLSearchParams(query)));
  if (data) return res.json(data);
  return res.status(404).json({ code: 404, msg: 'unknown mock route', path: neteasePath });
});

app.get('/api/__mode', (req, res) => res.json({ online, host: actualPort, ncm: ncmPort }));

// 同源音频代理：把远程音频（网易云 / 示例曲 / 音源返回链接）转发为同源流，
// 使渲染层可将其接入 Web Audio（均衡器 + 可视化）而不会因跨域被静音。支持 Range 转发。
app.get('/api/proxy', async (req, res) => {
  const u = req.query.url;
  if (!u || !/^https?:\/\//.test(u)) return res.status(400).end();
  try {
    const host = new URL(u).host.toLowerCase();
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (host.includes('163.com') || host.includes('netease') || host.includes('126.net')) headers['Referer'] = 'https://music.163.com/';
    if (host.includes('kugou.com')) headers['Referer'] = 'https://www.kugou.com/';
    if (req.headers.range) headers['Range'] = req.headers.range;
    const upstream = await fetch(u, { headers });
    res.status(upstream.status);
    ['content-length', 'accept-ranges', 'content-range'].forEach((h) => {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    });
    // 酷狗直链常返回 application/octet-stream，<audio> 会拒绝播放；
    // 取链方知道真实格式（ext），通过 ct 参数带过来，仅在类型不可用时覆盖。
    const upCt = upstream.headers.get('content-type') || '';
    const forceCt = req.query.ct;
    const ct = forceCt && (!upCt || /octet-stream/i.test(upCt)) ? String(forceCt) : upCt;
    if (ct) res.set('content-type', ct);
    if (upstream.body && upstream.body.getReader) {
      const r = Readable.fromWeb(upstream.body);
      r.on('error', () => res.destroy());
      r.pipe(res);
    } else {
      res.send(Buffer.from(await upstream.arrayBuffer()));
    }
  } catch (e) {
    if (!res.headersSent) res.status(502).end();
    else res.destroy();
  }
});

// 统一错误出口：body-parser 解析失败（非法 JSON / 超过 2mb）默认会返回 HTML 500 并打印堆栈，
// 既泄露本机绝对路径，又让渲染层拿不到可读原因。
app.use((err, req, res, _next) => {
  const status = Number(err && (err.status || err.statusCode)) || 500;
  if (status === 400 || status === 413) {
    return res.status(status).json({ code: status, msg: status === 413 ? '请求体过大' : '请求体格式错误（不是合法 JSON）' });
  }
  console.error('[host] 未处理异常:', err && err.message);
  if (!res.headersSent) res.status(500).json({ code: 500, msg: '服务器内部错误' });
});

// ---- 拉起网易云 API（后台子进程，端口动态挑选）----
// 开发时位于 node_modules；打包后 asarUnpack 会把它解到 app.asar.unpacked。
// asar 内的路径对 spawn 不是真实文件，必须先解析到解包位置。
function resolveNcmAppJs() {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked/node_modules/NeteaseCloudMusicApi/app.js'));
  }
  candidates.push(path.join(__dirname, '../node_modules/NeteaseCloudMusicApi/app.js'));
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) { /* ignore */ }
  }
  return candidates[candidates.length - 1];
}

// 子进程意外退出（常见的就是端口冲突）时自动重启，最多 3 次；
// 彻底起不来则由 probe 的后台轮询维持离线模式，不影响应用使用。
let ncmRestarts = 0;
function startNetease(port) {
  const appJs = resolveNcmAppJs();
  const child = spawn(process.execPath, [appJs], {
    // 关键：打包后 process.execPath 是应用自身的 exe，不加 ELECTRON_RUN_AS_NODE
    // 它会被当成 Electron 应用启动（弹窗/报错），而不是执行 Node 脚本。
    env: { ...process.env, PORT: String(port), ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 子进程日志走 console：Electron 下已被 hook 到 userData/logs/guman.log，
  // 纯 node 调试模式下则照常打到终端（打包后子进程控制台不可见，排障全靠日志）。
  const pipe = (buf, level) => {
    const s = String(buf).trim();
    if (!s) return;
    if (level === 'error') console.warn(`[ncm] ${s}`);
    else console.log(`[ncm] ${s}`);
  };
  child.stdout?.on('data', (d) => pipe(d, 'info'));
  child.stderr?.on('data', (d) => pipe(d, 'error'));
  child.on('exit', async (code) => {
    if (!code) return;
    console.log(`[ncm] exited with ${code}`);
    if (ENABLE_NCM && ncmRestarts < 3) {
      ncmRestarts++;
      // 换一个新端口再试：最常见的失败原因就是端口被抢，原地重启只会反复失败
      const next = await pickFreePort(ncmPort + 1);
      if (next !== ncmPort) {
        ncmPort = next;
        ncmUrl = `http://127.0.0.1:${ncmPort}`;
        account.init({ dataDir: DATA_DIR, ncmUrl });
      }
      console.log(`[ncm] 尝试重启（第 ${ncmRestarts} 次，端口 ${ncmPort}）`);
      setTimeout(() => startNetease(ncmPort), 1500);
    } else {
      console.log('[ncm] 多次启动失败，保持离线模式（内置示例曲库）');
    }
  });
  return child;
}

// 判断回环地址的某个端口是否空闲。
// 注意：不能用「自己 bind 成功 = 空闲」来探测——Windows 的 SO_REUSEADDR 允许
// 与已监听的端口重复 bind（曾导致误判 3001 空闲，子进程 listen 失败直接退出）。
// 改用主动连接探测：连得上 = 已被占用。
function isPortFree(p) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (free) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch (_) { /* ignore */ }
      resolve(free);
    };
    sock.setTimeout(500);
    sock.once('connect', () => done(false));   // 连得上 → 已被占用
    sock.once('timeout', () => done(false));   // 不确定，保守当作占用并换下一个
    sock.once('error', () => done(true));      // ECONNREFUSED → 空闲
    sock.connect(p, HOST_BIND);
  });
}

async function pickFreePort(start, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const p = start + i;
    if (await isPortFree(p)) return p;
  }
  return start;
}

// ---- 在线探测：可达即置 online（持久后台轮询）----
// 音源初始化与子进程启动可能争抢资源，NCM 起步慢时首次窗口（约 90s）内探不到；
// 因此窗口过后转入 5s 低频轮询，一旦可达立即切在线（UI 每 3s 轮询徽标）。
async function probe() {
  let announcedOffline = false;
  for (let i = 0; ; i++) {
    // 每轮都读最新的 ncmUrl：子进程重启到新端口后探测也要跟上
    if (!ncmUrl) { await new Promise((r) => setTimeout(r, 300)); continue; }
    try {
      const r = await fetch(`${ncmUrl}/personalized`, { signal: AbortSignal.timeout(1200) });
      if (r.ok) {
        if (!online) console.log('[api] 在线模式：已连接到网易云 API');
        online = true;
        // 上次登录过则补一次用户信息，UI 冷启动即可显示头像昵称
        account.refreshStatus().catch(() => {});
        return;
      }
    } catch (_) { /* not ready yet */ }
    if (i === 89 && !announcedOffline) {
      console.log('[api] 离线模式：网易云 API 暂不可达，使用内置示例曲库（仍在后台重试）');
      announcedOffline = true;
    }
    await new Promise((r) => setTimeout(r, i < 20 ? 300 : i < 90 ? 1000 : 5000));
  }
}

// 默认离线（内置示例曲库）；设置 ENABLE_NCM=1 才拉起网易云在线 API
const ENABLE_NCM = process.env.ENABLE_NCM === '1';

// 后端就绪 Promise：主进程 await 之后再 loadURL（端口此时已确定）
const ready = new Promise((resolve, reject) => {
  const server = app.listen(HOST_PORT, HOST_BIND, async () => {
    try {
      actualPort = server.address().port;
      fs.mkdirSync(DATA_DIR, { recursive: true });
      if (!ncmPort) ncmPort = await pickFreePort(3001);
      ncmUrl = `http://127.0.0.1:${ncmPort}`;
      // 账号与本地曲库都落在 userData（Electron 主进程通过 GUMAN_USER_DATA 传入）
      account.init({ dataDir: DATA_DIR, ncmUrl });
      library.init(DATA_DIR);
      translate.init(DATA_DIR);
      // 先初始化音源系统（读取已保存的音源脚本并执行）
      await sourceManager.init();
      console.log(`[host] 孤男音乐 后端已启动: http://127.0.0.1:${actualPort}（网易云 API 端口 ${ncmPort}）`);
      if (ENABLE_NCM) {
        startNetease(ncmPort);
        probe();
      } else {
        console.log('[api] 离线模式：内置示例曲库（设置 ENABLE_NCM=1 启用网易云在线曲库）');
      }
      resolve(actualPort);
    } catch (e) {
      reject(e);
    }
  });
  server.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') {
      console.error(`[host] 端口 ${HOST_PORT} 已被占用——可能已有另一个孤男音乐实例在运行。`);
      console.error('[host] 请先在系统托盘右键「退出」旧实例，或结束占用该端口的进程后重试。');
    } else {
      console.error('[host] 服务启动失败:', e);
    }
    reject(e);
    process.exit(1);
  });
});

module.exports = { ready, getPort: () => actualPort };
