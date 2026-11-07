'use strict';
/**
 * 发版门禁：聚合全部 node-only 回归脚本，任一失败即以非零码退出。
 *
 * 只收「不需要 Electron / 浏览器 / 网易云网络」的脚本，保证 GitHub Runner 上稳定。
 * 需要 Playwright + 本地服务的 ui-smoke / cache-check / cover-lyric-check 等仍按
 * README 的说明在本地单独运行；np-overlay-check 的浏览器部分通过 GUMAN_NP_URL
 * 手动开启，这里显式清掉该变量，避免聚合测试依赖外部服务。
 */
const cp = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHECKS = [
  ['proxy-check.js', []],
  ['platform-search-check.js', ['--offline']],
  ['platform-url-check.js', ['--offline']],
  ['source-search-check.js', []],
  ['lx-url-validate-check.js', []],
  ['sound-sources-check.js', []],
  ['version-check.js', []],
  ['platform-auth-check.js', []],
  ['cloud-playlist-check.js', []],
  ['np-overlay-check.js', []],
  ['signing-check.js', []],
  ['ci-gate-check.js', []],
];

const env = { ...process.env };
delete env.GUMAN_NP_URL; // 浏览器命中测试不在门禁里跑，避免依赖外部服务

const results = [];
console.log('========== 孤男音乐 · 发版回归门禁 ==========');
for (const [name, args] of CHECKS) {
  const script = path.join(ROOT, 'scripts', name);
  const started = Date.now();
  const r = cp.spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  const ok = r.status === 0 && !r.error;
  results.push({ name, ok, ms: Date.now() - started, detail: r.error ? r.error.message : `exit=${r.status}` });
}

console.log('\n========== 汇总 ==========');
results.forEach((r) => {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(34)} ${String(r.ms).padStart(6)} ms  ${r.ok ? '' : r.detail}`);
});
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? '✗' : '✓'} 发版门禁：${results.length - failed.length}/${results.length} 通过${failed.length ? `，${failed.length} 个失败` : ''}\n`);
if (failed.length) process.exitCode = 1;
