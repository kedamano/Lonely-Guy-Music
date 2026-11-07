'use strict';
/**
 * 平台登录态管理（当前主要是 QQ 音乐）
 *
 * 凭证落在本机 userData/platform-auth.json，结构：
 *   { tx: { uin, uinRaw, qmKeyst, updatedAt } }
 *
 * 设计约束：
 *  - 与 platform-url.js 解耦：取链层每次 readAuth() 都从文件读，本模块只负责写文件，
 *    保存后立即对下一次取链生效，无需两处共享内存状态或互相 require（避免循环依赖）。
 *  - 凭证绝不回传给渲染层：state() 只给「是否配置 + uin 掩码 + 更新时间」。
 *  - 原子写：先写 .tmp 再 rename，避免保存中途断电留下半截 JSON 把登录态弄丢。
 *  - 支持从浏览器复制的整段 Cookie / 整份 platform-auth.json 内容里自动提取字段，
 *    用户不必再手改文件。
 */

const fs = require('fs');
const path = require('path');

const UIN_KEYS = new Set(['uin', 'p_uin', 'luin', 'wxuin', 'o_cookie']);
const KEY_KEYS = new Set(['qm_keyst', 'qmkeyst', 'qm_keyst_qm']);

let FILE = '';

function init(p) {
  FILE = p;
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); } catch (_) { /* 只读用户目录时忽略 */ }
}

function readAll() {
  if (!FILE) return {};
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch (_) {
    return {};
  }
}

function writeAll(next) {
  if (!FILE) throw new Error('平台凭证路径未初始化');
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, FILE);
}

/**
 * 从多种输入解析出 { uin, uinRaw, qmKeyst }：
 *   { uin, qmKeyst }            手动两个字段
 *   { cookie: 'uin=o123; qm_keyst=xxx; ...' }  浏览器复制的整段 Cookie
 *   '{ "tx": { "uin": ..., "qmKeyst": ... } }' 整份配置文件内容
 *   'uin=...; qm_keyst=...'     直接传字符串
 *
 * QQ 网页 Cookie 的 uin 常带 o 前缀或被 URL 编码（p_uin=o0123…），
 * 取链接口的 comm.uin 需要纯数字，因此另外保留 uinRaw 供 Cookie 头原样使用。
 */
function parseCredential(input) {
  const src = input && typeof input === 'object' ? { ...input } : { cookie: String(input || '') };
  let uinRaw = String(src.uin || '').trim();
  let qmKeyst = String(src.qmKeyst || src.qm_keyst || '').trim();
  const cookie = String(src.cookie || '').trim();

  if (cookie) {
    // 整份 JSON 配置：先按结构取一遍
    if (cookie.startsWith('{')) {
      try {
        const j = JSON.parse(cookie);
        const tx = j && j.tx ? j.tx : j;
        if (!uinRaw) uinRaw = String(tx.uin || tx.uinRaw || '');
        if (!qmKeyst) qmKeyst = String(tx.qmKeyst || tx.qm_keyst || '');
      } catch (_) { /* 不是合法 JSON → 继续按分号扫描 */ }
    }
    // 再按 Cookie 分段扫一遍：JSON 里带 cookie 字段、或混排时也能兜住
    for (const seg of cookie.split(/[;,\n]+/)) {
      const i = seg.indexOf('=');
      if (i < 1) continue;
      const k = seg.slice(0, i).trim().replace(/^["'\s]+|["'\s]+$/g, '').toLowerCase();
      const v = seg.slice(i + 1).trim().replace(/^["'\s]+|["'\s]+$/g, '');
      if (!v) continue;
      if (UIN_KEYS.has(k) && !uinRaw) uinRaw = v;
      else if (KEY_KEYS.has(k) && !qmKeyst) qmKeyst = v;
    }
  }

  let uin = '';
  if (uinRaw) {
    let n = uinRaw;
    try { n = decodeURIComponent(n); } catch (_) { /* 非法转义就用原串 */ }
    n = String(n).replace(/^o/i, '').trim();
    if (/^\d{4,15}$/.test(n)) uin = n;
  }
  return { uin, uinRaw, qmKeyst };
}

function validate(cred) {
  if (!cred || !/^\d{4,15}$/.test(cred.uin || '')) {
    return 'uin 应为 4–15 位数字（QQ 号）；请确认 Cookie 里有 uin 字段';
  }
  if (!cred.qmKeyst || cred.qmKeyst.length < 8) {
    return '未取到有效的 qm_keyst；请确认已在 y.qq.com 登录后复制完整 Cookie';
  }
  return '';
}

function mask(s) {
  const t = String(s || '');
  if (t.length <= 4) return '****';
  return t.slice(0, 2) + '****' + t.slice(-2);
}

/** 对渲染层的视图：不含任何凭证 */
function state() {
  const tx = readAll().tx || {};
  return {
    tx: {
      configured: !!(tx.uin && tx.qmKeyst),
      uin: tx.uin ? mask(tx.uin) : '',
      updatedAt: Number(tx.updatedAt || 0),
    },
  };
}

/** 后端内部取原始凭证（给取链 / 测试用，绝不进 HTTP 响应） */
function raw() {
  return readAll().tx || null;
}

function save(input) {
  const cred = parseCredential(input);
  const err = validate(cred);
  if (err) {
    const e = new Error(err);
    e.status = 400;
    throw e;
  }
  const all = readAll();
  all.tx = {
    uin: cred.uin,
    uinRaw: cred.uinRaw || '',
    qmKeyst: cred.qmKeyst,
    updatedAt: Date.now(),
  };
  writeAll(all);
  return state();
}

function clear() {
  const all = readAll();
  delete all.tx;
  writeAll(all);
  return state();
}

module.exports = {
  init, state, save, clear, raw,
  __test: { parseCredential, validate, mask, readAll, writeAll },
};
