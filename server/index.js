'use strict';
/**
 * 主机后端（端口 3000）
 *  - 托管渲染层 UI（renderer/），与 API 同源 → 无 CORS、webSecurity 可保持开启
 *  - /api/* 路由：在线时反代网易云 API（运行在 3001），离线时降级为内置 mock
 *  - 在线探测：启动即拉起 NeteaseCloudMusicApi，探测可达后置 online
 *  - 音源系统：/api/sources/* 加载/管理 LX Music 自定义源脚本，/api/sources/resolve 取播放链
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const mock = require('./mock');
const sourceManager = require('./source-manager');
const account = require('./account');
const library = require('./library');

const HOST_PORT = Number(process.env.HOST_PORT || 3000);
const NCM_PORT = Number(process.env.NCM_PORT || 3001);
const NCM_URL = `http://localhost:${NCM_PORT}`;
const DATA_DIR = process.env.GUMAN_USER_DATA
  ? process.env.GUMAN_USER_DATA
  : path.join(__dirname, '../userData');

const app = express();
app.use(express.json({ limit: '2mb' }));

// 只允许本机页面访问：/api 会把登录 cookie 注入上游，若放开跨域，
// 任意网页都能借 localhost:3000 读用户的账号数据（CSRF/跨站读取）。
const ALLOW_ORIGINS = new Set([
  `http://localhost:${HOST_PORT}`,
  `http://127.0.0.1:${HOST_PORT}`,
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origin !== 'null' && !ALLOW_ORIGINS.has(origin)) {
    return res.status(403).json({ code: 403, msg: 'cross-origin request blocked' });
  }
  if (ALLOW_ORIGINS.has(origin)) res.set('Access-Control-Allow-Origin', origin);
  next();
});

// 第三方音源脚本内部的异步缺陷（如未 catch 的 Promise）不应污染终端/拖垮进程：
// 统一收敛为一行提示，应用继续运行。设 GUMAN_DEBUG=1 可看完整堆栈。
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? `${reason.message}` : String(reason);
  if (process.env.GUMAN_DEBUG === '1') {
    console.warn('[unhandled]', reason);
  } else {
    console.warn(`[source] 音源脚本异步错误（已忽略，不影响使用）: ${msg}`);
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
const isReserved = (p) => RESERVED.includes(p) || p.startsWith('/api/sources') || p.startsWith('/api/account') || p.startsWith('/api/library');
// 登录类接口会把 cookie 放进响应体，禁止渲染层直接访问（凭证只能留在后端）
const BLOCKED = ['/login', '/logout', '/relogin', '/regvalid'];

app.all('/api/*', async (req, res, next) => {
  if (isReserved(req.path)) return next();

  const neteasePath = req.path.replace(/^\/api/, '') || '/';
  if (BLOCKED.some((p) => neteasePath === p || neteasePath.startsWith(p + '/'))) {
    return res.status(403).json({ code: 403, msg: '请使用 /api/account/* 登录接口' });
  }
  const query = new URLSearchParams(req.url.split('?')[1] || '').toString();
  const target = `${NCM_URL}${neteasePath}${query ? `?${query}` : ''}`;

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

app.get('/api/__mode', (req, res) => res.json({ online, host: HOST_PORT, ncm: NCM_PORT }));

// 同源音频代理：把远程音频（网易云 / 示例曲 / 音源返回链接）转发为同源流，
// 使渲染层可将其接入 Web Audio（均衡器 + 可视化）而不会因跨域被静音。支持 Range 转发。
app.get('/api/proxy', async (req, res) => {
  const u = req.query.url;
  if (!u || !/^https?:\/\//.test(u)) return res.status(400).end();
  try {
    const host = new URL(u).host.toLowerCase();
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (host.includes('163.com') || host.includes('netease') || host.includes('126.net')) headers['Referer'] = 'https://music.163.com/';
    if (req.headers.range) headers['Range'] = req.headers.range;
    const upstream = await fetch(u, { headers });
    res.status(upstream.status);
    ['content-type', 'content-length', 'accept-ranges', 'content-range'].forEach((h) => {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    });
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

// ---- 拉起网易云 API（后台子进程，端口 3001）----
function startNetease() {
  const appJs = path.join(__dirname, '../node_modules/NeteaseCloudMusicApi/app.js');
  const child = spawn(process.execPath, [appJs], {
    env: { ...process.env, PORT: String(NCM_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', (d) => process.stderr.write(`[ncm] ${d}`));
  child.on('exit', (code) => {
    if (code) console.log(`[ncm] exited with ${code}`);
  });
  return child;
}

// ---- 在线探测：可达即置 online（持久后台轮询）----
// 音源初始化与子进程启动可能争抢资源，NCM 起步慢时首次窗口（约 90s）内探不到；
// 因此窗口过后转入 5s 低频轮询，一旦可达立即切在线（UI 每 3s 轮询徽标）。
async function probe() {
  let announcedOffline = false;
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${NCM_URL}/personalized`, { signal: AbortSignal.timeout(1200) });
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

// 默认离线（内置示例曲库）；设置 ENABLE_NCM=1 才拉起网易云在线 API（端口 NCM_PORT）
const ENABLE_NCM = process.env.ENABLE_NCM === '1';

app.listen(HOST_PORT, async () => {
  // 账号与本地曲库都落在 userData（Electron 主进程通过 GUMAN_USER_DATA 传入）
  fs.mkdirSync(DATA_DIR, { recursive: true });
  account.init({ dataDir: DATA_DIR, ncmUrl: NCM_URL });
  library.init(DATA_DIR);
  // 先初始化音源系统（读取已保存的音源脚本并执行）
  await sourceManager.init();
  console.log(`[host] 孤男音乐 后端已启动: http://localhost:${HOST_PORT}`);
  if (ENABLE_NCM) {
    startNetease();
    probe();
  } else {
    console.log('[api] 离线模式：内置示例曲库（设置 ENABLE_NCM=1 启用网易云在线曲库）');
  }
}).on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`[host] 端口 ${HOST_PORT} 已被占用——可能已有另一个孤男音乐实例在运行。`);
    console.error('[host] 请先在系统托盘右键「退出」旧实例，或结束占用该端口的进程后重试。');
  } else {
    console.error('[host] 服务启动失败:', e);
  }
  process.exit(1);
});
