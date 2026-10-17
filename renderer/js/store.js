// 落盘状态：设置 / 收藏 / 历史 / 搜索历史 / 本地命名歌单 / 收藏的在线歌单
const LS_KEY = 'guman.state.v2';

const DEFAULTS = {
  volume: 0.8,
  muted: false,
  accent: 'amber',
  repeat: 'all',     // all | one | none
  shuffle: false,
  eqPreset: 'flat',
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  sleepMin: 0,
  sourceQuality: 'flac', // 音源默认音质
  lyricBg: 'blur',       // 歌词页背景：app=应用背景 / blur=封面模糊 / color=封面主色
  stageOpen: false,
  searchHistory: [],
  favorites: [],
  history: [],
  sheets: [],   // 本地命名歌单：曲目落盘，跨会话保留
  pins: [],     // 收藏的在线歌单引用（内容仍从网易云实时拉取）

  /* ---------- 基本设置 ---------- */
  animations: true,     // 显示动画效果
  fontScale: 'md',      // 字体大小：xs/s/md/lg/xl/xxl
  windowSize: 'md',     // 窗口尺寸：sm/md/lg/xl
  lang: 'zh-CN',        // 界面语言（i18n.js）

  /* ---------- 播放设置 ---------- */
  autoPlay: false,        // 启动软件后自动播放音乐
  preventSleep: true,     // 播放歌曲时阻止电脑休眠
  rememberProgress: true, // 记住播放进度
  errorAutoNext: true,    // 播放错误时自动切换歌曲
  karaokeLyric: false,    // 使用卡拉OK样式歌词播放
  taskbarProgress: true,  // 在任务栏上显示当前歌曲播放进度

  /* ---------- 播放详情页设置 ---------- */
  scaleActiveLyric: true, // 缩放当前正在播放的歌曲
  delayLyricScroll: false,// 延迟歌词滚动
  lyricDragSeek: false,   // 允许通过拖拽歌词调整播放进度
  lyricAlign: 'center',   // 歌词对齐方式：left / center / right
  lyricLang: 'off',       // 歌词语言：off 只看原文 / trans 只看译文 / both 双语对照

  /* ---------- 桌面歌词 ---------- */
  desktopLyric: false,    // 显示桌面歌词
  dLyricColors: ['#ffffff', '#37d67a', 'rgba(0,0,0,.55)'], // 未播放 / 已播放 / 阴影
  dLyricAlign: 'center',  // 桌面歌词对齐：left / center / right
  dLyricBold: false,      // 桌面歌词加粗
  dLyricSize: 34,         // 桌面歌词字号 px
  dLyricLocked: false,    // 锁定桌面歌词（鼠标穿透）

  /* ---------- 列表设置 ---------- */
  showSourceTag: false,   // 显示歌曲来源平台
  rememberScroll: true,   // 记住播放列表滚动位置
  dblClickSwitch: true,   // 双击列表里的歌曲时自动切换到当前列表播放
  addToQueuePos: 'bottom',// 添加歌曲到播放列表的位置：top / bottom

  /* ---------- 下载设置 ---------- */
  downloadEnabled: true,        // 启用下载功能
  downloadDir: '',              // 下载路径（空 = 每次询问）
  downloadNaming: 'name-artist',// 文件命名方式：name-artist / artist-name / name

  /* ---------- 播放进度记忆（内部使用） ---------- */
  lastTrack: null,       // 上次播放的曲目（自动恢复用）
  lastProgress: {},      // { trackKey: 秒 }
};

