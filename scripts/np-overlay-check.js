'use strict';
/**
 * 歌曲详情页（正在播放浮层）隔离回归测试（node-only，无需 Electron / 网络）。
 *
 * 背景：v1.4.2 之前 .np 自身没有不透明底色，只有一层中心 alpha .34 的径向渐变，
 * 且 .np.open 整体做 opacity 0→1 淡入；于是侧栏昵称、「搜索 / 声场」页标题、
 * 顶栏曲名、播放列表文字都会透过半透明封面背景显示出来。
 *
 * 静态断言覆盖：不透明底色、层叠层级、淡入只作用于内容、未误伤弹窗 / 迷你模式 /
 * 封面三种背景模式 / 队列抽屉。设置 GUMAN_NP_URL 时额外跑一次真实 Chromium 命中测试。
 */
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.error('  ✗', name, extra != null ? '→ ' + JSON.stringify(extra) : ''); }
}
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function rule(css, selector) {
  // 取出单条规则的花括号内容（本项目 CSS 为单行紧凑写法）
  const i = css.indexOf(selector);
  if (i < 0) return '';
  const start = css.indexOf('{', i);
  const end = css.indexOf('}', start);
  return start < 0 || end < 0 ? '' : css.slice(start + 1, end);
}

async function browserChecks() {
  const url = process.env.GUMAN_NP_URL;
  if (!url) { console.log('\n  (未设置 GUMAN_NP_URL，跳过真实浏览器命中测试)'); return; }
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (_) { console.log('\n  (未安装 playwright，跳过真实浏览器命中测试)'); return; }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const points = [
      ['侧栏账号区', 95, 95], ['顶栏曲名', 680, 28],
      ['搜索页标题', 230, 130], ['声场页标题', 1100, 130], ['主视图中部', 500, 400],
    ];
    const before = await page.evaluate((pts) => pts.map(([, x, y]) => {
      const n = document.elementFromPoint(x, y);
      return !!(n && (n.closest('.titlebar') || n.closest('.app')));
    }), points);
    ok('[浏览器] 详情页关闭时这些坐标确实命中主界面 UI', before.every(Boolean), before);

    const styled = await page.evaluate(() => {
      const np = document.getElementById('np');
      np.classList.add('open');
      const s = getComputedStyle(np);
      return { bg: s.backgroundColor, opacity: s.opacity, display: s.display };
    });
    ok('[浏览器] 详情页背景完全不透明（无 alpha 通道）', /^rgb\(\s*\d+,\s*\d+,\s*\d+\s*\)$/.test(styled.bg), styled);
    ok('[浏览器] 详情页整体 opacity 为 1（淡入期间不露底层）', styled.opacity === '1', styled);
    ok('[浏览器] 详情页为 display:block', styled.display === 'block', styled);

    await page.waitForTimeout(450); // 等淡入结束
    const hits = await page.evaluate((pts) => pts.map(([, x, y]) => {
      const n = document.elementFromPoint(x, y);
      return !!(n && n.closest('#np'));
    }), points);
    ok('[浏览器] 5 个红框坐标全部被详情页遮罩接管', hits.every(Boolean), hits);

    const after = await page.evaluate(() => {
      const np = document.getElementById('np');
      np.classList.remove('open');
      return getComputedStyle(np).display;
    });
    ok('[浏览器] 关闭后详情页不再占位', after === 'none', after);
    ok('[浏览器] 无运行时错误', errors.length === 0, errors);
  } finally {
    await browser.close();
  }
}

