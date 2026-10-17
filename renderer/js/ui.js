// UI 辅助：DOM 构建、图标、封面、时间格式化、歌单/曲目渲染、空态与轻提示
import { store } from './store.js';
import { tr, tpl } from './i18n.js';

/* ---------------- DOM ---------------- */
// 布尔属性：只有为 true 时才写属性；若写入 disabled="false"，HTML 语义上按钮依然被禁用
const BOOLEAN_ATTRS = new Set(['disabled', 'checked', 'selected', 'readonly', 'required', 'multiple',
  'autofocus', 'hidden', 'open', 'default', 'reversed', 'loop', 'muted', 'controls', 'autoplay', 'novalidate']);
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === false && BOOLEAN_ATTRS.has(k)) continue; // 布尔属性不写 false
    else node.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null || c === false) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

/* ---------------- 图标 ---------------- */
const SVG_NS = 'http://www.w3.org/2000/svg';
export function icon(name, cls = 'ico') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}
export function setIcon(node, name) {
  if (!node) return;
  // 只替换直接子级图标，保留徽标、文字等其他子元素
  node.querySelectorAll(':scope > svg').forEach((s) => s.remove());
  node.insertBefore(icon(name), node.firstChild);
}
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    if (!node.querySelector(':scope > svg')) setIcon(node, node.dataset.icon);
  });
}

/* ---------------- 格式化 ---------------- */
export function fmtTime(sec) {
  if (!sec || isNaN(sec) || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtMs(ms) { return fmtTime((ms || 0) / 1000); }

function hash(str) {
  let h = 2166136261;
  for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function gradientFor(seed) {
  const h = hash(seed);
  const h1 = h % 360, h2 = (h * 7 + 130) % 360;
  return `linear-gradient(135deg, hsl(${h1} 66% 56%), hsl(${h2} 60% 36%))`;
}
export function trackKey(t) {
  if (!t) return '';
  return t.source === 'local' ? String(t.url || t.id) : String(t.id);
}

/* ---------------- 封面 ---------------- */
// 封面统一走同源代理：绕过防盗链/混合内容，与音频同一通道
export function proxyUrl(url) {
  if (!url) return '';
  if (url.startsWith('/') || url.startsWith('blob:') || url.startsWith('data:')) return url;
  return '/api/proxy?url=' + encodeURIComponent(url);
}

export function setCover(node, seed, picUrl) {
  if (!node) return;
  node.innerHTML = '';
  node.classList.remove('is-fallback');

  const applyFallback = () => {
    node.style.backgroundImage = gradientFor(seed || node.id || 'guman');
    node.classList.add('is-fallback');
    node.innerHTML = '';
    node.appendChild(el('div', { class: 'cover-fallback' }, [icon('music')]));
  };

  if (picUrl) {
    // 先用渐变占位，避免图片加载期间的空白
    node.style.backgroundImage = gradientFor(seed || node.id || 'guman');
    node.classList.add('is-fallback');
    node.appendChild(el('div', { class: 'cover-fallback' }, [icon('music')]));
    // <img> 作为加载探测器：background-image 无法感知失败，img 可以
    const probe = el('img', { class: 'cover-probe', alt: '', decoding: 'async' });
    probe.addEventListener('load', () => {
      node.style.backgroundImage = `url("${proxyUrl(picUrl)}")`;
      node.classList.remove('is-fallback');
      node.innerHTML = '';
    });
    probe.addEventListener('error', () => { probe.remove(); applyFallback(); });
    node.appendChild(probe); // 必须入文档才会发起加载
    probe.src = proxyUrl(picUrl);
  } else {
    applyFallback();
  }
  node.appendChild(el('div', { class: 'cover-noise' }));
}

// 歌单卡片封面
export function cover(seed, picUrl, className = '') {
  const c = el('div', { class: ('pl-card__cover ' + className).trim() });
  setCover(c, seed, picUrl);
  return c;
}

/* ---------------- Toast ---------------- */
let toastTimer = null;
export function toast(msg, ms = 2300, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = tr(msg);
  t.classList.toggle('is-error', type === 'error');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    t.classList.remove('is-error');
  }, ms);
}

/* ---------------- 空态 ---------------- */
export function emptyState({ iconName = 'music', title = '这里还是空的', desc = '', actions = [] } = {}) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty__ico' }, [icon(iconName)]),
    title ? el('div', { class: 'empty__title', text: title }) : null,
    desc ? el('p', { class: 'empty__desc', text: desc }) : null,
    actions.length ? el('div', { class: 'empty__actions' }, actions) : null,
  ]);
}

/* ---------------- 歌单网格 ---------------- */
export function playCountText(n) {
  if (n == null) return '';
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}

