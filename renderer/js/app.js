// 孤男音乐 · 编排层：路由 / 视图 / 播放控制 / 队列 / 声场 / 歌词 / 快捷键
import { store, EQ_FREQS, EQ_PRESETS, EQ_PRESET_LABELS } from './store.js';
import { api, normalizeTrack, normalizePlaylist } from './api.js';
import { Player } from './player.js';
import { createVisualizer } from './visualizer.js';
import { activeLine } from './lyrics.js';
import {
  el, icon, hydrateIcons, setIcon, setCover, cover, fmtTime, fmtMs, toast,
  renderPlaylistGrid, renderTrackList, heading, emptyState, trackKey,
  skeletonCards, skeletonRows, playCountText, proxyUrl, pager,
  openMenu, openModal, closeModal, promptText, confirmModal,
} from './ui.js';
import { SettingsView } from './settings.js';
import { applyLang, currentLang, tpl, tr } from './i18n.js';
import { accountState, refreshAccount, paintAccount, openAccountMenu, openLoginModal } from './account.js';
import { library } from './library.js';

const $ = (id) => document.getElementById(id);
const view = $('view');
const player = new Player();
let viz = null;
let lyricEls = [];
let lastLyricIdx = -1;
let routeToken = 0;
let currentRoute = 'discover';
let settingsView = null;
let queueOpen = false;
let searchTimer = null;

/* ---------------- 路由 ---------------- */
const routes = {
  discover: renderDiscover,
  hall: renderHall,
  search: renderSearch,
  local: renderLocal,
  mine: renderMine,
  settings: renderSettings,
};
function setActiveNav(name) {
  document.querySelectorAll('.nav__item').forEach((b) => b.classList.toggle('is-active', b.dataset.route === name));
}
function navigate(name, param) {
  const hash = param ? `#/${name}/${param}` : `#/${name}`;
  if (location.hash === hash) router();
  else location.hash = hash;
}
function goBack() {
  if (history.length > 1) history.back();
  else navigate('discover');
}
async function router() {
  saveScroll(); // 离开当前列表前记住滚动位置
  const token = ++routeToken;
  const h = location.hash.replace(/^#\/?/, '');
  const [name, param] = h.split('/');
  if (name === 'playlist' && param) {
    currentRoute = 'playlist';
    setActiveNav('');
    return renderPlaylist(param, token);
  }
  if (name === 'sheet' && param) {
    currentRoute = 'sheet';
    setActiveNav('mine');
    return renderSheet(param, token);
  }
  // #/mine/pins 这类深链：直接把「我的」切到指定分页
  if (name === 'mine' && param && MINE_TABS.some((t) => t.key === param)) mineTab = param;
  currentRoute = routes[name] ? name : 'discover';
  setActiveNav(currentRoute);
  await (routes[name] || renderDiscover)(token);
  applyLang(currentLang()); // 新渲染的节点套用当前语言
}
window.addEventListener('hashchange', router);

/* ---------------- 视图：发现 ---------------- */
// 游客态（网易云返回 profile:null + anonimousUser:true）时，界面看起来"登录了却什么都没有"，
// 需要在首屏说清楚原因并给出去主账号重扫的入口。
let anonBarDismissed = false;

async function reloginMainAccount() {
  try { await api.logout(); await refreshAccount(); } catch (_) { /* 退出失败也继续给扫码入口 */ }
  openLoginModal();
}

function anonBanner() {
  const st = accountState();
  if (anonBarDismissed || !st.loggedIn || !st.user?.anonymous) return null;
  return el('div', { class: 'anonbar reveal' }, [
    el('div', { class: 'anonbar__txt' }, [
      el('div', { class: 'anonbar__title', text: '当前是网易云游客账号' }),
      el('div', {
        class: 'anonbar__desc',
        text: '收藏、订阅、播放记录都能正常用，但网易云没有给这个账号昵称和头像，个性化推荐也基本是空的。'
          + '请在手机网易云 App 里确认已登录主账号，再回来重新扫码。',
      }),
    ]),
    el('button', { class: 'btn btn--small', onclick: () => reloginMainAccount() }, [icon('user'), '换主账号登录']),
    el('button', {
      class: 'btn-ghost',
      onclick: (e) => { anonBarDismissed = true; e.currentTarget.remove(); },
    }, ['不再提示']),
  ]);
}

async function renderDiscover(token) {
  view.innerHTML = '';
  const ab = anonBanner();
  if (ab) view.appendChild(ab);
  view.appendChild(heading(
    'DISCOVER', '孤男音乐',
    '把任意设备的扬声器，变成一台声场仪表盘。在线曲库 × 本地音乐 × 实时频谱。',
  ));

  const bars = el('div', { class: 'hero__bars' });
  for (let i = 0; i < 9; i++) {
    const bar = el('span', { class: 'hero__bar' });
    bar.style.animationDelay = (i * 0.13) + 's';
    bar.style.animationDuration = (1.5 + (i % 4) * 0.22) + 's';
    bars.appendChild(bar);
  }
  const hero = el('div', { class: 'hero reveal' }, [
    el('div', { class: 'hero__body' }, [
      el('div', { class: 'hero__big', html: '在<em>深夜</em><br>听见自己' }),
      el('p', { class: 'hero__desc', text: '聚合精选歌单，一键播放；打开声场面板，实时频谱、图形均衡器与睡眠定时都已就位。' }),
      el('div', { class: 'hero__cta' }, [
        el('button', { class: 'btn-primary', onclick: playRandom }, [icon('shuffle'), '随机来一首']),
        el('button', { class: 'btn-ghost', onclick: () => navigate('hall') }, [icon('hall'), '浏览音乐馆']),
      ]),
    ]),
    el('div', { class: 'hero__art' }, [
      el('div', { class: 'hero__art-label', text: 'LIVE SOUNDSTAGE' }),
      bars,
      el('div', { class: 'hero__now' }, [
        el('div', { class: 'hero__now-label', text: '正在播放' }),
        el('div', { class: 'hero__now-title', id: 'heroNowTitle', text: player.current?.name || '等待第一首歌' }),
        el('div', { class: 'hero__now-artist', id: 'heroNowArtist', text: player.current?.artist || '随机来一首，点亮声场' }),
      ]),
    ]),
  ]);
  view.appendChild(hero);

  // 每日推荐：登录时给个性化推荐，未登录降级到推荐新歌，离线也能出内容
  const daily = el('section', { class: 'section reveal' });
  view.appendChild(daily);
  applyDailyRecommend(daily, token);

  const sec = el('section', { class: 'section reveal' }, [
    el('div', { class: 'section__head' }, [
      el('div', { class: 'section__title', html: '精选歌单 <span class="section__sub">每日更新</span>' }),
      el('button', { class: 'section__more', onclick: () => navigate('hall') }, ['全部', icon('chevron-down')]),
    ]),
  ]);
  const grid = skeletonCards(6);
  sec.appendChild(grid);
  view.appendChild(sec);

  // 最近播放
  const recent = playableList(store.get('history') || []).slice(0, 6);
  if (recent.length) {
    const recentSec = el('section', { class: 'section reveal' }, [
      el('div', { class: 'section__head' }, [
        el('div', { class: 'section__title', html: '继续聆听 <span class="section__sub">最近播放</span>' }),
        el('button', { class: 'section__more', onclick: () => { mineTab = 'his'; navigate('mine'); } }, ['全部历史']),
      ]),
    ]);
    const list = el('div', { class: 'tracklist' });
    renderTrackList(list, recent, {
      onPlay: (t, i) => player.playTrack(t, recent, i),
      currentId: player.current?.id,
      currentSource: player.current?.source,
      onAddQueue: addQueueWithToast,
      onMenu: (t, i, pos) => openTrackMenu(t, i, pos, { scope: recent }),
      showSource: !!store.get('showSourceTag'),
      onDownload: store.get('downloadEnabled') ? (t) => downloadTrack(t) : null,
    });
    recentSec.appendChild(list);
    view.appendChild(recentSec);
  }
  revealIn();

  try {
    const r = await api.personalized();
    if (token !== routeToken) return;
    const list = (r.result || []).map(normalizePlaylist);
    const g = el('div', { class: 'grid' });
    renderPlaylistGrid(g, list, openPlaylist);
    grid.replaceWith(g);
  } catch (e) {
    if (token !== routeToken) return;
    grid.replaceWith(emptyState({
      iconName: 'alert', title: '歌单加载失败', desc: e.message,
      actions: [el('button', { class: 'btn', onclick: () => renderDiscover(++routeToken) }, [icon('refresh'), '重试'])],
    }));
  }
  revealIn();
}

/* ---------------- 每日推荐（首屏第一入口） ---------------- */
// 网易云的每日推荐按自然日生成，重复请求既慢又会让内容跳变，因此按天缓存；
// 登录态变化时缓存自动失效（key 里带 loggedIn），登录后立刻能看到个性化结果。
const DAILY_KEY = 'guman.daily.v1';
const todayStr = () => new Date().toLocaleDateString('en-CA'); // 本地时区的 YYYY-MM-DD

function readDailyCache() {
  try {
    const c = JSON.parse(localStorage.getItem(DAILY_KEY) || 'null');
    if (c && c.date === todayStr() && !!c.loggedIn === accountState().loggedIn) return c;
  } catch (_) { /* 缓存损坏按未命中处理 */ }
  return null;
}
function writeDailyCache(data) {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify({ ...data, date: todayStr(), loggedIn: accountState().loggedIn }));
  } catch (_) { /* 超出配额只影响首屏缓存，不影响功能 */ }
}

async function applyDailyRecommend(sec, token) {
  const cached = readDailyCache();
  if (cached) { paintDaily(sec, cached); return; }
  sec.appendChild(skeletonRows(4));

  const loggedIn = accountState().loggedIn;
  let data = null;
  try {
    if (loggedIn) {
      const [songsR, resR] = await Promise.all([
        api.recommendSongs().catch(() => null),
        api.recommendResource().catch(() => null),
      ]);
      const raw = songsR?.recommend || songsR?.results || [];
      data = {
        kind: 'personal',
        songs: raw.slice(0, 10).map(normalizeTrack),
        reason: String(raw[0]?.reason || ''),
        playlists: (resR?.recommend || resR?.recommendation || []).map(normalizePlaylist).slice(0, 4),
      };
    } else {
      const r = await api.personalizedNewsong();
      data = { kind: 'new', songs: (r.result || []).map(normalizeTrack).slice(0, 10), reason: '', playlists: [] };
    }
  } catch (e) {
    if (token === routeToken) sec.remove(); // 拉不到就不在首屏留空壳
    return;
  }
  if (token !== routeToken) return;
  writeDailyCache(data);
  paintDaily(sec, data);
}

function paintDaily(sec, data) {
  sec.innerHTML = '';
  const songs = (data.songs || []).filter((t) => t && t.id);
  const pins = data.playlists || [];
  if (!songs.length && !pins.length) { sec.remove(); return; }

  const personal = data.kind === 'personal';
  sec.appendChild(el('div', { class: 'section__head' }, [
    el('div', { class: 'section__title' }, [
      personal ? '每日推荐' : '推荐新歌',
      el('span', { class: 'section__sub', text: personal ? '根据你的收听历史生成' : '网易云近期上新' }),
      data.reason ? el('span', { class: 'reco__reason', text: data.reason }) : null,
    ]),
    el('div', { class: 'section__actions' }, [
      songs.length ? el('button', { class: 'linkbtn', onclick: () => playCollection(songs, 0) }, [icon('play'), '播放全部']) : null,
      el('button', {
        class: 'section__more',
        onclick: () => { localStorage.removeItem(DAILY_KEY); renderDiscover(++routeToken); },
        title: '换一批',
      }, ['换一批', icon('refresh')]),
    ]),
  ]));

  if (songs.length) {
    const list = el('div', { class: 'tracklist' });
    renderTrackList(list, songs, {
      onPlay: (t, i) => player.playTrack(t, songs, i),
      currentId: player.current?.id,
      currentSource: player.current?.source,
      onAddQueue: addQueueWithToast,
      onMenu: (t, i, pos) => openTrackMenu(t, i, pos, { scope: songs }),
      showSource: !!store.get('showSourceTag'),
      onDownload: store.get('downloadEnabled') ? (t) => downloadTrack(t) : null,
    });
    sec.appendChild(list);
  }
  if (pins.length) {
    const grid = el('div', { class: 'grid', style: 'margin-top:14px' });
    renderPlaylistGrid(grid, pins, openPlaylist);
    sec.appendChild(grid);
  }
  if (!personal && !accountState().loggedIn) {
    sec.appendChild(el('button', { class: 'pill pill--cta', onclick: () => openLoginModal() }, [
      icon('vip'), '登录网易云，解锁属于你的每日推荐',
    ]));
  }
  revealIn();
  applyLang(currentLang());
}

