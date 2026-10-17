// UI 回归检查：加载、搜索、播放、队列、歌单、歌词、声场、我的、设置、迷你模式
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

const BASE = process.env.BASE_URL || `http://localhost:${process.env.HOST_PORT || 3100}`;
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

// 假的 OpenAI 兼容翻译服务：验证「用户自带 key」这条链路时不需要真实额度
const STUB_PORT = Number(process.env.TRANS_STUB_PORT || 4399);
let stubHits = 0;
let stubAuth = '';
function startStubProvider() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        stubHits++;
        stubAuth = String(req.headers.authorization || '');
        let out = '[]';
        try {
          const body = JSON.parse(raw);
          const user = (body.messages || []).map((m) => m.content).join('\n');
          const arr = JSON.parse(user.slice(user.lastIndexOf('['), user.lastIndexOf(']') + 1));
          out = JSON.stringify(arr.map((s) => `T:${s}`));
        } catch (_) { /* 返回空数组，让被测代码走失败分支 */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: out } }] }));
      });
    });
    srv.once('error', reject);
    srv.listen(STUB_PORT, '127.0.0.1', () => resolve(srv));
  });
}

const apiGet = (p) => fetch(BASE + p).then((r) => r.json());
// 切语言会整页重建设置页，异步接口回填完成后才算稳定
const waitSettingsSettled = (page) => page.waitForFunction(() => {
  const secs = [...document.querySelectorAll('.settings__section')];
  if (!secs.length) return false;
  if (!secs.every((s) => +getComputedStyle(s).opacity > 0.9)) return false;
  const status = [...document.querySelectorAll('.settings__proxystatus')].filter((n) => n.textContent.trim());
  return status.length >= 2 && [...document.querySelectorAll('.settings__select')].every((s) => s.value);
}, null, { timeout: 10000 }).then(() => true).catch(() => false);
const apiPost = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

