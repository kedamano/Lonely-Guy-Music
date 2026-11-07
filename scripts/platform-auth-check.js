'use strict';
/**
 * 平台登录态（QQ 音乐）回归测试（node-only，无需 Electron / 网络）。
 * 覆盖：Cookie/JSON/双字段解析、uin 规范化、校验拒绝、落盘原子写、
 *       凭证不回传渲染层、清除保留其它平台配置、前后端接线与设置页 UI 存在性。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pa = require('../server/platform-auth');

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.error('  ✗', name, extra != null ? '→ ' + JSON.stringify(extra) : ''); }
}
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-check-'));
  const FILE = path.join(tmp, 'nested', 'platform-auth.json');
  pa.init(FILE);
  const T = pa.__test;

  console.log('\n[1] Cookie / JSON / 双字段解析');
  const c1 = T.parseCredential({ cookie: 'uin=o012345678; qm_keyst=AbCdEfGh123456; pgv_pvid=xx' });
  ok('整段 Cookie 提取 uin 数字', c1.uin === '012345678', c1);
  ok('整段 Cookie 保留 uinRaw 的 o 前缀', c1.uinRaw === 'o012345678', c1);
  ok('整段 Cookie 提取 qm_keyst', c1.qmKeyst === 'AbCdEfGh123456', c1);
  const c2 = T.parseCredential({ uin: '12345678', qmKeyst: 'AbCdEfGh123456' });
  ok('双字段输入可用', c2.uin === '12345678' && c2.qmKeyst === 'AbCdEfGh123456', c2);
  const c3 = T.parseCredential({ cookie: JSON.stringify({ tx: { uin: '87654321', qmKeyst: 'ZzYyXx987654' } }) });
  ok('整份 platform-auth.json 内容可解析', c3.uin === '87654321' && c3.qmKeyst === 'ZzYyXx987654', c3);
  const c4 = T.parseCredential('uin=12345678; qm_keyst=AbCdEfGh123456');
  ok('纯字符串 Cookie 可解析', c4.uin === '12345678' && c4.qmKeyst === 'AbCdEfGh123456', c4);
  const c5 = T.parseCredential({ cookie: 'qm_keyst=AbCdEfGh123456; p_uin=o012345678' });
  ok('p_uin 别名可被识别', c5.uin === '012345678', c5);
  const c6 = T.parseCredential({ cookie: 'uin=o012345678; qm_keyst=KkLlMmNn==; other=1' });
  ok('qm_keyst 含等号 padding 不截断', c6.qmKeyst === 'KkLlMmNn==', c6);
  const c7 = T.parseCredential({ cookie: 'uin=o012345678; qm_keyst=AbCdEfGh123456', uin: '99999999' });
  ok('显式 uin 优先于 Cookie 段', c7.uin === '99999999', c7);

  console.log('\n[2] 校验与掩码');
  ok('合法凭证通过校验', T.validate(c1) === '', T.validate(c1));
  ok('非法 uin 被拒绝', /uin/.test(T.validate(T.parseCredential({ cookie: 'uin=abc; qm_keyst=AbCdEfGh123456' }))));
  ok('缺失 qm_keyst 被拒绝', /qm_keyst/.test(T.validate(T.parseCredential({ uin: '12345678' }))));
  ok('过短 qm_keyst 被拒绝', /qm_keyst/.test(T.validate({ uin: '12345678', qmKeyst: 'abc' })));
  ok('uin 掩码保留首尾各两位', T.mask('12345678') === '12****78', T.mask('12345678'));
  ok('短 uin 不泄露', T.mask('123') === '****');

  console.log('\n[3] 落盘 / 状态 / 清除');
  const s1 = pa.save({ cookie: 'uin=o012345678; qm_keyst=AbCdEfGh123456' });
  const disk = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  ok('save 写入 tx.uin', disk.tx.uin === '012345678', disk.tx);
  ok('save 写入 tx.qmKeyst', disk.tx.qmKeyst === 'AbCdEfGh123456');
  ok('save 写入 tx.uinRaw', disk.tx.uinRaw === 'o012345678');
  ok('save 写入 updatedAt 时间戳', Number(disk.tx.updatedAt) > 0);
  ok('save 创建多级目录', fs.existsSync(path.dirname(FILE)));
  ok('原子写不残留 .tmp', !fs.existsSync(FILE + '.tmp'));
  ok('state 标记已配置', s1.tx.configured === true, s1);
  ok('state 的 uin 为掩码', s1.tx.uin === '01****78', s1.tx.uin);
  ok('state 不含 qmKeyst 字段', !Object.prototype.hasOwnProperty.call(s1.tx, 'qmKeyst'), s1.tx);
  ok('state 序列化后不含凭证值', !JSON.stringify(s1).includes('AbCdEfGh123456'));
  ok('raw() 供取链层读到原凭证', pa.raw().qmKeyst === 'AbCdEfGh123456');
  // 覆盖保存 + 保留其它平台配置
  T.writeAll({ kg: { token: 'keep-me' }, tx: disk.tx });
  const s2 = pa.clear();
  const disk2 = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  ok('clear 后 state 为未配置', s2.tx.configured === false, s2);
  ok('clear 删除 tx', !('tx' in disk2), disk2);
  ok('clear 保留其它平台字段', disk2.kg && disk2.kg.token === 'keep-me', disk2);
  let rejected = false;
  try { pa.save({ cookie: 'uin=abc' }); } catch (e) { rejected = e.status === 400; }
  ok('非法输入保存被拒（400）', rejected);
  ok('非法保存不覆盖已有配置', !fs.existsSync(FILE + '.tmp'));

  console.log('\n[4] 前后端接线（静态契约）');
  const idx = read('server/index.js');
  ok('后端挂载 GET /api/platform/auth', /app\.get\('\/api\/platform\/auth'/.test(idx));
  ok('后端挂载 POST /api/platform/auth', /app\.post\('\/api\/platform\/auth'/.test(idx));
  ok('后端挂载清除接口', /app\.post\('\/api\/platform\/auth\/clear'/.test(idx));
  ok('凭证路由在通配反代之前定义', idx.indexOf("app.get('/api/platform/auth'") < idx.indexOf("app.all('/api/*'"));
  ok('/api/platform 前缀属于 RESERVED', /p\.startsWith\('\/api\/platform'\)/.test(idx));
  ok('模块 init 使用与取链层同一文件', /platformAuth\.init\(PLATFORM_AUTH_FILE\)/.test(idx));
  const qq = read('server/platforms/qq.js');
  ok('QQ 取链 Cookie 优先使用 uinRaw', /uin=\$\{auth\.uinRaw \|\| auth\.uin\}/.test(qq));
  const apiSrc = read('renderer/js/api.js');
  ok('api 提供 platformAuth 读取', /platformAuth:\s*\(\)/.test(apiSrc));
  ok('api 提供 platformAuthSave', /platformAuthSave:/.test(apiSrc));
  ok('api 提供 platformAuthClear', /platformAuthClear:/.test(apiSrc));
  const setSrc = read('renderer/js/settings.js');
  ok('设置页存在 QQ 登录态分区', /QQ 音乐登录态/.test(setSrc));
  ok('设置页支持整段 Cookie 自动解析输入', /qqCookieInput/.test(setSrc));
  ok('设置页提供保存并生效', /onSavePlatformAuth/.test(setSrc));
  ok('设置页提供清除登录态', /onClearPlatformAuth/.test(setSrc));
  ok('设置页 init 加载凭证状态', /this\.loadPlatformAuth\(\)/.test(setSrc));
  ok('保存后清空输入框（凭证不留在 DOM）', /clearAuthInputs\(\)/.test(setSrc));

  console.log(`\n${failed ? '✗' : '✓'} platform-auth-check: ${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