/* ---------------- 视图：音乐馆 ---------------- */
const CATS = ['全部', '华语', '欧美', '日语', '韩语', '轻音乐', '摇滚'];
const HALL_PAGE_SIZE = 30;
let hallCat = '全部';
let hallPage = 1;
let hallPageCount = 1;
let hallTotal = null;
async function renderHall(token) {
  view.innerHTML = '';
  view.appendChild(heading('MUSIC HALL', '音乐馆', '按风格浏览热门歌单。'));
  const row = el('div', { class: 'cat-row reveal' });
  CATS.forEach((c) => {
    row.appendChild(el('button', {
      class: 'cat' + (c === hallCat ? ' is-active' : ''), text: c,
      onclick: () => {
        if (hallCat === c) return;
        hallCat = c; hallPage = 1; // 换分类回到第一页
        renderHall(++routeToken);
      },
    }));
  });
  view.appendChild(row);
  const grid = skeletonCards(8);
  view.appendChild(grid);
  revealIn();
  try {
    // 服务端分页：limit + offset，total 用于计算总页数
    const r = await api.topPlaylists(hallCat, HALL_PAGE_SIZE, (hallPage - 1) * HALL_PAGE_SIZE);
    if (token !== routeToken) return;
    hallTotal = Number(r.total || 0);
    hallPageCount = Math.max(1, Math.ceil(hallTotal / HALL_PAGE_SIZE));
    if (hallPage > hallPageCount) { hallPage = hallPageCount; return renderHall(token); }
    const g = el('div', { class: 'grid' });
    renderPlaylistGrid(g, (r.playlists || []).map(normalizePlaylist), openPlaylist);
    grid.replaceWith(g);
    view.appendChild(pager({
      page: hallPage, pageCount: hallPageCount, total: hallTotal, unit: '个歌单',
      onChange: (p) => {
        hallPage = Math.max(1, Math.min(hallPageCount, p));
        renderHall(++routeToken);
        $('view').scrollTop = 0;
      },
    }));
  } catch (e) {
    if (token !== routeToken) return;
    grid.replaceWith(emptyState({
      iconName: 'alert', title: '加载失败', desc: e.message,
      actions: [el('button', { class: 'btn', onclick: () => renderHall(++routeToken) }, [icon('refresh'), '重试'])],
    }));
  }
  revealIn();
}

/* ---------------- 视图：搜索 ---------------- */
const HOT_SEARCHES = ['夜曲', '稻香', '晴天', '欧美 R&B', '轻音乐', '摇滚'];
const SEARCH_PAGE_SIZE = 30;
const search = {
  query: '', type: 1, loading: false, error: '',
  songs: [], playlists: [], songCount: 0, playlistCount: 0,
  resultQuery: '', resultType: 0, seq: 0,
  page: 1, pageCount: 1, total: 0,
};

function renderSearch() {
  view.innerHTML = '';
  view.appendChild(heading('SEARCH', '搜索', '实时搜索网易云曲库：输入即搜，回车立即执行。'));
  const input = el('input', {
    id: 'searchInput', type: 'text', placeholder: '想听点什么？歌曲 / 歌单 / 艺人',
    autocomplete: 'off', spellcheck: 'false',
    oninput: onSearchInput,
    onkeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitSearch(); runSearch(true); }
      if (e.key === 'Escape') { e.target.value = ''; search.query = ''; resetSearchResults(); renderSearchOutput(); updateSearchTabs(); clearBtn.classList.add('hidden'); }
    },
  });
  input.value = search.query;
  const clearBtn = el('button', {
    class: 'searchclear' + (search.query ? '' : ' hidden'), title: '清空', 'aria-label': '清空搜索',
    onclick: () => {
      search.query = ''; input.value = ''; input.focus();
      resetSearchResults(); renderSearchOutput(); updateSearchTabs();
      clearBtn.classList.add('hidden');
    },
  }, [icon('close')]);
  const bar = el('div', { class: 'searchbar reveal' }, [
    el('span', {}, [icon('search')]),
    input,
    clearBtn,
    el('kbd', { text: 'Enter' }),
  ]);
  view.appendChild(bar);

  const tabs = el('div', { class: 'tabs reveal' }, [
    el('div', { class: 'tab', 'data-search-type': '1', role: 'tab', tabindex: '0', onclick: () => setSearchType(1) }, [
      '歌曲', el('span', { class: 'tab__count', id: 'tabCountSongs' }),
    ]),
    el('div', { class: 'tab', 'data-search-type': '1000', role: 'tab', tabindex: '0', onclick: () => setSearchType(1000) }, [
      '歌单', el('span', { class: 'tab__count', id: 'tabCountPlaylists' }),
    ]),
  ]);
  tabs.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSearchType(Number(tab.dataset.searchType)); }
    });
  });
  view.appendChild(tabs);

  const out = el('div', { id: 'searchOut' });
  view.appendChild(out);
  updateSearchTabs();
  renderSearchOutput();
  revealIn();

  if (search.query.trim() && (search.resultQuery !== search.query.trim() || search.resultType !== search.type)) {
    runSearch(true);
  }
  requestAnimationFrame(() => {
    input.focus();
    const len = input.value.length;
    try { input.setSelectionRange(len, len); } catch (_) { /* ignore */ }
  });
}

function resetSearchResults() {
  search.songs = []; search.playlists = []; search.error = '';
  search.resultQuery = ''; search.resultType = 0;
  search.loading = false; search.seq += 1;
  search.page = 1; search.pageCount = 1; search.total = 0;
  if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
}

function onSearchInput(e) {
  search.query = e.target.value;
  const clearBtn = document.querySelector('.searchclear');
  if (clearBtn) clearBtn.classList.toggle('hidden', !search.query);
  if (!search.query.trim()) {
    resetSearchResults();
    renderSearchOutput();
    updateSearchTabs();
    return;
  }
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(true), 300);
}

function setSearchType(type) {
  if (search.type === type) return;
  search.type = type;
  search.resultType = 0;
  search.page = 1; // 切 tab 回到第一页
  updateSearchTabs();
  if (search.query.trim()) runSearch(true);
  else renderSearchOutput();
}

function updateSearchTabs() {
  document.querySelectorAll('[data-search-type]').forEach((tab) => {
    const type = Number(tab.dataset.searchType);
    tab.classList.toggle('is-active', type === search.type);
    tab.setAttribute('aria-selected', type === search.type ? 'true' : 'false');
  });
  const sc = $('tabCountSongs'), pc = $('tabCountPlaylists');
  if (sc) { sc.textContent = search.songCount ? String(search.songCount) : ''; sc.classList.toggle('is-zero', !search.songCount); }
  if (pc) { pc.textContent = search.playlistCount ? String(search.playlistCount) : ''; pc.classList.toggle('is-zero', !search.playlistCount); }
}

async function runSearch(immediate = false) {
  const q = search.query.trim();
  if (!q) { renderSearchOutput(); return; }
  if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
  if (!immediate) {
    searchTimer = setTimeout(() => runSearch(true), 300);
    return;
  }
  const seq = ++search.seq;
  search.loading = true;
  search.error = '';
  renderSearchOutput();
  try {
    // 服务端分页：offset = (page-1) * pageSize
    const r = await api.search(q, search.type, SEARCH_PAGE_SIZE, (search.page - 1) * SEARCH_PAGE_SIZE);
    if (seq !== search.seq) return;
    if (search.type === 1) {
      search.songs = (r.result.songs || []).map(normalizeTrack);
      search.songCount = Number(r.result.songCount || search.songs.length);
      search.total = search.songCount;
    } else {
      search.playlists = (r.result.playlists || []).map(normalizePlaylist);
      search.playlistCount = Number(r.result.playlistCount || search.playlists.length);
      search.total = search.playlistCount;
    }
    search.pageCount = Math.max(1, Math.ceil(search.total / SEARCH_PAGE_SIZE));
    search.resultQuery = q;
    search.resultType = search.type;
  } catch (e) {
    if (seq !== search.seq) return;
    search.error = e.message || '网络异常';
  } finally {
    if (seq === search.seq) {
      search.loading = false;
      updateSearchTabs();
      renderSearchOutput();
    }
  }
}

function commitSearch() {
  const q = search.query.trim();
  if (q) store.pushSearchHistory(q);
}

function applySearch(q, type = search.type) {
  search.query = q;
  search.type = type;
  search.page = 1; // 新搜索回到第一页
  if (String(q).trim()) store.pushSearchHistory(q);
  resetSearchResults();
  if (currentRoute === 'search') {
    renderSearch();
    runSearch(true);
  } else {
    navigate('search');
  }
}

// 搜索分页：服务端翻页，重新发起同关键词搜索
function searchPager() {
  return pager({
    page: search.page, pageCount: search.pageCount, total: search.total,
    unit: search.type === 1 ? '首歌曲' : '个歌单',
    onChange: (p) => {
      const target = Math.max(1, Math.min(search.pageCount, p));
      if (target === search.page) return;
      search.page = target;
      runSearch(true);
      $('view').scrollTop = 0;
    },
  });
}

function renderSearchOutput() {
  const out = $('searchOut');
  if (!out) return;
  out.innerHTML = '';
  const q = search.query.trim();
  if (!q) { out.appendChild(buildSearchGuide()); return; }

  if (search.loading || search.resultQuery !== q || search.resultType !== search.type) {
    out.appendChild(el('div', { class: 'search-loading' }, [el('span', { class: 'spinner' }), `正在搜索「${q}」…`]));
    out.appendChild(skeletonRows(8));
    return;
  }
  if (search.error) {
    out.appendChild(emptyState({
      iconName: 'alert', title: '搜索失败', desc: search.error,
      actions: [el('button', { class: 'btn', onclick: () => runSearch(true) }, [icon('refresh'), '重试'])],
    }));
    return;
  }

  if (search.type === 1) {
    if (!search.songs.length) {
      out.appendChild(emptyState({
        iconName: 'search', title: `没有找到「${q}」`, desc: '换一个关键词，或者试试下方热门搜索。',
        actions: HOT_SEARCHES.slice(0, 3).map((h) => el('button', { class: 'btn', onclick: () => applySearch(h) }, [icon('search'), h])),
      }));
      return;
    }
    const metaText = el('div', { class: 'searchmeta__text' });
    tpl(metaText, '找到 <b>{n}</b> 首与「{q}」相关的歌曲', { n: search.songCount || search.songs.length, q: escapeHtml(q) });
    out.appendChild(el('div', { class: 'searchmeta' }, [
      metaText,
      el('div', { class: 'searchmeta__actions' }, [
        el('button', { class: 'btn btn--primary btn--small', onclick: () => playCollection(search.songs, 0) }, [icon('play'), '播放全部']),
        el('button', { class: 'btn btn--small', onclick: () => addAllToQueue(search.songs) }, [icon('plus'), '加入队列']),
      ]),
    ]));
    const list = el('div', { class: 'tracklist' });
    renderTrackList(list, search.songs, {
      onPlay: (t, i) => playCollection(search.songs, i),
      currentId: player.current?.id,
      currentSource: player.current?.source,
      onAddQueue: addQueueWithToast,
      onMenu: (t, i, pos) => openTrackMenu(t, i, pos, { scope: search.songs }),
      showSource: !!store.get('showSourceTag'),
      onDownload: store.get('downloadEnabled') ? (t) => downloadTrack(t) : null,
    });
    out.appendChild(list);
    if (search.pageCount > 1) out.appendChild(searchPager());
  } else {
    if (!search.playlists.length) {
      out.appendChild(emptyState({
        iconName: 'hall', title: `没有找到「${q}」相关歌单`, desc: '换一个关键词，或切到歌曲搜索。',
        actions: [el('button', { class: 'btn', onclick: () => setSearchType(1) }, [icon('search'), '搜歌曲'])],
      }));
      return;
    }
    const metaText = el('div', { class: 'searchmeta__text' });
    tpl(metaText, '找到 <b>{n}</b> 个与「{q}」相关的歌单', { n: search.playlistCount || search.playlists.length, q: escapeHtml(q) });
    out.appendChild(el('div', { class: 'searchmeta' }, [metaText]));
    const grid = el('div', { class: 'grid' });
    renderPlaylistGrid(grid, search.playlists, (pl) => { commitSearch(); openPlaylist(pl); });
    out.appendChild(grid);
    if (search.pageCount > 1) out.appendChild(searchPager());
    revealIn();
  }
  applyLang(currentLang()); // 搜索结果刷新后套用当前语言
}

