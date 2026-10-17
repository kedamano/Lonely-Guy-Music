// 版本号显示回归测试（默认不启动 GUI，避免与正在运行的实例抢单实例锁）
//
// 历史问题：主进程传 "v1.2.1"，渲染层又拼一个 v →「关于」面板显示「v v1.2.1」。
// 这里同时校验「传参契约」和「格式化结果」，任何一端再加 v 都会失败。
// 需要真机 DOM 校验时：set GUMAN_VERSION_GUI=1，要求先退出正在运行的应用。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const settingsSrc = fs.readFileSync(path.join(root, 'renderer/js/settings.js'), 'utf8');

// 1. 主进程只传裸版本号
const metaLine = (mainSrc.match(/--guman-meta=[^`]*/) || [''])[0];
check('主进程传参不带 v 前缀', !!metaLine && !/--guman-meta=v\}\$/.test(metaLine) && !/=v\$/.test(metaLine), metaLine.trim());

// 2. 渲染层剥离可能的前缀（兼容旧主进程）
check('关于面板会剥离 v 前缀', /appVersion[\s\S]{0,120}replace\(\/\^v\/i,\s*''\)/.test(settingsSrc), 'settings.js 版本读取');

// 3. 复刻格式化逻辑：两种输入都必须只出现一个 v
const fmt = (raw) => `孤男音乐 · 桌面声场 v${String(raw).replace(/^v/i, '')} · 当前模式：在线曲库（网易云）。`;
const pkgVersion = require('../package.json').version;
for (const raw of [pkgVersion, 'v' + pkgVersion]) {
  const line = fmt(raw);
  const vCount = (line.match(/v/gi) || []).length;
  const ok = line.includes('v' + pkgVersion) && vCount === 1 && !/v\s*v/i.test(line);
  check(`输入 ${raw} → 输出只含一个 v`, ok, line);
}

// 4. i18n 的关于面板模板仍能匹配（否则英文/繁体界面会漏翻这一行）
const i18nSrc = fs.readFileSync(path.join(root, 'renderer/js/i18n.js'), 'utf8');
check('i18n 关于面板正则仍匹配', /孤男音乐 · 桌面声场 \(v\\S\+\) · 当前模式/.test(i18nSrc), 'PATTERNS');

// 可选：真机校验（需要先退出正在运行的应用）
if (process.env.GUMAN_VERSION_GUI === '1') {
  const { _electron: electron } = require('playwright');
  (async () => {
    const app = await electron.launch({ args: [root], env: { ...process.env, ENABLE_NCM: '0' } });
    const page = await app.firstWindow();
    await page.waitForTimeout(3500);
    await page.click('.nav__item[data-route="settings"]');
    await page.waitForTimeout(1500);
    const about = await page.evaluate(() => {
      const hit = [...document.querySelectorAll('.settings__desc')].find((n) => /当前模式/.test(n.textContent));
      return hit ? hit.textContent.trim() : '';
    });
    const ok = /v\d+\.\d+\.\d+/.test(about) && (about.match(/v/gi) || []).length === 1;
    check('真机「关于」面板版本号', ok, about);
    await app.close();
    finish();
  })().catch((e) => { console.error('真机校验异常：', e.message); process.exit(1); });
} else {
  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n================ 汇总 ================`);
  console.log(`通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log('失败项：');
    failed.forEach((f) => console.log(` - ${f.name}（${f.detail}）`));
    process.exit(1);
  }
}
