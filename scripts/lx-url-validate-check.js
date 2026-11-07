'use strict';
/**
 * 洛雪音源取链校验回归（v1.2.6 修复）：
 *   resolveMusicUrl 把音源返回的链接交给 <audio> 前，必须先探测校验，
 *   避免「失效 / 错误页 / 试听占位 / 非音频」链接直达播放器触发 code 4「音源可能已失效」。
 *
 *   - 好链：校验通过 → 返回链接
 *   - 坏链：校验不过 → 视为该音源失败，Promise.any 切到下一音源；全失败则整体抛错（交给原生 + 跨平台兜底）
 *   - 多音源：坏链音源被跳过，好链音源胜出
 *   - skipSourceId：重试时跳过已知失效音源
 *   - 负缓存：同一坏链 60s 内不再重复探测
 *   - GUMAN_DISABLE_URL_PROBE=1：退回旧行为（不校验，直接返回）
 *   - lyric/pic action：不探测
 *
 * 全程不联网：probeAudio 由测试注入 mock。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guman-urlval-'));
process.env.GUMAN_USER_DATA = tmpDir;
process.env.GUMAN_DEBUG = '';
// 不依赖真实探测：本测试强制控制 probe 行为（即便 URL 校验被整体关闭，也能验证开关）
delete process.env.GUMAN_DISABLE_URL_PROBE;

const sourceManager = require('../server/source-manager');

function makeMusicUrlSource(name, platform, url) {
  return `
/* @name ${name} */
lx.send('inited', {
  status: 'ok',
  sources: {
    ${platform}: { name: '${name}', type: 'music', actions: ['musicUrl'], qualitys: ['128k'] }
  }
});
lx.on('request', function (data) {
  if (data.action === 'musicUrl') return ${JSON.stringify(url)};
  return null;
});
`;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('✅ ' + name); pass++; }
  else { console.error('❌ ' + name + (extra ? ' — ' + extra : '')); fail++; }
}

// 可控 probe：URL 含 'dead' → 校验不过；否则通过。统计调用次数用于负缓存断言。
let probeCalls = 0;
function mockProbe(url) {
  probeCalls++;
  if (/dead|fail|expired/.test(url)) return { ok: false, reason: 'HTTP 403 已失效' };
  return { ok: true, format: 'mp3', totalBytes: 3000000 };
}

async function main() {
  await sourceManager.init();
  sourceManager.__test.setProbeAudio(mockProbe);

  const GOOD = 'https://cdn.example.com/good.mp3';
  const BAD = 'https://cdn.example.com/dead.mp3';

  // 1) 好链：校验通过 → 返回
  await sourceManager.addSource({ code: makeMusicUrlSource('mock-good', 'kg', GOOD) });
  const goodId = sourceManager.getSources().find((s) => s.id === 'mock-good').id;
  let r1;
  try { r1 = await sourceManager.resolveMusicUrl({ sourcePlatform: 'kg', musicInfo: { interval: 200 }, quality: '128k' }); }
  catch (e) { r1 = { __err: e.message }; }
  ok('好链校验通过并返回', r1 && r1.url === GOOD, JSON.stringify(r1));

  // 2) 坏链：隔离好链音源后，校验不过 → 整体抛错（不会把死链当作结果返回）
  await sourceManager.addSource({ code: makeMusicUrlSource('mock-bad', 'kg', BAD) });
  let threwBad = false, badErr = '';
  try { await sourceManager.resolveMusicUrl({ sourcePlatform: 'kg', musicInfo: { interval: 200 }, quality: '128k', skipSourceId: goodId }); }
  catch (e) { threwBad = true; badErr = e.message; }
  ok('坏链（死链）被校验拦截并抛错', threwBad, badErr);
  ok('坏链错误信息体现校验失败', /校验/.test(badErr), badErr);

  // 3) 多音源：坏链音源被跳过，好链音源胜出
  //    （mock-good 与 mock-bad 都声明 kg；Promise.any 应返回好链）
  let r3;
  try { r3 = await sourceManager.resolveMusicUrl({ sourcePlatform: 'kg', musicInfo: { interval: 200 }, quality: '128k' }); }
  catch (e) { r3 = { __err: e.message }; }
  ok('坏链音源被跳过、好链胜出', r3 && r3.url === GOOD, JSON.stringify(r3));

  // 4) skipSourceId：存在好链时跳过它 → 只剩坏链 → 整体抛错
  const goodSummary = sourceManager.getSources().find((s) => s.id === 'mock-good');
  let threwSkip = false;
  try {
    await sourceManager.resolveMusicUrl({ sourcePlatform: 'kg', musicInfo: { interval: 200 }, quality: '128k', skipSourceId: goodSummary.id });
  } catch (_) { threwSkip = true; }
  ok('skipSourceId 跳过好链后坏链暴露并抛错', threwSkip);

  // 5) 负缓存：坏链失败后，60s 内再次解析同一坏链不再探测
  //    先移除其它音源，只留一个全新坏链音源 mock-bad2，单独观察其探测计数
  await sourceManager.removeSource(goodId);
  await sourceManager.removeSource('mock-bad');
  const BAD2 = 'https://cdn.example.com/dead2.mp3';
  await sourceManager.addSource({ code: makeMusicUrlSource('mock-bad2', 'kg', BAD2) });
  sourceManager.__test.clearLxNeg();
  probeCalls = 0;
  const beforeBad = probeCalls;
  try { await sourceManager.resolveMusicUrl({ sourcePlatform: 'kg', musicInfo: { hash: 'neg1' }, quality: '128k' }); } catch (_) {}
  const afterFirst = probeCalls;
  try { await sourceManager.resolveMusicUrl({ sourcePlatform: 'kg', musicInfo: { hash: 'neg1' }, quality: '128k' }); } catch (_) {}
  const afterSecond = probeCalls;
  ok('坏链首次解析会触发探测', afterFirst - beforeBad === 1, `calls=${afterFirst - beforeBad}`);
  ok('负缓存：60s 内重复坏链不再探测', afterSecond === afterFirst, `calls=${afterSecond - afterFirst}`);

  // 6) GUMAN_DISABLE_URL_PROBE=1：退回旧行为，坏链被直接返回（不校验、不读负缓存）
  sourceManager.__test.clearLxNeg();
  process.env.GUMAN_DISABLE_URL_PROBE = '1';
  let r6;
  try { r6 = await sourceManager.resolveMusicUrl({ sourcePlatform: 'kg', musicInfo: { hash: 'dis1' }, quality: '128k' }); }
  catch (e) { r6 = { __err: e.message }; }
  ok('关闭校验后坏链被直接返回（旧行为）', r6 && r6.url === BAD2, JSON.stringify(r6));
  delete process.env.GUMAN_DISABLE_URL_PROBE;

  // 7) lyric action 不探测：返回字符串即成功
  const lyricSource = `
  lx.send('inited', { status: 'ok', sources: { kg: { name: 'mock-lyric', type: 'music', actions: ['lyric'], qualitys: ['128k'] } } });
  lx.on('request', function (data) { if (data.action === 'lyric') return '[00:00.00]测试'; return null; });
  `;
  await sourceManager.addSource({ code: lyricSource });
  const beforeLyric = probeCalls;
  let r7;
  try { r7 = await sourceManager.resolveAction({ sourcePlatform: 'kg', action: 'lyric', musicInfo: {} }); }
  catch (e) { r7 = { __err: e.message }; }
  ok('lyric action 返回歌词且不触发探测', r7 && r7.lyric === '[00:00.00]测试', JSON.stringify(r7));
  ok('lyric 未调用 probeAudio', probeCalls === beforeLyric, `delta=${probeCalls - beforeLyric}`);

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('运行异常:', e); process.exit(1); });