function buildSearchGuide() {
  const wrap = el('div', { class: 'search-guide reveal in' });
  const history = store.getSearchHistory();

  /* ---------- 最近搜索：标题行 + 可单删的 chips ---------- */
  if (history.length) {
    wrap.appendChild(el('div', { class: 'guide-head' }, [
      el('div', { class: 'guide-head__main' }, [icon('clock'), el('span', { text: '最近搜索' })]),
      el('button', {
        class: 'guide-head__clear', title: '清除全部最近搜索',
        onclick: () => { store.clearSearchHistory(); renderSearchOutput(); },
      }, [icon('close'), '清除']),
    ]));
    const row = el('div', { class: 'chiprow' });
    history.forEach((h) => {
      const chip = el('button', { class: 'schip', onclick: () => applySearch(h) }, [
        icon('clock'),
        el('span', { class: 'schip__text', text: h }),
      ]);
      // 单条删除：悬停显示 ×，点击不触发搜索
      const del = el('span', {
        class: 'schip__del', title: '删除这条记录', role: 'button', tabindex: '-1',
        onclick: (e) => { e.stopPropagation(); store.removeSearchHistory(h); renderSearchOutput(); },
      }, [icon('close')]);
      chip.appendChild(del);
      row.appendChild(chip);
    });
    wrap.appendChild(row);
  }

  /* ---------- 热门搜索：标题行 + 排名网格 ---------- */
  wrap.appendChild(el('div', { class: 'guide-head' }, [
    el('div', { class: 'guide-head__main' }, [icon('flame'), el('span', { text: '热门搜索' })]),
    el('span', { class: 'guide-head__hint', text: '大家都在搜' }),
  ]));
  const grid = el('div', { class: 'hotgrid' });
  HOT_SEARCHES.forEach((h, i) => {
    grid.appendChild(el('button', {
      class: 'hotgrid__item' + (i < 3 ? ' is-top' : ''),
      onclick: () => applySearch(h),
    }, [
      el('span', { class: 'hotgrid__rank', text: String(i + 1) }),
      el('span', { class: 'hotgrid__name', text: h }),
      icon('chevron-right', 'hotgrid__go'),
    ]));
  });
  wrap.appendChild(grid);
  return wrap;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- 视图：本地音乐 ---------------- */
let localPage = 1; // 本地曲库客户端分页页码
async function renderLocal(token) {
  view.innerHTML = '';
  await library.load(); // 服务端清单（Electron）；浏览器环境直接返回会话清单
  if (token !== routeToken) return;

  const persistNote = library.isServer();
  const cta = el('div', { class: 'view-head__cta' }, [
    el('button', { class: 'btn-primary', onclick: () => pickLocalFiles() }, [icon('plus'), '选择文件']),
    el('button', { class: 'btn-ghost', onclick: () => pickLocalDir() }, [icon('folder-plus'), '选择文件夹']),
  ]);
  view.appendChild(heading('LOCAL', '本地音乐',
    persistNote ? '导入的曲目登记在本机清单里，重启后依然在。' : '导入本地音频，用同一套播放器与声场播放。', cta));

  // 浏览器环境没有原生文件对话框，用隐藏 input 兜底（Electron 走主进程对话框）
  if (!persistNote) {
    view.appendChild(el('input', { id: 'fileInput', type: 'file', accept: 'audio/*,.flac,.m4a', multiple: 'true', style: 'display:none', onchange: (e) => importFiles(e.target.files) }));
    view.appendChild(el('input', { id: 'dirInput', type: 'file', accept: 'audio/*,.flac,.m4a', multiple: 'true', webkitdirectory: 'true', style: 'display:none', onchange: (e) => importFiles(e.target.files) }));
  }

  const drop = el('div', { class: 'dropzone reveal' }, [
    icon('upload'),
    el('div', {}, [
      el('strong', { text: '把音频文件拖到这里' }),
      el('span', { text: '  ·  支持 mp3 / flac / wav / ogg / m4a / aac' }),
    ]),
  ]);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-drag');
    importFiles(e.dataTransfer?.files);
  });
  view.appendChild(drop);

  const lib = library.all();
  lib.filter((t) => !t.duration).slice(0, 30).forEach(readMeta); // 补齐缺失时长并回写清单
  if (!lib.length) {
    const empty = emptyState({
      iconName: 'local', title: '还没有本地音乐',
      desc: '把 mp3 / flac 等文件拖进上方区域，或通过按钮导入。导入后即可用均衡器与频谱播放。',
      actions: [
        el('button', { class: 'btn', onclick: () => pickLocalFiles() }, [icon('plus'), '选择文件']),
        el('button', { class: 'btn', onclick: () => pickLocalDir() }, [icon('folder-plus'), '选择文件夹']),
      ],
    });
    empty.classList.add('local-empty', 'reveal');
    view.appendChild(empty);
  } else {
    const bar = el('div', { class: 'lib-toolbar reveal' }, [
      (() => {
        const n = el('div', { class: 'lib-toolbar__info' });
        tpl(n, persistNote ? '本地曲库 <b>{n}</b> 首 · 已存入本机' : '本地曲库 <b>{n}</b> 首 · 仅本次会话有效', { n: lib.length });
        return n;
      })(),
      el('div', { class: 'lib-toolbar__actions' }, [
        el('button', { class: 'btn btn--small', onclick: () => playCollection(lib, 0) }, [icon('play'), '播放全部']),
        el('button', { class: 'btn btn--small', onclick: () => addAllToQueue(lib) }, [icon('plus'), '加入队列']),
      ]),
    ]);
    view.appendChild(bar);
    const { list, pager: pg } = paginatedTrackList(lib, localPage, {
      onPlay: (all, i) => playCollection(all, i),
      onAddQueue: addQueueWithToast,
      onRemove: (all, i) => removeLocalTrack(all[i]),
      removeTitle: '移除',
      onMenu: (t, i, pos) => openTrackMenu(t, i, pos, { scope: lib, onReRender: () => renderLocal(++routeToken) }),
      onPage: (p) => { localPage = p; renderLocal(++routeToken); $('view').scrollTop = 0; },
    });
    view.appendChild(list);
    if (pg.pageCount > 1) view.appendChild(pg);
  }
  revealIn();
}

async function removeLocalTrack(t) {
  await library.remove(t);
  toast('已从本地曲库移除');
  renderLocal(++routeToken);
}

async function pickLocalFiles() {
  if (!library.isServer()) { $('fileInput')?.click(); return; }
  try {
    const paths = await window.gm.openMusicFiles();
    if (paths && paths.length) await importPaths(paths);
  } catch (e) {
    toast('打开文件对话框失败：' + (e.message || ''), 4000, 'error');
  }
}

async function pickLocalDir() {
  if (!library.isServer()) { $('dirInput')?.click(); return; }
  let dir = null;
  try {
    dir = await window.gm.openMusicDir();
  } catch (e) {
    return toast('打开目录对话框失败：' + (e.message || ''), 4000, 'error');
  }
  if (!dir) return;
  toast('正在扫描目录，请稍候…');
  try {
    const r = await library.scan(dir);
    finishImport(r.added, r.skipped);
  } catch (e) {
    toast('扫描失败：' + (e.message || '目录不可读'), 5000, 'error');
  }
}

async function importFiles(fileList) {
  try {
    const r = await library.addFiles(fileList);
    finishImport(r.added, r.skipped);
  } catch (e) {
    toast('导入失败：' + (e.message || '无法读取所选文件'), 5000, 'error');
  }
}

async function importPaths(paths) {
  try {
    const r = await library.addPaths(paths);
    finishImport(r.added, r.skipped);
  } catch (e) {
    toast('导入失败：' + (e.message || ''), 5000, 'error');
  }
}

function finishImport(added, skipped = 0) {
  renderLocal(++routeToken);
  if (!added?.length) {
    toast(skipped ? '没有可导入的音频文件' : '这些曲目已经在曲库里了');
    return;
  }
  playCollection(library.all(), 0); // 导入即出声，验证链路可用
  toast(`已导入 ${added.length} 首本地音乐` + (skipped ? `，跳过 ${skipped} 个不支持的文件` : ''));
}

// 本地文件缺少时长：读一次 metadata 回写清单，避免每次进入页面重复探测
function readMeta(track) {
  if (!track || track.duration > 0) return;
  const a = new Audio();
  a.preload = 'metadata';
  a.src = track.url;
  a.addEventListener('loadedmetadata', () => {
    const ms = (a.duration || 0) * 1000;
    if (!ms) return;
    library.reportDuration(track, ms);
    document.querySelectorAll('.track').forEach((row) => {
      if (row.dataset.trackId === track.id) {
        const d = row.querySelector('.track__dur');
        if (d) d.textContent = fmtMs(ms);
      }
    });
  });
  a.addEventListener('error', () => { a.src = ''; }, { once: true });
}

/* ---------------- 视图：我的 ---------------- */
const MINE_TABS = [
  { key: 'fav', label: '收藏' },
  { key: 'his', label: '历史' },
  { key: 'queue', label: '队列' },
  { key: 'sheet', label: '我的歌单' },
  { key: 'pin', label: '订阅歌单' },
];
let mineTab = 'fav';
let minePage = 1; // 收藏/历史/队列客户端分页页码
function renderMine() {
  view.innerHTML = '';
  view.appendChild(heading('LIBRARY', '我的', '收藏、播放历史、当前队列与本地歌单。'));
  const favs = playableList(store.get('favorites') || []);
  const history = playableList(store.get('history') || []);
  const tabsData = MINE_TABS.map((t) => ({
    ...t,
    count: t.key === 'fav' ? favs.length
      : t.key === 'his' ? history.length
      : t.key === 'queue' ? player.queue.length
      : t.key === 'sheet' ? store.getSheets().length
      : store.getPins().length,
  }));
  const tabs = el('div', { class: 'tabs reveal' });
  tabsData.forEach((t) => {
    tabs.appendChild(el('div', {
      class: 'tab' + (mineTab === t.key ? ' is-active' : ''),
      role: 'tab', tabindex: '0',
      onclick: () => { mineTab = t.key; minePage = 1; renderMine(); },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mineTab = t.key; renderMine(); } },
    }, [t.label, el('span', { class: 'tab__count' + (t.count ? '' : ' is-zero'), text: String(t.count) })]));
  });
  view.appendChild(tabs);
  const out = el('div', { class: 'reveal' });
  view.appendChild(out);

  if (mineTab === 'sheet') { renderMineSheets(out); revealIn(); applyLang(currentLang()); return; }
  if (mineTab === 'pin') { renderMinePins(out); revealIn(); applyLang(currentLang()); return; }

  if (mineTab === 'queue') {
    if (!player.queue.length) {
      out.appendChild(emptyState({
        iconName: 'queue', title: '播放队列是空的', desc: '在曲目行悬停点击＋，或播放任意歌单来填充队列。',
        actions: [
          el('button', { class: 'btn', onclick: () => navigate('discover') }, [icon('discover'), '去发现']),
          el('button', { class: 'btn', onclick: () => navigate('search') }, [icon('search'), '去搜索']),
        ],
      }));
    } else {
      out.appendChild(el('div', { class: 'lib-toolbar' }, [
        (() => { const n = el('div', { class: 'lib-toolbar__info' }); tpl(n, '队列共 <b>{n}</b> 首', { n: player.queue.length }); return n; })(),
        el('div', { class: 'lib-toolbar__actions' }, [
          el('button', { class: 'btn btn--small', onclick: () => playCollection(player.queue, 0) }, [icon('play'), '从头播放']),
          el('button', { class: 'btn btn--small btn--danger', onclick: () => { player.clearQueue(); toast('队列已清空'); renderMine(); } }, [icon('trash'), '清空队列']),
        ]),
      ]));
      // 客户端分页：队列可能很长
      const { list: qList, pager: pg } = paginatedTrackList(player.queue, minePage, {
        onPlay: (all, i) => player.playAt(i),
        onAddQueue: false,
        onFav: false,
        onMenu: (t, i, pos) => openTrackMenu(t, i, pos, {
          scope: player.queue,
          removeTitle: '移出队列',
          onRemove: (tt, ii) => { player.removeFromQueue(ii); toast('已从队列移除'); renderMine(); },
        }),
        onRemove: (all, i) => {
          player.removeFromQueue(i);
          toast('已从队列移除');
          renderMine();
        },
        removeTitle: '移出队列',
        onPage: (p) => { minePage = p; renderMine(); $('view').scrollTop = 0; },
      });
      out.appendChild(qList);
      if (pg.pageCount > 1) out.appendChild(pg);
    }
  } else {
    const arr = mineTab === 'fav' ? favs : history;
    if (!arr.length) {
      out.appendChild(emptyState({
        iconName: mineTab === 'fav' ? 'heart' : 'clock',
        title: mineTab === 'fav' ? '还没有收藏' : '还没有播放历史',
        desc: mineTab === 'fav' ? '在播放条或任意曲目行点击 ♥，喜欢的歌会出现在这里。' : '播放过的歌曲会自动记录在这里。',
        actions: [el('button', { class: 'btn btn--primary', onclick: () => navigate('discover') }, [icon('discover'), '去发现音乐'])],
      }));
    } else {
      const tracks = arr.map((t) => ({ ...t, id: String(t.id) }));
      out.appendChild(el('div', { class: 'lib-toolbar' }, [
        (() => { const n = el('div', { class: 'lib-toolbar__info' }); tpl(n, mineTab === 'fav' ? '收藏共 <b>{n}</b> 首' : '历史共 <b>{n}</b> 首', { n: tracks.length }); return n; })(),
        el('div', { class: 'lib-toolbar__actions' }, [
          el('button', { class: 'btn btn--small', onclick: () => playCollection(tracks, 0) }, [icon('play'), '播放全部']),
          el('button', {
            class: 'btn btn--small btn--danger',
            onclick: async () => {
              const label = mineTab === 'fav' ? '收藏' : '播放历史';
              if (!await confirmModal({ title: `清空${label}`, desc: `确定清空全部 ${tracks.length} 条${label}？此操作不可撤销。`, okText: '清空', danger: true })) return;
              if (mineTab === 'fav') store.set({ favorites: [] });
              else store.clearHistory();
              toast('已清空');
              updateFavButtons();
              syncFavRows();
              renderMine();
            },
          }, [icon('trash'), '清空']),
        ]),
      ]));
      // 客户端分页：收藏/历史可能上百条
      const { list, pager: pg } = paginatedTrackList(tracks, minePage, {
        onPlay: (all, i) => playCollection(all, i),
        onAddQueue: addQueueWithToast,
        onMenu: (t, i, pos) => openTrackMenu(t, i, pos, {
          scope: tracks,
          removeTitle: '移除',
          onRemove: (tt) => removeMineTrack(tt),
        }),
        onRemove: (all, i) => removeMineTrack(all[i]),
        removeTitle: '移除',
        onPage: (p) => { minePage = p; renderMine(); $('view').scrollTop = 0; },
      });
      out.appendChild(list);
      if (pg.pageCount > 1) out.appendChild(pg);
    }
  }
  revealIn();
}

/* ---------------- 本地命名歌单（落盘） ---------------- */
function removeMineTrack(t) {
  if (mineTab === 'fav') store.removeFav(t);
  else store.removeHistory(t);
  updateFavButtons();
  toast('已移除');
  renderMine();
}

function sheetCard(s) {
  const card = el('div', {
    class: 'pl-card reveal', role: 'button', tabindex: '0',
    'aria-label': `打开歌单 ${s.name}`,
    onclick: () => navigate('sheet', s.id),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('sheet', s.id); } },
    oncontextmenu: (e) => { e.preventDefault(); openSheetMenu(s, e.clientX, e.clientY); },
  });
  card.style.transitionDelay = '0ms';
  card.appendChild(cover(s.id, ''));
  card.querySelector('.pl-card__cover').appendChild(
    el('button', { class: 'pl-card__play', title: '打开歌单', 'aria-label': '打开歌单', onclick: (e) => { e.stopPropagation(); navigate('sheet', s.id); } }, [icon('play')]),
  );
  card.appendChild(el('div', { class: 'pl-card__name', text: s.name }));
  card.appendChild(el('div', { class: 'pl-card__meta', text: `${s.tracks.length} 首 · 本地歌单` }));
  return card;
}

