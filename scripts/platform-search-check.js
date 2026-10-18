'use strict';
/**
 * 多平台搜索与取链回归（离线为主，默认附带联网冒烟）。
 *
 * 离线覆盖：
 *   - 文本归一化：NFKC / HTML 实体 / 繁转简 / 去括号 / 版本标记
 *   - 酷我伪 JSON 解析（单引号、无引号键、尾逗号、无根括号）
 *   - QQ / 酷我 / 咪咕字段映射（时长毫秒、VIP、封面、qualityHints）
 *   - 平台内去重与跨平台合并（sourceCount / sources / 主来源）
 *   - 取链缓存键包含音质
 *   - 音频探测：酷我 181521 试听占位、过小文件、码率异常、正常文件
 *   - 平台可用性：mg 原生可用、qs 依赖洛雪音源
 *
 * 联网覆盖（加 --offline 跳过）：QQ / 酷我 / 咪咕 / 聚合搜索。
 *
 * 用法：node scripts/platform-search-check.js [--offline]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const OFFLINE = process.argv.includes('--offline');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guman-psearch-'));
process.env.GUMAN_USER_DATA = tmpDir;
process.env.GUMAN_DEBUG = '';

const utils = require('../server/song-utils');
const { parseLooseJson } = require('../server/loose-json');
const qq = require('../server/platforms/qq');
const kuwo = require('../server/platforms/kuwo');
const migu = require('../server/platforms/migu');
const platformSearch = require('../server/platform-search');
const platformAggregate = require('../server/platform-aggregate');
const platformUrl = require('../server/platform-url');
const sourceManager = require('../server/source-manager');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('✅ ' + name); pass++; }
  else { console.error('❌ ' + name + (extra !== undefined ? ' — ' + extra : '')); fail++; }
}

async function offlineTests() {
  /* ---------- 文本归一化 ---------- */
  ok('NFKC 全角转半角', utils.cleanText('ＡＢＣ　１２３') === 'ABC 123', utils.cleanText('ＡＢＣ　１２３'));
  ok('解码 HTML 实体并去标签', utils.cleanText('<em>A&amp;B</em>') === 'A&B', utils.cleanText('<em>A&amp;B</em>'));
  ok('繁转简（opencc）', /周杰伦/.test(utils.toSimplified('周傑倫 晴天')) && /女声/.test(utils.toSimplified('女聲獨唱版')));
  ok('normName 既有语义', utils.normName('海阔天空 - Beyond!') === '海阔天空beyond');
  ok('normName 去掉括号版本', utils.normName('晴天 (Live)') === '晴天');
  ok('variantTag 标记 Live', utils.variantTag('晴天 (Live)') === 'Live');
  ok('variantTag 无标记返回 null', utils.variantTag('晴天') === null);

  /* ---------- 酷我伪 JSON ---------- */
  const loose = parseLooseJson("{abslist:[{'MUSICRID':'MUSIC_1','NAME':'&apos;晴天&apos;','ARTIST':'周杰倫',},],total:'10'}");
  ok('伪 JSON 支持单引号/无引号键/尾逗号', Array.isArray(loose.abslist) && loose.abslist.length === 1, JSON.stringify(loose).slice(0, 80));
  ok('伪 JSON 解码 HTML 实体', loose.abslist[0].NAME === "'晴天'", loose.abslist[0].NAME);
  const braceLess = parseLooseJson("abslist:[{NAME:'x'}],total:'1'");
  ok('伪 JSON 无根括号自动包裹', braceLess.abslist[0].NAME === 'x' && braceLess.total === '1');

  /* ---------- 平台字段映射 ---------- */
  const tx = qq.__test.mapOfficial({
    songmid: '0039MnYb0qxYhV', media_mid: '001Media', songname: '晴天', singer: [{ name: '周杰伦' }],
    albumname: '叶惠美', albummid: '002Album', interval: 269, pay: { payplay: 1 },
    size128: 4300000, size320: 10700000, sizeflac: 32000000,
  });
  ok('QQ id/平台前缀', tx.id === 'tx:0039MnYb0qxYhV' && tx.platform === 'tx');
  ok('QQ 时长转毫秒', tx.duration === 269000, tx.duration);
  ok('QQ VIP 标记', tx.vip === true);
  ok('QQ qualityHints 保留文件大小', tx.qualityHints['128'] === 4300000 && tx.qualityHints.flac === 32000000, JSON.stringify(tx.qualityHints));
  ok('QQ 封面由 albummid 生成', /y\.gtimg\.cn.*002Album/.test(tx.albumPic), tx.albumPic);

  const kw = kuwo.__test.mapSong({
    MUSICRID: 'MUSIC_228908', NAME: '晴天', ARTIST: '周杰伦', ALBUM: '叶惠美', DURATION: '269',
    fpay: '1', FORMATS: 'mp3|320k|mp3|128k', web_albumpic_short: '120/88/88.jpg',
  });
  ok('酷我 MUSICRID 去前缀', kw.platformId === '228908' && kw.id === 'kw:228908', kw.id);
  ok('酷我时长转毫秒', kw.duration === 269000, kw.duration);
  ok('酷我 fpay=1 才是 VIP', kw.vip === true);
  ok('酷我 PAY 位掩码不误判 VIP', kuwo.__test.mapSong({ MUSICRID: 'MUSIC_2', NAME: 'x', PAY: '16711935' }).vip === false);
  ok('酷我封面补全域名', /img4\.kuwo\.cn/.test(kw.albumPic) && !/^120\//.test(kw.albumPic), kw.albumPic);
  ok('酷我 FORMATS 推断音质', !!kw.qualityHints['320'] && !!kw.qualityHints['128'], JSON.stringify(kw.qualityHints));

  const mg = migu.__test.mapSong({
    contentId: '60054700001', copyrightId: 'CP001', name: '晴天', vipType: '1',
    singers: [{ name: '周杰伦' }], albums: [{ name: '叶惠美' }],
    rateFormats: [{ formatType: 'PQ', size: '4300000' }],
    imgItems: [{ img: 'http://x/03.jpg', imgSizeType: '03' }, { img: 'http://x/01.jpg', imgSizeType: '01' }],
  });
  ok('咪咕 contentId/copyrightId', mg.platformId === '60054700001' && mg.musicInfo.copyrightId === 'CP001');
  ok('咪咕由文件大小推时长', mg.duration > 200000 && mg.duration < 300000, mg.duration);
  ok('咪咕 VIP 标记', mg.vip === true);
  ok('咪咕优先大图', mg.albumPic === 'http://x/03.jpg', mg.albumPic);

  /* ---------- 去重 / 合并 ---------- */
  const raw = [
    { platform: 'tx', platformId: 'a', name: '晴天', artist: '周杰伦', duration: 269000, playable: true, vip: true, qualityHints: { '128': 1 } },
    { platform: 'kg', platformId: 'b', name: '晴天', artist: '周杰伦', duration: 269500, playable: true, vip: false, qualityHints: { '320': 1 } },
    { platform: 'kw', platformId: 'c', name: '晴天', artist: '周杰伦', duration: 268000, playable: true, vip: false },
    { platform: 'tx', platformId: 'a', name: '晴天', artist: '周杰伦', duration: 269000, playable: true, vip: true },
    { platform: 'kg', platformId: 'short', name: '晴天片段', artist: '周杰伦', duration: 8000 },
  ];
  const rank = utils.rankAndDedupe(raw, { keyword: '晴天' });
  ok('丢弃 30 秒以下片段', !rank.some((t) => t.duration > 0 && t.duration < 30000));
  ok('平台内去重（tx 只留一条）', rank.filter((t) => t.platform === 'tx').length === 1);

  const merged = utils.mergeTracks(raw, { keyword: '晴天', limit: 10 });
  ok('跨平台合并为一首', merged.length === 1, 'groups=' + merged.length);
  ok('sourceCount=3 且 sources 含三平台', merged[0].sourceCount === 3 && new Set(merged[0].sources.map((s) => s.platform)).size === 3);
  ok('主来源选非 VIP 且质量更好的一条', merged[0].platform === 'kg', merged[0].platform);
  ok('聚合 id 稳定且带 agg 前缀', /^agg:[a-z0-9]+$/.test(merged[0].id), merged[0].id);
  const again = utils.mergeTracks(raw, { keyword: '晴天', limit: 10 });
  ok('聚合 id 可复现', again[0].id === merged[0].id);

  const cover = utils.mergeTracks([
    { platform: 'kg', platformId: 'o', name: '晴天', artist: '周杰伦', duration: 269000, vip: false },
    { platform: 'kw', platformId: 'v', name: '晴天', artist: '某翻唱歌手', duration: 269000, vip: false },
  ], { keyword: '晴天' });
  ok('不同歌手不合并', cover.length === 2, 'groups=' + cover.length);

  /* ---------- 取链缓存键 / 探测 ---------- */
  const ck128 = platformUrl.__test.cacheKey({ platform: 'tx', musicInfo: { songmid: 'abc' }, quality: '128' });
  const ck320 = platformUrl.__test.cacheKey({ platform: 'tx', musicInfo: { songmid: 'abc' }, quality: '320' });
  ok('取链缓存键包含音质', ck128 !== ck320 && /:128$/.test(ck128) && /:320$/.test(ck320));

  const { validateProbe, parseContentRange, PLACEHOLDER_BYTES } = platformUrl.__test;
  ok('Content-Range 解析', JSON.stringify(parseContentRange('bytes 0-65535/123456')) === JSON.stringify({ start: 0, end: 65535, total: 123456 }));
  const placeholder = validateProbe({
    statusCode: 200,
    headers: { 'content-type': 'audio/mpeg', 'content-range': `bytes 0-65535/${PLACEHOLDER_BYTES}` },
    buffer: Buffer.from([0xff, 0xfb, 0x90, 0x64]),
    expectedDurationMs: 240000,
  });
  ok('拒绝酷我 181521 试听占位', placeholder.ok === false && /占位/.test(placeholder.reason), JSON.stringify(placeholder));
  const tiny = validateProbe({
    statusCode: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': '120000' },
    buffer: Buffer.from([0xff, 0xfb, 0x90, 0x64]), expectedDurationMs: 240000,
  });
  ok('拒绝过小文件', tiny.ok === false && /试听|过小/.test(tiny.reason), JSON.stringify(tiny));
  const low = validateProbe({
    statusCode: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-65535/500000' },
    buffer: Buffer.from([0xff, 0xfb, 0x90, 0x64]), expectedDurationMs: 600000,
  });
  ok('拒绝码率异常偏低', low.ok === false && /码率/.test(low.reason), JSON.stringify(low));
  const good = validateProbe({
    statusCode: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-65535/5400000' },
    buffer: Buffer.from([0xff, 0xfb, 0x90, 0x64]), expectedDurationMs: 180000,
  });
  ok('正常文件放行', good.ok === true && good.totalBytes === 5400000, JSON.stringify(good));
  const html = validateProbe({ statusCode: 200, headers: { 'content-type': 'text/html' }, buffer: Buffer.from('<html>') });
  ok('HTML 错误页被拒绝', html.ok === false);

  /* ---------- 平台可用性 ---------- */
  const list = platformSearch.platformList();
  const mgMeta = list.find((p) => p.key === 'mg');
  const qsMeta = list.find((p) => p.key === 'qs');
  ok('mg 原生搜索可用', mgMeta && mgMeta.available === true && mgMeta.viaSource === false);
  ok('qs 未导入音源时不可用', qsMeta && qsMeta.available === false);
  ok('平台清单含酷我', list.some((p) => p.key === 'kw'));
  const caps = sourceManager.getCapabilities();
  ok('getCapabilities 结构', caps && Array.isArray(caps.search) && Array.isArray(caps.musicUrl), JSON.stringify(caps.search));
  ok('SOURCE_TIMEOUT_MS 导出', Number(sourceManager.SOURCE_TIMEOUT_MS) > 0, sourceManager.SOURCE_TIMEOUT_MS);

  /* ---------- 音源请求 SSRF 防护 ---------- */
  const { isPrivateHost } = sourceManager.__test;
  ok('SSRF 拦截 localhost', isPrivateHost('localhost') && isPrivateHost('a.localhost'));
  ok('SSRF 拦截私网 IPv4', ['127.0.0.1', '10.0.0.8', '192.168.1.2', '172.16.0.1', '169.254.1.1'].every(isPrivateHost));
  ok('SSRF 拦截 IPv6 本机/内网', ['[::1]', '::1', 'fd00::1', 'fe80::1'].every(isPrivateHost));
  ok('SSRF 放行公网域名/IP', !isPrivateHost('music.163.com') && !isPrivateHost('8.8.8.8'));

  ok('查询变体：第 1 页包含去括号词', platformAggregate.__test.queryVariants('晴天 (Live)', 1).length === 2);
  ok('查询变体：后续页只用原词', platformAggregate.__test.queryVariants('晴天 (Live)', 2).length === 1);
}