export function renderPlaylistGrid(container, playlists, onOpen) {
  container.innerHTML = '';
  if (!playlists.length) {
    container.appendChild(emptyState({ iconName: 'hall', title: '没有找到歌单', desc: '换个分类或关键词试试。' }));
    return;
  }
  playlists.forEach((pl, i) => {
    const card = el('div', {
      class: 'pl-card reveal',
      role: 'button',
      tabindex: '0',
      'aria-label': `打开歌单 ${pl.name}`,
      onclick: () => onOpen(pl),
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(pl); }
      },
    });
    card.style.transitionDelay = Math.min(i, 8) * 40 + 'ms';
    card.appendChild(cover(pl.id || pl.name, pl.picUrl));
    const playBtn = el('button', { class: 'pl-card__play', title: '打开歌单', 'aria-label': '打开歌单' }, [icon('play')]);
    playBtn.addEventListener('click', (e) => { e.stopPropagation(); onOpen(pl); });
    card.querySelector('.pl-card__cover').appendChild(playBtn);
    card.appendChild(el('div', { class: 'pl-card__name', text: pl.name }));
    card.appendChild(el('div', {
      class: 'pl-card__meta',
      text: [pl.playCount != null ? playCountText(pl.playCount) : '', pl.creator?.nickname || ''].filter(Boolean).join(' · '),
    }));
    container.appendChild(card);
  });
}

/* ---------------- 右键菜单 ---------------- */
// 桌面用户最强的肌肉记忆：曲目行 / 卡片上右键出菜单。菜单挂在 body 上，
// 这样不受列表 overflow 裁剪；点击外部、Esc、滚动、窗口失焦都立即收起。
let menuEl = null;
export function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}
export function openMenu(x, y, items = []) {
  closeMenu();
  const m = el('div', { class: 'menu open', role: 'menu' });
  items.forEach((it) => {
    if (it.sep) { m.appendChild(el('div', { class: 'menu__sep' })); return; }
    if (it.label) { m.appendChild(el('div', { class: 'menu__label', text: it.label })); return; }
    const b = el('button', {
      class: 'menu__item' + (it.danger ? ' menu__item--danger' : '') + (it.on ? ' is-on' : ''),
      role: 'menuitem',
      onclick: () => { closeMenu(); it.run?.(); },
    }, [it.iconName ? icon(it.iconName) : null, it.text]);
    m.appendChild(b);
  });
  document.body.appendChild(m);
  menuEl = m;
  // 防止溢出视口（先量尺寸再定位）
  const r = m.getBoundingClientRect();
  const px = Math.max(8, Math.min(x, window.innerWidth - r.width - 10));
  const py = Math.max(8, Math.min(y, window.innerHeight - r.height - 10));
  m.style.left = px + 'px';
  m.style.top = py + 'px';
  setTimeout(() => {
    const dismiss = (e) => { if (!m.contains(e.target)) { closeMenu(); window.removeEventListener('pointerdown', dismiss, true); } };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); }, { once: true });
    window.addEventListener('blur', closeMenu, { once: true });
    document.getElementById('view')?.addEventListener('scroll', closeMenu, { once: true, passive: true });
  }, 0);
  return m;
}

/* ---------------- 曲目列表 ---------------- */
function syncFavButton(btn, on) {
  btn.classList.toggle('is-on', on);
  btn.title = on ? '取消收藏' : '收藏';
  btn.innerHTML = '';
  btn.appendChild(icon(on ? 'heart-fill' : 'heart'));
  if (on) btn.querySelector('svg').style.fill = 'currentColor';
}