function openSheetMenu(s, x, y) {
  openMenu(x, y, [
    { text: '打开', iconName: 'play', run: () => navigate('sheet', s.id) },
    { text: '播放全部', iconName: 'stage', run: () => playCollection(playableList(s.tracks), 0) },
    { text: '加入队列', iconName: 'plus', run: () => addAllToQueue(playableList(s.tracks)) },
    { sep: true },
    { text: '重命名', iconName: 'sheet', run: () => renameSheet(s) },
    { text: '删除歌单', iconName: 'trash', danger: true, run: () => deleteSheet(s) },
  ]);
}

async function createSheetInteractive() {
  const name = await promptText({ title: '新建歌单', label: '歌单名称', placeholder: '例如：深夜写代码', okText: '创建' });
  if (name === null) return null;
  if (!name.trim()) return toast('歌单名称不能为空');
  const sheet = store.createSheet(name);
  toast(`已创建歌单「${sheet.name}」`);
  if (currentRoute === 'mine') renderMine();
  return sheet;
}

async function renameSheet(s) {
  const name = await promptText({ title: '重命名歌单', label: '歌单名称', value: s.name, okText: '保存' });
  if (name === null || !name.trim()) return;
  store.updateSheet(s.id, { name });
  toast('已重命名');
  if (currentRoute === 'sheet' && location.hash.includes(s.id)) renderSheet(s.id, ++routeToken);
  else if (currentRoute === 'mine') renderMine();
}

async function deleteSheet(s) {
  const ok = await confirmModal({ title: '删除歌单', desc: `确定删除「${s.name}」？歌单里的 ${s.tracks.length} 首曲目记录会一起删除，收藏与本地曲库不受影响。`, okText: '删除', danger: true });
  if (!ok) return;
  store.removeSheet(s.id);
  toast('已删除歌单');
  if (currentRoute === 'sheet') navigate('mine');
  else renderMine();
}

// 「加入歌单」：右键菜单入口。没有歌单时先建一个，避免用户点了没反应
async function openAddToSheetDialog(track, pos = null) {
  const sheets = store.getSheets();
  if (!sheets.length) {
    const sheet = await createSheetInteractive();
    if (sheet) addTrackToSheet(sheet.id, track, sheet.name);
    return;
  }
  const inSheets = new Set(store.sheetsOfTrack(track));
  const items = sheets.slice(0, 10).map((s) => ({
    text: s.name,
    iconName: 'sheet',
    on: inSheets.has(s.id),
    run: () => toggleSheetTrack(s.id, track, s.name),
  }));
  items.push({ sep: true });
  items.push({ text: '新建歌单…', iconName: 'plus', run: () => createAndAdd(track) });
  openMenu(pos?.x ?? Math.round(window.innerWidth / 2), pos?.y ?? 140, items);
}

async function createAndAdd(track) {
  const sheet = await createSheetInteractive();
  if (sheet) addTrackToSheet(sheet.id, track, sheet.name);
}

function addTrackToSheet(sheetId, track, sheetName) {
  if (!store.addSheetTrack(sheetId, track)) return toast('这首歌已经在歌单里了');
  toast(`已加入「${sheetName}」`);
  refreshSheetViews(sheetId);
}

function toggleSheetTrack(sheetId, track, sheetName) {
  if (store.sheetsOfTrack(track).includes(sheetId)) {
    store.removeSheetTrack(sheetId, trackKey(track));
    toast(`已从「${sheetName}」移除`);
  } else {
    return addTrackToSheet(sheetId, track, sheetName);
  }
  refreshSheetViews(sheetId);
}

// 歌单内容变了，只重绘正在显示的相关视图（侧栏计数 + 歌单页 / 我的页）
function refreshSheetViews(sheetId) {
  if (currentRoute === 'sheet' && location.hash.includes(sheetId)) renderSheet(location.hash.split('/')[2], ++routeToken);
  else if (currentRoute === 'mine' && mineTab === 'sheet') renderMine();
}

function renderMineSheets(out) {
  const sheets = store.getSheets();
  out.appendChild(el('div', { class: 'lib-toolbar' }, [
    (() => { const n = el('div', { class: 'lib-toolbar__info' }); tpl(n, '本机歌单 <b>{n}</b> 个 · 只存在这台设备上', { n: sheets.length }); return n; })(),
    el('div', { class: 'lib-toolbar__actions' }, [
      el('button', { class: 'btn btn--small', onclick: () => createSheetInteractive() }, [icon('plus'), '新建歌单']),
    ]),
  ]));
  if (!sheets.length) {
    out.appendChild(emptyState({
      iconName: 'sheet', title: '还没有本地歌单',
      desc: '在任何曲目上右键 → 加入歌单，就能把散落的歌收进一个袋子里；歌单只保存在本机，重启也在。',
      actions: [
        el('button', { class: 'btn btn--primary', onclick: () => createSheetInteractive() }, [icon('plus'), '新建第一个歌单']),
        el('button', { class: 'btn', onclick: () => navigate('discover') }, [icon('discover'), '去发现音乐']),
      ],
    }));
    return;
  }
  const grid = el('div', { class: 'grid' });
  sheets.forEach((s) => grid.appendChild(sheetCard(s)));
  grid.appendChild(el('div', {
    class: 'pl-card--new', role: 'button', tabindex: '0',
    'aria-label': '新建歌单', text: '',
    onclick: () => createSheetInteractive(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); createSheetInteractive(); } },
  }, [icon('plus'), el('span', { text: '新建歌单' })]));
  out.appendChild(grid);
}

/* ---------------- 视图：单个本地歌单 ---------------- */
let sheetPage = 1; // 本地歌单客户端分页页码
async function renderSheet(id, token) {
  view.innerHTML = '';
  view.appendChild(el('button', { class: 'backbtn', onclick: goBack }, [icon('chevron-left'), '返回']));
  const s = store.findSheet(id);
  if (!s) {
    view.appendChild(emptyState({
      iconName: 'sheet', title: '歌单不存在或已删除',
      actions: [el('button', { class: 'btn', onclick: () => navigate('mine') }, [icon('heart'), '回到我的'])],
    }));
    return;
  }
  if (token == null) token = routeToken;
  const tracks = playableList(s.tracks);
  const coverEl = el('div', { class: 'pl-hero__cover' });
  setCover(coverEl, s.id, '');
  const body = el('div', { class: 'pl-hero__body' }, [
    el('div', { class: 'kicker', text: 'LOCAL PLAYLIST' }),
    el('h1', { class: 'pl-hero__name', text: s.name }),
    el('div', { class: 'pl-hero__meta' }, [
      el('span', { class: 'meta-chip meta-chip--accent' }, [icon('music'), `${s.tracks.length} 首`]),
      s.desc ? el('span', { class: 'meta-chip' }, [icon('spark'), s.desc]) : null,
      el('span', { class: 'meta-chip' }, [icon('clock'), `更新于 ${new Date(s.updatedAt || s.createdAt).toLocaleDateString()}`]),
    ]),
    el('div', { class: 'pl-hero__cta' }, [
      el('button', { class: 'btn-primary', onclick: () => playCollection(tracks, 0) }, [icon('play'), '播放全部']),
      el('button', { class: 'btn-ghost', onclick: () => shuffleCollection(tracks) }, [icon('shuffle'), '随机播放']),
      el('button', { class: 'btn-ghost', onclick: () => addAllToQueue(tracks) }, [icon('plus'), '加入队列']),
      el('button', { class: 'btn-ghost', onclick: () => renameSheet(s) }, [icon('sheet'), '重命名']),
      el('button', { class: 'btn-ghost', onclick: () => deleteSheet(s) }, [icon('trash'), '删除']),
    ]),
  ]);
  view.appendChild(el('div', { class: 'pl-hero reveal' }, [coverEl, body]));

  if (!tracks.length) {
    view.appendChild(emptyState({
      iconName: s.tracks.length ? 'alert' : 'music',
      title: s.tracks.length ? '这些本地曲目已不在曲库' : '这个歌单还是空的',
      desc: s.tracks.length ? '本地文件被移动或删除后无法播放，可在「本地音乐」重新导入。' : '在任意曲目行右键 → 加入歌单，把歌收进来。',
      actions: [el('button', { class: 'btn', onclick: () => navigate('local') }, [icon('local'), '去本地音乐'])],
    }));
  } else {
    const { list, pager: pg } = paginatedTrackList(tracks, sheetPage, {
      onPlay: (all, i) => playCollection(all, i),
      onAddQueue: addQueueWithToast,
      onRemove: (all, i) => {
        store.removeSheetTrack(s.id, trackKey(all[i]));
        toast('已从歌单移除');
        renderSheet(s.id, ++routeToken);
      },
      removeTitle: '移出歌单',
      onMenu: (t, i, pos) => openTrackMenu(t, i, pos, { scope: tracks }),
      onPage: (p) => { sheetPage = p; renderSheet(s.id, ++routeToken); $('view').scrollTop = 0; },
    });
    view.appendChild(list);
    if (pg.pageCount > 1) view.appendChild(pg);
  }
  revealIn();
  applyLang(currentLang());
}

/* ---------------- 曲目右键菜单 ---------------- */
function openTrackMenu(track, index, pos, { scope = null, onRemove = null, removeTitle = '移除' } = {}) {
  const faved = store.isFav(trackKey(track));
  const inSheets = new Set(store.sheetsOfTrack(track));
  const items = [
    { label: track.name },
    { text: '播放', iconName: 'play', run: () => (scope ? playCollection(scope, index) : player.playTrack(track, [track], 0)) },
    { text: '下一首播放', iconName: 'plus', run: () => addQueueWithToast(track) },
    { text: faved ? '取消收藏' : '收藏', iconName: faved ? 'heart-fill' : 'heart', on: faved, run: () => { store.toggleFav(track); window.dispatchEvent(new CustomEvent('guman:favchange')); } },
    { sep: true },
    { text: '加入歌单…', iconName: 'sheet', run: () => openAddToSheetDialog(track, pos) },
  ];
  store.getSheets().slice(0, 6).forEach((s) => items.push({
    text: s.name, iconName: 'sheet', on: inSheets.has(s.id), run: () => toggleSheetTrack(s.id, track, s.name),
  }));
  if (track.source !== 'local' && store.get('downloadEnabled')) {
    items.push({ sep: true }, { text: '下载这首歌', iconName: 'download', run: () => downloadTrack(track) });
  }
  if (onRemove) items.push({ sep: true }, { text: removeTitle, iconName: 'trash', danger: true, run: () => onRemove(track, index) });
  openMenu(pos.x, pos.y, items);
}

/* ---------------- 收藏的在线歌单 ---------------- */
// 来源标记：本机=只存在这台设备，云端=已在网易云收藏（换设备不丢），自建=云端里我自己创建的歌单
function pinBadge(p) {
  if (!p.cloud) return { text: '本机', cls: 'is-local' };
  return p.own ? { text: '自建', cls: 'is-own' } : { text: '云端', cls: 'is-cloud' };
}

function pinCard(p) {
  const badge = pinBadge(p);
  const card = el('div', {
    class: 'pl-card reveal', role: 'button', tabindex: '0',
    'aria-label': `打开歌单 ${p.name}`,
    onclick: () => openPlaylist(p),
    oncontextmenu: (e) => {
      e.preventDefault();
      const items = [
        { text: '打开', iconName: 'play', run: () => openPlaylist(p) },
      ];
      if (!p.cloud && accountState().loggedIn) {
        items.push({ text: '同步到网易云', iconName: 'upload', run: () => pushPinToCloud(p) });
      }
      items.push({ sep: true }, { text: '取消收藏', iconName: 'trash', danger: true, run: () => unpin(p) });
      openMenu(e.clientX, e.clientY, items);
    },
  });
  card.appendChild(cover(p.id, p.picUrl));
  card.querySelector('.pl-card__cover').appendChild(
    el('button', { class: 'pl-card__play', title: '打开歌单', 'aria-label': '打开歌单', onclick: (e) => { e.stopPropagation(); openPlaylist(p); } }, [icon('play')]),
  );
  card.querySelector('.pl-card__cover').appendChild(el('span', { class: 'pl-badge ' + badge.cls, text: badge.text }));
  card.appendChild(el('div', { class: 'pl-card__name', text: p.name }));
  card.appendChild(el('div', { class: 'pl-card__meta', text: [p.trackCount ? `${p.trackCount} 首` : '', p.creator || ''].filter(Boolean).join(' · ') }));
  return card;
}

// 收藏在线歌单：本机清单先落盘（保证离线也能看到），登录状态下再尽力同步到网易云
async function toggleSubscribe(pl) {
  const obj = { ...normalizePlaylist(pl), trackCount: pl.trackCount };
  const on = store.togglePin(obj);
  toast(on ? '已收藏歌单' : '已取消收藏歌单');
  if (accountState().loggedIn) {
    try {
      await api.subscribePlaylist(pl.id, on ? 1 : 0);
      store.markPin(pl.id, { cloud: on, own: false }); // 云端确认成功才改来源标记
    } catch (e) {
      toast('网易云端同步失败：' + (e.message || '接口不可用'), 4500, 'error');
    }
  }
  if (currentRoute === 'playlist') renderPlaylist(String(pl.id), routeToken);
  if (currentRoute === 'mine') renderMine();
}

async function pushPinToCloud(p) {
  try {
    await api.subscribePlaylist(p.id, 1);
    store.markPin(p.id, { cloud: true, own: false });
    toast(`已同步「${p.name}」到网易云收藏`);
    if (currentRoute === 'mine') renderMine();
  } catch (e) {
    toast('同步失败：' + (e.message || '接口不可用'), 5000, 'error');
  }
}

