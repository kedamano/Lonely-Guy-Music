'use strict';
/**
 * 账号（网易云）
 * - cookie 只落在本机 userData/account.json，且**永不出现在响应体里**：
 *   渲染层只能通过 publicState() 拿到昵称/头像/VIP，凭证由本模块注入到反代请求头。
 * - 登录走 NeteaseCloudMusicApi 的 /login/qr/*，二维码图片由上游直接返回 dataURL（无需 qrcode 依赖）。
 */

const fs = require('fs');
const path = require('path');

let FILE = '';
let NCM = '';
let state = { cookie: '', user: null, loginAt: 0 };

function init(opts) {
  NCM = opts.ncmUrl;
  FILE = path.join(opts.dataDir, 'account.json');
  try {
    if (fs.existsSync(FILE)) {
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      // 老版本把 Set-Cookie 原文整个存了下来，读出来先洗一遍，省得用户重新扫码
      state = {
        cookie: cleanCookie(j.cookie),
        user: j.user || null,
        loginAt: Number(j.loginAt || 0),
      };
      if (state.cookie) console.log('[account] 已恢复登录态' + (state.user ? `：${state.user.nickname || ''}` : ''));
    }
  } catch (e) {
    console.warn('[account] 读取登录态失败，按未登录处理:', e.message);
    state = { cookie: '', user: null, loginAt: 0 };
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn('[account] 保存登录态失败:', e.message);
  }
}

/** 仅供反代注入请求头；不对外暴露 */
function getCookie() {
  return state.cookie;
}

/** 调上游 NCM：cookie 走请求头，不进 URL（避免落在日志/历史里） */
async function ncm(pathname, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  const url = `${NCM}${pathname}${qs ? `?${qs}` : ''}`;
  const r = await fetch(url, {
    headers: state.cookie ? { Cookie: state.cookie } : {},
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => null);
  if (!j) throw new Error(`网易云接口无响应（${pathname}）`);
  // 只把 4xx/5xx 当接口错误：登录轮询用 8xx（800 过期 / 801 待扫码 / 802 待确认 / 803 成功）表达正常状态
  if (j.code && j.code >= 400 && j.code < 600) throw new Error(`网易云接口错误 ${j.code}`);
  return j;
}

// MUSIC_U 是登录凭证的标志位；没有它说明拿到的只是匿名 cookie
function hasCredential(cookie) {
  return /MUSIC_U=[^;]+/.test(String(cookie || ''));
}

// 上游把 Set-Cookie 原文拼成一个字符串返回，属性段（Path/Domain/Expires/Max-Age…）
// 混在里面会让注入的 Cookie 头带上非法字段，这里只保留 NAME=VALUE 对（同名取最后一次）。
const COOKIE_ATTRS = /^(max-age|expires|path|domain|secure|httponly|samesite|version|comment)$/i;
function cleanCookie(raw) {
  const out = new Map();
  for (const seg of String(raw || '').split(';')) {
    const t = seg.trim();
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i);
    if (!/^[\w.-]+$/.test(k) || COOKIE_ATTRS.test(k)) continue;
    out.set(k, t.slice(i + 1).trim());
  }
  return [...out].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * 从 /login/status、/user/account 的响应里取用户资料（两者一个套 data 一个不套）。
 * 昵称与头像只在 profile 里；网易云对匿名/游客态账号把 profile 回成 null，
 * 此时不能编一个昵称顶上去——界面要靠 anonymous 说明"为什么没有昵称"。
 */
function pickUser(raw) {
  const d = raw?.data || raw || {};
  const acc = d.account || {};
  const pro = d.profile || {};
  const vipType = Number(pro.vipType ?? acc.vipType ?? 0);
  const nickname = String(pro.nickname || pro.name || '');
  return {
    userId: String(pro.userId || acc.id || ''),
    nickname,
    avatarUrl: String(pro.avatarUrl || ''),
    signature: String(pro.signature || ''),
    vipType,
    level: Number(d.level ?? pro.level ?? 0),
    // 8/120 为各类 VIP；0 表示普通用户
    isVip: vipType > 0,
    // 匿名账号：有 MUSIC_U 但没有资料页，收藏/推荐能用，昵称头像不存在
    anonymous: !nickname && (acc.anonimousUser === true || acc.anonymousUser === true),
  };
}

async function refreshStatus() {
  if (!state.cookie) return null;
  try {
    const j = await ncm('/login/status');
    const user = pickUser(j);
    if (user.userId) {
      state.user = user;
      save();
    }
    return user;
  } catch (e) {
    console.warn('[account] 刷新登录态失败:', e.message);
    return state.user;
  }
}

async function qrKey() {
  const j = await ncm('/login/qr/key', { timestamp: Date.now() });
  const key = j?.data?.unikey || j?.unikey;
  if (!key) throw new Error('未取得登录密钥（网易云接口可能不可达）');
  return key;
}

async function qrCreate(key) {
  const j = await ncm('/login/qr/create', { key, qrimg: 'true', timestamp: Date.now() });
  const data = j?.data || {};
  if (!data.qrimg) throw new Error('未能生成二维码图片');
  return { key, qrurl: data.qrurl || '', qrimg: data.qrimg };
}

/**
 * 轮询扫码结果。上游 code：800 二维码已过期 / 801 等待扫码 / 802 已扫码待确认 / 803 成功
 * 成功时把上游返回的 cookie 存下来（只在本机），响应里仅回 code 与用户信息。
 */
async function qrCheck(key) {
  const j = await ncm('/login/qr/check', { key, timestamp: Date.now() });
  const code = Number(j?.code || 0);
  if (code === 803 && hasCredential(j?.cookie)) {
    state.cookie = cleanCookie(j.cookie);
    state.loginAt = Date.now();
    save();
    const user = await refreshStatus();
    return { code, loggedIn: true, user: user || state.user };
  }
  return { code, loggedIn: false, user: null };
}

function logout() {
  const p = state.cookie ? ncm('/logout').catch(() => null) : Promise.resolve(null);
  return p.then(() => {
    state = { cookie: '', user: null, loginAt: 0 };
    save();
    return publicState();
  });
}

/** 给渲染层的视图：不含任何凭证 */
function publicState() {
  return {
    loggedIn: hasCredential(state.cookie),
    user: state.user,
    loginAt: state.loginAt,
    // 上游可达性影响登录能力；由调用方结合 online 标志判断
  };
}

module.exports = { init, getCookie, publicState, qrKey, qrCreate, qrCheck, refreshStatus, logout };
