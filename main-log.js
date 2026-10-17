'use strict';
/**
 * 主进程日志模块：所有输出同时写往 userData/logs/guman.log。
 * 打包后开发者工具不可见，用户侧故障诊断全靠这个文件。
 * - 单文件超过 2MB 自动轮转为 guman.log.1（只保留一份）
 * - 写失败（磁盘满/权限）静默降级，绝不影响应用运行
 */
const fs = require('fs');
const path = require('path');

const MAX_SIZE = 2 * 1024 * 1024;
let stream = null;
let file = '';

function init(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'guman.log');
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_SIZE) {
        fs.renameSync(file, `${file}.1`);
      }
    } catch (_) { /* 轮转失败不影响主流程 */ }
    stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', () => { stream = null; });
  } catch (_) {
    stream = null;
  }
}

function fmt(v) {
  if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

function line(level, args) {
  const ts = new Date().toISOString();
  const msg = args.map(fmt).join(' ');
  try {
    if (stream) stream.write(`[${ts}] [${level}] ${msg}\n`);
  } catch (_) { /* ignore */ }
}

module.exports = {
  init,
  log: (...a) => line('info', a),
  warn: (...a) => line('warn', a),
  error: (...a) => line('error', a),
  dir: () => file,
  logsDir: () => (file ? path.dirname(file) : ''),
};
