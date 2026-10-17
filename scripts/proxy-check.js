// 代理机制验证：默认不走代理（忽略系统代理环境变量）→ 用户配置后走代理 → 关闭恢复直连
// 运行：node scripts/proxy-check.js
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 模拟用户环境：本机存在失效代理（clash 未运行），旧逻辑会被它拖垮
process.env.HTTPS_PROXY = 'http://127.0.0.1:7890';
process.env.HTTP_PROXY = 'http://127.0.0.1:7890';
process.env.NO_PROXY = '';

// 隔离 userData，避免污染真实配置
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guman-proxy-check-'));
process.env.GUMAN_USER_DATA = tmp;

const sm = require('../server/source-manager');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

function startServer(onRequest) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      onRequest(req.url);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  await sm.init(); // 触发 loadConfig：默认 proxy 为空

  const hits = [];
  const target = await startServer((u) => hits.push(u));
  const proxySrv = await startServer((u) => hits.push(u));
  const targetPort = target.address().port;
  const proxyPort = proxySrv.address().port;
  const targetUrl = `http://127.0.0.1:${targetPort}/ping`;

  // 1. 默认：即使系统环境里有失效代理，也不走代理
  check('默认 getProxyFor 为 null（忽略系统代理环境变量）', sm.__test.getProxyFor(targetUrl) === null);
  let r = await sm.__test.requestAsync(targetUrl);
  check('默认直连请求成功', r.statusCode === 200, `status=${r.statusCode}`);
  check('默认请求未经代理（路径为 /ping）', hits[hits.length - 1] === '/ping', hits[hits.length - 1]);

  // 2. 用户配置代理（省略协议前缀也应归一化）
  let saved = sm.setProxy(`127.0.0.1:${proxyPort}`);
  check('setProxy 归一化补全 http://', saved.proxy === `http://127.0.0.1:${proxyPort}`, saved.proxy);
  check('配置后 getProxyFor 返回代理', String(sm.__test.getProxyFor(targetUrl)) === `http://127.0.0.1:${proxyPort}/`);
  r = await sm.__test.requestAsync(targetUrl);
  check('经代理请求成功', r.statusCode === 200, `status=${r.statusCode}`);
  check('经代理的请求使用绝对 URI', hits[hits.length - 1] === targetUrl, hits[hits.length - 1]);

  // 3. 代理持久化：重新加载配置后仍生效
  const cfgPath = path.join(tmp, 'sources.json');
  const persisted = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  check('代理已持久化到 sources.json', persisted.proxy === `http://127.0.0.1:${proxyPort}`, JSON.stringify(persisted.proxy));

  // 4. NO_PROXY 例外仍然尊重
  process.env.NO_PROXY = '127.0.0.1';
  check('NO_PROXY 命中时不走代理', sm.__test.getProxyFor(targetUrl) === null);
  process.env.NO_PROXY = '';

  // 5. 非法代理地址
  let err = null;
  try { sm.setProxy('http://'); } catch (e) { err = e; }
  check('非法代理地址（无主机名）被拒绝', !!err, err && err.message);

  // 6. 清空 = 关闭代理，恢复直连
  saved = sm.setProxy('');
  check('清空后代理关闭', saved.proxy === '' && sm.__test.getProxyFor(targetUrl) === null);
  r = await sm.__test.requestAsync(targetUrl);
  check('关闭后恢复直连', r.statusCode === 200 && hits[hits.length - 1] === '/ping', hits[hits.length - 1]);

  target.close();
  proxySrv.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  const failed = results.filter((x) => !x.ok);
  console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED:', e); process.exit(1); });
