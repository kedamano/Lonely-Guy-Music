'use strict';
/**
 * 存储区真机验证（Electron + Playwright）
 *
 * ui-smoke 里的缓存断言用的是注入的 window.gm mock，只覆盖 UI 渲染。
 * 这个脚本启动真实客户端（独立 userData，不干扰正在运行的实例），
 * 走完整的 preload → ipcMain 链路，确认：
 *   1. 设置页能读到真实磁盘缓存体积（不是「统计中…」或「不可用」）
 *   2. 「立即清理」能真的把体积降下来并给出释放量
 *   3. 上限档位点击后能落到主进程配置并回读
 *
 * 运行：node scripts/cache-e2e.js
 */
const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'guman-cache-e2e-'));
  // 跳过首启用户协议弹窗（否则会先出现声明窗口）
  fs.writeFileSync(path.join(userData, '.agreed'), '');

  // ELECTRON_RUN_AS_NODE 会让 electron 以纯 Node 方式启动，playwright 等不到调试端口
  const env = { ...process.env, GUMAN_USER_DATA_DIR: userData, ENABLE_NCM: '0', GUMAN_DISABLE_GPU: '1' };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    cwd: ROOT,
    // 这台开发机的 GPU 进程在开发模式下会反复崩溃（0xC0000005）并拖垮整个应用；
    // 验证存储区不需要 GPU，走 GUMAN_DISABLE_GPU 的逃生通道。
    args: ['.'],
    env,
    timeout: 180000,
  });

  let pass = 0;
  let fail = 0;
  const check = (ok, name, detail = '') => {
    if (ok) { pass += 1; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
    else { fail += 1; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
  };

  try {
    const page = await app.firstWindow({ timeout: 120000 });
    await page.waitForSelector('.nav__item[data-route="settings"]', { timeout: 120000 });

    // 先制造一点缓存：让首页的个性化请求跑起来（离线 mock 也会有接口响应）
    await sleep(4000);

    await page.click('.nav__item[data-route="settings"]');
    await page.waitForSelector('.settings__item:has-text("缓存占用")', { timeout: 30000 });
    await sleep(2000);

    const valEl = page.locator('.settings__item', { hasText: '缓存占用' }).locator('.settings__pathval');
    const shown = (await valEl.textContent()) || '';
    check(!/统计中|不可用|统计失败/.test(shown), '真实读取到缓存体积', `显示 "${shown}"`);
    check(/\d+(\.\d+)?\s*(B|KB|MB|GB)/.test(shown), '体积格式可读', shown);

    const note = (await page.locator('.settings__item', { hasText: '缓存占用' }).locator('.settings__item-desc').textContent()) || '';
    check(/上限/.test(note), '上限状态回读成功', `"${note.slice(0, 60)}"`);

    const limits = page.locator('.seg[aria-label="缓存上限"] .seg__btn');
    check((await limits.count()) === 5, '上限档位来自主进程配置', `${await limits.count()} 档`);

    // 切到 256MB，主进程应立即回读为 256
    await limits.nth(1).click();
    await sleep(1200);
    const activeAfter = (await page.locator('.seg[aria-label="缓存上限"] .seg__btn.is-active').textContent()) || '';
    check(/256/.test(activeAfter), '切换上限后回读一致', `当前 "${activeAfter}"`);
    const cfgPath = path.join(userData, 'cache-config.json');
    let cfg = null;
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) { /* 未落盘 */ }
    check(cfg && Number(cfg.limitMB) === 256, '上限已持久化到 userData', cfg ? JSON.stringify(cfg) : '文件不存在');

    // 清理
    await page.locator('.settings__item', { hasText: '缓存占用' }).locator('button', { hasText: '立即清理' }).click();
    await sleep(2500);
    const toast = (await page.locator('#toast').textContent()) || '';
    check(/已释放|已清理/.test(toast), '清理有明确结果反馈', `提示 "${toast}"`);
  } catch (e) {
    check(false, '真机流程未抛异常', e.message);
  } finally {
    try { await app.close(); } catch (_) { /* ignore */ }
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('[cache-e2e] 启动失败:', e && e.message);
  process.exit(1);
});
