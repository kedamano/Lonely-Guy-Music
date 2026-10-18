'use strict';
/**
 * 咪咕(mg) / 汽水(qs) 搜索源接入回归：
 * 这两个平台没有可公开访问的官方搜索接口，搜索与取链一样委托给洛雪音源脚本。
 * 本脚本用一个 mock 洛雪音源脚本验证：
 *   - platformList 包含 mg / qs，且标记 searchable / playlist=false / viaSource=true
 *   - 有支持 mg 搜索的音源时，searchPlatform('mg', ...) 返回统一曲目结构
 *   - 没有任何音源支持 qs 搜索时，返回清晰可读的报错（而非崩溃）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// 必须在首次 require source-manager 之前设置，否则会落到默认 userData 目录
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guman-srcsearch-'));
process.env.GUMAN_USER_DATA = tmpDir;
process.env.GUMAN_DEBUG = ''; // 关闭音源脚本日志噪音

const sourceManager = require('../server/source-manager');
const platformSearch = require('../server/platform-search');

// 一个最小的「洛雪音源」：声明支持 mg 的 musicUrl + search，搜索返回两首假数据
const MOCK_SOURCE = `
lx.send('inited', {
  status: 'ok',
  sources: {
    mg: { name: 'mock-migu', type: 'music', actions: ['musicUrl', 'search'], qualitys: ['128k'] }
  }
});
lx.on('request', function (data) {
  if (data.action === 'search') {
    var kw = (data.info && data.info.keywork) || '';
    return [
      { songmid: 'c1', name: '测试曲-' + kw, singer: ['歌手甲'], album: '专辑A', img: 'http://x/a.jpg', interval: 200, musicInfo: { copyrightId: 'c1' } },
      { songmid: 'c2', name: '另一首-' + kw, singer: ['歌手乙'], album: '专辑B', interval: 180, musicInfo: { copyrightId: 'c2' } },
    ];
  }
  return null;
});
`;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('✅ ' + name); pass++; }
  else { console.error('❌ ' + name + (extra ? ' — ' + extra : '')); fail++; }
}

async function main() {
  // 1) platformList 含 mg / qs
  const list = platformSearch.platformList();
  const mg = list.find((p) => p.key === 'mg');
  const qs = list.find((p) => p.key === 'qs');
  ok('platformList 包含 mg', !!mg, JSON.stringify(list.map((p) => p.key)));
  ok('platformList 包含 qs', !!qs);
  ok('mg 可搜索 / 非歌单 / viaSource', mg && mg.searchable === true && mg.playlist === false && mg.viaSource === true);
  ok('qs 可搜索 / 非歌单 / viaSource', qs && qs.searchable === true && qs.playlist === false && qs.viaSource === true);

  // 2) 注册 mock 音源，并验证 inited 抓取到了 search action
  await sourceManager.init(); // 创建 sources 目录（生产环境由服务启动时调用）
  const summary = await sourceManager.addSource({ code: MOCK_SOURCE });
  const src = summary.sources && summary.sources.mg;
  ok('mock 音源注册成功且 inited', summary.inited === true, summary.error || '');
  ok('mg 音源声明了 search action', !!(src && Array.isArray(src.actions) && src.actions.includes('search')));

  // 3) 通过搜索入口检索 mg，得到统一曲目结构
  const r = await platformSearch.searchPlatform('mg', '测试', 1, 30);
  ok('mg 搜索返回列表非空', Array.isArray(r.list) && r.list.length >= 1, 'list=' + (r && r.list && r.list.length));
  const t = r.list[0];
  ok('曲目 id 带 mg 前缀', t && typeof t.id === 'string' && t.id.startsWith('mg:'), t && t.id);
  ok('曲目 platform=mg', t && t.platform === 'mg');
  ok('曲目携带 musicInfo（供取链回传）', t && t.musicInfo && typeof t.musicInfo === 'object');
  ok('曲目 duration 为毫秒', t && Number.isFinite(t.duration) && t.duration > 1000, t && t.duration);
  ok('返回 platform=mg 与 hasMore 布尔', r && r.platform === 'mg' && typeof r.hasMore === 'boolean');

  // 4) qs 无音源支持时，给出清晰报错，不崩溃
  let threw = false, msg = '';
  try {
    await platformSearch.searchPlatform('qs', '测试', 1, 30);
  } catch (e) {
    threw = true; msg = e.message || '';
  }
  ok('qs 无音源时抛错', threw);
  ok('qs 报错提示「导入支持该平台搜索的音源」', /导入支持该平台搜索的音源|音源/.test(msg), msg);

  // 5) 非法平台仍被拒绝
  let threwBad = false;
  try { await platformSearch.searchPlatform('xxx', '测试'); } catch (_) { threwBad = true; }
  ok('未知平台被拒绝', threwBad);

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('运行异常:', e); process.exit(1); });
