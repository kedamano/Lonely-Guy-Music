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
      state = { cookie: String(j.cookie || ''), user: j.user || null, loginAt: Number(j.loginAt || 0) };
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
  if (j.code && j.code >= 500) throw new Error(`网易云接口错误 ${j.code}`);
  return j;
}

// MUSIC_U 是登录凭证的标志位；没有它说明拿到的只是匿名 cookie
function hasCredential(cookie) {
  return /MUSIC_U=[^;]+/.test(String(cookie || ''));
}

function pickUser(raw) {
  const acc = raw?.account || raw?.data?.account || raw || {};
  const level = raw?.level ?? acc?.level ?? 0;
  return {
    userId: String(acc?.id || acc?.userId || ''),
    nickname: acc?.nickname || acc?.nickName || '网易云用户',
    avatarUrl: acc?.avatarUrl || '',
    signature: acc?.signature || '',
    vipType: Number(acc?.vipType || 0),
    level: Number(level || 0),
    // 8/120 为各类 VIP；0 表示普通用户
    isVip: Number(acc?.vipType || 0) > 0,
  };
}

async function refreshStatus() {
  if (!state.cookie) return null;
  try {
    const j = await ncm('/login/status');
    const user = pickUser(j?.data || j);
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
 * 轮询扫码结果。上游 code：801 已扫码待确认 / 802 等待扫码 / 803 成功 / 800 已过期
 * 成功时把上游返回的 cookie 存下来（只在本机），响应里仅回 code 与用户信息。
 */
async function qrCheck(key) {
  const j = await ncm('/login/qr/check', { key, timestamp: Date.now() });
  const code = Number(j?.code || 0);
  if (code === 803 && hasCredential(j?.cookie)) {
    state.cookie = String(j.cookie).trim();
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
