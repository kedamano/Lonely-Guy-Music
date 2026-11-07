'use strict';
/**
 * 默认音源 + 洛雪列表定时探测 回归测试（node-only，无需 Electron）。
 * 覆盖：页面解析、默认集基线、自动导入幂等、地址变更触发更新。
 */
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const ss = require('../server/sound-sources');
const { safeId } = require('../server/source-manager');

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.error('  ✗', name, extra != null ? '→ ' + JSON.stringify(extra) : ''); }
}

const FIXTURE = `
<html><body>
下面是本站于 2026-09-28 逐条实测过的常用音源：
六音音源：https://raw.githubusercontent.com/pdone/lx-music-source/main/sixyin/latest.js
LX官方源：https://raw.githubusercontent.com/pdone/lx-music-source/main/lx/latest.js
Flower音源：https://raw.githubusercontent.com/pdone/lx-music-source/main/flower/latest.js
Huibq音源：https://raw.githubusercontent.com/pdone/lx-music-source/main/huibq/latest.js
JuheApi音源：https://raw.githubusercontent.com/pdone/lx-music-source/main/juhe/latest.js
newsrc：https://raw.githubusercontent.com/pdone/lx-music-source/main/newsrc/latest.js
攻略更新于 2026/09/28
</body></html>
`;

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-check-'));
  ss.init(tmp, {});

  console.log('1) 页面解析');
  const parsed = ss.parsePage(FIXTURE);
  ok('解析出 6 个音源（5 已知 + 1 新）', parsed.sources.length === 6, parsed.sources.length);
  ok('捕获页面更新日期', parsed.updatedAt === '2026/09/28', parsed.updatedAt);
  const six = parsed.sources.find((s) => s.key === 'sixyin');
  ok('六音音源地址正确', !!six && six.url === 'https://raw.githubusercontent.com/pdone/lx-music-source/main/sixyin/latest.js', six && six.url);
  ok('六音音源名字映射', six && six.name === '六音音源', six && six.name);
  const neo = parsed.sources.find((s) => s.key === 'newsrc');
  ok('新音源 newsrc 被纳入', !!neo);
  ok('未知 key 用 key 当名字', neo && neo.name === 'newsrc', neo && neo.name);

  console.log('2) 默认集基线');
  const defs = ss.getDefaults();
  ok('默认集含 5 个出厂音源', defs.length === 5, defs.length);
  ok('默认 key 齐全', ['sixyin', 'lx', 'flower', 'huibq', 'juhe'].every((k) => defs.some((d) => d.key === k)));
  ok('默认 URL 指向 main 分支', defs.every((d) => d.url.includes('/main/')), defs.map((d) => d.url));

  console.log('3) 自动导入：首跑导入全部，二跑幂等');
  const calls = [];
  const addedIds = [];
  const mockSm = {
    getConfig: () => ({ sources: addedIds.map((id) => ({ id })) }),
    addSource: async ({ url }) => {
      calls.push(url);
      const def = ss.DEFAULT_SOURCES.find((d) => d.url === url);
      const id = safeId(def ? def.name : 'x');
      if (!addedIds.includes(id)) addedIds.push(id);
      return { id };
    },
  };
  ss.attach(mockSm);
  await ss.ensureImported();
  ok('首跑导入 5 个默认音源', calls.length === 5, calls.length);
  const firstCalls = calls.slice();
  await ss.ensureImported();
  ok('二跑不再重复导入（幂等）', calls.length === 5, calls.length);
  ok('首跑与二跑 URL 集合一致', JSON.stringify(firstCalls.sort()) === JSON.stringify(calls.slice().sort()));

  console.log('4) 地址变更触发更新');
  // 模拟六音音源地址被探测到新版本：只清该音源的已导入记录，其余保持
  const changedUrl = 'https://raw.githubusercontent.com/pdone/lx-music-source/main/sixyin/v2/latest.js';
  const sixDef = ss.DEFAULT_SOURCES.find((d) => d.key === 'sixyin');
  const oldUrl = sixDef.url;
  const imp = ss.__test.getImported();
  delete imp[safeId('六音音源')];
  delete imp['sixyin'];
  sixDef.url = changedUrl;
  await ss.ensureImported();
  ok('地址变更后重新导入（calls 增至 6）', calls.length === 6, calls.length);
  ok('新地址被提交导入', calls.includes(changedUrl), calls);
  sixDef.url = oldUrl; // 还原，避免影响后续

  console.log('5) 快照结构');
  const snap2 = ss.snapshot();
  ok('快照含 sources 数组', Array.isArray(snap2.sources) && snap2.sources.length === 5);
  ok('快照含 config', snap2.config && typeof snap2.config.intervalMinutes === 'number');
  ok('快照含 probing 布尔', typeof snap2.probing === 'boolean');

  console.log(`\n默认音源探测回归：${passed} 通过 / ${failed} 失败`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error('运行异常：', e); process.exit(1); });
