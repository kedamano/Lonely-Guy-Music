'use strict';
/**
 * 生成自托管字体资源：从 @fontsource 包抽取所需子集 → renderer/assets/fonts/
 *
 * 目的：去掉运行时对 Google Fonts CDN 的依赖（离线可用、不向第三方域名发请求）。
 *  - Anton            latin + latin-ext（单一字重 400，用于展示型标题）
 *  - IBM Plex Sans    变量版 wght 轴（100~700），覆盖正文 400/500/600/700
 *  - IBM Plex Mono    静态版 400/500/600/700，用于数值与时间
 *  - Noto Sans SC     变量版全量子集（101 个 unicode 区块），中文歌名/歌词不缺字
 *
 * 用法：npm run fonts
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const OUT_DIR = path.join(ROOT, 'renderer', 'assets', 'fonts');

const PLAN = [
  {
    pkg: '@fontsource/anton',
    family: 'Anton',
    keep: (f) => /^anton-latin(-ext)?-\d+-normal\.woff2$/.test(f),
  },
  {
    pkg: '@fontsource-variable/ibm-plex-sans',
    family: 'IBM Plex Sans',
    keep: (f) => /^ibm-plex-sans-latin(-ext)?-wght-normal\.woff2$/.test(f),
  },
  {
    pkg: '@fontsource/ibm-plex-mono',
    family: 'IBM Plex Mono',
    keep: (f) => /^ibm-plex-mono-latin(-ext)?-[4567]00-normal\.woff2$/.test(f),
  },
  {
    pkg: '@fontsource-variable/noto-sans-sc',
    family: 'Noto Sans SC',
    // 数字编号是中文/符号区块；latin* 必须包含（界面数字、时间、kbd 都走拉丁字形）
    keep: (f) => /^noto-sans-sc-(latin|latin-ext|cyrillic|vietnamese|\d+)-wght-normal\.woff2$/.test(f),
  },
];

function collectCss(pkgDir) {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(p);
      } else if (e.name.endsWith('.css')) {
        files.push(p);
      }
    }
  };
  walk(pkgDir);
  return files;
}

function parseBlocks(css) {
  const blocks = [];
  const re = /@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) blocks.push(m[1]);
  return blocks;
}

// 重写 @font-face：统一字体名、去掉非 woff2 源、路径改为同目录（保留 format 描述符）
function rewriteBlock(body, family) {
  let b = body;
  b = b.replace(/font-family:[^;]*;/i, `font-family: '${family}';`);
  // 只留 woff2：变量字体源带 format('woff2-variations')，必须保留
  b = b.replace(/,\s*url\([^)]*\)\s*format\((['"])(?:woff|truetype|opentype|svg)\1\)/gi, '');
  b = b.replace(/url\([^)]*\/([^/)]+)\)/g, (s, file) => `url('./${file}')`);
  return b;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // 清理上一次生成的文件（保留 NOTICE.txt）
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.woff2') || f === 'fonts.css') fs.unlinkSync(path.join(OUT_DIR, f));
  }

  const rules = [];
  let copied = 0;
  let bytes = 0;

  for (const plan of PLAN) {
    const pkgDir = path.join(NM, plan.pkg);
    if (!fs.existsSync(pkgDir)) {
      console.error(`[fonts] 缺少依赖 ${plan.pkg}，请先 npm install`);
      process.exit(1);
    }
    const filesDir = path.join(pkgDir, 'files');
    const seen = new Set();

    for (const cssFile of collectCss(pkgDir)) {
      const css = fs.readFileSync(cssFile, 'utf8');
      for (const body of parseBlocks(css)) {
        const hit = /url\([^)]*\/([^/)]+)\)/.exec(body);
        if (!hit) continue;
        const name = hit[1];
        if (!plan.keep(name) || seen.has(name)) continue;
        const src = path.join(filesDir, name);
        if (!fs.existsSync(src)) continue;
        seen.add(name);
        fs.copyFileSync(src, path.join(OUT_DIR, name));
        bytes += fs.statSync(src).size;
        copied++;
        rules.push(`@font-face {${rewriteBlock(body, plan.family)}}`);
      }
    }
    console.log(`[fonts] ${plan.family}: ${seen.size} 个文件`);
  }

  const css = [
    '/* 自动生成，请勿手改：由 scripts/build-fonts.js 从 @fontsource 包提取 */',
    '/* Anton / IBM Plex Sans / IBM Plex Mono / Noto Sans SC —— SIL Open Font License 1.1 */',
    '',
    ...rules,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'fonts.css'), css);

  console.log(`[fonts] 共 ${copied} 个 woff2，${(bytes / 1024 / 1024).toFixed(2)} MB → renderer/assets/fonts/`);
}

main();
