// 搜索页「最近搜索 / 热门搜索」新版式专项验证
const { chromium } = require('playwright');

const results = [];
const errors = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

  const BASE = process.env.BASE_URL || 'http://localhost:3100/';
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 预置搜索历史（经 store 内存态 + 落盘），验证「最近搜索」区
  await page.evaluate(() => {
    window.__guman.store.clearSearchHistory();
    ['治愈', '夜曲', '张韶涵'].forEach((q) => window.__guman.store.pushSearchHistory(q));
  });
  await page.click('.nav__item[data-route="search"]');
  await page.waitForTimeout(600);

  // ---------- 结构断言 ----------
  check('最近搜索标题行存在', (await page.locator('.guide-head', { hasText: '最近搜索' }).count()) === 1);
  check('热门搜索标题行存在', (await page.locator('.guide-head', { hasText: '热门搜索' }).count()) === 1);
  check('清除按钮存在', (await page.locator('.guide-head__clear').count()) === 1);
  check('热门提示文案存在', (await page.locator('.guide-head__hint').count()) === 1);
  check('最近搜索 chips 数量正确', (await page.locator('.chiprow .schip').count()) === 3,
    `${await page.locator('.chiprow .schip').count()} 个`);
  check('热门搜索网格 6 项', (await page.locator('.hotgrid__item').count()) === 6,
    `${await page.locator('.hotgrid__item').count()} 项`);
  check('前三名带 is-top', (await page.locator('.hotgrid__item.is-top').count()) === 3);
  const ranks = await page.locator('.hotgrid__rank').allTextContents();
  check('排名序号 1-6', ranks.join(',') === '1,2,3,4,5,6', ranks.join(','));

  // 视觉细节：前三名排名为强调色，其余为弱色
  const rankColors = await page.evaluate(() => {
    const get = (i) => getComputedStyle(document.querySelectorAll('.hotgrid__rank')[i]).color;
    return { top: get(0), rest: get(4) };
  });
  check('前三名与其余排名颜色不同', rankColors.top !== rankColors.rest, JSON.stringify(rankColors));

  // 悬停 chip 显示单条删除按钮
  await page.locator('.chiprow .schip').first().hover();
  await page.waitForTimeout(300);
  const delOpacity = await page.evaluate(() => {
    const d = document.querySelector('.chiprow .schip .schip__del');
    return d ? getComputedStyle(d).opacity : 'none';
  });
  check('悬停 chip 显示单删按钮', Number(delOpacity) > 0.5, `opacity=${delOpacity}`);

  // 点击单删：只删一条，其余保留
  await page.locator('.chiprow .schip .schip__del').first().click();
  await page.waitForTimeout(400);
  const chipsAfterDel = await page.locator('.chiprow .schip').count();
  check('单删移除一条历史', chipsAfterDel === 2, `${chipsAfterDel} 个剩余`);

  // 点击 chip 触发搜索
  await page.locator('.chiprow .schip').first().click();
  await page.waitForTimeout(2500);
  const searchMeta = await page.locator('.searchmeta__text').textContent().catch(() => '');
  check('点击最近搜索词触发搜索', /找到/.test(searchMeta), searchMeta);

  // 点击热门词触发搜索（先清空输入框回到引导页）
  await page.fill('#searchInput', '');
  await page.waitForTimeout(500);
  await page.locator('.hotgrid__item').nth(1).click();
  await page.waitForTimeout(2500);
  const hotMeta = await page.locator('.searchmeta__text').textContent().catch(() => '');
  check('点击热门搜索词触发搜索', /找到/.test(hotMeta), hotMeta);

  // 清除全部（回到引导页后操作）
  await page.fill('#searchInput', '');
  await page.waitForTimeout(500);
  await page.locator('.guide-head__clear').click();
  await page.waitForTimeout(400);
  check('清除后最近搜索区消失', (await page.locator('.chiprow .schip').count()) === 0);
  check('清除后热门搜索区仍在', (await page.locator('.hotgrid__item').count()) === 6);

  // 语言切换：热门/最近文案跟随（重新预置历史，保证两区都在）
  await page.evaluate(() => {
    window.__guman.store.clearSearchHistory();
    ['治愈', '夜曲', '张韶涵'].forEach((q) => window.__guman.store.pushSearchHistory(q));
  });
  const langSel = page.locator('.settings__select[data-key="lang"]');
  await page.click('.nav__item[data-route="settings"]');
  await page.waitForTimeout(600);
  check('语言下拉可用 data-key 定位', (await langSel.count()) === 1);
  await langSel.selectOption('zh-TW');
  await page.waitForTimeout(700);
  await page.click('.nav__item[data-route="search"]');
  await page.waitForTimeout(500);
  const twRecent = await page.locator('.guide-head', { hasText: '最近搜尋' }).count();
  const twHot = await page.locator('.guide-head', { hasText: '熱門搜尋' }).count();
  check('繁體中文下两区标题转换', twRecent === 1 && twHot === 1, `recent=${twRecent} hot=${twHot}`);
  await page.click('.nav__item[data-route="settings"]');
  await page.waitForTimeout(600);
  await langSel.selectOption('en');
  await page.waitForTimeout(700);
  await page.click('.nav__item[data-route="search"]');
  await page.waitForTimeout(500);
  const enHot = await page.locator('.guide-head', { hasText: 'Trending' }).count();
  check('English 下热门标题转换', enHot === 1);
  await page.click('.nav__item[data-route="settings"]');
  await page.waitForTimeout(600);
  const clearTitleEn = await page.locator('.guide-head__clear').count();
  check('English 下界面可交互（设置页渲染）', (await page.locator('.settings__section').count()) >= 5,
    `${await page.locator('.settings__section').count()} 个分区`);
  await langSel.selectOption('zh-CN');
  await page.waitForTimeout(700);

  // 截图（预置历史后重载以拍全两区）
  await page.evaluate(() => {
    window.__guman.store.clearSearchHistory();
    ['欧美 R&B', '治愈', '夜曲', '张韶涵'].forEach((q) => window.__guman.store.pushSearchHistory(q));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.click('.nav__item[data-route="search"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'scripts/ui-shot-search-guide.png' });

  console.log('\n================ 汇总 ================');
  const failed = results.filter((r) => !r.ok);
  console.log(`通过 ${results.length - failed.length}/${results.length}`);
  failed.forEach((f) => console.log(`❌ ${f.name} — ${f.detail}`));
  console.log('运行时错误:', errors.length ? '\n' + errors.join('\n') : '无');
  await browser.close();
})().catch((e) => { console.error('TEST CRASHED:', e); process.exit(1); });
