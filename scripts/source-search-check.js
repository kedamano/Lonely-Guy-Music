'use strict';
/**
 * 洛雪音源搜索接入回归（CP6 / CP4）：
 *
 *   - platformList：咪咕(mg) 已改为原生搜索（viaSource=false、available=true），
 *     汽水(qs) 仍依赖洛雪音源，未导入时 available=false 且带 reason
 *   - source-manager.getCapabilities() / platformsWithAction('search') 能汇总音源能力
 *   - resolveSearch 并行尝试多个音源：第一个返回空列表时，第二个仍能给出结果
 *   - qs 通过音源搜索返回统一曲目结构；未知平台被拒绝
 *
 * 注意：本脚本不联网。mg 原生搜索由 platform-search 负责，联网覆盖在
 * platform-search-check.js 中；这里只验证音源委托路径。
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

// 空结果音源：先注册，验证并行解析会继续采用后面的音源
const MOCK_EMPTY = `
lx.send('inited', {
  status: 'ok',
  sources: {
    mg: { name: 'mock-empty', type: 'music', actions: ['search'], qualitys: ['128k'] },
    qs: { name: 'mock-empty-qs', type: 'music', actions: ['search'], qualitys: ['128k'] }
  }
});
lx.on('request', function () { return []; });
`;

// 正常音源：声明 mg + qs 搜索，返回两首假数据
const MOCK_SOURCE = `
lx.send('inited', {
  status: 'ok',
  sources: {
    mg: { name: 'mock-migu', type: 'music', actions: ['musicUrl', 'search'], qualitys: ['128k'] },
    qs: { name: 'mock-qishui', type: 'music', actions: ['musicUrl', 'search'], qualitys: ['128k'] }
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
  // 1) 平台清单：mg 原生可用；qs 无音源时不可用并给出原因
  const list = platformSearch.platformList();
  const mg = list.find((p) => p.key === 'mg');
  const qs = list.find((p) => p.key === 'qs');
  ok('platformList 包含 mg', !!mg, JSON.stringify(list.map((p) => p.key)));
  ok('platformList 包含 qs', !!qs);
  ok('mg 原生搜索 / 非歌单 / 非音源委托',
    mg && mg.searchable === true && mg.playlist === false && mg.viaSource === false,
    mg && JSON.stringify(mg));
  ok('mg 标记为可用（原生接口）', mg && mg.available === true);
  ok('mg 播放走跨源兜底', mg && mg.playback === 'fallback');
  ok('qs 可搜索 / 非歌单 / 音源委托', qs && qs.searchable === true && qs.playlist === false && qs.viaSource === true);
  ok('qs 无音源时不可用', qs && qs.available === false, qs && qs.reason);
  ok('qs 不可用原因可读', qs && /音源/.test(qs.reason || ''), qs && qs.reason);

  // 2) 注册音源（先空结果、后正常结果）
  await sourceManager.init(); // 创建 sources 目录（生产环境由服务启动时调用）
  await sourceManager.addSource({ code: MOCK_EMPTY });
  const summary = await sourceManager.addSource({ code: MOCK_SOURCE });
  const srcMg = summary.sources && summary.sources.mg;
  ok('正常音源注册成功且 inited', summary.inited === true, summary.error || '');
  ok('音源声明了 mg search action', !!(srcMg && Array.isArray(srcMg.actions) && srcMg.actions.includes('search')));

  // 3) 能力查询
  const caps = sourceManager.getCapabilities();
  ok('getCapabilities 汇总 search 平台', Array.isArray(caps.search) && caps.search.includes('mg') && caps.search.includes('qs'), JSON.stringify(caps.search));
  const withSearch = sourceManager.platformsWithAction('search');
  ok('platformsWithAction(search) 包含 mg/qs', withSearch.includes('mg') && withSearch.includes('qs'), JSON.stringify(withSearch));

  // 4) 并行解析：第一个音源返回空数组，第二个音源仍能给出结果
  const r = await sourceManager.resolveSearch({ sourcePlatform: 'mg', keyword: '测试', page: 1, limit: 30 });
  ok('resolveSearch 跳过空结果音源并返回列表', Array.isArray(r.list) && r.list.length >= 1, 'list=' + (r && r.list && r.list.length));
  ok('resolveSearch 只返回一个 sourceId', typeof r.sourceId === 'string' && r.sourceId.length > 0, r && r.sourceId);

  // 5) 导入支持 qs 的音源后，qs 变为可用；通过音源路径搜索返回统一结构
  const qsAfter = platformSearch.platformList().find((p) => p.key === 'qs');
  ok('导入后 qs 可用', qsAfter && qsAfter.available === true, qsAfter && qsAfter.reason);
  const q = await platformSearch.searchPlatform('qs', '测试', 1, 30);
  ok('qs 搜索返回列表非空', Array.isArray(q.list) && q.list.length >= 1, 'list=' + (q && q.list && q.list.length));
  const t = q.list[0];
  ok('曲目 id 带 qs 前缀', t && typeof t.id === 'string' && t.id.startsWith('qs:'), t && t.id);
  ok('曲目 platform=qs', t && t.platform === 'qs');
  ok('曲目携带 musicInfo（供取链回传）', t && t.musicInfo && typeof t.musicInfo === 'object');
  ok('曲目 duration 为毫秒', t && Number.isFinite(t.duration) && t.duration > 1000, t && t.duration);
  ok('返回 platform=qs 与 hasMore 布尔', q && q.platform === 'qs' && typeof q.hasMore === 'boolean');

  // 6) 非法平台仍被拒绝
  let threwBad = false;
  try { await platformSearch.searchPlatform('xxx', '测试'); } catch (_) { threwBad = true; }
  ok('未知平台被拒绝', threwBad);

  let threwNotFound = false;
  try { await sourceManager.resolveSearch({ sourcePlatform: 'mg', keyword: '测试', page: 1, limit: 1, sourceId: 'nope' }); } catch (_) { threwNotFound = true; }
  // resolveSearch 目前不接受 sourceId 过滤，这里仅确认参数不会导致崩溃
  ok('resolveSearch 忽略未知 sourceId 不崩溃', !threwNotFound);

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('运行异常:', e); process.exit(1); });