async function pullCloudPlaylists() {
  const st = accountState();
  if (!st.loggedIn) return toast('请先登录网易云账号');
  const uid = st.user?.userId;
  if (!uid) return toast('账号信息缺少 UID，请在账号菜单里退出后重新扫码');
  toast('正在拉取云端歌单…');
  try {
    const r = await api.userPlaylists(uid);
    const list = r?.playlist || [];
    if (!list.length) return toast('云端还没有歌单');
    let added = 0;
    list.forEach((p) => {
      // subscribed=true 是收藏的别人的歌单，false 是自己创建的
      if (store.upsertPin(normalizePlaylist(p), {
        trackCount: p.trackCount, playCount: p.playCount, cloud: true, own: !p.subscribed,
      })) added++;
    });
    toast(`云端 ${list.length} 个歌单已同步，新增 ${added} 个`);
    if (currentRoute === 'mine') renderMine();
  } catch (e) {
    toast('拉取失败：' + (e.message || '接口不可用'), 5000, 'error');
  }
}

async function unpin(p) {
  // 云端也有的条目要问一句，避免"以为取消了收藏，手机上网易云还在"
  let unlink = false;
  if (p.cloud && accountState().loggedIn) {
    unlink = await confirmModal({
      title: '取消收藏', okText: '同时取消云端', cancelText: '只删本机',
      desc: `「${p.name}」已同步在网易云端。要同时在网易云取消订阅吗？只删本机的话，下次拉取云端还会回来。`,
    });
  } else {
    unlink = false;
  }
  if (unlink) {
    try { await api.subscribePlaylist(p.id, 0); }
    catch (e) { toast('云端取消失败：' + (e.message || '接口不可用'), 5000, 'error'); return; }
  }
  if (store.isPinned(p.id)) store.togglePin(p);
  toast(unlink ? '已从本机与网易云取消收藏' : '已从本机取消收藏');
  renderMine();
}

async function importPlaylistByLink() {
  const raw = await promptText({
    title: '导入歌单', label: '网易云歌单链接或 ID',
    placeholder: 'https://music.163.com/#/playlist?id=xxxxxxx', okText: '收藏',
  });
  if (raw === null) return;
  const id = String(raw).match(/\d{5,}/)?.[0];
  if (!id) return toast('没有识别到歌单 ID');
  toast('正在读取歌单…');
  try {
    const r = await api.playlistDetail(id);
    const pl = r.playlist;
    if (!pl?.id) throw new Error('歌单不存在或无权访问');
    if (store.isPinned(pl.id)) { openPlaylist(pl); return; }
    store.togglePin(normalizePlaylist(pl));
    toast(`已收藏「${pl.name}」`);
    if (currentRoute === 'mine') renderMine();
  } catch (e) {
    toast('导入失败：' + (e.message || '歌单不存在'), 5000, 'error');
  }
}

function renderMinePins(out) {
  const pins = store.getPins();
  const cloud = pins.filter((p) => p.cloud).length;
  const loggedIn = accountState().loggedIn;
  out.appendChild(el('div', { class: 'lib-toolbar' }, [
    (() => {
      // tpl 的节点会被 applyLang 重写 innerHTML，附加内容必须放在它的兄弟节点里
      const n = el('div', { class: 'lib-toolbar__info' });
      const cnt = el('span', {});
      tpl(cnt, '收藏歌单 <b>{n}</b> 个', { n: pins.length });
      n.appendChild(cnt);
      n.appendChild(el('span', {
        class: 'lib-toolbar__hint',
        text: cloud ? `其中 ${cloud} 个已在网易云端，换设备可拉回` : (loggedIn ? '全部只存在本机，点「拉取云端」合并账号里的歌单' : '登录后可与网易云收藏互相同步'),
      }));
      return n;
    })(),
    el('div', { class: 'lib-toolbar__actions' }, [
      loggedIn
        ? el('button', { class: 'btn btn--small', onclick: () => pullCloudPlaylists() }, [icon('refresh'), '拉取云端歌单'])
        : null,
      el('button', { class: 'btn btn--small', onclick: () => importPlaylistByLink() }, [icon('link'), '导入歌单链接']),
    ].filter(Boolean),
    ),
  ]));
  if (pins.length) {
    const grid = el('div', { class: 'grid' });
    pins.forEach((p) => grid.appendChild(pinCard(p)));
    out.appendChild(grid);
  } else {
    out.appendChild(emptyState({
      iconName: 'heart', title: '还没有收藏在线歌单',
      desc: loggedIn
        ? '点「拉取云端歌单」把你网易云账号里的歌单一次搬进来；也可以粘贴链接或去音乐馆收藏。'
        : '在歌单详情页点「收藏歌单」，或粘贴网易云歌单链接导入。登录后可以与网易云互相同步。',
      actions: [
        loggedIn
          ? el('button', { class: 'btn btn--primary', onclick: () => pullCloudPlaylists() }, [icon('refresh'), '拉取云端歌单'])
          : el('button', { class: 'btn btn--primary', onclick: () => openLoginModal() }, [icon('user'), '登录网易云']),
        el('button', { class: 'btn', onclick: () => importPlaylistByLink() }, [icon('link'), '导入歌单链接']),
        el('button', { class: 'btn', onclick: () => navigate('hall') }, [icon('hall'), '去音乐馆']),
      ],
    }));
  }
  revealIn();
}

/* ---------------- 视图：设置 ---------------- */
async function renderSettings() {
  view.innerHTML = '';
  if (!settingsView) settingsView = new SettingsView(view, toast);
  await settingsView.init();
  revealIn();
  applyLang(currentLang()); // 重建出来的节点是中文原文，要按当前语言再套一次
}

/* ---------------- 列表分页（客户端切片） ---------------- */
// 全量数据保留（播放队列上下文用全量），页面只展示当前页切片。
// opts: { onPlay(all, globalIndex), onPage(page), showAlbum, onAddQueue, onFav, onRemove(all, globalIndex), removeTitle }
const LIST_PAGE_SIZE = 50;
function paginatedTrackList(all, page, opts = {}) {
  const pageCount = Math.max(1, Math.ceil(all.length / LIST_PAGE_SIZE));
  const p = Math.max(1, Math.min(page, pageCount));
  const start = (p - 1) * LIST_PAGE_SIZE;
  const list = el('div', { class: 'tracklist' });
  renderTrackList(list, all.slice(start, start + LIST_PAGE_SIZE), {
    onPlay: (t, i) => opts.onPlay?.(all, start + i),
    currentId: player.current?.id,
    currentSource: player.current?.source,
    showAlbum: opts.showAlbum,
    onAddQueue: opts.onAddQueue,
    onFav: opts.onFav,
    onRemove: opts.onRemove ? (t, i) => opts.onRemove(all, start + i) : null,
    removeTitle: opts.removeTitle,
    onMenu: opts.onMenu ? (t, i, pos) => opts.onMenu(t, start + i, pos) : null,
    showSource: !!store.get('showSourceTag'),
    onDownload: store.get('downloadEnabled') ? (t) => downloadTrack(t) : null,
  });
  const pg = pager({
    page: p, pageCount, total: all.length, unit: '首',
    onChange: (np) => opts.onPage?.(Math.max(1, Math.min(pageCount, np))),
  });
  return { list, pager: pg, page: p, pageCount };
}

/* ---------------- 视图：歌单详情 ---------------- */
function openPlaylist(pl) { navigate('playlist', pl.id); }
let plPage = 1; // 歌单详情客户端分页页码
async function renderPlaylist(id, token) {
  view.innerHTML = '';
  view.appendChild(el('button', { class: 'backbtn', onclick: goBack }, [icon('chevron-left'), '返回']));
  const loading = skeletonRows(10);
  view.appendChild(loading);
  try {
    const [detail, tracksR] = await Promise.all([api.playlistDetail(id), api.playlistTracks(id)]);
    if (token !== routeToken) return;
    const pl = detail.playlist || {};
    const songs = (tracksR.songs || []).map(normalizeTrack);
    view.innerHTML = '';
    view.appendChild(el('button', { class: 'backbtn', onclick: goBack }, [icon('chevron-left'), '返回']));

    const coverEl = el('div', { class: 'pl-hero__cover' });
    setCover(coverEl, pl.id || pl.name, pl.coverImgUrl || pl.picUrl);
    const body = el('div', { class: 'pl-hero__body' }, [
      el('div', { class: 'kicker', text: 'PLAYLIST' }),
      el('h1', { class: 'pl-hero__name', text: pl.name || '歌单' }),
      el('div', { class: 'pl-hero__meta' }, [
        pl.creator?.nickname ? el('span', { class: 'meta-chip' }, [icon('music'), pl.creator.nickname]) : null,
        (() => { const n = el('span', { class: 'meta-chip meta-chip--accent' }, [icon('music')]); tpl(n, '{n} 首', { n: songs.length }); return n; })(),
        pl.playCount != null ? el('span', { class: 'meta-chip' }, [icon('stage'), `${playCountText(pl.playCount)} 播放`]) : null,
        ...(pl.tags || []).slice(0, 3).map((tag) => el('span', { class: 'meta-chip', text: `# ${tag}` })),
      ]),
      pl.description ? el('p', { class: 'pl-hero__desc', text: pl.description }) : null,
      el('div', { class: 'pl-hero__cta' }, [
        el('button', { class: 'btn-primary', onclick: () => playCollection(songs, 0) }, [icon('play'), '播放全部']),
        el('button', { class: 'btn-ghost', onclick: () => shuffleCollection(songs) }, [icon('shuffle'), '随机播放']),
        el('button', { class: 'btn-ghost', onclick: () => addAllToQueue(songs) }, [icon('plus'), '加入队列']),
        el('button', { class: 'btn-ghost' + (store.isPinned(pl.id) ? ' is-on' : ''), onclick: () => toggleSubscribe(pl) },
          [icon(store.isPinned(pl.id) ? 'heart-fill' : 'heart'), store.isPinned(pl.id) ? '已收藏歌单' : '收藏歌单']),
      ]),
    ]);
    view.appendChild(el('div', { class: 'pl-hero reveal' }, [coverEl, body]));

    if (!songs.length) {
      view.appendChild(emptyState({ iconName: 'music', title: '这个歌单还没有歌曲', desc: '试试其他歌单。' }));
    } else {
      view.appendChild(el('div', { class: 'pl-toolbar reveal' }, [
        el('div', { class: 'pl-toolbar__left' }, [icon('queue'), (() => { const n = el('span'); tpl(n, '共 {n} 首', { n: songs.length }); return n; })()]),
        el('button', { class: 'linkbtn', onclick: () => navigate('search') }, '继续搜索'),
      ]));
      // 客户端分页：队列上下文用全量 songs，页面展示当前页
      const { list, pager: pg } = paginatedTrackList(songs, plPage, {
        onPlay: (all, i) => playCollection(all, i),
        showAlbum: songs.some((s) => s.album),
        onAddQueue: addQueueWithToast,
        onMenu: (t, i, pos) => openTrackMenu(t, i, pos, { scope: songs }),
        onPage: (p) => { plPage = p; renderPlaylist(id, ++routeToken); $('view').scrollTop = 0; },
      });
      view.appendChild(list);
      if (pg.pageCount > 1) view.appendChild(pg);
    }
  } catch (e) {
    if (token !== routeToken) return;
    view.innerHTML = '';
    view.appendChild(el('button', { class: 'backbtn', onclick: goBack }, [icon('chevron-left'), '返回']));
    view.appendChild(emptyState({
      iconName: 'alert', title: '歌单加载失败', desc: e.message,
      actions: [el('button', { class: 'btn', onclick: () => renderPlaylist(id, ++routeToken) }, [icon('refresh'), '重试'])],
    }));
  }
  revealIn();
}

/* ---------------- 播放辅助 ---------------- */
function playCollection(songs, index = 0) {
  if (!songs || !songs.length) return toast('这里还没有可播放的歌曲');
  const i = Math.max(0, Math.min(index, songs.length - 1));
  player.playTrack(songs[i], songs, i);
}

function shuffleCollection(songs) {
  if (!songs || !songs.length) return toast('这里还没有可播放的歌曲');
  store.set({ shuffle: true });
  applyShuffleUI();
  const i = Math.floor(Math.random() * songs.length);
  player.playTrack(songs[i], songs, i);
}

function addAllToQueue(songs) {
  let added = 0;
  songs.forEach((t) => { if (player.addToQueue(t)) added++; });
  toast(added ? `已加入队列 ${added} 首` : '这些歌曲已在队列中');
  renderQueue();
}

function addQueueWithToast(t) {
  const ok = player.addToQueue(t);
  toast(ok ? `已加入队列：${t.name}` : '已在播放队列中');
  renderQueue();
}

async function playRandom() {
  try {
    const r = await api.personalized();
    const list = r.result || [];
    if (!list.length) return toast('暂无可播放内容');
    const pl = list[Math.floor(Math.random() * list.length)];
    const tr = await api.playlistTracks(pl.id);
    const songs = (tr.songs || []).map(normalizeTrack);
    if (!songs.length) return toast('暂无可播放内容');
    const i = Math.floor(Math.random() * songs.length);
    store.set({ shuffle: true });
    applyShuffleUI();
    player.playTrack(songs[i], songs, i);
    toast(`随机播放 · ${songs[i].name}`);
  } catch (e) {
    toast('随机播放失败：' + e.message);
  }
}

async function openMood(keyword) {
  const pill = document.querySelector(`.pill[data-mood="${keyword}"]`);
  pill?.classList.add('is-loading');
  setTimeout(() => pill?.classList.remove('is-loading'), 1600);
  applySearch(keyword, 1000);
  store.pushSearchHistory(keyword);
  toast(`正在打开「${keyword}」电台…`);
}