function load() {
  try {
    const r = JSON.parse(localStorage.getItem(LS_KEY));
    return r ? { ...DEFAULTS, ...r } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}
function persist() { try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (_) { /* ignore quota */ } }

const data = load();

// 会话级（不落盘）
const session = { library: [], queue: [], queueIndex: -1 };

function keyOf(track) {
  return track.source === 'local' ? String(track.url || track.id) : String(track.id);
}

export const store = {
  get(k) { return data[k]; },
  set(patch) { Object.assign(data, patch); persist(); },

  /* ---------- 收藏 ---------- */
  toggleFav(track) {
    const arr = data.favorites || (data.favorites = []);
    const key = keyOf(track);
    const i = arr.findIndex((t) => keyOf(t) === key);
    if (i >= 0) arr.splice(i, 1);
    else arr.push({
      id: String(track.id), name: track.name, artist: track.artist, album: track.album,
      albumPic: track.albumPic, duration: track.duration, source: track.source, url: track.url,
    });
    persist();
    return i < 0; // true 表示刚收藏
  },
  removeFav(track) {
    const arr = data.favorites || [];
    const key = keyOf(track);
    const i = arr.findIndex((t) => keyOf(t) === key);
    if (i >= 0) arr.splice(i, 1);
    persist();
    return i >= 0;
  },
  isFav(key) { return (data.favorites || []).some((t) => keyOf(t) === String(key)); },

  /* ---------- 本地命名歌单（落盘） ---------- */
  getSheets() { return (data.sheets || []).slice(); },
  findSheet(id) { return (data.sheets || []).find((s) => s.id === id) || null; },
  createSheet(name, desc = '') {
    const arr = data.sheets || (data.sheets = []);
    const sheet = {
      id: 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: String(name || '').trim() || '未命名歌单',
      desc: String(desc || '').trim(),
      tracks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    arr.unshift(sheet);
    persist();
    return sheet;
  },
  updateSheet(id, patch) {
    const s = (data.sheets || []).find((x) => x.id === id);
    if (!s) return null;
    if (patch.name != null) s.name = String(patch.name).trim() || s.name;
    if (patch.desc != null) s.desc = String(patch.desc).trim();
    s.updatedAt = Date.now();
    persist();
    return s;
  },
  removeSheet(id) {
    const arr = data.sheets || [];
    const i = arr.findIndex((s) => s.id === id);
    if (i < 0) return false;
    arr.splice(i, 1);
    persist();
    return true;
  },
  addSheetTrack(id, track) {
    const s = (data.sheets || []).find((x) => x.id === id);
    if (!s) return false;
    const key = keyOf(track);
    if (s.tracks.some((t) => keyOf(t) === key)) return false;
    s.tracks.unshift({
      id: String(track.id), name: track.name, artist: track.artist, album: track.album,
      albumPic: track.albumPic, duration: track.duration, source: track.source, url: track.url,
    });
    s.updatedAt = Date.now();
    persist();
    return true;
  },
  removeSheetTrack(id, key) {
    const s = (data.sheets || []).find((x) => x.id === id);
    if (!s) return false;
    const i = s.tracks.findIndex((t) => keyOf(t) === String(key));
    if (i < 0) return false;
    s.tracks.splice(i, 1);
    s.updatedAt = Date.now();
    persist();
    return true;
  },
  /** 当前曲目被收录在哪些本地歌单里（用于右键菜单勾选） */
  sheetsOfTrack(track) {
    const key = keyOf(track);
    return (data.sheets || []).filter((s) => s.tracks.some((t) => keyOf(t) === key)).map((s) => s.id);
  },

  /* ---------- 在线歌单收藏（引用落盘，内容实时拉取） ---------- */
  // cloud: 已在网易云订阅（换设备不丢）；own: 网易云里自己创建的歌单
  getPins() { return (data.pins || []).slice(); },
  findPin(id) { return (data.pins || []).find((p) => String(p.id) === String(id)) || null; },
  togglePin(pl) {
    const arr = data.pins || (data.pins = []);
    const i = arr.findIndex((p) => String(p.id) === String(pl.id));
    if (i >= 0) arr.splice(i, 1);
    else arr.unshift({
      id: String(pl.id), name: pl.name, picUrl: pl.picUrl || pl.coverImgUrl || '',
      trackCount: pl.trackCount, playCount: pl.playCount,
      creator: pl.creator?.nickname || '', addedAt: Date.now(),
    });
    persist();
    return i < 0;
  },
  /** 拉取/推送云端后写入或更新一条收藏，返回是否新建 */
  upsertPin(pl, patch = {}) {
    const arr = data.pins || (data.pins = []);
    const id = String(pl.id);
    const hit = arr.find((p) => String(p.id) === id);
    const base = {
      id, name: pl.name || hit?.name || '未命名歌单',
      picUrl: pl.picUrl || pl.coverImgUrl || hit?.picUrl || '',
      trackCount: pl.trackCount ?? hit?.trackCount, playCount: pl.playCount ?? hit?.playCount,
      creator: pl.creator?.nickname || pl.creator || hit?.creator || '',
    };
    if (hit) Object.assign(hit, base, patch);
    else arr.unshift({ ...base, addedAt: Date.now(), cloud: false, ...patch });
    persist();
    return !hit;
  },
  markPin(id, patch) {
    const hit = (data.pins || []).find((p) => String(p.id) === String(id));
    if (!hit) return null;
    Object.assign(hit, patch);
    persist();
    return hit;
  },
  isPinned(id) { return (data.pins || []).some((p) => String(p.id) === String(id)); },

  /* ---------- 历史 ---------- */
  pushHistory(track) {
    const arr = data.history || (data.history = []);
    const key = keyOf(track);
    const light = {
      id: track.id, name: track.name, artist: track.artist,
      album: track.album, albumPic: track.albumPic, duration: track.duration,
      source: track.source, url: track.url,
    };
    const existed = arr.findIndex((t) => keyOf(t) === key);
    if (existed >= 0) arr.splice(existed, 1);
    arr.unshift(light);
    if (arr.length > 100) arr.length = 100;
    persist();
  },
  removeHistory(track) {
    const arr = data.history || [];
    const key = keyOf(track);
    const i = arr.findIndex((t) => keyOf(t) === key);
    if (i >= 0) arr.splice(i, 1);
    persist();
    return i >= 0;
  },
  clearHistory() { data.history = []; persist(); },

  /* ---------- 搜索历史 ---------- */
  getSearchHistory() { return (data.searchHistory || []).slice(); },
  pushSearchHistory(keyword) {
    const q = String(keyword || '').trim();
    if (!q) return;
    const arr = (data.searchHistory || []).filter((x) => x !== q);
    arr.unshift(q);
    data.searchHistory = arr.slice(0, 8);
    persist();
  },
  clearSearchHistory() { data.searchHistory = []; persist(); },
  removeSearchHistory(keyword) {
    data.searchHistory = (data.searchHistory || []).filter((x) => x !== keyword);
    persist();
  },

  /* ---------- 播放进度记忆 ---------- */
  getProgress(key) {
    const v = (data.lastProgress || {})[key];
    return typeof v === 'number' && v > 3 ? v : 0; // 3 秒以内不恢复，避免从片头曲赘述
  },
  setProgress(key, sec) {
    const m = data.lastProgress || (data.lastProgress = {});
    m[key] = Math.round(sec);
    // 只保留最近 100 首，避免无限增长
    const keys = Object.keys(m);
    if (keys.length > 100) keys.slice(0, keys.length - 100).forEach((k) => delete m[k]);
    persist();
  },
  setLastTrack(track) {
    data.lastTrack = track ? {
      id: track.id, name: track.name, artist: track.artist, album: track.album,
      albumPic: track.albumPic, duration: track.duration, source: track.source, url: track.url,
    } : null;
    persist();
  },
  getLastTrack() { return data.lastTrack; },

  /* ---------- 播放队列（会话级） ---------- */
  // 本地曲库不在这里：已改由后端按绝对路径登记（见 renderer/js/library.js），跨会话保留
  setQueue(list, index) { session.queue = list || []; session.queueIndex = index ?? -1; },
  getQueue() { return session.queue; },
  getQueueIndex() { return session.queueIndex; },
  setQueueIndex(i) { session.queueIndex = i; },
};

export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  流行: [-2, 1, 3, 4, 3, 0, -1, -1, -1, -2],
  摇滚: [4, 3, 2, 1, -1, -2, 1, 2, 3, 4],
  人声: [-3, -1, 1, 4, 5, 4, 2, 0, -1, -2],
  古典: [3, 2, 1, 0, -1, -1, 0, 2, 3, 4],
  重低音: [7, 6, 5, 3, 1, 0, -1, -2, -3, -4],
};
export const EQ_PRESET_LABELS = { flat: '扁平' };
