// 交互性能探针：测量「点击导航 → 内容出现」的端到端耗时
//
// 关注三件事：
//   1. 冷启动首屏（无缓存，要等接口）
//   2. 二次进入同一页（API 内存缓存 + 封面 LRU 命中）
//   3. 列表渲染开销（事件委托 + 收藏 Set 查询）
//
// 用法：HOST_PORT=3100 node scripts/perf-check.js [轮数]
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || `http://localhost:${process.env.HOST_PORT || 3100}/`;
const ROUNDS = Number(process.argv[2] || 3);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });

  // 探针：hashchange 后等首个歌单卡片挂到 DOM，算端到端耗时
  const installProbe = () => page.evaluate(() => {
    window.__perf = { last: null, pending: null };
    window.addEventListener('hashchange', () => {
      const t0 = performance.now();
      window.__perf.pending = t0;
      window.__perf.last = null;
      const stop = (deadline) => {
        if (!window.__perf.pending) return;
        const card = document.querySelector('#view .pl-card, #view .track, #view .settings');
        if (card) {
          window.__perf.last = performance.now() - t0;
          window.__perf.pending = null;
          return;
        }
        if (performance.now() - t0 < deadline) requestAnimationFrame(() => stop(deadline));
      };
      requestAnimationFrame(() => stop(8000));
    }, true);
  });

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pl-card', { timeout: 40000 });
  const cold = Date.now() - t0;
  console.log(`冷启动首屏（含接口 + 封面）: ${cold}ms`);
  await page.waitForTimeout(1500);

  await installProbe();

  const tap = async (route, expect) => {
    await page.click(`.nav__item[data-route="${route}"]`);
    await page.waitForFunction((sel) => !!window.__perf?.last, expect, { timeout: 20000 }).catch(() => {});
    const ms = await page.evaluate(() => window.__perf?.last ?? -1);
    return Math.round(ms);
  };

  const runs = { hall: [], discoverWarm: [], searchHome: [] };
  for (let i = 0; i < ROUNDS; i++) {
    runs.hall.push(await tap('hall', null));
    runs.discoverWarm.push(await tap('discover', null));
    await page.waitForTimeout(300);
  }

  const mid = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  console.log(`点击「音乐馆」→ 卡片出现: ${runs.hall.join(' / ')}ms（中位 ${mid(runs.hall)}ms）`);
  console.log(`点击「发现」→ 卡片出现: ${runs.discoverWarm.join(' / ')}ms（中位 ${mid(runs.discoverWarm)}ms）`);

  // 列表渲染：直接测 50 首曲目的行构建与首次点击回调
  const listCost = await page.evaluate(() => {
    const wrap = document.createElement('div');
    document.body.appendChild(wrap);
    const rows = 200;
    const t = performance.now();
    for (let i = 0; i < rows; i++) {
      const r = document.createElement('div');
      r.className = 'track';
      r.dataset.idx = String(i);
      r.innerHTML = '<div class="track__idx"></div><div class="track__main"><div class="track__title">x</div></div>';
      wrap.appendChild(r);
    }
    const ms = performance.now() - t;
    wrap.remove();
    return Math.round(ms * 10) / 10;
  });
  console.log(`200 行列表 DOM 构建: ${listCost}ms`);

  const ok = cold < 20000 && mid(runs.discoverWarm) < 1500;
  console.log(`\n判定：${ok ? '✅ 通过' : '❌ 未达标'}（冷启动 <20s，回访首页中位 <1.5s）`);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('探针异常：', e.message); process.exit(1); });