/* ---------------- 播放器事件 → UI ---------------- */
player.on('trackchange', (t) => {
  updateNowPlaying(t);
  updateActiveRows();
  renderQueue();
  if ($('np').classList.contains('open')) {
    lastLyricIdx = -1;
    updateLyric(player.audio.currentTime || 0);
  }
});
player.on('playstate', (playing) => {
  setIcon($('btnPlay'), playing ? 'pause' : 'play');
  setIcon($('npPlay'), playing ? 'pause' : 'play');
  $('pbCover').classList.toggle('is-playing', playing);
  $('titleNp').classList.toggle('is-playing', playing);
});
player.on('time', (cur, dur) => {
  const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;
  ['seek', 'npSeek'].forEach((id) => {
    const root = $(id);
    if (!root) return;
    const fill = root.querySelector('.seek__fill');
    const knob = root.querySelector('.seek__knob');
    if (fill) fill.style.width = pct + '%';
    if (knob) knob.style.left = pct + '%';
    root.setAttribute('aria-valuenow', String(Math.round(pct)));
  });
  const curText = fmtTime(cur), durText = fmtTime(dur);
  $('curTime').textContent = curText;
  $('durTime').textContent = durText;
  $('npCurTime').textContent = curText;
  $('npDurTime').textContent = durText;
  updateLyric(cur);
  updateTaskbarProgress(cur, dur);
});
player.on('lyric', (lines) => renderLyrics(lines));
player.on('error', (m) => {
  toast('⚠ ' + m, 6500, 'error');
  // 播放条同步进入错误态（标题变红），错过 toast 也能看见
  ['pbTitle', 'titleNp'].forEach((id) => {
    const n = $(id);
    if (!n) return;
    n.classList.add('is-error');
    clearTimeout(n._errTimer);
    n._errTimer = setTimeout(() => n.classList.remove('is-error'), 6500);
  });
});
player.on('queueend', () => toast('播放列表已结束'));
player.on('queuechange', () => { renderQueue(); });
player.on('volume', (v, muted) => updateVolumeUI(v, muted));
player.on('loading', (loading) => {
  $('titleNp').classList.toggle('is-loading', !!loading);
});
player.on('sleepend', () => {
  resetSleepUI('已淡出并暂停');
  toast('睡眠定时结束，音乐已淡出');
});

function updateNowPlaying(t) {
  const key = trackKey(t);
  setCover($('pbCover'), key, t.albumPic);
  $('pbTitle').textContent = t.name;
  $('pbArtist').textContent = t.artist || '未知艺人';
  $('titleNp').textContent = `${t.name} — ${t.artist || '未知艺人'}`;
  setCover($('npCover'), key, t.albumPic);
  applyLyricBg(t);
  $('npTitle').textContent = t.name;
  $('npArtist').textContent = t.artist || '未知艺人';
  if (t.album) tpl($('npAlbum'), '专辑 · {album}', { album: t.album });
  else $('npAlbum').textContent = '';
  updateFavButtons();
  updateHeroNow(t);
}

// 歌词页背景：app=应用背景 / blur=封面模糊 / color=封面主色（设置页可切，立即生效）
function applyLyricBg(t) {
  const npBg = $('npBg');
  if (!npBg) return;
  const mode = store.get('lyricBg') || 'blur';
  npBg.dataset.mode = mode;
  npBg.style.background = '';
  npBg.style.backgroundImage = '';
  const seed = t ? trackKey(t) : 'guman';
  if (!t || !t.albumPic || mode === 'app') {
    if (mode === 'app') return; // 应用背景：npBg 透明，露出应用底色
    npBg.style.background = gradientText(seed); // 无封面 → 渐变占位
    return;
  }
  const pic = proxyUrl(t.albumPic);
  if (mode === 'blur') {
    npBg.style.backgroundImage = `url("${pic}")`;
  } else if (mode === 'color') {
    npBg.style.background = gradientText(seed); // 提取完成前先占位
    extractDominantColor(pic).then((rgb) => {
      if (npBg.dataset.mode !== 'color') return; // 期间用户又切了模式
      npBg.style.background = rgb
        ? `linear-gradient(155deg, rgba(${rgb[0]},${rgb[1]},${rgb[2]},.66), rgba(${rgb[0]},${rgb[1]},${rgb[2]},.20) 55%, rgba(10,9,7,.08))`
        : gradientText(seed);
    });
  }
}

// 从封面图提取主色调（加权平均，三级筛选回退：严格 → 仅亮度 → 全图）。
// 封面经同源代理加载，canvas 读取不会被 taint。
function extractDominantColor(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const avg = (satMin, lumMin, lumMax) => {
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < data.length; i += 4) {
            const rr = data[i], gg = data[i + 1], bb = data[i + 2];
            const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
            if (max > 0 && (max - min) / max < satMin) continue; // 跳过近灰
            const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
            if (lum < lumMin || lum > lumMax) continue; // 跳过过暗/过亮
            r += rr; g += gg; b += bb; n++;
          }
          return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
        };
        const rgb = avg(0.18, 26, 235) || avg(0, 20, 240) || avg(0, 0, 255);
        resolve(rgb ? vividColor(rgb) : null);
      } catch (_) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// 把平均色转为适合做氛围背景的鲜艳色：饱和度兜底 0.4、亮度限制在 34%~60%，
// 避免灰度封面生成发灰/发暗的渐变。
function vividColor([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2 / 255;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const s = d === 0 ? 0 : d / 255 / (1 - Math.abs(2 * l - 1));
  const s2 = Math.min(0.85, Math.max(0.4, s));
  const l2 = Math.min(0.6, Math.max(0.34, l));
  const c = (1 - Math.abs(2 * l2 - 1)) * s2;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l2 - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const tbl = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
  return tbl.map((v) => Math.round((v + m) * 255));
}

function gradientText(seed) {
  // 与 ui.gradientFor 保持一致的封面渐变，用于浮层背景
  let h = 2166136261;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h = h >>> 0;
  return `linear-gradient(135deg, hsl(${h % 360} 66% 46%), hsl(${(h * 7 + 130) % 360} 60% 28%))`;
}

function updateHeroNow(t) {
  const title = $('heroNowTitle');
  if (title) title.textContent = t ? t.name : '等待第一首歌';
  const artist = $('heroNowArtist');
  if (artist) artist.textContent = t ? (t.artist || '未知艺人') : '随机来一首，点亮声场';
}

function updateActiveRows() {
  const cur = player.current;
  document.querySelectorAll('.track').forEach((row) => {
    const same = cur
      && row.dataset.trackId === String(cur.id)
      && (!row.dataset.trackSource || row.dataset.trackSource === cur.source);
    row.classList.toggle('is-active', !!same);
  });
}

function updateFavButtons() {
  const on = !!(player.current && store.isFav(trackKey(player.current)));
  ['btnFav', 'npFav'].forEach((id) => {
    const btn = $(id);
    if (!btn) return;
    btn.classList.toggle('is-on', on);
    btn.innerHTML = '';
    btn.appendChild(icon(on ? 'heart-fill' : 'heart'));
    if (on) btn.querySelector('svg').style.fill = 'currentColor';
    btn.title = on ? '取消收藏' : '收藏';
  });
}

// 列表内每行的收藏心形与播放条保持同步
function syncFavRows() {
  document.querySelectorAll('.track__actions [data-fav-for]').forEach((btn) => {
    const on = store.isFav(btn.dataset.favFor);
    btn.classList.toggle('is-on', on);
    btn.innerHTML = '';
    btn.appendChild(icon(on ? 'heart-fill' : 'heart'));
    if (on) btn.querySelector('svg').style.fill = 'currentColor';
    btn.title = on ? '取消收藏' : '收藏';
  });
}

// 收藏/历史里的本地曲目只有仍在曲库清单中才可播放（文件被移动或删除后 url 已失效）
function playableList(list) {
  return (list || []).filter((t) => t.source !== 'local' || library.containsUrl(t.url));
}

/* ---------------- 歌词 ---------------- */
// 歌词显示语言：off 只看原文 / trans 只看译文 / both 双语对照
function lyricLangMode() {
  const v = store.get('lyricLang');
  return v === 'trans' || v === 'both' ? v : 'off';
}
// 译文目标语言跟随界面语言
function lyricTransTarget() {
  const l = currentLang();
  return l === 'en' ? 'en' : l === 'zh-TW' ? 'zh-TW' : 'zh';
}

function renderLyrics(lines) {
  const box = $('npLyrics');
  if (!box) return;
  box.innerHTML = '';
  lyricEls = [];
  lastLyricIdx = -1;
  if (!lines || !lines.length) {
    box.appendChild(el('div', { class: 'lyric-empty' }, [icon('lyric'), player.current?.source === 'local' ? '本地音乐暂无歌词' : '暂无歌词 · 请欣赏旋律']));
    return;
  }
  const mode = lyricLangMode();
  const hasTrans = lines.some((l) => l.trans);
  // 译文没有字符级时间轴，逐字高亮只对原文成立
  const karaoke = !!store.get('karaokeLyric') && mode !== 'trans';
  const dragSeek = !!store.get('lyricDragSeek');
  lines.forEach((l) => {
    const d = el('div', {
      class: 'lyric-line' + (karaoke ? ' is-karaoke' : '') + (dragSeek ? ' is-grabbable' : ''),
      title: dragSeek ? '上下拖拽调整播放进度' : '点击跳转',
    });
    const main = mode === 'trans' && l.trans ? l.trans : l.text;
    // 卡拉OK模式：按字符拆 span，已播放部分高亮
    if (karaoke) {
      main.split('').forEach((ch) => {
        const s = el('span', { class: 'lyric-word', text: ch });
        d.appendChild(s);
      });
    } else {
      d.textContent = main;
    }
    if (mode === 'both' && l.trans && l.trans !== main) {
      d.appendChild(el('div', { class: 'lyric-line__trans', text: l.trans }));
    }
    if (dragSeek) bindLyricDrag(d, l.time);
    else d.addEventListener('click', () => { player.seek(l.time + 0.02); });
    lyricEls.push(d);
    box.appendChild(d);
  });
  if (mode !== 'off' && !hasTrans) box.appendChild(translateAsk());
  updateLyric(player.audio.currentTime || 0);
}

// 网易云没给译文时，由用户点一下才去请求翻译服务（不自动产生外部调用）
function translateAsk() {
  const btn = el('button', { class: 'lyric-trans-ask', text: tr('翻译这首歌') });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = tr('正在翻译…');
    try {
      const ok = await player.requestTranslation(lyricTransTarget());
      if (ok) { toast(tr('译文已就绪')); renderLyrics(player.lyricLines); }
      else { btn.disabled = false; btn.textContent = tr('翻译失败，点此重试'); toast(tr('未配置翻译服务或翻译失败')); }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = tr('翻译失败，点此重试');
      toast(tr('翻译失败'));
    }
  });
  return btn;
}

// 拖拽歌词行调整播放进度：上下拖拽 → ±秒（每 40px ≈ 10 秒）
function bindLyricDrag(node, lineTime) {
  let startY = 0;
  let startTime = 0;
  let hint = null;
  node.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    node.classList.add('is-grabbing');
    try { node.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    startY = e.clientY;
    startTime = player.audio.currentTime || 0;
    hint = el('div', { class: 'lyric-line__drag-hint' });
    document.body.appendChild(hint);
    const move = (ev) => {
      const dy = ev.clientY - startY;
      const target = Math.max(0, Math.min(player.duration || 0, startTime + dy * 0.25));
      if (hint) {
        hint.textContent = fmtTime(target);
        hint.style.left = ev.clientX + 'px';
        hint.style.top = ev.clientY + 'px';
      }
    };
    const up = (ev) => {
      node.classList.remove('is-grabbing');
      const dy = (ev.clientY ?? startY) - startY;
      const target = Math.max(0, Math.min(player.duration || 0, startTime + dy * 0.25));
      player.seek(target);
      hint?.remove();
      hint = null;
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
  });
}

function updateLyric(cur) {
  const lines = player.lyricLines;
  if (!lines || !lines.length || !lyricEls.length) return;
  const idx = activeLine(lines, cur);
  if (idx === lastLyricIdx) return;
  lastLyricIdx = idx;
  lyricEls.forEach((e, i) => e.classList.toggle('is-active', i === idx));
  // 卡拉OK：已播放字符高亮
  if (store.get('karaokeLyric') && idx >= 0) {
    const line = lines[idx];
    const sung = Math.max(0, Math.min(1, (cur - line.time) / Math.max(0.1, (line.duration || 3))));
    const words = lyricEls[idx]?.querySelectorAll('.lyric-word') || [];
    const n = Math.floor(sung * words.length);
    words.forEach((w, i) => w.classList.toggle('is-sung', i < n));
  }
  const active = lyricEls[idx];
  if (active && $('np').classList.contains('open')) {
    if (store.get('delayLyricScroll')) {
      // 延迟滚动：等 350ms 让用户先看到新行出现
      clearTimeout(active._scrollTimer);
      active._scrollTimer = setTimeout(() => {
        if (lyricEls[idx] === active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 350);
    } else {
      active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  pushDesktopLyric();
}

/* ---------------- 队列 ---------------- */
function renderQueue() {
  const list = $('queueList');
  updateQueueBadge();
  if (!list) return;
  list.innerHTML = '';
  if (!player.queue.length) {
    list.appendChild(emptyState({ iconName: 'queue', title: '队列是空的', desc: '播放歌曲或点击曲目行的＋加入队列。' }));
    return;
  }
  player.queue.forEach((t, i) => {
    const active = player.current
      && String(t.id) === String(player.current.id)
      && t.source === player.current.source;
    const removeBtn = el('button', { class: 'iconbtn', title: '移出队列', 'aria-label': '移出队列' }, [icon('trash')]);
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      player.removeFromQueue(i);
      toast('已从队列移除');
    });
    const row = el('div', {
      class: 'queue-row' + (active ? ' is-active' : ''),
      role: 'button', tabindex: '0',
      onclick: () => { player.playAt(i); },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); player.playAt(i); } },
    }, [
      el('div', { class: 'queue-row__idx', text: String(i + 1).padStart(2, '0') }),
      el('div', { class: 'queue-row__main' }, [
        el('div', { class: 'queue-row__title', text: t.name }),
        el('div', { class: 'queue-row__artist', text: t.artist || '未知艺人' }),
      ]),
      el('div', { class: 'queue-row__actions' }, [removeBtn]),
    ]);
    list.appendChild(row);
  });
  applyLang(currentLang());
}

