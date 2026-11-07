'use strict';
/**
 * 代码签名配置回归测试（node-only）。
 *
 * 覆盖：动态签名状态机、无证书 / 有证书 / 只签不公证三种配置产物、
 * Windows 时间戳与哈希算法、entitlements 完整性、证书绝不入库、
 * 以及 release.yml 的 secrets 注入接线。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.error('  ✗', name, extra != null ? '→ ' + JSON.stringify(extra) : ''); }
}

const cfg = require('../electron-builder.js');
const state = cfg.__signingState;
const src = read('electron-builder.js');
const release = read('.github/workflows/release.yml');
const gitignore = read('.gitignore');

const SIGN_KEYS = [
  'CSC_LINK', 'WIN_CSC_LINK', 'MAC_CSC_LINK', 'CSC_NAME', 'CSC_KEY_PASSWORD',
  'CSC_IDENTITY_AUTO_DISCOVERY', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID',
  'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER',
  'APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE',
];
/** 在干净且可恢复的 env 下生成一份 builder 配置 */
function buildWith(extra = {}) {
  const saved = {};
  for (const k of SIGN_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
  try { return cfg(); }
  finally {
    for (const k of SIGN_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    for (const k of Object.keys(extra)) if (!SIGN_KEYS.includes(k)) delete process.env[k];
  }
}
const clean = (extra) => state(extra);

console.log('— 配置文件形态 —');
ok('electron-builder.js 存在', exists('electron-builder.js'));
ok('配置导出为函数（支持按 env 动态生成）', typeof cfg === 'function');
ok('导出 __signingState 纯函数供测试', typeof state === 'function');
ok('旧 electron-builder.yml 已删除（否则 yml 优先，JS 永远不生效）', !exists('electron-builder.yml'));
const baseCfg = buildWith();
ok('基础字段完整（appId / files / asarUnpack）',
  baseCfg.appId === 'com.guman.music' && Array.isArray(baseCfg.files) && baseCfg.asarUnpack.includes('**/node_modules/**'));
ok('publish 仍指向 GitHub Releases', /github/.test(JSON.stringify(baseCfg.publish)));

console.log('— 签名状态机 —');
ok('无任何凭据 → 全部关闭', JSON.stringify(clean({})) === JSON.stringify({ win: false, mac: false, apple: false, notarize: false }));
ok('通用 CSC_LINK → Windows + macOS 都签', (() => { const s = clean({ CSC_LINK: 'base64...' }); return s.win && s.mac && !s.notarize; })());
ok('WIN_CSC_LINK 只影响 Windows', (() => { const s = clean({ WIN_CSC_LINK: 'x' }); return s.win && !s.mac; })());
ok('MAC_CSC_LINK 只影响 macOS', (() => { const s = clean({ MAC_CSC_LINK: 'x' }); return !s.win && s.mac; })());
ok('CSC_NAME（钥匙串已有证书）也启用 macOS 签名', clean({ CSC_NAME: 'Developer ID Application: X' }).mac === true);
ok('空白字符串不算已配置', JSON.stringify(clean({ CSC_LINK: '   ', APPLE_ID: '' })) === JSON.stringify({ win: false, mac: false, apple: false, notarize: false }));
ok('Apple ID 三件套 → apple=true', clean({ APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b', APPLE_TEAM_ID: 'c' }).apple === true);
ok('App Store API Key 三件套 → apple=true', clean({ APPLE_API_KEY: 'a', APPLE_API_KEY_ID: 'b', APPLE_API_ISSUER: 'c' }).apple === true);
ok('Keychain profile 组合 → apple=true', clean({ APPLE_KEYCHAIN: 'a', APPLE_KEYCHAIN_PROFILE: 'b' }).apple === true);
ok('Apple ID 缺 TEAM_ID → apple=false', clean({ APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b' }).apple === false);
ok('API Key 缺 ISSUER → apple=false', clean({ APPLE_API_KEY: 'a', APPLE_API_KEY_ID: 'b' }).apple === false);
ok('只有 Apple 凭据、没有证书 → 不公证', clean({ APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b', APPLE_TEAM_ID: 'c' }).notarize === false);
ok('macOS 证书 + Apple 凭据 → 公证', clean({ MAC_CSC_LINK: 'x', APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b', APPLE_TEAM_ID: 'c' }).notarize === true);

console.log('— 无证书构建（必须与旧行为一致）—');
const unsigned = buildWith();
ok('mac.identity 保持 null，显式跳过签名', unsigned.mac.identity === null);
ok('hardenedRuntime=false，避免 ad-hoc 签名启动崩溃', unsigned.mac.hardenedRuntime === false);
ok('gatekeeperAssess=false', unsigned.mac.gatekeeperAssess === false);
ok('notarize=false，显式跳过公证', unsigned.mac.notarize === false);
ok('mac target 仍是 dmg + zip 双架构', JSON.stringify(unsigned.mac.target).includes('dmg') && JSON.stringify(unsigned.mac.target).includes('arm64'));

console.log('— 有证书构建 —');
const full = buildWith({
  CSC_LINK: 'base64...', CSC_KEY_PASSWORD: 'pw',
  APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b', APPLE_TEAM_ID: 'c',
});
ok('mac.identity 不再为 null（允许自动发现 Developer ID）', full.mac.identity !== null);
ok('hardenedRuntime=true（公证必需）', full.mac.hardenedRuntime === true);
ok('gatekeeperAssess=true（构建时校验签名）', full.mac.gatekeeperAssess === true);
ok('notarize=true', full.mac.notarize === true);
ok('有证书但缺 Apple 凭据 → 只签名不公证',
  buildWith({ CSC_LINK: 'x' }).mac.notarize === false && buildWith({ CSC_LINK: 'x' }).mac.hardenedRuntime === true);

console.log('— Windows 签名参数 —');
ok('签名参数收在 win.signtoolOptions（builder 26 schema 要求）', !!baseCfg.win.signtoolOptions && !('signingHashAlgorithms' in baseCfg.win));
ok('只用 SHA256（不再带已弃用的 SHA1）', JSON.stringify(baseCfg.win.signtoolOptions?.signingHashAlgorithms) === '["sha256"]');
ok('RFC3161 时间戳服务器已配置', /timestamp\.digicert\.com/.test(baseCfg.win.signtoolOptions?.rfc3161TimeStampServer || ''));
ok('win 产物名与 target 保持不变',
  baseCfg.win.artifactName === 'GumanMusic-${version}-${arch}.${ext}' && baseCfg.win.target[0].target === 'nsis');

console.log('— 证书绝不入库 —');
ok('配置里不写死 certificateFile / certificatePassword', !/certificateFile\s*:/.test(src) && !/certificatePassword\s*:/.test(src));
ok('配置里没有任何 pfx / p12 路径或明文口令', !/\.pfx|\.p12|password\s*[:=]\s*['"][^'"]+['"]/i.test(src));
ok('调试输出只打印布尔状态，不打印 env 值', /console\.log\('\[builder\] signing state:', JSON\.stringify\(s\)\)/.test(src));
ok('.gitignore 忽略 pfx / p12 / cer', ['*.pfx', '*.p12', '*.cer'].every((p) => gitignore.includes(p)));
ok('.gitignore 保留 entitlements 例外', gitignore.includes('!build/entitlements.mac.plist') && gitignore.includes('!build/entitlements.mac.inherit.plist'));

console.log('— macOS entitlements（hardened runtime 必需）—');
const ent = exists('build/entitlements.mac.plist') ? read('build/entitlements.mac.plist') : '';
const entInherit = exists('build/entitlements.mac.inherit.plist') ? read('build/entitlements.mac.inherit.plist') : '';
ok('build/entitlements.mac.plist 存在', !!ent);
ok('含 allow-jit（Electron / V8 必需）', ent.includes('com.apple.security.cs.allow-jit'));
ok('含 disable-library-validation（Electron framework 上游签名）', ent.includes('com.apple.security.cs.disable-library-validation'));
ok('含 network.server（本地 Express 回环监听）', ent.includes('com.apple.security.network.server'));
ok('inherit plist 存在且含 JIT 权限', !!entInherit && entInherit.includes('com.apple.security.cs.allow-jit'));

console.log('— CI 凭据注入接线 —');
ok('release.yml 注入 WIN_CSC_LINK / MAC_CSC_LINK', release.includes('secrets.WIN_CSC_LINK') && release.includes('secrets.MAC_CSC_LINK'));
ok('release.yml 注入 CSC_KEY_PASSWORD', release.includes('secrets.WIN_CSC_KEY_PASSWORD') && release.includes('secrets.MAC_CSC_KEY_PASSWORD'));
ok('release.yml 注入 Apple 公证三件套', ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].every((k) => release.includes('secrets.' + k)));
ok('release.yml 不再无条件关闭证书自动发现', !/CSC_IDENTITY_AUTO_DISCOVERY:\s*'false'/.test(release));

console.log(`\n${failed ? '✗' : '✓'} signing-check: ${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
