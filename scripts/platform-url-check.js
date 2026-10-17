#!/usr/bin/env node
// 平台取链验证：匹配打分（纯函数）+ 酷狗匿名直链（联网）
//
// 背景：QQ 的 vkey 与 uin 绑定，匿名拿不到 purl；酷狗 m.kugou.com 的 playInfo 接口匿名可用。
// 因此取链策略是「音源 → 平台原生 → QQ 跨平台兜底到酷狗」，本脚本验证这套策略的关键环节。
//
// 运行：node scripts/platform-url-check.js
//   --offline   只跑纯函数断言，跳过联网部分
const path = require('path');
const os = require('os');
const fs = require('fs');

const OFFLINE = process.argv.includes('--offline');

// 隔离 userData：取链模块会读 platform-auth.json
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guman-url-check-'));
process.env.GUMAN_USER_DATA = tmp;

const purl = require('../server/platform-url');
const search = require('../server/platform-search');
const { similarity, normName } = purl.__test;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  /* ---------- 1. 歌名归一化 ---------- */
  check('归一化去掉括号版本标记', normName('晴天 (女声独唱版)') === '晴天', normName('晴天 (女声独唱版)'));
  check('归一化去掉标点与空格', normName('海阔天空 - Beyond!') === '海阔天空beyond', normName('海阔天空 - Beyond!'));
  check('归一化统一大小写', normName('Hey Jude') === normName('HEY JUDE'), normName('Hey Jude'));

  /* ---------- 2. 相似度打分 ---------- */
  const target = { name: '晴天', artist: '周杰伦', duration: 269000 };
  const sameSong = similarity({ name: '晴天', artist: '周杰伦', duration: 268000 }, target);
  const coverSameLen = similarity({ name: '晴天 (女声独唱版)', artist: '梅菜扣肉肉', duration: 268000 }, target);
  const wrongSong = similarity({ name: '七里香', artist: '周杰伦', duration: 269000 }, target);
  const wayOffLen = similarity({ name: '晴天', artist: '路人', duration: 90000 }, target);

  check('原曲命中最高分', sameSong >= 10, String(sameSong));
  check('翻唱版（同长、歌手不同）仍可接受', coverSameLen >= 7, String(coverSameLen));
  check('不同歌名直接淘汰', wrongSong === -1, String(wrongSong));
  check('同名但时长差极大被降权', wayOffLen < coverSameLen, `${wayOffLen} < ${coverSameLen}`);

  /* ---------- 3. 酷狗取链（联网） ---------- */
  if (OFFLINE) {
    console.log('\n（--offline：跳过联网取链）');
  } else {
    let list = [];
    try {
      const r = await search.searchPlatform('kg', '海阔天空 Beyond', 1, 5);
      list = r.list || [];
      check('酷狗搜索可返回结果', list.length > 0, `${list.length} 条`);
    } catch (e) {
      check('酷狗搜索可返回结果', false, e.message);
    }

    if (list.length) {
      const t = list[0];
      try {
        const got = await purl.resolvePlatformUrl({
          platform: 'kg',
          musicInfo: t.musicInfo,
          name: t.name,
          artist: t.artist,
          duration: t.duration,
          quality: '320',
        });
        check('酷狗可解析出播放地址', !!got.url, got.from);
        check('返回地址指向酷狗 CDN', /kugou\.com/.test(got.url), got.url.slice(0, 48));

        // 真实拉一小段，确认不是 403/空响应
        const r = await fetch(got.url, { headers: { Range: 'bytes=0-2047' }, signal: AbortSignal.timeout(15000) });
        const buf = Buffer.from(await r.arrayBuffer());
        check('直链可下载音频数据', (r.status === 200 || r.status === 206) && buf.length > 0,
          `${r.status} ${buf.length}B ${r.headers.get('content-type')}`);
        // ID3 或 MPEG 帧同步字：确认确实是音频而非错误页
        const isAudio = buf.slice(0, 3).toString() === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
        check('返回内容为音频数据', isAudio, buf.slice(0, 3).toString('hex'));
      } catch (e) {
        check('酷狗可解析出播放地址', false, e.message);
      }
    }

    /* ---------- 4. QQ 兜底（无登录态时应转到酷狗） ---------- */
    try {
      const r = await search.searchPlatform('tx', '海阔天空 Beyond', 1, 3);
      const t = (r.list || [])[0];
      if (t) {
        const got = await purl.resolvePlatformUrl({
          platform: 'tx',
          musicInfo: t.musicInfo,
          name: t.name,
          artist: t.artist,
          duration: t.duration,
          quality: '320',
        });
        check('QQ 无登录态时走跨平台兜底', got.from === 'kugou-fallback', got.from);
        check('兜底结果带匹配信息', !!(got.matched && got.matched.name), got.matched ? `${got.matched.name} · ${got.matched.artist}` : '无');
      } else {
        check('QQ 搜索可返回结果', false, '空列表');
      }
    } catch (e) {
      check('QQ 无登录态时走跨平台兜底', false, e.message);
    }
  }

  /* ---------- 汇总 ---------- */
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n通过 ${pass}/${results.length}`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  process.exit(pass === results.length ? 0 : 1);
})();
