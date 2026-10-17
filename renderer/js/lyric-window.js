// 桌面歌词窗口：置顶无边框透明层。
// 设置（颜色/对齐/加粗/字号/锁定）与主窗口同源共享 localStorage；
// 歌词行由主窗口经 IPC（lyric:update → lyric:line）推送。
const LS_KEY = 'guman.state.v2';

function readStore() {
  try {
    const r = JSON.parse(localStorage.getItem(LS_KEY));
    return r || {};
  } catch { return {}; }
}
function writeStore(patch) {
  const cur = readStore();
  localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...patch }));
}

const wrap = document.getElementById('dlWrap');
const lineEl = document.getElementById('dlLine');
const subEl = document.getElementById('dlSub');
const lockBtn = document.getElementById('dlLock');
const closeBtn = document.getElementById('dlClose');
const fontUp = document.getElementById('dlFontUp');
const fontDown = document.getElementById('dlFontDown');

let settings = readStore();
let locked = !!settings.dLyricLocked;

function applyStyle() {
  settings = readStore();
  const colors = settings.dLyricColors || ['#ffffff', '#37d67a', 'rgba(0,0,0,.55)'];
  const size = settings.dLyricSize || 34;
  const align = settings.dLyricAlign || 'center';
  lineEl.style.fontSize = size + 'px';
  lineEl.style.color = colors[0] || '#fff';
  lineEl.style.textShadow = `0 2px 8px ${colors[2] || 'rgba(0,0,0,.55)'}, 0 0 2px ${colors[2] || 'rgba(0,0,0,.55)'}`;
  lineEl.style.fontWeight = settings.dLyricBold ? '900' : '600';
  subEl.style.color = colors[1] || '#37d67a';
  subEl.style.fontSize = Math.round(size * 0.62) + 'px';
  subEl.style.textShadow = lineEl.style.textShadow;
  const justify = { left: 'flex-start', center: 'center', right: 'flex-end' }[align] || 'center';
  wrap.style.alignItems = justify;
  wrap.style.textAlign = align;
  // 锁定态：整个窗口鼠标穿透
  wrap.classList.toggle('is-locked', locked);
  lockBtn.classList.toggle('is-on', locked);
  lockBtn.textContent = locked ? '🔓' : '🔒';
  lockBtn.title = locked ? '解锁' : '锁定（鼠标穿透）';
  window.gm?.lyricLock?.(locked);
}

function setLyric(text, sub) {
  lineEl.textContent = text || '孤男音乐';
  if (sub) {
    subEl.textContent = sub;
    subEl.style.display = '';
  } else {
    subEl.style.display = 'none';
  }
}

// 主进程转发的歌词行 / 播放状态
window.gm?.onLyricLine?.((payload) => setLyric(payload?.text, payload?.sub));

/* ---------- 交互 ---------- */
lockBtn.addEventListener('click', () => {
  locked = !locked;
  writeStore({ dLyricLocked: locked });
  applyStyle();
});
closeBtn.addEventListener('click', () => window.gm?.lyricCloseRequest?.());
fontUp.addEventListener('click', () => {
  writeStore({ dLyricSize: Math.min(72, (readStore().dLyricSize || 34) + 2) });
  applyStyle();
});
fontDown.addEventListener('click', () => {
  writeStore({ dLyricSize: Math.max(18, (readStore().dLyricSize || 34) - 2) });
  applyStyle();
});
// 点击歌词 → 唤出主窗口
lineEl.addEventListener('click', () => window.gm?.lyricActivate?.());
subEl.addEventListener('click', () => window.gm?.lyricActivate?.());

applyStyle();
