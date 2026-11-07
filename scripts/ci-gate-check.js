'use strict';
/**
 * 发版测试门禁回归测试（node-only）。
 *
 * 历史问题：release.yml 由 tag 触发，但 tag push 不匹配 ci.yml 的 branches 过滤，
 * 且 build / publish 不依赖任何测试结果 —— 发版链路完全没有门禁。
 * 这里只做文本/结构断言，不解析 YAML（避免引入间接依赖），保证契约不被改回去。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.error('  ✗', name, extra != null ? '→ ' + JSON.stringify(extra) : ''); }
}

/** 按两空格缩进切出顶层 job 块 */
function jobsOf(yaml) {
  const out = {};
  let cur = null;
  for (const line of yaml.split('\n')) {
    const m = line.match(/^  ([A-Za-z][\w-]*):\s*$/);
    if (m) { cur = m[1]; out[cur] = []; continue; }
    if (/^[^\s]/.test(line)) { cur = null; continue; } // 回到顶层键
    if (cur) out[cur].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]));
}

const release = read('.github/workflows/release.yml');
const ci = read('.github/workflows/ci.yml');
const pkg = require('../package.json');
const all = read('scripts/check-all.js');
const syntax = read('scripts/check-syntax.js');
const J = jobsOf(release);

const NODE_ONLY = [
  'proxy-check.js', 'platform-search-check.js', 'platform-url-check.js',
  'source-search-check.js', 'lx-url-validate-check.js', 'sound-sources-check.js',
  'version-check.js', 'platform-auth-check.js', 'cloud-playlist-check.js',
  'np-overlay-check.js', 'signing-check.js', 'ci-gate-check.js',
];

console.log('— release.yml 门禁结构 —');
ok('存在独立 test job', !!J.test, Object.keys(J));
ok('build 依赖 test', /needs:\s*test\b/.test(J.build || ''));
ok('publish 依赖 test', /needs:\s*\[?[^\]]*test/.test(J.publish || ''));
ok('publish 依赖 build', /needs:\s*\[?[^\]]*build/.test(J.publish || ''));
ok('test job 安装依赖 npm ci', /npm ci/.test(J.test || ''));
ok('test job 固定 Node 22', /node-version:\s*22/.test(J.test || ''));
ok('test job 跑语法检查', /npm run check:syntax/.test(J.test || ''));
ok('test job 跑全量回归门禁', /npm run check:all/.test(J.test || ''));
ok('test job 不打包（纯测试，失败即挡住三平台构建）', !/electron-builder|npm run dist/.test(J.test || ''));
ok('test job 在 Linux runner 上跑（跨平台再校验一遍）', /runs-on:\s*ubuntu-latest/.test(J.test || ''));
ok('release 仍保留 contents: write 权限', /contents:\s*write/.test(release));
ok('三平台矩阵仍在', ['windows-latest', 'macos-latest', 'ubuntu-latest'].every((os) => release.includes(os)));

console.log('— 主干 CI 复用同一套门禁 —');
ok('ci.yml 跑 check:syntax', /npm run check:syntax/.test(ci));
ok('ci.yml 跑 check:all', /npm run check:all/.test(ci));
ok('ci.yml 仍覆盖 push main 与 PR', /branches:\s*\[main, master\]/.test(ci) && /pull_request:/.test(ci));

console.log('— 聚合脚本契约 —');
ok('package.json 提供 check:syntax', /check-syntax\.js/.test(pkg.scripts['check:syntax'] || ''));
ok('package.json 提供 check:all', /check-all\.js/.test(pkg.scripts['check:all'] || ''));
ok(`check-all 聚合 ${NODE_ONLY.length} 个 node-only 脚本`, (all.match(/\['[\w-]+-check\.js'/g) || []).length === NODE_ONLY.length);
NODE_ONLY.forEach((name) => ok(`check-all 收录 ${name}`, all.includes(`['${name}'`)));
ok('任一脚本失败即退出非零', /process\.exitCode\s*=\s*1/.test(all));
ok('清空 GUMAN_NP_URL，聚合测试不依赖外部服务', /delete env\.GUMAN_NP_URL/.test(all));
ok('明确排除需要 Electron / 浏览器的脚本', /ui-smoke|cache-check|cover-lyric-check/.test(all));
ok('check-syntax 覆盖主进程与预加载', ['main.js', 'main-log.js', 'preload.js'].every((f) => syntax.includes(f)));
ok('check-syntax 覆盖 server / renderer/js / scripts', ['server', 'renderer/js', 'scripts'].every((d) => syntax.includes(`'${d}'`)));
ok('check-syntax 覆盖动态打包配置', syntax.includes('electron-builder.config.js'));
ok('check-syntax 失败即退出非零', /process\.exitCode\s*=\s*1/.test(syntax));

console.log('— 签名凭据注入 —');
ok('Windows 打包 step 注入 CSC_LINK / 密码', /CSC_LINK:\s*\$\{\{ secrets\.WIN_CSC_LINK \}\}/.test(release) && /secrets\.WIN_CSC_KEY_PASSWORD/.test(release));
ok('macOS 打包 step 注入 CSC_LINK / CSC_NAME', /secrets\.MAC_CSC_LINK/.test(release) && /secrets\.MAC_CSC_NAME/.test(release));
ok('macOS 打包 step 注入 Apple 公证凭据', ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY'].every((k) => release.includes('secrets.' + k)));
ok('证书自动发现改为按凭据条件开启', /CSC_IDENTITY_AUTO_DISCOVERY:\s*\$\{\{/.test(release));
ok('无凭据时不强制签名（构建照常）', /secrets\.MAC_CSC_LINK != ''/.test(release));
ok('三平台打包命令都显式指定动态配置（-c）',
  (release.match(/npx electron-builder -c electron-builder\.config\.js/g) || []).length === 3);
ok('不存在与 CLI 同名、会被 npx 静默执行的 electron-builder.js',
  !require('fs').existsSync(path.join(ROOT, 'electron-builder.js')));

console.log('— 版本一致性 —');
const readme = read('README.md');
ok('README 版本徽章与 package.json 一致', readme.includes(`version-${pkg.version}-`));

console.log(`\n${failed ? '✗' : '✓'} ci-gate-check: ${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