async function onlineTests() {
  const tx = await platformSearch.searchPlatform('tx', '周杰伦', 1, 10);
  ok('联网：QQ 搜索有结果', Array.isArray(tx.list) && tx.list.length > 0, 'list=' + tx.list.length);
  ok('联网：QQ 返回 media_mid', tx.list[0] && tx.list[0].musicInfo && !!tx.list[0].musicInfo.media_mid);
  ok('联网：QQ 曲目带 vip 布尔', tx.list[0] && typeof tx.list[0].vip === 'boolean');

  const kw = await platformSearch.searchPlatform('kw', '晴天', 1, 10);
  ok('联网：酷我搜索有结果', kw.list.length > 0, 'list=' + kw.list.length);
  ok('联网：酷我时长为毫秒', kw.list[0] && kw.list[0].duration > 30000, kw.list[0] && kw.list[0].duration);

  const mg = await platformSearch.searchPlatform('mg', '晴天', 1, 10);
  ok('联网：咪咕搜索有结果', mg.list.length > 0, 'list=' + mg.list.length);

  const agg = await platformAggregate.searchAll({ keyword: '晴天', page: 1, limit: 20, sources: ['tx', 'kg', 'kw'] });
  ok('联网：聚合搜索有结果', agg.list.length > 0, 'list=' + agg.list.length);
  ok('联网：聚合行携带 sources[]', agg.list.every((t) => Array.isArray(t.sources) && t.sources.length >= 1));
  ok('联网：聚合行 id 带 agg 前缀', agg.list.every((t) => String(t.id).startsWith('agg:')), agg.list[0] && agg.list[0].id);
  ok('联网：聚合记录各平台状态', Array.isArray(agg.platforms) && agg.platforms.length === 3);
}

(async () => {
  try {
    await offlineTests();
    if (OFFLINE) {
      console.log('\n（--offline：跳过联网搜索）');
    } else {
      console.log('\n--- 联网冒烟 ---');
      await onlineTests();
    }
  } catch (e) {
    console.error('运行异常:', e);
    fail++;
  }
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})();