function updateQueueBadge() {
  const badge = $('queueCount');
  if (!badge) return;
  const n = player.queue.length;
  badge.textContent = String(n);
  badge.classList.toggle('is-zero', n === 0);
}

function openQueue() {
  queueOpen = true;
  if ($('np').classList.contains('open')) closeNp();
  $('queuePanel').classList.add('open');
  $('queuePanel').setAttribute('aria-hidden', 'false');
  $('queueBackdrop').classList.add('open');
  renderQueue();
}
function closeQueue() {
  queueOpen = false;
  $('queuePanel').classList.remove('open');
  $('queuePanel').setAttribute('aria-hidden', 'true');
  $('queueBackdrop').classList.remove('open');
}
function toggleQueue() { queueOpen ? closeQueue() : openQueue(); }

/* ---------------- 声场面板 ---------------- */
function eqLabel(name) {
  if (name === 'custom') return '自定义';
  return EQ_PRESET_LABELS[name] || name;
}

function buildEQ() {
  const eq = $('eq');
  eq.innerHTML = '';
  const gains = store.get('eqGains').slice();
  EQ_FREQS.forEach((f, i) => {
    const band = el('div', { class: 'eq__band' }, [
      el('input', {
        type: 'range', min: '-12', max: '12', step: '1', value: String(gains[i] || 0),
        'aria-label': `${f} Hz`,
        oninput: (e) => {
          gains[i] = +e.target.value;
          player.setEQ(gains);
          store.set({ eqPreset: 'custom' });
          $('eqPresetName').textContent = '自定义';
          markPresetActive(null);
        },
      }),
      el('span', { text: f >= 1000 ? f / 1000 + 'k' : String(f) }),
    ]);
    eq.appendChild(band);
  });
  const presetName = store.get('eqPreset') || 'flat';
  $('eqPresetName').textContent = eqLabel(presetName);
  const presets = $('eqPresets');
  presets.innerHTML = '';
  Object.keys(EQ_PRESETS).forEach((name) => {
    presets.appendChild(el('button', {
      class: 'eqp', text: eqLabel(name), 'data-preset': name,
      onclick: () => applyPreset(name),
    }));
  });
  markPresetActive(presetName === 'custom' ? null : presetName);
  player.setEQ(gains);
}

function applyPreset(name) {
  const gains = EQ_PRESETS[name].slice();
  store.set({ eqPreset: name });
  player.setEQ(gains);
  const inputs = $('eq').querySelectorAll('input');
  gains.forEach((g, i) => { if (inputs[i]) inputs[i].value = String(g); });
  $('eqPresetName').textContent = eqLabel(name);
  markPresetActive(name);
}

function markPresetActive(name) {
  $('eqPresets').querySelectorAll('.eqp').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.preset === name);
  });
}

let sleepTimer = null;
let sleepDeadline = 0;
function resetSleepUI(status = '播放结束淡出关闭') {
  if (sleepTimer) { clearInterval(sleepTimer); sleepTimer = null; }
  $('sleepStatus').textContent = status;
  $('sleepBadge').textContent = '';
  $('sleepRow').querySelectorAll('.chip').forEach((x) => x.classList.toggle('is-active', x.dataset.min === '0'));
  if (store.get('sleepMin') !== 0) store.set({ sleepMin: 0 });
}

function applySleep(min) {
  player.setSleep(min);
  $('sleepRow').querySelectorAll('.chip').forEach((x) => x.classList.toggle('is-active', Number(x.dataset.min) === min));
  if (sleepTimer) { clearInterval(sleepTimer); sleepTimer = null; }
  if (min <= 0) {
    $('sleepBadge').textContent = '';
    $('sleepStatus').textContent = '播放结束淡出关闭';
    return;
  }
  sleepDeadline = Date.now() + min * 60000;
  const tick = () => {
    const remain = Math.max(0, sleepDeadline - Date.now());
    $('sleepBadge').textContent = 'ON';
    $('sleepStatus').textContent = `还剩 ${fmtTime(Math.ceil(remain / 1000))} · 到点淡出并暂停`;
    if (remain <= 0 && sleepTimer) { clearInterval(sleepTimer); sleepTimer = null; }
  };
  tick();
  sleepTimer = setInterval(tick, 1000);
}

function setupStage() {
  buildEQ();
  $('sleepRow').querySelectorAll('.chip').forEach((c) => {
    c.addEventListener('click', () => applySleep(Number(c.dataset.min)));
  });
  const savedSleep = Number(store.get('sleepMin') || 0);
  if (savedSleep > 0) applySleep(savedSleep); else resetSleepUI();

  const accent = store.get('accent') || 'amber';
  document.documentElement.setAttribute('data-accent', accent);
  $('accents').querySelectorAll('.swatch').forEach((s) => {
    s.classList.toggle('is-active', s.dataset.accent === accent);
    s.addEventListener('click', () => {
      store.set({ accent: s.dataset.accent });
      document.documentElement.setAttribute('data-accent', s.dataset.accent);
      $('accents').querySelectorAll('.swatch').forEach((x) => x.classList.toggle('is-active', x === s));
    });
  });

  const stageOpen = !!store.get('stageOpen');
  setStage(stageOpen, false);
  $('btnStage').addEventListener('click', () => setStage(!$('app').classList.contains('stage-open')));
  $('stageClose').addEventListener('click', () => setStage(false));
}

function setStage(open, persist = true) {
  $('app').classList.toggle('stage-open', open);
  $('stage').setAttribute('aria-hidden', open ? 'false' : 'true');
  $('btnStage').classList.toggle('is-active', open);
  if (persist) store.set({ stageOpen: open });
}

/* ---------------- 播放条控件 ---------------- */
function applyShuffleUI() {
  const on = !!store.get('shuffle');
  $('btnShuffle').classList.toggle('is-on', on);
  $('btnShuffle').title = on ? '随机播放：开' : '随机播放：关';
  $('btnShuffle').setAttribute('aria-pressed', on ? 'true' : 'false');
}

function applyRepeatUI() {
  const mode = store.get('repeat') || 'all';
  $('btnRepeat').classList.toggle('is-on', mode !== 'none');
  setIcon($('btnRepeat'), mode === 'one' ? 'repeat-one' : 'repeat');
  $('btnRepeat').title = { all: '列表循环', one: '单曲循环', none: '顺序播放' }[mode];
  $('btnRepeat').setAttribute('aria-label', $('btnRepeat').title);
}

function cycleRepeat() {
  const order = ['all', 'one', 'none'];
  const cur = store.get('repeat');
  const next = order[(order.indexOf(cur) + 1) % 3];
  store.set({ repeat: next });
  applyRepeatUI();
  toast({ all: '列表循环', one: '单曲循环', none: '顺序播放' }[next]);
}

function updateVolumeUI(v = store.get('volume'), muted = store.get('muted')) {
  const vol = Math.max(0, Math.min(1, Number(v) || 0));
  const eff = muted ? 0 : vol;
  $('volFill').style.width = (eff * 100) + '%';
  $('volSlider').setAttribute('aria-valuenow', String(Math.round(eff * 100)));
  const name = muted || vol <= 0.001 ? 'volume-x' : vol < 0.45 ? 'volume-1' : 'volume';
  setIcon($('btnVol'), name);
  $('btnVol').title = muted ? '取消静音' : '静音';
}

function togglePlay() {
  if (!player.current) {
    if (player.queue.length) player.playAt(0);
    else toast('先选择一首歌曲');
    return;
  }
  player.toggle();
}

function toggleCurrentFav() {
  if (!player.current) return toast('先播放一首歌曲');
  const on = store.toggleFav(player.current);
  updateFavButtons();
  syncFavRows();
  toast(on ? '已收藏' : '已取消收藏');
}

function bindRange(node, onRatio, { keyboard = null } = {}) {
  if (!node) return;
  let dragging = false;
  const ratioFrom = (e) => {
    const r = node.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
  };
  const apply = (e) => onRatio(ratioFrom(e));
  node.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    node.classList.add('is-dragging');
    try { node.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    apply(e);
  });
  node.addEventListener('pointermove', (e) => { if (dragging) apply(e); });
  const end = () => { dragging = false; node.classList.remove('is-dragging'); };
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('lostpointercapture', end);
  node.addEventListener('keydown', (e) => {
    if (!keyboard) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); keyboard(1); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); keyboard(-1); }
  });
}

function bindControls() {
  $('btnPlay').onclick = togglePlay;
  $('npPlay').onclick = togglePlay;
  $('btnNext').onclick = () => { if (!player.queue.length) return toast('播放队列为空'); player.next(); };
  $('npNext').onclick = $('btnNext').onclick;
  $('btnPrev').onclick = () => { if (!player.queue.length) return toast('播放队列为空'); player.prev(); };
  $('npPrev').onclick = $('btnPrev').onclick;

  $('btnShuffle').onclick = () => {
    const v = !store.get('shuffle');
    store.set({ shuffle: v });
    applyShuffleUI();
    toast(v ? '随机播放已开启' : '随机播放已关闭');
  };
  $('btnRepeat').onclick = cycleRepeat;

  bindRange($('seek'), (r) => player.seekRatio(r), { keyboard: (dir) => player.seek(player.audio.currentTime + dir * 5) });
  bindRange($('npSeek'), (r) => player.seekRatio(r), { keyboard: (dir) => player.seek(player.audio.currentTime + dir * 5) });
  bindRange($('volSlider'), (r) => player.setVolume(r), {
    keyboard: (dir) => player.setVolume(Math.max(0, Math.min(1, store.get('volume') + dir * 0.05))),
  });
  $('btnVol').onclick = () => player.toggleMute();

  $('btnFav').onclick = toggleCurrentFav;
  $('npFav').onclick = toggleCurrentFav;
  $('npDownload').onclick = () => {
    if (!player.current) return toast('先播放一首歌曲');
    if (!store.get('downloadEnabled')) return toast('下载功能已在设置 → 下载设置中关闭');
    downloadTrack(player.current);
  };

  $('btnLyric').onclick = openNp;
  $('npClose').onclick = closeNp;
  $('np').addEventListener('click', (e) => {
    if (e.target === $('np') || e.target.id === 'npBg') closeNp();
  });
  $('pbCover').onclick = openNp;

  $('btnQueue').onclick = toggleQueue;
  $('npQueue').onclick = openQueue;
  $('queueClose').onclick = closeQueue;
  $('queueBackdrop').onclick = closeQueue;
  $('queueClear').onclick = () => {
    if (!player.queue.length) return toast('队列已经是空的');
    player.clearQueue();
    toast('队列已清空');
    renderQueue();
    if (currentRoute === 'mine' && mineTab === 'queue') renderMine();
  };

  $('btnMini').onclick = toggleMini;
  $('btnMini2').onclick = toggleMini;
  $('brandBtn').onclick = () => navigate('discover');
  $('titleNp').onclick = openNp;

  if (window.gm) {
    $('btnMin').onclick = () => window.gm.minimize();
    $('btnMax').onclick = async () => { await window.gm.maximize(); setTimeout(syncMaxIcon, 120); };
    $('btnClose').onclick = () => window.gm.close();
    $('titlebarDrag').addEventListener('dblclick', () => window.gm.maximize());
    window.gm.onControl?.((action) => {
      if (action === 'toggle') togglePlay();
      else if (action === 'next') player.next();
      else if (action === 'prev') player.prev();
    });
    window.gm.onMaxState?.((max) => setMaxIcon(max));
    syncMaxIcon();
  }

  document.querySelectorAll('.nav__item').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.route)));
  document.querySelectorAll('.pill').forEach((b) => b.addEventListener('click', () => openMood(b.dataset.mood)));

  // 侧边栏账号：未登录时点击 = 打开扫码登录，已登录时点击 = 账号菜单
  const accountBtn = $('accountBtn');
  if (accountBtn) {
    accountBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const r = accountBtn.getBoundingClientRect();
      openAccountMenu(r.right + 8, r.top);
    });
  }
  // 账号菜单里的项目通过事件回传（account.js 不依赖 app.js，避免循环引用）
  window.addEventListener('guman:navigate', (e) => {
    const { name, param } = e.detail || {};
    if (name) navigate(name, param);
  });

  // 拖拽文件时阻止浏览器打开
  ['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
    if (!e.target.closest?.('.dropzone')) e.preventDefault();
  }));

  // 首次交互时解锁 AudioContext
  const unlock = () => { if (player.ctx && player.ctx.state === 'suspended') player.ctx.resume(); };
  document.addEventListener('pointerdown', unlock, { passive: true });

  updateVolumeUI();
  applyShuffleUI();
  applyRepeatUI();
  updateQueueBadge();
}

async function syncMaxIcon() {
  if (!window.gm?.isMaximized) return;
  try { setMaxIcon(await window.gm.isMaximized()); } catch (_) { /* ignore */ }
}
function setMaxIcon(max) {
  setIcon($('btnMax'), max ? 'restore' : 'max');
  $('btnMax').title = max ? '还原' : '最大化';
  $('btnMax').setAttribute('aria-label', max ? '还原' : '最大化');
}