(async () => {
  const stub = await startStubProvider();
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
  check('我的页六个标签', mineTabs === 6, `${mineTabs} 个`);
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
  // 原生下拉面板由系统绘制：option 若继承半透明底会在白底上糊成一片，必须是不透明深色
  const optLum = await page.evaluate(() => {
    const o = document.querySelector('select option');
    if (!o) return -1;
    const n = getComputedStyle(o).backgroundColor.match(/\d+/g).map(Number);
    return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2];
  });
  check('下拉选项为不透明深色底', optLum >= 0 && optLum < 90, `亮度 ${Math.round(optLum)}`);
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

  // ---------- 订阅歌单（来源标记） ----------
  await page.evaluate(() => { location.hash = '#/mine/pin'; });
  await page.waitForTimeout(700);
  check('订阅歌单工具栏', (await page.locator('.lib-toolbar').count()) > 0);
  check('未登录时给登录引导', (await page.locator('.lib-toolbar__hint').textContent()).includes('登录'));
  const pullBtn = await page.getByText('拉取云端歌单').count();
  check('未登录不显示拉取云端', pullBtn === 0);
  await shot(page, '15-mine-pin');

  // ---------- 听歌记录回写 ----------
  await page.evaluate(() => { location.hash = '#/discover'; });
  await page.waitForTimeout(900);
  await page.locator('.track').first().click();
  await page.waitForTimeout(2500);
  const scrobbleGate = await page.evaluate(() => {
    const p = window.__guman.player;
    return { source: p.current?.source, id: p.current?.id, ready: p._scrobbleReady() };
  });
  check('在线曲目进入上报候选', scrobbleGate.source === 'online' && /^\d+$/.test(String(scrobbleGate.id)),
    `${scrobbleGate.source}/${scrobbleGate.id}`);
  check('未登录时不上报听歌记录', scrobbleGate.ready === false);

  const scrobbleReq = page.waitForRequest((r) => r.url().includes('/api/scrobble'), { timeout: 12000 })
    .catch(() => null);
  const scrobbleDrive = await page.evaluate(async () => {
    const p = window.__guman.player;
    // 离线环境没有登录态，绕过账号闸门，只验证"到达阈值 → 发出上报请求"这条链路
    p._scrobbleReady = () => true;
    p._scrobbled = false;
    if (p.audio.paused) { try { await p.audio.play(); } catch (_) { /* 自动播放策略 */ } }
    const d = p.duration;
    const need = d ? Math.max(30, Math.min(d / 2, 240)) : 30;
    // 示例音频走外网 CDN，元数据没回来时 seek 会被夹回 0，所以轮询到阈值真正生效为止
    const deadline = Date.now() + 9000;
    while (Date.now() < deadline && !p._scrobbled) {
      p.audio.currentTime = need + 1;
      p._maybeScrobble();
      await new Promise((r) => setTimeout(r, 250));
    }
    return { need, state: p.audio.readyState, dur: p.audio.duration, at: p.audio.currentTime };
  });
  const hit = await scrobbleReq;
  check('到达阈值后上报听歌记录', !!hit,
    hit ? new URL(hit.url()).search.slice(0, 48) : `未发出请求（阈值 ${scrobbleDrive.need}s，readyState ${scrobbleDrive.state}）`);
  const dup = await page.evaluate(() => window.__guman.player._scrobbled);
  check('同一首不重复上报', dup === true);
  await shot(page, '16-scrobble');

  // ---------- 语言切换 ----------
  const CJK = new RegExp('[' + String.fromCharCode(0x3400) + '-' + String.fromCharCode(0x9fff) + ']');
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const sel = [...document.querySelectorAll('.settings__select')]
      .find((s) => [...s.options].some((o) => o.value === 'en'));
    sel.value = 'en';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  check('切英文后设置页重建完成', await waitSettingsSettled(page));
  const langState = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('.settings__section')];
    const pick = (sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent.trim()).filter(Boolean);
    return {
      sections: secs.length,
      visible: secs.filter((s) => +getComputedStyle(s).opacity > 0.9).length,
      titles: pick('.settings__title'),
      labels: pick('.settings__item-label'),
      descs: pick('.settings__item-desc'),
      nav: pick('.nav__item'),
    };
  });
  check('切英文后设置页仍然可见', langState.sections > 0 && langState.visible === langState.sections,
    `${langState.visible}/${langState.sections} 区块不透明`);
  const uiText = [...langState.titles, ...langState.labels, ...langState.descs];
  const leftover = uiText.filter((t) => CJK.test(t));
  check('设置页文案全量跟随语言', leftover.length === 0, leftover.slice(0, 3).join(' / '));
  const phLeft = await page.evaluate(() => {
    const re = new RegExp('[' + String.fromCharCode(0x3400) + '-' + String.fromCharCode(0x9fff) + ']');
    return [...document.querySelectorAll('.settings__input')]
      .map((n) => `${n.placeholder}|${n.getAttribute('aria-label') || ''}`)
      .filter((s) => re.test(s));
  });
  check('输入框提示语跟随语言', phLeft.length === 0, phLeft.slice(0, 2).join(' / '));
  check('侧边栏跟随语言', langState.nav.every((t) => !CJK.test(t)), langState.nav.join(' '));
  await shot(page, '17-settings-en');

  await page.evaluate(() => {
    const sel = [...document.querySelectorAll('.settings__select')]
      .find((s) => [...s.options].some((o) => o.value === 'zh-CN'));
    sel.value = 'zh-CN';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  check('切回简体后设置页重建完成', await waitSettingsSettled(page));
  const backZh = await page.evaluate(() => [...document.querySelectorAll('.settings__title')].map((n) => n.textContent.trim()));
  check('切回简体后原文还原', backZh.length > 0 && backZh.every((t) => CJK.test(t)), backZh.slice(0, 2).join(' '));
  const backPh = await page.evaluate(() => [...document.querySelectorAll('.settings__input')].map((n) => n.placeholder || ''));
  check('切回简体后输入框提示语还原',
    backPh.some((s) => s.includes('留空')) && !backPh.some((s) => /leave blank|e\.g\./.test(s)),
    backPh.filter(Boolean).join(' | ').slice(0, 70));

  // ---------- 歌词翻译 ----------
  const badCfg = await apiPost('/api/translate/config', { baseUrl: '127.0.0.1:1/v1', model: 'x', apiKey: 'k' });
  check('拒绝非法翻译服务地址', badCfg.code === 400, badCfg.msg || '');
  await apiPost('/api/translate/config', {
    baseUrl: `http://127.0.0.1:${STUB_PORT}/v1`, model: 'stub-mini', apiKey: 'sk-never-leak',
  });
  const trState = await apiGet('/api/translate/state');
  check('状态接口不回显密钥',
    trState.data.configured === true && !JSON.stringify(trState).includes('sk-never-leak'),
    JSON.stringify(trState.data));
  // 缓存按 歌曲id+语言+原文 落盘，用一次性 id 保证每次运行都能走到真实的外部调用
  const probeId = `uitest-${Date.now()}`;
  const t1 = await apiPost('/api/translate', { id: probeId, lines: ['夜色像潮水漫过窗台'], to: 'en' });
  const t2 = await apiPost('/api/translate', { id: probeId, lines: ['夜色像潮水漫过窗台'], to: 'en' });
  check('按需调用翻译服务', t1.code === 0 && t1.data.from === 'ai' && String(t1.data.lines[0]).startsWith('T:'),
    `${t1.data && t1.data.from} / ${t1.data && t1.data.lines[0]}`);
  check('同一首二次请求命中缓存', t2.code === 0 && t2.data.from === 'cache' && stubHits === 1,
    `${t2.data && t2.data.from}，外部调用 ${stubHits} 次`);
  check('密钥随请求发给用户自己的服务', stubAuth === 'Bearer sk-never-leak', stubAuth.slice(0, 18));

  await page.click('.nav__item[data-route="discover"]');
  await page.waitForTimeout(900);
  await page.locator('.pl-card').first().click();
  await page.waitForTimeout(1500);
  const rowIds = await page.evaluate(() => [...document.querySelectorAll('.track[data-track-id]')].map((n) => n.dataset.trackId));
  const probed = [];
  for (const id of rowIds.slice(0, 30)) {
    const r = await apiGet(`/api/lyric?id=${encodeURIComponent(id)}`);
    // 有些歌连原文歌词都没有，那种样本测不到翻译入口
    const lrc = String((r && r.lrc && r.lrc.lyric) || '').replace(/\[[^\]]*\]/g, '').trim();
    probed.push({ id, lrc: !!lrc, has: !!(r && r.tlyric && r.tlyric.lyric) });
    if (probed.some((p) => p.lrc && p.has) && probed.some((p) => p.lrc && !p.has)) break;
  }
  const cloudSample = probed.find((p) => p.lrc && p.has);
  const bareSample = probed.find((p) => p.lrc && !p.has);
  await page.evaluate(() => { window.__guman.store.set({ lyricLang: 'both' }); });

  if (cloudSample) {
    await page.locator(`.track[data-track-id="${cloudSample.id}"]`).click();
    await page.waitForTimeout(2200);
    await page.click('#btnLyric');
    await page.waitForTimeout(1600);
    const cloud = await page.evaluate(() => ({
      lines: document.querySelectorAll('.lyric-line').length,
      trans: document.querySelectorAll('.lyric-line__trans').length,
      from: window.__guman.player.lyricTransFrom,
      ask: document.querySelectorAll('.lyric-trans-ask').length,
    }));
    check('官方译文直接双语显示', cloud.trans > 0 && cloud.from === 'cloud' && cloud.ask === 0,
      `${cloud.trans}/${cloud.lines} 行有译文，来源 ${cloud.from}`);
    await shot(page, '18-lyric-cloud-trans');
    await page.keyboard.press('Escape');
  } else {
    check('官方译文直接双语显示', true, '样本里没有带 tlyric 的歌曲，跳过');
  }

  // 只看译文：不再叠加双语子行（走 selectRow 同款事件契约）
  if (cloudSample) {
    await page.evaluate(() => {
      window.__guman.store.set({ lyricLang: 'trans' });
      window.dispatchEvent(new CustomEvent('guman:setting', { detail: { key: 'lyricLang', value: 'trans' } }));
    });
    await page.waitForTimeout(900);
    await page.click('#btnLyric');
    await page.waitForTimeout(1200);
    const only = await page.evaluate(() => ({
      sub: document.querySelectorAll('.lyric-line__trans').length,
      latin: [...document.querySelectorAll('.lyric-line')].filter((n) => /[A-Za-z]{3}/.test(n.textContent)).length,
      ask: document.querySelectorAll('.lyric-trans-ask').length,
    }));
    check('只看译文时不再叠加原文', only.sub === 0 && only.latin > 0 && only.ask === 0,
      `译文 ${only.latin} 行 / 双语子行 ${only.sub} 个`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__guman.store.set({ lyricLang: 'both' }); });
    await page.waitForTimeout(400);
  }

  if (bareSample) {
    await page.locator(`.track[data-track-id="${bareSample.id}"]`).click();
    await page.waitForTimeout(2200);
    await page.click('#btnLyric');
    await page.waitForTimeout(1600);
    const before = await page.evaluate(() => ({
      lines: document.querySelectorAll('.lyric-line').length,
      trans: document.querySelectorAll('.lyric-line__trans').length,
      ask: document.querySelectorAll('.lyric-trans-ask').length,
    }));
    check('无译文时给出翻译入口', before.ask === 1 && before.trans === 0 && before.lines > 0,
      `${before.lines} 行 / 按钮 ${before.ask} 个 / 译文 ${before.trans} 行`);
    if (before.ask === 1) {
      await page.locator('.lyric-trans-ask').click();
      await page.waitForFunction(() => document.querySelectorAll('.lyric-line__trans').length > 0, null, { timeout: 15000 })
        .catch(() => {});
    }
    const after = await page.evaluate(() => ({
      trans: document.querySelectorAll('.lyric-line__trans').length,
      sample: document.querySelector('.lyric-line__trans')?.textContent || '',
      from: window.__guman.player.lyricTransFrom,
    }));
    check('点击后按需生成译文', after.trans > 0 && after.from === 'ai' && after.sample.startsWith('T:'),
      `${after.trans} 行 / ${after.sample.slice(0, 20)}`);
    await shot(page, '19-lyric-ai-trans');
    const hitsFirst = stubHits;

    // 换一首再切回来：译文应来自本地缓存，不再产生外部调用
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    if (cloudSample) {
      await page.locator(`.track[data-track-id="${cloudSample.id}"]`).click();
      await page.waitForTimeout(2000);
      await page.locator(`.track[data-track-id="${bareSample.id}"]`).click();
      await page.waitForTimeout(2000);
      await page.click('#btnLyric');
      await page.waitForTimeout(1500);
      const again = await page.evaluate(() => ({
        ask: document.querySelectorAll('.lyric-trans-ask').length,
        trans: document.querySelectorAll('.lyric-line__trans').length,
      }));
      let cached = { trans: 0, from: '' };
      if (again.ask === 1 && again.trans === 0) {
        await page.locator('.lyric-trans-ask').click();
        await page.waitForFunction(() => document.querySelectorAll('.lyric-line__trans').length > 0, null, { timeout: 15000 })
          .catch(() => {});
        cached = await page.evaluate(() => ({
          trans: document.querySelectorAll('.lyric-line__trans').length,
          from: window.__guman.player.lyricTransFrom,
        }));
      }
      // 第二次点同一首必须吃本地缓存：外部调用数不再增长
      check('重进同一首走本地缓存', cached.trans > 0 && cached.from === 'ai' && stubHits === hitsFirst,
        `外部调用 ${hitsFirst} → ${stubHits} 次，译文 ${cached.trans} 行`);
    }
    await page.keyboard.press('Escape');
  } else {
    check('无译文时给出翻译入口', true, '样本里每首歌都带 tlyric，跳过');
    check('点击后按需生成译文', true, '跳过');
  }
  await page.evaluate(() => { window.__guman.store.set({ lyricLang: 'off' }); });

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
  stub.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST CRASHED:', e); process.exit(1); });
