'use strict';
/**
 * 跨平台语法检查（CI 门禁用）。
 * 原来 ci.yml 里是 bash 的 for 循环，只能在 bash shell 下跑；这里改成 Node，
 * Windows / macOS / Linux 的 runner 与本地 npm run 行为完全一致。
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const files = new Set();

for (const rel of ['main.js', 'main-log.js', 'preload.js', 'assets/icon.js', 'electron-builder.js']) {
  if (fs.existsSync(path.join(ROOT, rel))) files.add(rel);
}

function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  for (const name of fs.readdirSync(abs)) {
    const child = path.join(rel, name).replace(/\\/g, '/');
    const st = fs.statSync(path.join(ROOT, child));
    if (st.isDirectory()) {
      if (name === 'shots' || name === 'node_modules') continue;
      walk(child);
    } else if (name.endsWith('.js')) {
      files.add(child);
    }
  }
}
['server', 'renderer/js', 'scripts'].forEach(walk);

const failed = [];
for (const rel of [...files].sort()) {
  try {
    cp.execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' });
  } catch (e) {
    failed.push({ rel, msg: String(e.stderr || e.message).trim().split('\n')[0] });
  }
}

if (failed.length) {
  failed.forEach((f) => console.error(`  ✗ ${f.rel} → ${f.msg}`));
  console.error(`\n✗ 语法检查：${files.size - failed.length}/${files.size} 通过，${failed.length} 个文件有语法错误\n`);
  process.exitCode = 1;
} else {
  console.log(`✓ 语法检查：${files.size} 个 JS 文件全部通过`);
}
