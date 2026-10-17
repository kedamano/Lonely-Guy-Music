'use strict';
/**
 * 磁盘缓存回归（Electron 主进程环境）
 *
 * 设置页「存储」区的三个能力全部依赖 Electron session API：
 *   session.defaultSession.getCacheSize() / clearCache()
 * 这两个 API 一旦改名或行为变化，界面会静默显示 0 B 或清理无效，
 * 所以这里用本地 HTTP 服务真实写入缓存，再验证「体积可读 → 清理有效」。
 *
 * 运行：npx electron scripts/cache-check.js
 */
const { app, session } = require('electron');
const path = require('path');
const os = require('os');
const http = require('http');

// 独立 userData：不碰正在运行的客户端，也不会污染真实缓存
app.setPath('userData', path.join(os.tmpdir(), 'guman-cache-check-' + Date.now()));
// 无窗口环境里 GPU 进程会反复崩溃（0xC0000005），直接禁用
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('in-process-gpu');

let pass = 0;
let fail = 0;
function check(ok, name, detail = '') {
  if (ok) { pass += 1; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail += 1; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  let srv = null;
  try {
    check(typeof ses.getCacheSize === 'function', 'getCacheSize 可用');
    check(typeof ses.clearCache === 'function', 'clearCache 可用');

    const before = await ses.getCacheSize();
    check(Number.isFinite(before) && before >= 0, '缓存体积是有限数值', `${before} B`);

    // 起本地服务写入可缓存资源，避免依赖外网
    srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=600' });
      res.end('x'.repeat(256 * 1024));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      const r = await ses.fetch(`http://127.0.0.1:${port}/${name}`);
      await r.text();
    }
    await sleep(600);
    const after = await ses.getCacheSize();
    check(after > before, '写过的资源会计入缓存', `${before} B → ${after} B`);

    await ses.clearCache();
    await sleep(400);
    const cleared = await ses.getCacheSize();
    check(cleared <= before + 4096, '清理后体积回落到基线', `${after} B → ${cleared} B`);
    check(cleared < after || after === 0, '清理确实释放了空间', `释放 ${Math.max(0, after - cleared)} B`);

    // 二次清理必须幂等：界面上的「立即清理」可以被点很多次
    await ses.clearCache();
    check(true, '重复清理不报错（幂等）');
  } catch (e) {
    check(false, '缓存 API 调用未抛异常', e.message);
  } finally {
    if (srv) { try { srv.close(); } catch (_) { /* ignore */ } }
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => {
  console.error('[cache-check] 启动失败:', e && e.message);
  app.exit(1);
});
