// 账号：侧边栏登录态、账号菜单与扫码登录弹窗。
// 凭证只在后端（userData/account.json 与反代请求头），本模块永远拿不到 cookie。
import { api } from './api.js';
import { el, icon, toast, openMenu, openModal, closeModal, proxyUrl } from './ui.js';

const $ = (id) => document.getElementById(id);

let state = { loggedIn: false, user: null, loginAt: 0, online: false };
let pollTimer = null;
let pollKey = '';

function goto(name, param) {
  window.dispatchEvent(new CustomEvent('guman:navigate', { detail: { name, param } }));
}
function emitChanged() {
  window.dispatchEvent(new CustomEvent('guman:accountchange'));
}

export function accountState() { return state; }

export async function refreshAccount() {
  try {
    const d = await api.accountState();
    state = { loggedIn: !!d.loggedIn, user: d.user || null, loginAt: Number(d.loginAt || 0), online: !!d.online };
  } catch (_) {
    state = { ...state, loggedIn: false, user: null };
  }
  paintAccount();
  return state;
}

export function paintAccount() {
  const box = $('accountBox');
  const btn = $('accountBtn');
  const av = $('accountAvatar');
  const name = $('accountName');
  const sub = $('accountSub');
  if (!box || !btn || !av || !name || !sub) return;

  const u = state.user || {};
  const anon = !!u.anonymous;
  box.classList.toggle('is-login', state.loggedIn);
  name.textContent = state.loggedIn ? (u.nickname || (anon ? '匿名账号' : '已登录')) : '未登录';
  if (state.loggedIn) {
    // 网易云对匿名/游客态账号不返回 profile，这里如实说明，别让用户以为登录丢数据了
    sub.textContent = anon
      ? '游客态 · 建议在 App 内登录主账号'
      : (u.isVip ? '黑胶会员 · 已同步' : '网易云用户 · 已同步');
    btn.title = anon
      ? '当前是网易云游客账号，收藏与推荐可用，但没有昵称头像'
      : `${u.nickname || ''} · 点击查看账号菜单`;
  } else {
    sub.textContent = state.online ? '扫码登录网易云' : '曲库离线，暂无法登录';
    btn.title = state.online ? '登录网易云账号' : '网易云接口不可达，无法登录';
  }
  av.innerHTML = '';
  if (state.loggedIn && u.avatarUrl) av.appendChild(el('img', { src: proxyUrl(u.avatarUrl), alt: '' }));
  else av.appendChild(icon(state.loggedIn ? 'vip' : 'user'));
}

export function openAccountMenu(x, y) {
  if (!state.loggedIn) {
    openLoginModal();
    return;
  }
  const u = state.user || {};
  openMenu(x, y, [
    { label: u.nickname || '已登录' },
    { text: '每日推荐', iconName: 'spark', run: () => goto('discover') },
    { text: '我收藏的歌单', iconName: 'heart', run: () => goto('mine', 'pins') },
    { text: '账号信息', iconName: 'vip', run: () => showAccountInfo(u) },
    { sep: true },
    { text: '退出登录', iconName: 'close', danger: true, run: () => logoutAccount() },
  ]);
}

function showAccountInfo(u) {
  const anon = !!u.anonymous;
  const rows = [
    ['昵称', u.nickname || '—'],
    ['等级', u.level ? `Lv.${u.level}` : '—'],
    ['会员', u.isVip ? '黑胶会员' : '普通用户'],
    ['UID', u.userId || '—'],
  ];
  if (anon) rows.splice(1, 0, ['账号类型', '游客态（网易云未返回资料页）']);
  const body = el('div', {}, rows.map(([k, v]) => el('div', { class: 'kv' }, [
    el('span', { class: 'kv__k', text: k }),
    el('span', { class: 'kv__v', text: v }),
  ])));
  openModal({
    title: '账号信息',
    desc: anon
      ? '这个账号是在网易云 App 里以游客态扫码的：收藏、订阅、每日推荐都可用，但昵称头像不存在。想要个性化推荐，请在 App 内登录主账号后回来重新扫码。'
      : (u.signature ? '个性签名：' + u.signature : '登录凭证保存在本机，不会发送到界面层。'),
    body,
    actions: [el('button', { class: 'btn btn--primary', text: '知道了', onclick: () => closeModal() })],
  });
}

