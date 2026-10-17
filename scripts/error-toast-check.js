// 专项验证：播放失败时的用户提示（toast + 播放条错误态）
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3100/';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // 播放一个不存在的歌曲 id：所有音源与官方接口都应失败
  await page.evaluate(() => {
    window.__guman.player.playTrack(
      { id: '999999999999', name: '不存在的测试歌', artist: '测试艺人', album: '测试专辑', albumPic: '', duration: 0, source: 'online' },
      [{ id: '999999999999', name: '不存在的测试歌', artist: '测试艺人', album: '测试专辑', albumPic: '', duration: 0, source: 'online' }],
      0,
    );
  });

  // 等音源逐个尝试完成（最多 45s）
  let toastText = '';
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(1000);
    toastText = (await page.locator('#toast').textContent()) || '';
    if (/暂无可播放源|播放失败|已尝试/.test(toastText)) break;
  }
  check('播放失败弹出明确提示', /暂无可播放源|播放失败/.test(toastText), toastText.slice(0, 160));
  check('提示包含歌名与原因', /《/.test(toastText) && /：/.test(toastText), toastText.slice(0, 160));
  check('提示不含浏览器技术术语', !/no supported source|MEDIA_ERR|Failed to load/i.test(toastText), toastText.slice(0, 160));

  const errCls = await page.locator('#pbTitle.is-error').count();
  check('播放条标题进入错误态（变红）', errCls === 1);

  // 错误 toast 应允许换行（长文本不被截断）
  const whiteSpace = await page.evaluate(() => {
    const t = document.getElementById('toast');
    return t.classList.contains('is-error') ? getComputedStyle(t).whiteSpace : 'n/a';
  });
  check('错误提示文本可换行显示', whiteSpace === 'normal', whiteSpace);

  await page.screenshot({ path: 'scripts/ui-shot-error.png' });

  console.log('\n================ 汇总 ================');
  const failed = results.filter((r) => !r.ok);
  console.log(`通过 ${results.length - failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('CRASHED:', e); process.exit(1); });
