// 抽取渲染层中文文案，与 i18n.js 的字典比对覆盖率。
// 用法：node scripts/i18n-extract.js [--json out.json] [--missing]
// 退出码：0 覆盖率达标（默认 >=95%），1 未达标——可直接挂进回归。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer');
const I18N = path.join(RENDERER, 'js', 'i18n.js');
// 直接写 CJK 区间字面量在本仓库的编辑器链路里会被截断，改用码点拼装
const HAS_CJK = new RegExp('[' + String.fromCharCode(0x3400) + '-' + String.fromCharCode(0x9fff) + ']');

function read(f) { return fs.readFileSync(f, 'utf8'); }

// 取出 `const NAME = { ... };` 字面量块里的键
function dictKeys(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  if (start < 0) return new Set();
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i; break; } }
  }
  const body = src.slice(start, end + 1);
  const keys = new Set();
  // 键写法有两种：裸标识符（中文可直接作标识符）和带引号字符串
  const re = /(?:^|[{,\s])("([^"]+)"|'([^']+)'|([^\s,:'"{\][]+))\s*:/g;
  let m;
  while ((m = re.exec(body))) {
    const k = m[2] || m[3] || m[4];
    if (k && HAS_CJK.test(k)) keys.add(k.trim());
  }
  return keys;
}

// PATTERNS 里的正则模板（动态句子走这一路），只统计数量
function patternCount(src) {
  const start = src.indexOf('const PATTERNS = [');
  if (start < 0) return 0;
  const body = src.slice(start, src.indexOf('\n];', start));
  return (body.match(/^\s*re:/gm) || []).length;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

// 抽取中文字面量。跳过注释行与 i18n.js 自身（那是字典本体）
function literals(files) {
  const found = new Map(); // text -> [{file, line}]
  for (const f of files) {
    if (path.resolve(f) === path.resolve(I18N)) continue;
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    read(f).split('\n').forEach((line, n) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      const code = t.replace(/(\s|^)\/\/.*$/, '');
      const re = /'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g;
      let m;
      while ((m = re.exec(code))) {
        const s = (m[1] || m[2] || m[3] || '').trim();
        if (!s || !HAS_CJK.test(s)) continue;
        if (!found.has(s)) found.set(s, []);
        found.get(s).push(`${rel}:${n + 1}`);
      }
    });
  }
  return found;
}

// 不翻译的专有名词：品牌、电台名、热门搜索词、第三方平台名
const SKIP = new Set([
  '孤男音乐', '网易云', '夜曲', '稻香', '晴天', '欧美 R&B',
  '酷我', '酷狗', '咪咕', '汽水', '亿', '万', '治愈', '深夜', '通勤',
]);

const args = process.argv.slice(2);
const src = read(I18N);
const dicts = { 'zh-TW': dictKeys(src, 'ZH_TW'), en: dictKeys(src, 'EN') };
const all = literals(walk(RENDERER));
// 含 {n} 占位符的句子由 PATTERNS 负责（tr 看到的是代入参数后的整句），单列统计
const isTemplate = (s) => s.includes('${') || /\{[A-Za-z_][\w]*\}/.test(s);
const dynamic = [...all.keys()].filter(isTemplate);
const statics = [...all.keys()].filter((s) => !isTemplate(s) && !SKIP.has(s));

const report = {};
for (const [lang, keys] of Object.entries(dicts)) {
  const missing = statics.filter((s) => !keys.has(s));
  report[lang] = { total: statics.length, covered: statics.length - missing.length, missing };
}
report.dynamic = { count: dynamic.length, patterns: patternCount(src), samples: dynamic.slice(0, 12) };

const jsonIdx = args.indexOf('--json');
if (jsonIdx >= 0 && args[jsonIdx + 1]) {
  fs.writeFileSync(path.resolve(args[jsonIdx + 1]), JSON.stringify(report, null, 2));
}

for (const lang of ['zh-TW', 'en']) {
  const r = report[lang];
  const pct = r.total ? ((r.covered / r.total) * 100).toFixed(1) : '100.0';
  console.log(`${lang}: ${r.covered}/${r.total} 静态文案已覆盖 (${pct}%)`);
}
console.log(`动态句子: ${report.dynamic.count} 处插值文案 / ${report.dynamic.patterns} 条 PATTERNS 兜底`);

if (args.includes('--missing')) {
  for (const lang of ['zh-TW', 'en']) {
    console.log(`\n--- ${lang} 缺失 (${report[lang].missing.length}) ---`);
    report[lang].missing.forEach((s) => console.log(`${s}  ← ${all.get(s)[0]}`));
  }
}

const min = Number(process.env.I18N_MIN || 95);
const worst = Math.min(...['zh-TW', 'en'].map((l) => (report[l].covered / report[l].total) * 100));
if (worst < min) {
  console.log(`\n❌ 覆盖率 ${worst.toFixed(1)}% 低于门槛 ${min}%`);
  process.exit(1);
}