async function logoutAccount() {
  try {
    await api.logout();
    stopPolling();
    await refreshAccount();
    emitChanged();
    toast('已退出登录');
  } catch (e) {
    toast('退出失败：' + (e.message || '网络异常'), 4000, 'error');
  }
}

/* ---------------- 扫码登录 ---------------- */
const QR_STATUS = {
  800: { text: '二维码已过期，正在刷新…', cls: 'is-wait' },
  801: { text: '等待扫码 · 请用网易云音乐 App 扫二维码', cls: 'is-wait' },
  802: { text: '已扫码 · 请在手机上确认登录', cls: 'is-wait' },
  803: { text: '登录成功', cls: 'is-ok' },
};

function setStatus(node, text, cls = '') {
  if (!node) return;
  node.className = 'qr__status ' + cls;
  node.textContent = text;
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  pollKey = '';
}

export function openLoginModal() {
  if (!state.online) return toast('网易云接口不可达，暂时无法登录');

  const imgBox = el('div', { class: 'qr__img' }, [el('span', { class: 'spinner' })]);
  const status = el('div', { class: 'qr__status is-wait', text: '正在生成二维码…' });
  const body = el('div', { class: 'qr' }, [
    imgBox,
    status,
    el('div', { class: 'qr__hint', text: '扫码并在手机上确认后自动登录；凭证仅保存在本机用户目录。' }),
  ]);

  openModal({
    title: '扫码登录',
    desc: '打开网易云音乐 App → 我的 → 右上角扫码。',
    body,
    actions: [el('button', { class: 'btn', text: '取消', onclick: () => closeModal() })],
    onClose: stopPolling,
  });
  loadQr(imgBox, status);
}

async function loadQr(imgBox, status) {
  stopPolling();
  imgBox.innerHTML = '';
  imgBox.appendChild(el('span', { class: 'spinner' }));
  setStatus(status, '正在生成二维码…', 'is-wait');
  try {
    const d = await api.qrStart();
    if (!d?.key) throw new Error('未取得登录密钥');
    imgBox.innerHTML = '';
    imgBox.appendChild(el('img', { src: d.qrimg, alt: '登录二维码' }));
    pollKey = d.key;
    setStatus(status, QR_STATUS[801].text, QR_STATUS[801].cls);
    pollTimer = setInterval(() => pollQr(imgBox, status), 2000);
  } catch (e) {
    imgBox.innerHTML = '';
    setStatus(status, e.message || '二维码生成失败', '');
    imgBox.appendChild(el('button', {
      class: 'btn btn--small',
      text: '重新生成',
      onclick: () => loadQr(imgBox, status),
    }));
  }
}

async function pollQr(imgBox, status) {
  if (!pollKey) return;
  let d;
  try {
    d = await api.qrCheck(pollKey);
  } catch (e) {
    setStatus(status, e.message || '登录状态查询失败', '');
    return;
  }
  const code = Number(d?.code || 0);
  if (code === 803) {
    stopPolling();
    setStatus(status, '登录成功', 'is-ok');
    state = { ...state, loggedIn: true, user: d.user || state.user, loginAt: Date.now() };
    paintAccount();
    emitChanged();
    setTimeout(() => { closeModal(); toast('已登录：' + (d.user?.nickname || '网易云用户')); }, 450);
    return;
  }
  if (code === 800) {
    loadQr(imgBox, status); // 过期自动换码，用户不用手动重试
    return;
  }
  const s = QR_STATUS[code] || { text: '等待扫码…', cls: 'is-wait' };
  setStatus(status, s.text, s.cls);
}
