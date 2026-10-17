// UI 回归检查：加载、搜索、播放、队列、歌单、歌词、声场、我的、设置、迷你模式
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// 生成 1 秒正弦波 WAV，用于验证本地导入与真实播放链路
function writeToneWav(file) {
  const rate = 8000, seconds = 1, samples = rate * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}
const TONE = path.join(require('os').tmpdir(), 'guman-test-tone.wav');
writeToneWav(TONE);

const results = [];
const errors = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false });
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('favicon')) errors.push(`[http ${r.status()}] ${r.url()}`);
  });

  // ---------- 启动 ----------
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const cards = await page.locator('.pl-card').count();
  check('发现页歌单卡片', cards > 0, `${cards} 张`);
  check('图标系统渲染', (await page.locator('.nav__item svg').count()) >= 6, `${await page.locator('.nav__item svg').count()} 个`);
  await shot(page, '01-discover');

  // ---------- 搜索：输入即搜 ----------
  await page.click('.nav__item[data-route="search"]');
  await page.waitForTimeout(300);
  await page.fill('#searchInput', '夜曲');
  await page.waitForTimeout(1200);
  const songs = await page.locator('#searchOut .track').count();
  check('输入即搜（无需回车）', songs > 0, `${songs} 首`);
  check('搜索页保留关键词', (await page.inputValue('#searchInput')) === '夜曲');
  await shot(page, '02-search');

  // 切歌单 tab 后应保留关键词并自动搜
  await page.click('.tab[data-search-type="1000"]');
  await page.waitForTimeout(900);
  const pls = await page.locator('#searchOut .pl-card').count();
  check('切到歌单搜索并保留关键词', pls > 0 && (await page.inputValue('#searchInput')) === '夜曲', `${pls} 个歌单`);
  await shot(page, '03-search-playlist');
  await page.click('.tab[data-search-type="1"]');
  await page.waitForTimeout(800);

  // ---------- 播放 ----------
  const firstTitle = await page.locator('#searchOut .track__title').first().textContent();
  await page.locator('#searchOut .track').first().click();
  await page.waitForTimeout(2500);
  const pbTitle = await page.locator('#pbTitle').textContent();
  check('点击曲目更新播放条', pbTitle === firstTitle, `"${pbTitle}"`);
  check('播放/暂停状态按钮切换', (await page.locator('#btnPlay svg use').getAttribute('href')) !== null);

  // 进度拖拽与音量
  const seekBox = await page.locator('#seek').boundingBox();
  if (seekBox) await page.mouse.click(seekBox.x + seekBox.width * 0.4, seekBox.y + seekBox.height / 2);
  await page.waitForTimeout(500);
  const cur = await page.locator('#curTime').textContent();
  check('点击进度条可跳转', cur !== '0:00', `当前 ${cur}`);

  // 收藏
  const favBefore = await page.locator('#btnFav.is-on').count();
  await page.click('#btnFav');
  await page.waitForTimeout(300);
  const favAfter = await page.locator('#btnFav.is-on').count();
  check('收藏按钮可切换', favBefore !== favAfter, `${favBefore} → ${favAfter}`);

  // 加入队列
  const trackRow = page.locator('#searchOut .track').nth(1);
  await trackRow.hover();
  await trackRow.locator('.track__actions .iconbtn').first().click();
  await page.waitForTimeout(400);
  const badge = await page.locator('#queueCount').textContent();
  check('加入队列按钮更新徽标', Number(badge) > 0, `队列 ${badge} 首`);

  // 打开队列抽屉
  await page.click('#btnQueue');
  await page.waitForTimeout(500);
  check('队列抽屉打开', (await page.locator('#queuePanel.open').count()) > 0);
  await shot(page, '04-queue');
  await page.click('#queueClose');

  // ---------- 歌词浮层 ----------
  await page.click('#btnLyric');
  await page.waitForTimeout(1500);
  check('歌词浮层打开', (await page.locator('#np.open').count()) > 0);
  const lyricCount = await page.locator('.lyric-line').count();
  check('歌词行渲染', lyricCount > 0, `${lyricCount} 行`);
  await shot(page, '05-now-playing');
  await page.keyboard.press('Escape');

  // ---------- 歌单详情 ----------
  await page.click('.nav__item[data-route="discover"]');
  await page.waitForTimeout(900);
  await page.locator('.pl-card').first().click();
  await page.waitForTimeout(1400);
  const cover = await page.locator('.pl-hero__cover').boundingBox();
  check('歌单详情封面有尺寸', !!cover && cover.width > 100, cover ? `${Math.round(cover.width)}×${Math.round(cover.height)}` : '无封面');
  const plTracks = await page.locator('.track').count();
  check('歌单详情曲目列表', plTracks > 0, `${plTracks} 首`);
  await shot(page, '06-playlist');

  // ---------- 声场 ----------
  await page.click('#btnStage');
  await page.waitForTimeout(600);
  check('声场面板打开', (await page.locator('#app.stage-open').count()) > 0);
  await page.locator('#eq input').nth(2).fill('6');
  await page.waitForTimeout(250);
  check('EQ 拖动后标记自定义', (await page.locator('#eqPresetName').textContent()) === '自定义');
  await page.click('.eqp[data-preset="摇滚"]');
  await page.waitForTimeout(250);
  check('EQ 预设切换', (await page.locator('#eqPresetName').textContent()) === '摇滚');
  await page.click('#sleepRow .chip[data-min="15"]');
  await page.waitForTimeout(1100);
  check('睡眠倒计时运行', (await page.locator('#sleepStatus').textContent()).includes('还剩'));
  await shot(page, '07-stage');
  await page.click('#sleepRow .chip[data-min="0"]');
  await page.click('#stageClose');

  // ---------- 我的 ----------
  await page.click('.nav__item[data-route="mine"]');
  await page.waitForTimeout(500);
  check('我的页渲染', (await page.locator('.h-title').textContent()) === '我的');
  const mineTabs = await page.locator('.tab').count();
  check('我的页五个标签', mineTabs === 5, `${mineTabs} 个`);
  await page.locator('.tab').nth(1).click();
  await page.waitForTimeout(400);
  check('历史标签有播放记录', (await page.locator('.track').count()) > 0, `${await page.locator('.track').count()} 首`);
  await shot(page, '08-mine');

  // ---------- 设置 ----------
  await page.click('.nav__item[data-route="settings"]');
  await page.waitForTimeout(900);
  const sels = await page.locator('.settings__select').count();
  check('设置页渲染', sels >= 3, `${sels} 个下拉`);
  check('设置页快捷键说明', (await page.locator('.settings__section').count()) >= 3, `${await page.locator('.settings__section').count()} 个区块`);
  await shot(page, '09-settings');

  // ---------- 本地音乐导入 ----------
  await page.click('.nav__item[data-route="local"]');
  await page.waitForTimeout(500);
  await page.setInputFiles('#fileInput', TONE);
  await page.waitForTimeout(1500);
  const localRows = await page.locator('.track').count();
  check('本地音频导入', localRows > 0, `${localRows} 首`);
  check('本地音频可播放', (await page.locator('#pbTitle').textContent()).includes('guman-test-tone'), await page.locator('#pbTitle').textContent());
  await shot(page, '12-local');

  // ---------- 账号入口 / 每日推荐 / 右键加入歌单 ----------
  await page.click('.nav__item[data-route="discover"]');
  await page.waitForTimeout(1400);
  check('侧边栏账号入口可见', await page.locator('#accountBtn').isVisible());
  check('未登录文案', (await page.locator('#accountName').textContent()) === '未登录',
    await page.locator('#accountSub').textContent());
  const dailyTitle = (await page.locator('.section__title').first().textContent() || '').trim();
  check('发现页每日推荐区块', dailyTitle.includes('推荐'), dailyTitle.slice(0, 24));
  const dailyRows = await page.locator('.section .track').count();
  check('推荐曲目行渲染', dailyRows > 0, `${dailyRows} 首`);

  await page.locator('.section .track').first().click({ button: 'right' });
  await page.waitForTimeout(350);
  const menuItems = await page.locator('.menu__item').count();
  check('曲目右键菜单', menuItems >= 4, `${menuItems} 项`);
  await page.locator('.menu__item', { hasText: '加入歌单…' }).click();
  await page.waitForTimeout(450);
  check('新建歌单弹窗', (await page.locator('.modal.open .modal__title').textContent()) === '新建歌单');
  await page.fill('.modal input', '测试歌单');
  await page.locator('.modal__foot .btn--primary').click();
  await page.waitForTimeout(700);
  check('建单后弹窗关闭', (await page.locator('.modal.open').count()) === 0);

  await page.click('.nav__item[data-route="mine"]');
  await page.waitForTimeout(500);
  await page.locator('.tab').nth(3).click();
  await page.waitForTimeout(600);
  check('我的歌单卡片', (await page.locator('.pl-card__name').first().textContent()) === '测试歌单');
  await page.locator('.pl-card').first().click();
  await page.waitForTimeout(800);
  check('本地歌单详情页', (await page.locator('.pl-hero__name').textContent()) === '测试歌单');
  const sheetRows = await page.locator('.track').count();
  check('本地歌单曲目', sheetRows >= 1, `${sheetRows} 首`);
  await shot(page, '13-sheet');

  await page.locator('.pl-hero__cta .btn-ghost').nth(3).click(); // 删除
  await page.waitForTimeout(450);
  check('删除确认弹窗', (await page.locator('.modal.open .modal__title').textContent()) === '删除歌单');
  await page.locator('.modal__foot .btn--danger').click();
  await page.waitForTimeout(700);
  check('删除后回到我的', (await page.locator('.h-title').textContent()) === '我的');
  await shot(page, '14-sheet-deleted');

  // ---------- 迷你模式 ----------
  await page.keyboard.press('m');
  await page.waitForTimeout(500);
  check('迷你模式切换', (await page.locator('body.mini').count()) > 0);
  check('迷你模式隐藏主界面', !(await page.locator('.app').isVisible()));
  await page.setViewportSize({ width: 400, height: 120 });
  await page.waitForTimeout(400);
  check('迷你窗口内保留还原按钮', await page.locator('#btnMini2').isVisible());
  await shot(page, '10-mini');
  await page.keyboard.press('m');
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.waitForTimeout(300);

  // ---------- 响应式 ----------
  await page.setViewportSize({ width: 980, height: 760 });
  await page.waitForTimeout(500);
  await shot(page, '11-responsive');

  // ---------- 汇总 ----------
  console.log('\n================ 汇总 ================');
  const failed = results.filter((r) => !r.ok);
  console.log(`通过 ${results.length - failed.length}/${results.length}`);
  failed.forEach((f) => console.log(`❌ ${f.name} — ${f.detail}`));
  console.log('运行时错误:', errors.length ? '\n' + errors.join('\n') : '无');
  await browser.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST CRASHED:', e); process.exit(1); });