export function renderTrackList(container, tracks, {
  onPlay,
  currentId,
  currentSource,
  showAlbum = false,
  onAddQueue = null,
  onFav = null,
  onRemove = null,
  removeTitle = '删除',
  compact = false,
  onDownload = null,
  showSource = false,
  onMenu = null,
} = {}) {
  container.innerHTML = '';
  if (!tracks.length) return;
  tracks.forEach((t, i) => {
    const active = String(t.id) === String(currentId) &&
      (!currentSource || !t.source || t.source === currentSource) &&
      (currentSource || !t.source || t.source !== 'local' || String(t.id) === String(currentId));
    const row = el('div', {
      class: 'track' + (active ? ' is-active' : '') + (showAlbum ? '' : ' track--noalbum'),
      role: 'button',
      tabindex: '0',
      dataset: { trackId: String(t.id), trackSource: t.source || 'online' },
      'aria-label': `${t.name}${t.artist ? ' - ' + t.artist : ''}`,
      onclick: () => onPlay?.(t, i),
      ondblclick: (e) => {
        // 双击 = 用当前列表整体替换播放队列（列表设置可关）
        if (store.get('dblClickSwitch')) { e.preventDefault(); onPlay?.(t, i); }
      },
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPlay?.(t, i); }
      },
    });

    const idx = el('div', { class: 'track__idx' }, [
      el('span', { class: 'track__num', text: String(i + 1).padStart(2, '0') }),
      el('span', { class: 'track__playicon' }, [icon('play')]),
      el('span', { class: 'track__eq' }, [el('span'), el('span'), el('span')]),
    ]);
    row.appendChild(idx);

    row.appendChild(el('div', { class: 'track__main' }, [
      el('div', { class: 'track__title' }, [
        document.createTextNode(t.name),
        showSource ? el('span', { class: 'track__src', text: t.source === 'local' ? '本地' : '网易云' }) : null,
      ]),
      el('div', { class: 'track__artist', text: t.artist || '未知艺人' }),
    ]));

    if (showAlbum) row.appendChild(el('div', { class: 'track__album', text: t.album || '' }));

    const actions = el('div', { class: 'track__actions' });
    if (onDownload) {
      const b = el('button', { class: 'iconbtn', title: '下载这首歌', 'aria-label': '下载这首歌' }, [icon('download')]);
      b.addEventListener('click', (e) => { e.stopPropagation(); onDownload(t, i); });
      actions.appendChild(b);
    }
    if (onAddQueue) {
      const b = el('button', { class: 'iconbtn', title: '加入播放队列', 'aria-label': '加入播放队列' }, [icon('plus')]);
      b.addEventListener('click', (e) => { e.stopPropagation(); onAddQueue(t, i); });
      actions.appendChild(b);
    }
    if (onFav !== false) {
      const on = store.isFav(trackKey(t));
      const b = el('button', { class: 'iconbtn', title: '收藏', 'aria-label': '收藏' });
      b.dataset.favFor = trackKey(t);
      syncFavButton(b, on);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const now = onFav ? onFav(t) : store.toggleFav(t);
        syncFavButton(b, now);
        window.dispatchEvent(new CustomEvent('guman:favchange'));
        toast(now ? '已收藏' : '已取消收藏');
      });
      actions.appendChild(b);
    }
    if (onRemove) {
      const b = el('button', { class: 'iconbtn', title: removeTitle, 'aria-label': removeTitle }, [icon('trash')]);
      b.addEventListener('click', (e) => { e.stopPropagation(); onRemove(t, i); });
      actions.appendChild(b);
    }
    row.appendChild(actions);

    row.appendChild(el('div', { class: 'track__dur', text: fmtMs(t.duration) }));
    container.appendChild(row);
  });
}

/* ---------------- 分页 ---------------- */
// 页码序列：总页数 ≤7 全展示，否则 1 … N-1 N … last（当前页 ±1）
function pageList(page, pageCount) {
  const out = [];
  if (pageCount <= 7) {
    for (let i = 1; i <= pageCount; i++) out.push(i);
    return out;
  }
  out.push(1);
  if (page > 3) out.push('…');
  for (let i = Math.max(2, page - 1); i <= Math.min(pageCount - 1, page + 1); i++) out.push(i);
  if (page < pageCount - 2) out.push('…');
  out.push(pageCount);
  return out;
}

// 分页条：info（总数/当前页）+ 页码按钮。onChange(page) 由调用方决定翻页方式
// （服务端翻页重新请求 / 客户端切片重渲染）。
export function pager({ page = 1, pageCount = 1, total = null, unit = '项', onChange }) {
  const wrap = el('div', { class: 'pager' });
  const info = el('div', { class: 'pager__info' });
  const infoParams = total != null
    ? { n: total, unit: tr(unit), page, pages: pageCount, showPage: pageCount > 1 }
    : { page, pages: pageCount, showPage: true };
  tpl(info, total != null
    ? (pageCount > 1 ? '共 {n} {unit} · 第 {page} / {pages} 页' : '共 {n} {unit}')
    : '第 {page} / {pages} 页', infoParams);
  const btns = el('div', { class: 'pager__btns' });
  const mk = (child, p, opts = {}) => el('button', {
    class: 'pager__btn' + (opts.active ? ' is-active' : ''),
    title: opts.title || `第 ${p} 页`,
    'aria-label': opts.title || `第 ${p} 页`,
    disabled: !!opts.disabled,
    onclick: () => onChange(p),
  }, child);
  btns.appendChild(mk(icon('chevron-left'), page - 1, { disabled: page <= 1, title: '上一页' }));
  pageList(page, pageCount).forEach((p) => {
    if (p === '…') btns.appendChild(el('span', { class: 'pager__ellipsis', text: '…' }));
    else btns.appendChild(mk(String(p), p, { active: p === page }));
  });
  btns.appendChild(mk(icon('chevron-right'), page + 1, { disabled: page >= pageCount, title: '下一页' }));
  wrap.append(info, btns);
  return wrap;
}

/* ---------------- 标题区 ---------------- */
export function heading(kicker, title, sub, cta) {
  return el('div', { class: 'view-head' }, [
    el('div', {}, [
      kicker ? el('div', { class: 'kicker', text: kicker }) : null,
      el('h1', { class: 'h-title', text: title }),
      sub ? el('p', { class: 'h-sub', text: sub }) : null,
    ]),
    cta ? el('div', { class: 'view-head__cta' }, Array.isArray(cta) ? cta : [cta]) : null,
  ]);
}

export function skeletonCards(count = 6) {
  return el('div', { class: 'grid' }, Array.from({ length: count }, () => el('div', { class: 'skeleton skeleton-card' })));
}
export function skeletonRows(count = 8) {
  return el('div', { class: 'tracklist' }, Array.from({ length: count }, () => el('div', { class: 'skeleton skeleton-row' })));
}