async function main() {
  const css = read('renderer/styles.css');
  const html = read('renderer/index.html');
  const app = read('renderer/js/app.js');

  const npRule = rule(css, '.np {');
  const openRule = rule(css, '.np.open {');

  console.log('— 覆盖层底色 —');
  ok('.np 规则存在', !!npRule);
  ok('.np 全屏覆盖（position:fixed + inset:0）', /position:\s*fixed/.test(npRule) && /inset:\s*0/.test(npRule));
  ok('.np 自带不透明底色 background: var(--bg)', /background:\s*var\(--bg\)/.test(npRule));
  ok('--bg 是不透明 6 位 hex（无 alpha / 非 transparent）', /--bg:\s*#[0-9a-fA-F]{6}\s*;/.test(css));
  ok('.np 默认 display:none，不占位', /display:\s*none/.test(npRule));

  console.log('— 层叠层级 —');
  const npZ = Number((npRule.match(/z-index:\s*(\d+)/) || [])[1]);
  ok('.np z-index 为 40', npZ === 40, npZ);
  ok('.np 高于自定义标题栏 (12)', npZ > Number((rule(css, '.titlebar {').match(/z-index:\s*(\d+)/) || [])[1]));
  ok('.np 高于播放栏 (15)', npZ > Number((rule(css, '.playerbar {').match(/z-index:\s*(\d+)/) || [])[1]));
  ok('.np 高于响应式 stage (24)', npZ > 24 && /z-index:\s*24/.test(css));
  ok('HTML 中 #np 在 playerbar 之后（body 直属，不在 .app 内）',
    html.indexOf('class="np"') > html.indexOf('</footer>'));
  ok('底层 UI 节点仍在 DOM（靠遮罩隔离，而非删节点）',
    /id="titleNp"/.test(html) && /class="account"/.test(html));

  console.log('— 淡入动画 —');
  ok('.np.open 不再整体做 opacity 淡入', !!openRule && !/animation/.test(openRule) && /display:\s*block/.test(openRule));
  ok('.np.open .np__inner 单独淡入', /\.np\.open \.np__inner,\s*\n\.np\.open \.np__close \{\s*animation:\s*fade/.test(css));
  ok('.np__bg 不被 fade 动画覆盖（data-mode 的 opacity 仍生效）',
    !/\.np\.open \.np__bg[^{]*\{[^}]*animation/.test(css));
  ok('@keyframes fade 保留', /@keyframes fade \{[\s\S]*?opacity:\s*0[\s\S]*?opacity:\s*1/.test(css));
  ok('弹窗 .modal.open 仍沿用 fade（未误伤）', /\.modal\.open \{[^}]*animation:\s*fade/.test(css));

  console.log('— 背景与内容层级 —');
  ok('.np::before 暗化渐变保留且在底层 (z-index 0)', /\.np::before \{[^}]*radial-gradient[^}]*z-index:\s*0/.test(css));
  ok('.np__bg 为 z-index 0（低于内容）', /\.np__bg \{[^}]*z-index:\s*0/.test(css));
  ok('.np__inner 为 z-index 2、关闭按钮为 3', /\.np__inner \{[^}]*z-index:\s*2/.test(css) && /\.np__close \{[^}]*z-index:\s*3/.test(css));
  ok('封面背景三种模式规则齐全', ['blur', 'color', 'app'].every((m) => css.includes(`.np__bg[data-mode="${m}"]`)));

  console.log('— 相邻交互不受影响 —');
  ok('np 打开时播放栏仍隐藏', /body:has\(\.np\.open\) \.playerbar \{[^}]*opacity:\s*0/.test(css));
  ok('迷你模式下 np 仍不显示', /body\.mini \.np[^{]*\{[^}]*display:\s*none\s*!important/.test(css));
  ok('响应式窄屏仍保留 .np 内边距覆盖', /@media \(max-width:[^)]*\)[\s\S]{0,400}\.np \{ padding:/.test(css) || /\.np \{ padding: 54px 36px 42px; \}/.test(css));
  ok('openNp 先关闭队列（不透明底色不会挡住队列抽屉）', /function openNp\(\)[\s\S]{0,220}closeQueue\(\)/.test(app));
  ok('详情页内队列按钮会先关闭详情页再显示队列', /function openQueue\(\)[\s\S]{0,180}classList\.contains\('open'\)\) closeNp\(\)/.test(app));
  ok('详情页初始 aria-hidden=true 且关闭时复位', /id="np" aria-hidden="true"/.test(html) && /setAttribute\('aria-hidden', 'true'\)/.test(app));

  await browserChecks();
  console.log(`\n${failed ? '✗' : '✓'} np-overlay-check: ${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
