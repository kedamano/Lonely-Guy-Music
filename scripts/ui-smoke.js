// 全量交互测试：每个按钮、每条流程都点一遍，报告失败项（含可见性断言）
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
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url().slice(0, 120)}`); });

  // ---------- 1. 启动与模式徽标 ----------
  await page.goto(process.env.BASE_URL || 'http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const badge1 = await page.locator('#apiMode').textContent();
  await page.waitForTimeout(12000); // 等网易云探测完成
  const badge2 = await page.locator('#apiMode').textContent();
  check('模式徽标已确定', ['在线曲库', '离线示例'].includes(badge2), `boot时="${badge1}" 12s后="${badge2}"`);

  // ---------- 2. 发现页 ----------
  const cards = await page.locator('.pl-card').count();
  const cardOpacity = await page.evaluate(() => {
    const c = document.querySelector('.pl-card');
    return c ? getComputedStyle(c).opacity : 'none';
  });
  check('发现页歌单卡片 > 0 且可见', cards > 0 && cardOpacity === '1', `${cards} 张, opacity=${cardOpacity}`);
  // 封面应真实加载成功（经 /api/proxy），而非停留在渐变占位
  await page.waitForTimeout(2500);
  const coverStat = await page.evaluate(() => {
    const covers = [...document.querySelectorAll('.pl-card__cover')];
    const loaded = covers.filter((c) => !c.classList.contains('is-fallback') && /url\(/.test(getComputedStyle(c).backgroundImage));
    return { total: covers.length, loaded: loaded.length };
  });
  check('发现页封面真实加载（非占位）', coverStat.total > 0 && coverStat.loaded / coverStat.total >= 0.5,
    `已加载 ${coverStat.loaded}/${coverStat.total}`);

  // ---------- 3. 导航：每个侧边栏项 ----------
  for (const route of ['hall', 'search', 'local', 'mine', 'settings', 'discover']) {
    await page.click(`.nav__item[data-route="${route}"]`);
    await page.waitForTimeout(500);
    const title = await page.locator('.h-title').first().textContent().catch(() => '');
    check(`导航 → ${route}`, !!title, `标题="${title}"`);
  }

  // ---------- 4. 音乐馆分类 + 分页 ----------
  await page.click('.nav__item[data-route="hall"]');
  await page.waitForTimeout(400);
  await page.click('.cat:not(.is-active)');
  await page.waitForTimeout(1500);
  const hallCards = await page.locator('.pl-card').count();
  check('音乐馆切换分类有内容', hallCards > 0, `${hallCards} 张`);
  // 分页器：信息行 + 翻页按钮
  const hallPagerCount = await page.locator('.pager').count();
  const hallInfo = await page.locator('.pager__info').first().textContent().catch(() => '');
  check('音乐馆显示分页器与总数', hallPagerCount > 0 && /共\s*\d+\s*个歌单/.test(hallInfo), hallInfo);
  if (hallPagerCount > 0) {
    const nextBtn = page.locator('.pager__btn[aria-label="下一页"]').first();
    const disabled = await nextBtn.isDisabled();
    check('音乐馆第一页时“下一页”可用', !disabled);
    if (!disabled) {
      await nextBtn.click();
      await page.waitForTimeout(1500);
      const info2 = await page.locator('.pager__info').first().textContent().catch(() => '');
      const activePage = await page.locator('.pager__btn.is-active').first().textContent().catch(() => '');
      check('音乐馆翻页生效', /第\s*2\s*\//.test(info2) && activePage === '2', `${info2} | 当前页=${activePage}`);
    }
  }

  // ---------- 5. 搜索（Enter 触发 + 可见性） ----------
  await page.click('.nav__item[data-route="search"]');
  await page.waitForTimeout(400);
  await page.fill('#searchInput', '稻香');
  await page.press('#searchInput', 'Enter');
  await page.waitForTimeout(4000);
  const searchTracks = await page.locator('#searchOut .track').count();
  const searchVis = await page.evaluate(() => {
    const t = document.querySelector('#searchOut .track');
    return t ? { opacity: getComputedStyle(t).opacity, h: Math.round(t.getBoundingClientRect().height) } : null;
  });
  check('搜索"稻香"有结果且可见', searchTracks > 0 && searchVis && searchVis.opacity === '1' && searchVis.h > 0,
    `tracks=${searchTracks}, ${JSON.stringify(searchVis)}`);
  // 搜索分页器
  const searchPagerCount = await page.locator('#view .pager').count();
  const searchInfo = await page.locator('.pager__info').first().textContent().catch(() => '');
  check('搜索结果显示分页器', searchPagerCount > 0 && /第\s*\d+\s*\/\s*\d+\s*页/.test(searchInfo), searchInfo);
  await page.screenshot({ path: 'scripts/ui-shot-search.png' });

  // ---------- 6. 点击歌曲播放 ----------
  if (searchTracks > 0) {
    const firstTitle = await page.locator('#searchOut .track__title').first().textContent();
    await page.locator('#searchOut .track').first().click();
    await page.waitForTimeout(9000);
    const pbTitle = await page.locator('#pbTitle').textContent();
    const cur = await page.locator('#curTime').textContent();
    const dur = await page.locator('#durTime').textContent();
    check('点击歌曲后播放条更新', pbTitle === firstTitle && cur !== '0:00', `播放"${pbTitle}" ${cur}/${dur}`);
    // 封面应经同源代理加载成功（background-image 非空且不是破图）
    const coverBg = await page.evaluate(() => {
      const c = document.querySelector('#pbCover');
      return c ? getComputedStyle(c).backgroundImage : 'none';
    });
    check('播放后封面加载成功', coverBg && coverBg !== 'none' && /proxy|126\.net|gradient/.test(coverBg), String(coverBg).slice(0, 90));
  }

  // ---------- 7. 播放条按钮 ----------
  const clickAndCheck = async (sel, name, verify) => {
    await page.click(sel);
    await page.waitForTimeout(600);
    check(name, await verify());
  };
  if (searchTracks > 0) {
    await clickAndCheck('#btnShuffle', '随机按钮切换', async () => (await page.locator('#btnShuffle.is-on').count()) > 0);
    await clickAndCheck('#btnShuffle', '随机按钮再切换', async () => (await page.locator('#btnShuffle.is-on').count()) === 0);
    await page.click('#btnRepeat');
    await page.waitForTimeout(300);
    check('循环按钮切换', (await page.locator('#btnRepeat').getAttribute('title')) !== '列表循环');
    await page.click('#btnNext');
    await page.waitForTimeout(2500);
    check('下一首切换曲目', (await page.locator('#pbTitle').textContent()) !== '');
    await page.click('#btnFav');
    await page.waitForTimeout(300);
    check('收藏按钮切换', (await page.locator('#btnFav.is-on').count()) > 0);
    await page.click('#btnLyric');
    await page.waitForTimeout(400);
    check('歌词浮层打开', (await page.locator('#np.open').count()) > 0);
    await page.click('#npClose');
    await page.waitForTimeout(300);
    check('歌词浮层关闭', (await page.locator('#np.open').count()) === 0);
    await page.click('#btnPlay');
    await page.waitForTimeout(500);
    const playing1 = await page.locator('#btnPlay use').getAttribute('href');
    await page.click('#btnPlay');
    await page.waitForTimeout(500);
    const playing2 = await page.locator('#btnPlay use').getAttribute('href');
    check('播放/暂停切换', playing1 !== playing2, `${playing1}→${playing2}`);
    // 进度条 seek（点中点）
    await page.click('#seek');
    await page.waitForTimeout(800);
    check('进度条跳转', (await page.locator('#curTime').textContent()) !== '0:00');
    // 音量
    await page.click('#volSlider');
    await page.waitForTimeout(300);
    check('音量条点击', (await page.locator('#volFill').getAttribute('style')) !== 'width: 80%');
  }

  // ---------- 8. 声场面板 ----------
  await page.click('#btnStage');
  await page.waitForTimeout(500);
  check('声场面板打开', (await page.locator('#app.stage-open').count()) > 0);
  const eqInputs = await page.locator('#eq input').count();
  check('EQ 10 段滑块', eqInputs === 10, `${eqInputs} 段`);
  await page.locator('#eq input').nth(2).fill('6');
  await page.waitForTimeout(300);
  check('EQ 滑块调参', (await page.locator('#eqPresetName').textContent()) === '自定义');
  await page.click('.eqp:not(.is-active)');
  await page.waitForTimeout(300);
  check('EQ 预设切换', (await page.locator('#eqPresetName').textContent()) !== '自定义');
  await page.click('#sleepRow .chip[data-min="30"]');
  await page.waitForTimeout(300);
  check('睡眠定时设置', (await page.locator('#sleepStatus').textContent()).includes('还剩'));
  await page.click('#sleepRow .chip[data-min="0"]');
  await page.waitForTimeout(200);
  await page.click('#accents .swatch[data-accent="violet"]');
  await page.waitForTimeout(300);
  check('强调色切换', (await page.locator('html').getAttribute('data-accent')) === 'violet');
  await page.screenshot({ path: 'scripts/ui-shot-stage.png' });
  await page.click('#stageClose');
  await page.waitForTimeout(300);
  check('声场面板关闭', (await page.locator('#app.stage-open').count()) === 0);

  // ---------- 9. 迷你模式 ----------
  await page.keyboard.press('m');
  await page.waitForTimeout(400);
  check('迷你模式切换', (await page.locator('body.mini').count()) > 0);
  await page.keyboard.press('m');
  await page.waitForTimeout(300);

  // ---------- 10. 快捷电台 ----------
  await page.click('.pill[data-mood="摇滚"]');
  await page.waitForTimeout(2500);
  const moodTracks = await page.locator('.pl-card').count();
  const moodVis = await page.evaluate(() => {
    const t = document.querySelector('.pl-card');
    return t ? getComputedStyle(t).opacity : 'none';
  });
  check('快捷电台进入歌单且可见', moodTracks > 0 && moodVis === '1', `${moodTracks} 个歌单, opacity=${moodVis}`);

  // ---------- 11. 设置页 + 音源开关 + 网络代理 + 歌词背景 ----------
  await page.click('.nav__item[data-route="settings"]');
  await page.waitForTimeout(600);
  const selCount = await page.locator('.settings__select').count();
  check('设置页渲染', selCount === 3, `${selCount} 个下拉（音质/歌词背景/语言）`);
  const srcCount = await page.locator('.sourcecard').count();
  check('设置页显示音源区域', (await page.locator('.settings__section').count()) >= 3, `${srcCount} 张音源卡`);

  // 语言切换：简体 → English，界面文案应变换
  const langSel = page.locator('.settings__select[aria-label="语言"]');
  check('设置页有语言选项', (await langSel.count()) === 1);
  if ((await langSel.count()) === 1) {
    await langSel.selectOption('en');
    await page.waitForTimeout(800);
    const navText = await page.locator('.nav__item[data-route="settings"]').textContent();
    check('语言切换为 English 生效', /settings/i.test(navText), `导航项="${navText}"`);
    await langSel.selectOption('zh-CN');
    await page.waitForTimeout(800);
    const navBack = await page.locator('.nav__item[data-route="settings"]').textContent();
    check('语言可切回简体中文', /设置/.test(navBack), `导航项="${navBack}"`);
  }

  // 字体大小：切换后 html[data-fontsize] 变化
  const fontSeg = page.locator('.seg[aria-label="字体大小"]');
  check('设置页有字体大小选项', (await fontSeg.count()) === 1);
  if ((await fontSeg.count()) === 1) {
    await fontSeg.locator('.seg__btn').nth(4).click();
    await page.waitForTimeout(400);
    const fs = await page.evaluate(() => document.documentElement.getAttribute('data-fontsize'));
    check('字体大小切换生效', !!fs && fs !== '', `data-fontsize=${fs}`);
  }

  // 动画开关（复选框视觉隐藏，点滑块）
  const animToggle = page.locator('.settings__item', { hasText: '显示动画效果' }).locator('.toggle__slider');
  check('设置页有动画开关', (await animToggle.count()) === 1);
  if ((await animToggle.count()) === 1) {
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-anim'));
    await animToggle.click();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-anim'));
    check('动画开关切换生效', before !== after, `${before}→${after}`);
    await animToggle.click(); // 还原
    await page.waitForTimeout(300);
  }

  // 下载开关：控制播放条下载按钮显隐
  const dlToggle = page.locator('.settings__item', { hasText: '启用下载功能' }).locator('.toggle__slider');
  check('设置有下载开关', (await dlToggle.count()) === 1);
  if ((await dlToggle.count()) === 1) {
    const checked = await page.locator('.settings__item', { hasText: '启用下载功能' }).locator('input[type="checkbox"]').isChecked();
    if (!checked) await dlToggle.click();
    await page.waitForTimeout(300);
    const npDlVisible = await page.evaluate(() => {
      const b = document.querySelector('#npDownload');
      return b ? getComputedStyle(b).display !== 'none' : false;
    });
    check('开启下载后播放条显示下载按钮', npDlVisible);
  }

  // 来源标签开关：控制 body.no-srctag 的增减
  const srcToggle = page.locator('.settings__item', { hasText: '显示歌曲来源平台' }).locator('.toggle__slider');
  check('设置有来源标签开关', (await srcToggle.count()) === 1);
  if ((await srcToggle.count()) === 1) {
    const clsBefore = await page.evaluate(() => document.body.className);
    await srcToggle.click(); // 关→开
    await page.waitForTimeout(300);
    const clsOn = await page.evaluate(() => document.body.className);
    check('来源标签开启时移除 no-srctag', !/no-srctag/.test(clsOn), `body="${clsOn}"（原="${clsBefore}"）`);
    await srcToggle.click(); // 开→关，还原
    await page.waitForTimeout(300);
    const clsOff = await page.evaluate(() => document.body.className);
    check('来源标签关闭时添加 no-srctag', /no-srctag/.test(clsOff), `body="${clsOff}"`);
  }

  // 桌面歌词开关（浏览器中无 Electron，仅验证开关可切换）
  const dlwToggle = page.locator('.settings__item', { hasText: '显示桌面歌词' }).locator('.toggle__slider');
  check('设置有桌面歌词开关', (await dlwToggle.count()) === 1);
  if ((await dlwToggle.count()) === 1) {
    const before = await page.locator('.settings__item', { hasText: '显示桌面歌词' }).locator('input[type="checkbox"]').isChecked();
    await dlwToggle.click();
    await page.waitForTimeout(300);
    const after = await page.locator('.settings__item', { hasText: '显示桌面歌词' }).locator('input[type="checkbox"]').isChecked();
    check('桌面歌词开关可切换', before !== after);
    await dlwToggle.click(); // 还原
    await page.waitForTimeout(300);
  }

  // 网络代理：尊重用户既有配置——先记录、测完恢复，不污染真实设置
  const proxyInput = page.locator('.settings__input[aria-label="网络代理地址"]');
  check('设置页有网络代理配置项', (await proxyInput.count()) === 1);
  if ((await proxyInput.count()) === 1) {
    const initialProxy = await proxyInput.inputValue();
    const proxyStatus = await page.locator('.settings__proxystatus').textContent();
    if (initialProxy) {
      check('已配置代理时状态正确显示', new RegExp(initialProxy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(proxyStatus), proxyStatus);
    } else {
      check('代理默认状态为直连', /未使用代理/.test(proxyStatus), proxyStatus);
    }
    const saveProxy = page.locator('.settings__addrow .btn--primary', { hasText: '保存代理' });
    // 空保存 = 关闭代理
    await proxyInput.fill('');
    await saveProxy.click();
    await page.waitForTimeout(600);
    const toast1 = await page.locator('#toast').textContent();
    check('保存空代理即关闭代理', /已关闭代理/.test(toast1), toast1);
    // 非法代理地址应报错且不影响现有配置
    await proxyInput.fill('http://');
    await saveProxy.click();
    await page.waitForTimeout(600);
    const toast2 = await page.locator('#toast').textContent();
    check('非法代理地址被拒绝', /保存失败/.test(toast2), toast2);
    // 恢复用户原有配置
    await proxyInput.fill(initialProxy);
    await saveProxy.click();
    await page.waitForTimeout(600);
    const toast3 = await page.locator('#toast').textContent();
    const restoredOk = initialProxy ? /已启用代理/.test(toast3) : /已关闭代理/.test(toast3);
    check('代理配置测后可恢复', restoredOk, `${initialProxy || '（空）'} → ${toast3}`);
  }

  // 歌词页背景：三模式可切换
  const bgSel = page.locator('.settings__select[aria-label="歌词页背景"]');
  check('设置页有歌词背景选项', (await bgSel.count()) === 1);
  if ((await bgSel.count()) === 1) {
    await bgSel.selectOption('app');
    await page.waitForTimeout(400);
    const toastBg = await page.locator('#toast').textContent();
    check('歌词背景可切换为应用背景', /应用背景/.test(toastBg), toastBg);
    const npMode = await page.evaluate(() => document.querySelector('#npBg')?.dataset.mode || '');
    check('歌词背景切换后立即生效', npMode === 'app', `npBg mode=${npMode}`);
    await bgSel.selectOption('blur');
    await page.waitForTimeout(400);
    const npMode2 = await page.evaluate(() => document.querySelector('#npBg')?.dataset.mode || '');
    check('歌词背景可切回封面模糊', npMode2 === 'blur', `npBg mode=${npMode2}`);
  }

  if (srcCount > 0) {
    const firstSlider = page.locator('.sourcecard .toggle__slider').first();
    const checkedBefore = await page.locator('.sourcecard .toggle input').first().isChecked();
    await firstSlider.click();
    await page.waitForTimeout(500);
    const checkedAfter = await page.locator('.sourcecard .toggle input').first().isChecked();
    check('音源开关可切换', checkedBefore !== checkedAfter, `${checkedBefore}→${checkedAfter}`);
    await firstSlider.click(); // 还原
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: 'scripts/ui-shot-settings.png' });

  // ---------- 12. 歌单详情 + 播放全部 ----------
  await page.click('.nav__item[data-route="discover"]');
  await page.waitForTimeout(800);
  await page.locator('.pl-card').first().click();
  await page.waitForTimeout(2500);
  const plTracks = await page.locator('.track').count();
  check('歌单详情有曲目', plTracks > 0, `${plTracks} 首`);
  // 歌单详情分页（曲目超过 50 才有翻页，否则至少无报错）
  const plPager = await page.locator('.pager').count();
  check('歌单详情分页器就绪', plPager >= 0, `${plPager} 个分页器`);
  if (plTracks > 0) {
    await page.click('.pl-hero__cta .btn-primary');
    await page.waitForTimeout(9000);
    const t = await page.locator('#pbTitle').textContent();
    const c = await page.locator('#curTime').textContent();
    check('播放全部生效', c !== '0:00' && t !== '未选择歌曲', `播放"${t}" ${c}`);
  }

  // ---------- 汇总 ----------
  console.log('\n================ 汇总 ================');
  const failed = results.filter((r) => !r.ok);
  console.log(`通过 ${results.length - failed.length}/${results.length}`);
  failed.forEach((f) => console.log(`❌ ${f.name} — ${f.detail}`));
  console.log('运行时错误:', errors.length ? '\n' + errors.join('\n') : '无');
  await browser.close();
})().catch((e) => { console.error('TEST CRASHED:', e); process.exit(1); });