/* ---------------- 正在播放浮层 ---------------- */
function openNp() {
  if (!player.current) return toast('先播放一首歌曲');
  if (document.body.classList.contains('mini')) {
    toggleMini().then(() => setTimeout(openNp, 320));
    return;
  }
  closeQueue();
  $('np').classList.add('open');
  $('np').setAttribute('aria-hidden', 'false');
  lastLyricIdx = -1;
  updateLyric(player.audio.currentTime || 0);
  const active = lyricEls.find((e) => e.classList.contains('is-active'));
  if (active) requestAnimationFrame(() => active.scrollIntoView({ block: 'center' }));
}
function closeNp() {
  $('np').classList.remove('open');
  $('np').setAttribute('aria-hidden', 'true');
}

async function toggleMini() {
  closeNp();
  closeQueue();
  if (window.gm?.toggleMini) {
    try {
      const isMini = await window.gm.toggleMini();
      document.body.classList.toggle('mini', !!isMini);
      return;
    } catch (_) { /* fall through */ }
  }
  document.body.classList.toggle('mini');
}

/* ---------------- 快捷键 ---------------- */
function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName || '';
    const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || document.activeElement?.isContentEditable;
    const onSlider = document.activeElement?.getAttribute('role') === 'slider';
    const onButton = tag === 'BUTTON';

    if (e.key === 'Escape') {
      if ($('np').classList.contains('open')) { closeNp(); return; }
      if (queueOpen) { closeQueue(); return; }
      if (document.body.classList.contains('mini')) { toggleMini(); return; }
      if ($('app').classList.contains('stage-open')) { setStage(false); return; }
    }
    if (typing || onSlider) return;

    if (e.key === ' ' && !onButton) { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); player.seek(player.audio.currentTime + 5); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); player.seek(player.audio.currentTime - 5); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); player.setVolume(Math.min(1, store.get('volume') + 0.05)); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); player.setVolume(Math.max(0, store.get('volume') - 0.05)); }
    else if (e.key.toLowerCase() === 'l') openNp();
    else if (e.key.toLowerCase() === 'm') toggleMini();
    else if (e.key.toLowerCase() === 'q') toggleQueue();
    else if (e.key === '/') { e.preventDefault(); navigate('search'); }
  });
}

/* ---------------- 系统媒体键 ---------------- */
function bindMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const handlers = {
    play: () => { if (player.audio.paused) togglePlay(); },
    pause: () => player.audio.pause(),
    previoustrack: () => player.prev(),
    nexttrack: () => player.next(),
    seekbackward: () => player.seek(player.audio.currentTime - 10),
    seekforward: () => player.seek(player.audio.currentTime + 10),
    seekto: (d) => player.seek(d.seekTime),
  };
  Object.entries(handlers).forEach(([action, fn]) => {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch (_) { /* unsupported */ }
  });
}

/* ---------------- 工具 ---------------- */
function revealIn() {
  requestAnimationFrame(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
}

/* ---------------- 设置应用 ----------------
 * 设置页（settings.js）改任意选项都会广播 guman:setting { key, value }，
 * 这里统一应用到 UI / 播放器 / 主进程，做到即时生效无需重启。 */
function applySetting(key, value) {
  switch (key) {
    case 'animations':
      document.documentElement.setAttribute('data-anim', value ? 'on' : 'off');
      break;
    case 'fontScale':
      document.documentElement.setAttribute('data-fontsize', value);
      break;
    case 'accent':
      document.documentElement.setAttribute('data-accent', value);
      break;
    case 'lyricAlign':
      if ($('npLyrics')) $('npLyrics').dataset.align = value;
      break;
    case 'scaleActiveLyric':
      if ($('npLyrics')) $('npLyrics').classList.toggle('is-scale', !!value);
      break;
    case 'karaokeLyric':
    case 'lyricDragSeek':
      if (player.lyricLines.length) renderLyrics(player.lyricLines);
      break;
    case 'lyricLang':
      if (player.lyricLines.length) renderLyrics(player.lyricLines);
      pushDesktopLyric();
      break;
    case 'showSourceTag':
      document.body.classList.toggle('no-srctag', !value);
      if (currentRoute) router(); // 重渲染当前列表，刷新来源标签
      break;
    case 'downloadEnabled':
      if ($('npDownload')) $('npDownload').style.display = value ? '' : 'none';
      if (currentRoute) router();
      break;
    case 'desktopLyric':
      if (value) { window.gm?.lyricOpen?.().then(() => pushDesktopLyric()); }
      else window.gm?.lyricClose?.();
      break;
    case 'dLyricColors':
    case 'dLyricAlign':
    case 'dLyricBold':
    case 'dLyricSize':
    case 'dLyricLocked':
      pushDesktopLyricSettings();
      break;
    case 'preventSleep':
      if (!value) window.gm?.preventSleep?.(false);
      else if (!player.audio.paused) window.gm?.preventSleep?.(true);
      break;
    case 'taskbarProgress':
      if (!value) window.gm?.taskbarProgress?.(-1);
      else if (player.current) updateTaskbarProgress(player.audio.currentTime, player.duration);
      break;
    case 'windowSize':
      window.gm?.setWindowSize?.(value);
      break;
    case 'lang':
      applyLang(value);
      // 设置页由 SettingsView 一次性构建，新节点没走 revealIn() 会停在 opacity:0 看起来像整页空白
      if (currentRoute === 'settings') renderSettings();
      break;
    default:
      break;
  }
}

function applyAllSettings() {
  document.documentElement.setAttribute('data-anim', store.get('animations') ? 'on' : 'off');
  document.documentElement.setAttribute('data-fontsize', store.get('fontScale') || 'md');
  document.documentElement.setAttribute('data-accent', store.get('accent') || 'amber');
  document.body.classList.toggle('no-srctag', !store.get('showSourceTag'));
  if ($('npLyrics')) {
    $('npLyrics').dataset.align = store.get('lyricAlign') || 'center';
    $('npLyrics').classList.toggle('is-scale', store.get('scaleActiveLyric') !== false);
  }
  if ($('npDownload')) $('npDownload').style.display = store.get('downloadEnabled') ? '' : 'none';
  // 窗口尺寸预设：启动时应用（仅 Electron 环境）
  if (window.gm?.setWindowSize) window.gm.setWindowSize(store.get('windowSize') || 'md');
}

window.addEventListener('guman:setting', (e) => applySetting(e.detail?.key, e.detail?.value));

/* ---------- 任务栏进度 ---------- */
function updateTaskbarProgress(cur, dur) {
  if (!store.get('taskbarProgress') || !window.gm?.taskbarProgress) return;
  if (!dur || !isFinite(dur) || !player.current) { window.gm.taskbarProgress(-1); return; }
  window.gm.taskbarProgress(Math.max(0, Math.min(1, cur / dur)));
}

/* ---------- 桌面歌词 ---------- */
function pushDesktopLyricSettings() {
  if (!store.get('desktopLyric')) return;
  // 歌词窗口与主窗口同源共享 localStorage，设置变更后推一次当前行使样式生效
  pushDesktopLyric();
}
function pushDesktopLyric() {
  if (!store.get('desktopLyric') || !window.gm?.lyricUpdate) return;
  const lines = player.lyricLines;
  let text = '';
  let sub = '';
  if (player.current) text = player.current.name + ' — ' + (player.current.artist || '');
  if (lines.length) {
    const mode = lyricLangMode();
    const idx = activeLine(lines, player.audio.currentTime || 0);
    const cur = idx >= 0 ? lines[idx] : null;
    if (cur) { text = (mode === 'trans' && cur.trans) ? cur.trans : (cur.text || text); }
    if (cur && mode === 'both' && cur.trans) sub = cur.trans;
    else {
      const next = lines[idx + 1];
      if (next) sub = next.text || '';
    }
  }
  window.gm.lyricUpdate({ text, sub });
}

/* ---------- 下载 ---------- */
// 下载当前歌曲：取同源代理音频流 → 主进程落盘（目录为空则每次询问）
async function downloadTrack(track) {
  if (!track) return;
  if (track.source === 'local') return toast('本地文件可直接在原位置查看');
  toast(`正在准备下载《${track.name}》…`);
  try {
    // 先解析真实播放地址（音源优先，失败降级官方）
    const url = await player._resolveUrl(track, player._token);
    if (!url) throw new Error('无法获取该歌曲的下载地址');
    const res = await fetch(url);
    if (!res.ok) throw new Error('下载失败（HTTP ' + res.status + '）');
    const buf = new Uint8Array(await res.arrayBuffer());
    const naming = store.get('downloadNaming') || 'name-artist';
    const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    let base = safeName(track.name);
    if (naming === 'name-artist') base += ' - ' + safeName(track.artist);
    else if (naming === 'artist-name') base = safeName(track.artist) + ' - ' + base;
    const ext = (url.match(/\.(flac|mp3|m4a|ogg|wav|aac)(\?|$)/i) || [])[1] || 'mp3';
    const name = `${base}.${ext}`;
    const saved = await window.gm?.saveDownload?.({ name, dir: store.get('downloadDir') || '', data: Array.from(buf) });
    if (saved) toast(`已保存到：${saved}`, 4000);
  } catch (e) {
    toast('下载失败：' + (e.message || '网络异常'), 5000, 'error');
  }
}

/* ---------- 启动 ---------------- */
// 模式徽标：NCM 子进程探测最多需要 90s，启动时查一次会永远停在"离线示例"，
// 因此短轮询刷新，探测完成后自动变为"在线曲库"（绿点）。
let lastOnline = null;
async function refreshMode() {
  const m = await api.mode().catch(() => null);
  const badge = $('apiMode');
  if (!badge || !m) return;
  badge.textContent = m.online ? '在线曲库' : '离线示例';
  badge.classList.toggle('is-online', !!m.online);
  badge.title = m.online ? '已连接网易云曲库' : '网易云接口暂不可达，使用内置示例曲库';
  // 上游从不可达变为可达时，账号登录态与「能否登录」都要跟着刷新
  if (lastOnline !== m.online) { lastOnline = m.online; refreshAccount(); }
}

async function boot() {
  hydrateIcons();

  await refreshMode();
  setInterval(refreshMode, 3000);
  // 先恢复本地曲库清单，否则收藏/历史里的本地曲目会在首屏被误判为已失效
  await library.load();
  document.title = '孤男音乐 · 桌面声场';

  // 初始封面：没有播放内容时也保持视觉完整
  setCover($('pbCover'), 'guman', '');
  setCover($('npCover'), 'guman', '');
  applyLyricBg(null);

  applyAllSettings();
  // 设置页切换歌词背景后立即生效
  window.addEventListener('guman:lyricbgchange', () => applyLyricBg(player.current));
  // 桌面歌词窗口被用户关闭 → 同步设置开关
  window.gm?.onLyricClosedByUser?.(() => {
    store.set({ desktopLyric: false });
    if (settingsView) settingsView.load?.();
  });
  // 桌面歌词点击跳转
  window.gm?.onSeek?.((t) => {
    if (typeof t === 'number' && t >= 0) player.seek(t);
  });

  setupStage();
  bindControls();
  bindKeys();
  bindMediaSession();
  renderQueue();
  updateFavButtons();
  updateVolumeUI(store.get('volume'), store.get('muted'));
  window.addEventListener('guman:favchange', () => { updateFavButtons(); syncFavRows(); });
  // 登录/退出后重画首屏：每日推荐的数据源与侧栏文案都依赖登录态
  window.addEventListener('guman:accountchange', () => {
    paintAccount();
    localStorage.removeItem(DAILY_KEY);
    if (currentRoute === 'discover') renderDiscover(routeToken);
    if (currentRoute === 'mine' && mineTab === 'pin') renderMine();
  });

  // 可视化（分析器在首次播放时创建）
  player.on('trackchange', () => {
    if (player.analyser && !viz) {
      viz = createVisualizer($('viz'), player.analyser);
      viz.start();
    }
  });

  // 桌面歌词：设置开启时随启动打开
  if (store.get('desktopLyric')) {
    window.gm?.lyricOpen?.().then(() => pushDesktopLyric()).catch(() => {});
  }

  // 启动自动播放：接着播放上次的歌曲（记住播放进度开启时恢复到原位置）
  if (store.get('autoPlay')) {
    const last = store.getLastTrack();
    if (last && last.source !== 'local') {
      setTimeout(() => player.playTrack(last, [last], 0), 600);
    }
  }

  if (!location.hash) history.replaceState(null, '', '#/discover');
  await router();
  restoreScroll();
  await refreshAccount(); // 登录态决定首屏每日推荐用哪个数据源
  if (currentRoute === 'discover') renderDiscover(routeToken);
}

// 列表滚动位置记忆（列表设置 → 记住播放列表滚动位置）
const SCROLL_KEY = 'guman.scroll.v1';
function scrollMemoryKey() {
  const h = location.hash.replace(/^#\/?/, '') || 'discover';
  return h;
}
function saveScroll() {
  if (!store.get('rememberScroll')) return;
  try {
    const m = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}');
    m[scrollMemoryKey()] = $('view').scrollTop;
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(m));
  } catch (_) { /* ignore */ }
}
function restoreScroll() {
  if (!store.get('rememberScroll')) return;
  try {
    const m = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}');
    const y = m[scrollMemoryKey()];
    if (typeof y === 'number' && y > 0) requestAnimationFrame(() => { $('view').scrollTop = y; });
  } catch (_) { /* ignore */ }
}
boot();

// 调试/自动化测试钩子（控制台与 Playwright 可用）
// 调试钩子：仅开发模式（npm start / GUMAN_DEBUG=1）或无 Electron 的浏览器测试环境暴露；
// 生产打包后 window.gm.devMode === false，player/store/api 句柄不再挂到 window 上。
if (!window.gm || window.gm.devMode) window.__guman = { player, store, api };
