// 设置页：基本设置 / 音乐来源 / 播放设置 / 播放详情页 / 桌面歌词 / 列表设置 /
//         下载设置 / 网络代理 / 自定义源管理 / 快捷键 / 关于
import { api } from './api.js';
import { store } from './store.js';
import { FX_SCENES } from './player.js';
import { applyLang, currentLang } from './i18n.js';
import { el, heading, icon, toast as uiToast, emptyState } from './ui.js';

const QUALITIES = [
  { key: 'flac24bit', label: 'FLAC 24bit' },
  { key: 'flac', label: 'FLAC 无损' },
  { key: '320k', label: '320K' },
  { key: '192k', label: '192K' },
  { key: '128k', label: '128K' },
];

const PLATFORM_LABEL = {
  kw: '酷我', kg: '酷狗', tx: 'QQ', wy: '网易', mg: '咪咕', qs: '汽水', local: '本地',
};

const LYRIC_BGS = [
  { key: 'blur', label: '封面模糊' },
  { key: 'color', label: '封面主色' },
  { key: 'app', label: '应用背景' },
];

const THEMES = [
  { key: 'amber', label: '信号琥珀', color: '#ff6a2c' },
  { key: 'violet', label: '霓虹紫', color: '#8b7bff' },
  { key: 'cyan', label: '电子青', color: '#22d3d8' },
  { key: 'rose', label: '玫红', color: '#ff5470' },
];

const FONT_SIZES = [
  { key: 'xs', label: '更小' },
  { key: 's', label: '小' },
  { key: 'md', label: '标准' },
  { key: 'lg', label: '大' },
  { key: 'xl', label: '更大' },
  { key: 'xxl', label: '非常大' },
];

const WINDOW_SIZES = [
  { key: 'sm', label: '小', w: 1000, h: 680 },
  { key: 'md', label: '中', w: 1200, h: 780 },
  { key: 'lg', label: '大', w: 1360, h: 860 },
  { key: 'xl', label: '超大', w: 1560, h: 940 },
];

const LANGS = [
  { key: 'zh-CN', label: '简体中文' },
  { key: 'zh-TW', label: '繁體中文' },
  { key: 'en', label: 'English' },
];

const LYRIC_ALIGNS = [
  { key: 'left', label: '左' },
  { key: 'center', label: '中' },
  { key: 'right', label: '右' },
];

const LYRIC_LANGS = [
  { key: 'off', label: '只看原文' },
  { key: 'trans', label: '只看译文' },
  { key: 'both', label: '双语对照' },
];

const NAMINGS = [
  { key: 'name-artist', label: '歌曲名 - 艺术家' },
  { key: 'artist-name', label: '艺术家 - 歌曲名' },
  { key: 'name', label: '歌曲名' },
];

const SHORTCUTS = [
  ['空格', '播放 / 暂停'],
  ['← / →', '快退 / 快进 5 秒'],
  ['↑ / ↓', '音量 ±5%'],
  ['L', '打开歌词'],
  ['M', '迷你模式'],
  ['Q', '播放队列'],
  ['/ ', '聚焦搜索'],
  ['Esc', '关闭浮层'],
];

export class SettingsView {
  constructor(container, onToast) {
    this.container = container;
    this.onToast = onToast || uiToast;
    this.sources = [];
    this.config = { quality: store.get('sourceQuality') || 'flac', proxy: '' };
    this.installFile = null;
  }

  async init() {
    this.container.innerHTML = '';
    this.renderSkeleton();
    await Promise.all([this.load(), this.loadTranslate()]);
    // 状态行与占位符是接口回来后才写入的，首屏那次 applyLang 看不到它们
    this.refreshLang();
  }

  refreshLang() { applyLang(currentLang()); }

  // ---------- 音效：场景预设 + 空间宽度 / 混响强度 ----------
  fxRow(sec) {
    const sceneOf = () => store.get('fxScene') || 'off';
    const cards = {};
    const paint = () => {
      Object.entries(cards).forEach(([k, c]) => c.classList.toggle('is-active', k === sceneOf()));
    };

    const grid = el('div', { class: 'fx-grid' });
    Object.entries(FX_SCENES).forEach(([key, s]) => {
      const card = el('button', { type: 'button', class: 'fx-card', 'data-fx': key }, [
        el('span', { class: 'fx-card__name', text: s.label }),
        el('span', { class: 'fx-card__desc', text: s.desc }),
      ]);
      card.addEventListener('click', () => {
        store.set({ fxScene: key, fxWidth: null, fxReverb: null });
        paint();
        syncW(); syncR();
        window.dispatchEvent(new CustomEvent('guman:setting', { detail: { key: 'fxScene', value: key } }));
        this.onToast(`音效场景：${s.label}`);
      });
      cards[key] = card;
      grid.appendChild(card);
    });
    sec.appendChild(grid);

    const mkSlider = ({ key, label, min, max, step, fmt, hint }) => {
      const input = el('input', { type: 'range', min, max, step, 'aria-label': label });
      const val = el('span', { class: 'fx-slider__val' });
      const read = () => {
        const scene = FX_SCENES[sceneOf()] || FX_SCENES.off;
        const raw = store.get(key);
        return raw == null ? (key === 'fxWidth' ? scene.width : scene.wet) : Number(raw);
      };
      const sync = () => {
        const v = read();
        input.value = String(v);
        val.textContent = fmt(v);
      };
      input.addEventListener('input', () => {
        const v = Number(input.value);
        store.set({ [key]: v });
        val.textContent = fmt(v);
        window.dispatchEvent(new CustomEvent('guman:setting', { detail: { key, value: v } }));
      });
      sec.appendChild(el('div', { class: 'fx-slider' }, [
        el('div', { class: 'fx-slider__head' }, [
          el('span', { class: 'settings__item-label', text: label }),
          val,
        ]),
        input,
        el('div', { class: 'settings__item-desc', text: hint }),
      ]));
      return sync;
    };

    const syncW = mkSlider({
      key: 'fxWidth', label: '空间宽度', min: '0', max: '2', step: '0.05',
      fmt: (v) => `${Math.round(v * 100)}%`,
      hint: '100% 为原始立体声；调高拉宽声场，过高会显得中空。',
    });
    const syncR = mkSlider({
      key: 'fxReverb', label: '混响强度', min: '0', max: '1', step: '0.02',
      fmt: (v) => `${Math.round(v * 100)}%`,
      hint: '模拟房间反射；各场景自带不同默认值，可在此微调。',
    });

    const reset = el('button', { type: 'button', class: 'btn btn--small', text: '恢复场景默认' });
    reset.addEventListener('click', () => {
      store.set({ fxWidth: null, fxReverb: null });
      syncW(); syncR();
      window.dispatchEvent(new CustomEvent('guman:setting', { detail: { key: 'fxScene', value: sceneOf() } }));
      this.onToast('已恢复该场景的默认参数');
    });
    sec.appendChild(el('div', { class: 'fx-actions' }, [reset]));

    paint();
    syncW();
    syncR();
  }

  // ---------- 构建 ----------
  section(title, desc) {
    const sec = el('section', { class: 'settings__section reveal' });
    if (title) sec.appendChild(el('h2', { class: 'settings__title' }, title));
    if (desc) sec.appendChild(el('p', { class: 'settings__desc' }, desc));
    return sec;
  }

  // 开关行：自动读写 store，并广播 guman:setting 事件供全局即时生效
  toggleRow(sec, { key, label, desc = '' }) {
    const row = el('div', { class: 'settings__item' });
    const main = el('div', { class: 'settings__item-main' }, [
      el('span', { class: 'settings__item-label', text: label }),
      desc ? el('div', { class: 'settings__item-desc', text: desc }) : null,
    ]);
    const ctrl = el('div', { class: 'settings__item-ctrl' });
    const toggle = el('label', { class: 'toggle' });
    const cb = el('input', { type: 'checkbox', 'aria-label': label });
    cb.checked = !!store.get(key);
    cb.addEventListener('change', () => {
      store.set({ [key]: cb.checked });
      window.dispatchEvent(new CustomEvent('guman:setting', { detail: { key, value: cb.checked } }));
      this.onToast(`${label}已${cb.checked ? '开启' : '关闭'}`);
    });
    toggle.append(cb, el('span', { class: 'toggle__slider' }));
    ctrl.appendChild(toggle);
    row.append(main, ctrl);
    sec.appendChild(row);
    return row;
  }

  // 分段控件行
  segRow(sec, { key, label, options, desc = '' }) {
    const row = el('div', { class: 'settings__item' });
    row.appendChild(el('div', { class: 'settings__item-main' }, [
      el('span', { class: 'settings__item-label', text: label }),
      desc ? el('div', { class: 'settings__item-desc', text: desc }) : null,
    ]));
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': label });
    const cur = store.get(key);
    options.forEach((o) => {
      const b = el('button', {
        class: 'seg__btn' + (cur === o.key ? ' is-active' : ''),
        text: o.label, 'data-val': o.key,
      });
      b.addEventListener('click', () => {
        seg.querySelectorAll('.seg__btn').forEach((x) => x.classList.toggle('is-active', x === b));
        store.set({ [key]: o.key });
        window.dispatchEvent(new CustomEvent('guman:setting', { detail: { key, value: o.key } }));
        if (o.w) window.dispatchEvent(new CustomEvent('guman:setting', { detail: { key, value: o.key } }));
      });
      seg.appendChild(b);
    });
    row.appendChild(seg);
    sec.appendChild(row);
    return row;
  }

  // 下拉行
  selectRow(sec, { key, label, options, desc = '' }) {
    const row = el('div', { class: 'settings__item' });
    row.appendChild(el('div', { class: 'settings__item-main' }, [
      el('span', { class: 'settings__item-label', text: label }),
      desc ? el('div', { class: 'settings__item-desc', text: desc }) : null,
    ]));
    const sel = el('select', { class: 'settings__select', 'aria-label': label, dataset: { key } });
    options.forEach((o) => sel.appendChild(el('option', { value: o.key }, o.label)));
    sel.value = store.get(key);
    sel.addEventListener('change', () => {
      store.set({ [key]: sel.value });
      window.dispatchEvent(new CustomEvent('guman:setting', { detail: { key, value: sel.value } }));
    });
    row.appendChild(sel);
    sec.appendChild(row);
    return row;
  }

  renderSkeleton() {
    const wrap = el('div', { class: 'settings__wrap' });
    wrap.appendChild(heading('SETTINGS', '设置', '播放、外观、歌词、列表与下载，全部选项即时生效。'));

    /* ---------- 基本设置 ---------- */
    const basic = this.section('基本设置', '动画、主题、窗口与字体，随时切换即时生效。');
    this.toggleRow(basic, { key: 'animations', label: '显示动画效果', desc: '关闭后减少界面动效，低性能设备更流畅' });
    // 主题颜色
    const themeRow = el('div', { class: 'settings__item' });
    themeRow.appendChild(el('div', { class: 'settings__item-main' }, [
      el('span', { class: 'settings__item-label', text: '主题颜色' }),
      el('div', { class: 'settings__item-desc', text: '全站强调色，影响按钮、频谱、氛围光' }),
    ]));
    const themes = el('div', { class: 'settings__themes' });
    const curAccent = store.get('accent') || 'amber';
    THEMES.forEach((t) => {
      const b = el('button', {
        class: 'settings__theme' + (curAccent === t.key ? ' is-active' : ''),
        title: t.label, 'aria-label': t.label, 'data-accent': t.key,
      }, [
        el('span', { class: 'settings__theme-dot', style: `--s:${t.color}` }),
        el('span', { text: t.label }),
      ]);
      b.addEventListener('click', () => {
        store.set({ accent: t.key });
        document.documentElement.setAttribute('data-accent', t.key);
        themes.querySelectorAll('.settings__theme').forEach((x) => x.classList.toggle('is-active', x === b));
        document.querySelectorAll('#accents .swatch').forEach((s) => s.classList.toggle('is-active', s.dataset.accent === t.key));
        window.dispatchEvent(new CustomEvent('guman:setting', { detail: { key: 'accent', value: t.key } }));
        this.onToast(`主题已切换为${t.label}`);
      });
      themes.appendChild(b);
    });
    themeRow.appendChild(themes);
    basic.appendChild(themeRow);
    this.segRow(basic, { key: 'windowSize', label: '窗口尺寸', options: WINDOW_SIZES });
    this.segRow(basic, { key: 'fontScale', label: '字体大小', options: FONT_SIZES });
    this.selectRow(basic, { key: 'lang', label: '语言', options: LANGS, desc: '切换后整个界面立即转换，可随时切回' });
    wrap.appendChild(basic);

    /* ---------- 音乐来源 ---------- */
    const qualitySec = this.section('音乐来源', '搜索使用网易云元数据，播放时优先调用下方已启用的自定义音源获取真实链接；失败会自动降级到官方接口。');
    const qualityRow = el('div', { class: 'settings__row' });
    qualityRow.appendChild(el('span', { class: 'settings__label' }, '默认音质'));
    this.qualitySelect = el('select', { class: 'settings__select', 'aria-label': '默认音质' });
    QUALITIES.forEach((q) => this.qualitySelect.appendChild(el('option', { value: q.key }, q.label)));
    this.qualitySelect.value = this.config.quality;
    this.qualitySelect.addEventListener('change', () => this.onQualityChange());
    qualityRow.appendChild(this.qualitySelect);
    qualitySec.appendChild(qualityRow);
    const bgRow = el('div', { class: 'settings__row', style: 'margin-top:10px' });
    bgRow.appendChild(el('span', { class: 'settings__label' }, '歌词页背景'));
    this.lyricBgSelect = el('select', { class: 'settings__select', 'aria-label': '歌词页背景' });
    LYRIC_BGS.forEach((b) => this.lyricBgSelect.appendChild(el('option', { value: b.key }, b.label)));
    this.lyricBgSelect.value = store.get('lyricBg') || 'blur';
    this.lyricBgSelect.addEventListener('change', () => this.onLyricBgChange());
    bgRow.appendChild(this.lyricBgSelect);
    qualitySec.appendChild(bgRow);
    wrap.appendChild(qualitySec);

    /* ---------- 播放设置 ---------- */
    const play = this.section('播放设置');
    this.toggleRow(play, { key: 'autoPlay', label: '启动软件后自动播放音乐', desc: '启动时自动接着播放上次的歌曲' });
    this.toggleRow(play, { key: 'preventSleep', label: '播放歌曲时阻止电脑休眠', desc: '播放期间系统不会进入睡眠' });
    this.toggleRow(play, { key: 'rememberProgress', label: '记住播放进度', desc: '再次播放同一首歌时恢复到上次位置' });
    this.toggleRow(play, { key: 'errorAutoNext', label: '播放错误时自动切换歌曲', desc: '取链或播放失败时自动播放下一首' });
    this.toggleRow(play, { key: 'karaokeLyric', label: '使用卡拉OK样式歌词播放', desc: '已播放的歌词逐字高亮' });
    this.toggleRow(play, { key: 'taskbarProgress', label: '在任务栏上显示当前歌曲播放进度', desc: 'Windows 任务栏图标显示播放进度' });
    wrap.appendChild(play);

    /* ---------- 音效（空间音频 / 场景预设） ---------- */
    const fx = this.section('音效', '空间音频与场景预设直接作用于 Web Audio 音频链，播放中即时生效；与上面的 10 段均衡器叠加使用。');
    this.fxRow(fx);
    wrap.appendChild(fx);

    /* ---------- 播放详情页设置 ---------- */
    const npSet = this.section('播放详情页设置', '点击播放条封面打开的歌词大页。');
    this.toggleRow(npSet, { key: 'scaleActiveLyric', label: '缩放当前正在播放的歌曲', desc: '当前歌词行放大，其余行淡出' });
    this.toggleRow(npSet, { key: 'delayLyricScroll', label: '延迟歌词滚动', desc: '歌词稍晚跟随播放进度，适合跟唱' });
    this.toggleRow(npSet, { key: 'lyricDragSeek', label: '允许通过拖拽歌词调整播放进度', desc: '上下拖拽歌词行快进/快退' });
    this.segRow(npSet, { key: 'lyricAlign', label: '歌词对齐方式', options: LYRIC_ALIGNS });
    wrap.appendChild(npSet);

    /* ---------- 歌词翻译 ---------- */
    const transSec = this.section('歌词翻译', '优先使用网易云自带的官方译文；没有译文时，点歌词页的「翻译这首歌」才会调用你配置的模型，不会自动发起外部请求。');
    this.selectRow(transSec, { key: 'lyricLang', label: '歌词显示', options: LYRIC_LANGS, desc: '译文按界面语言生成：简体/繁体界面译成中文，英文界面译成英文' });
    const trRow = el('div', { class: 'settings__addrow settings__keyrow' });
    this.trBaseInput = el('input', { class: 'settings__input', type: 'text', spellcheck: 'false', placeholder: 'https://api.openai.com/v1', 'aria-label': '翻译服务地址' });
    this.trKeyInput = el('input', { class: 'settings__input', type: 'password', spellcheck: 'false', placeholder: 'API Key', 'aria-label': '翻译服务密钥' });
    this.trModelInput = el('input', { class: 'settings__input', type: 'text', spellcheck: 'false', placeholder: '模型名，如 gpt-4o-mini', 'aria-label': '翻译模型' });
    trRow.append(this.trBaseInput, this.trKeyInput, this.trModelInput);
    trRow.appendChild(el('button', { class: 'btn btn--primary', onclick: () => this.onSaveTranslate() }, [icon('check'), '保存翻译服务']));
    transSec.appendChild(trRow);
    this.trStatus = el('p', { class: 'settings__desc settings__proxystatus' });
    transSec.appendChild(this.trStatus);
    wrap.appendChild(transSec);

    /* ---------- 桌面歌词 ---------- */
    const dl = this.section('桌面歌词', '在桌面上显示一层置顶歌词，可锁定位置。');
    this.toggleRow(dl, { key: 'desktopLyric', label: '显示桌面歌词', desc: '在屏幕底部显示置顶歌词窗口' });
    // 歌词字体颜色
    const colorRow = el('div', { class: 'settings__item' });
    colorRow.appendChild(el('div', { class: 'settings__item-main' }, [
      el('span', { class: 'settings__item-label', text: '歌词字体颜色' }),
      el('div', { class: 'settings__item-desc', text: '未播放 / 已播放 / 阴影颜色' }),
    ]));
    const colorCtrl = el('div', { class: 'settings__item-ctrl' });
    this.dColorInputs = [];
    ['未播放', '已播放', '阴影'].forEach((name, i) => {
      const cur = (store.get('dLyricColors') || [])[i];
      const inp = el('input', { class: 'colorchip', type: 'color', 'aria-label': `${name}颜色`, value: toHex(cur) || '#ffffff' });
      inp.addEventListener('input', () => {
        const arr = (store.get('dLyricColors') || []).slice();
        arr[i] = inp.value;
        store.set({ dLyricColors: arr });
        window.dispatchEvent(new CustomEvent('guman:setting', { detail: { key: 'dLyricColors', value: arr } }));
      });
      this.dColorInputs.push(inp);
      colorCtrl.appendChild(inp);
    });
    colorRow.appendChild(colorCtrl);
    dl.appendChild(colorRow);
    this.segRow(dl, { key: 'dLyricAlign', label: '桌面歌词对齐方式', options: LYRIC_ALIGNS });
    this.toggleRow(dl, { key: 'dLyricBold', label: '桌面歌词加粗' });
    // 桌面歌词字号
    const sizeRow = el('div', { class: 'settings__item' });
    sizeRow.appendChild(el('div', { class: 'settings__item-main' }, [
      el('span', { class: 'settings__item-label', text: '桌面歌词字号' }),
      el('div', { class: 'settings__item-desc', text: '当前 ' + (store.get('dLyricSize') || 34) + ' px' }),
    ]));
    this.dSizeLabel = sizeRow.querySelector('.settings__item-desc');
    const sizeRange = el('input', {
      type: 'range', min: '20', max: '64', step: '1', value: String(store.get('dLyricSize') || 34),
      style: 'width:150px', 'aria-label': '桌面歌词字号',
    });
    sizeRange.addEventListener('input', () => {
      const v = Number(sizeRange.value);
      store.set({ dLyricSize: v });
      if (this.dSizeLabel) this.dSizeLabel.textContent = `当前 ${v} px`;
      window.dispatchEvent(new CustomEvent('guman:setting', { detail: { key: 'dLyricSize', value: v } }));
    });
    sizeRow.appendChild(sizeRange);
    dl.appendChild(sizeRow);
    this.toggleRow(dl, { key: 'dLyricLocked', label: '锁定桌面歌词', desc: '锁定后鼠标事件穿透，不会挡住桌面操作' });
    wrap.appendChild(dl);

    /* ---------- 列表设置 ---------- */
    const listSet = this.section('列表设置');
    this.toggleRow(listSet, { key: 'showSourceTag', label: '显示歌曲来源平台', desc: '在曲目名后标注来源平台' });
    this.toggleRow(listSet, { key: 'rememberScroll', label: '记住播放列表滚动位置', desc: '返回列表时恢复上次浏览位置' });
    this.toggleRow(listSet, { key: 'dblClickSwitch', label: '双击列表里的歌曲时自动切换到当前列表播放', desc: '双击直接用当前列表替换播放队列' });
    this.segRow(listSet, { key: 'addToQueuePos', label: '添加歌曲到播放列表的位置', options: [{ key: 'top', label: '顶部' }, { key: 'bottom', label: '底部' }] });
    wrap.appendChild(listSet);

    /* ---------- 下载设置 ---------- */
    const down = this.section('下载设置', '把在线歌曲保存到本地，文件名按下方规则生成。');
    this.toggleRow(down, { key: 'downloadEnabled', label: '启用下载功能', desc: '在曲目行与歌词页显示下载按钮' });
    const pathRow = el('div', { class: 'settings__item' });
    pathRow.appendChild(el('div', { class: 'settings__item-main' }, [
      el('span', { class: 'settings__item-label', text: '下载路径' }),
      el('div', { class: 'settings__item-desc', text: '留空则每次下载时询问保存位置' }),
    ]));
    this.pathVal = el('div', { class: 'settings__pathval', text: store.get('downloadDir') || '未设置（每次询问）' });
    const pathBtn = el('button', { class: 'btn btn--small', onclick: () => this.onPickDir() }, [icon('folder-plus'), '更改']);
    const pathClear = el('button', { class: 'btn btn--small', onclick: () => { store.set({ downloadDir: '' }); this.pathVal.textContent = '未设置（每次询问）'; this.onToast('已恢复每次询问'); } }, '恢复询问');
    pathRow.append(el('div', { class: 'settings__item-ctrl' }, [this.pathVal, pathBtn, pathClear]));
    down.appendChild(pathRow);
    this.segRow(down, { key: 'downloadNaming', label: '文件命名方式', options: NAMINGS });
    wrap.appendChild(down);

    /* ---------- 网络代理（用户自定义，默认不走代理） ---------- */
    const proxySec = this.section('网络代理', '音源的网络请求默认直连，不读取系统代理。仅当你的网络必须通过代理才能访问音源接口时，才需要填写；保存后立即生效，无需重启。');
    const proxyRow = el('div', { class: 'settings__addrow' });
    this.proxyInput = el('input', {
      class: 'settings__input', type: 'text', spellcheck: 'false',
      placeholder: 'http://127.0.0.1:7890（留空 = 不使用代理）', 'aria-label': '网络代理地址',
    });
    proxyRow.appendChild(this.proxyInput);
    this.proxySaveBtn = el('button', { class: 'btn btn--primary', onclick: () => this.onSaveProxy() }, [icon('check'), '保存代理']);
    proxyRow.appendChild(this.proxySaveBtn);
    proxySec.appendChild(proxyRow);
    this.proxyStatus = el('p', { class: 'settings__desc settings__proxystatus' });
    proxySec.appendChild(this.proxyStatus);
    wrap.appendChild(proxySec);

    /* ---------- 音源管理 ---------- */
    const sourceSec = this.section('自定义源管理', '兼容 LX Music 自定义音源脚本。导入后启用，播放时会优先用音源取链；全部失败才降级官方接口。');
    const addRow = el('div', { class: 'settings__addrow' });
    this.urlInput = el('input', { class: 'settings__input', type: 'url', placeholder: '输入音源脚本 URL（如 https://…/xxx.js）', 'aria-label': '音源脚本 URL' });
    addRow.appendChild(this.urlInput);
    this.urlInstallBtn = el('button', { class: 'btn btn--primary', onclick: () => this.onInstallUrl() }, [icon('link'), '从 URL 安装']);
    addRow.appendChild(this.urlInstallBtn);
    this.fileInstallBtn = el('button', { class: 'btn', onclick: () => this.onImportFile() }, [icon('upload'), '导入本地 .js']);
    addRow.appendChild(this.fileInstallBtn);
    sourceSec.appendChild(addRow);
    this.sourceList = el('div', { class: 'settings__sourcelist' });
    this.sourceList.appendChild(el('div', { class: 'settings__empty' }, '正在读取音源…'));
    sourceSec.appendChild(this.sourceList);
    wrap.appendChild(sourceSec);

    /* ---------- 播放与快捷键 ---------- */
    const helpSec = this.section('播放与快捷键', '支持系统媒体键与托盘控制。以下快捷键在非输入状态下生效。');
    SHORTCUTS.forEach(([key, desc]) => {
      helpSec.appendChild(el('div', { class: 'settings__item' }, [
        el('span', { class: 'meta-chip', text: key }),
        el('span', { class: 'settings__label', text: desc }),
      ]));
    });
    wrap.appendChild(helpSec);

    /* ---------- 关于 ---------- */
    const aboutSec = this.section('关于');
    const modeText = api.lastMode === 'online' ? '在线曲库（网易云）' : '离线示例曲库';
    // 版本号以 package.json 为单一来源（preload 暴露 app.getVersion()）
    const ver = (window.gm && window.gm.appVersion) || '1.0.0';
    aboutSec.appendChild(el('p', { class: 'settings__desc' }, `孤男音乐 · 桌面声场 v${ver} · 当前模式：${modeText}。`));
    aboutSec.appendChild(el('p', { class: 'settings__desc' }, '在线曲库依赖第三方接口，仅供学习研究；本地音乐与自定义音源均在本机处理。'));
    if (window.gm && window.gm.electronVersion) {
      aboutSec.appendChild(el('p', { class: 'settings__desc' }, `Electron ${window.gm.electronVersion} · 运行模式：${window.gm.devMode ? '开发' : '生产'}`));
    }
    // 日志目录：故障诊断时排查用
    const logRow = el('div', { class: 'settings__item' }, [
      el('div', { class: 'settings__item-main' }, [
        el('div', { class: 'settings__item-label', text: '日志目录' }),
        el('div', { class: 'settings__item-desc', text: '运行日志仅保存在本机，排查故障时提供给开发者' }),
      ]),
      el('div', { class: 'settings__item-ctrl' }, [
        el('button', {
          class: 'btn btn--small',
          onclick: () => { if (window.gm && window.gm.openLogDir) window.gm.openLogDir(); },
        }, [icon('folder'), '打开']),
      ]),
    ]);
    aboutSec.appendChild(logRow);
    wrap.appendChild(aboutSec);

    this.container.appendChild(wrap);
  }

  async load() {
    try {
      const { list, config } = await api.sources();
      this.sources = list || [];
      this.config = config || this.config;
      api.invalidateSources();
      if (this.qualitySelect) this.qualitySelect.value = this.config.quality || 'flac';
      if (this.proxyInput) this.proxyInput.value = this.config.proxy || '';
      this.renderProxyStatus();
      this.renderSources();
    } catch (e) {
      this.sourceList.innerHTML = '';
      this.sourceList.appendChild(emptyState({
        iconName: 'alert', title: '音源列表加载失败', desc: e.message,
        actions: [el('button', { class: 'btn btn--small', onclick: () => this.load() }, [icon('refresh'), '重试'])],
      }));
    }
  }

  renderTranslateStatus() {
    if (!this.trStatus) return;
    const c = this.translateCfg;
    this.trStatus.textContent = c && c.configured
      ? `当前状态：已配置 ${c.model}（密钥只保存在本机用户目录，不会下发到界面）`
      : '当前状态：未配置翻译服务，只有网易云自带译文的歌曲能显示译文';
  }

  async loadTranslate() {
    try {
      const c = await api.translateState();
      this.translateCfg = c || null;
      if (this.trBaseInput) this.trBaseInput.value = (c && c.baseUrl) || '';
      if (this.trModelInput) this.trModelInput.value = (c && c.model) || '';
      if (this.trKeyInput) this.trKeyInput.placeholder = c && c.configured ? '已保存（留空则不修改）' : 'API Key';
      this.renderTranslateStatus();
    } catch (_) { /* 探测失败不影响设置页其余部分 */ }
  }

  async onSaveTranslate() {
    const base = this.trBaseInput.value.trim();
    const key = this.trKeyInput.value.trim();
    const model = this.trModelInput.value.trim();
    if (!base || !model) return this.onToast('请填写服务地址与模型名');
    if (!key && !(this.translateCfg && this.translateCfg.configured)) return this.onToast('请填写 API Key');
    try {
      const saved = await api.translateSave({ baseUrl: base, model, apiKey: key || undefined });
      this.translateCfg = saved;
      this.trKeyInput.value = '';
      this.renderTranslateStatus();
      this.onToast('翻译服务已保存');
    } catch (e) {
      this.onToast('保存失败：' + e.message);
    }
  }

  renderSources() {
    this.sourceList.innerHTML = '';
    if (!this.sources.length) {
      this.sourceList.appendChild(emptyState({
        iconName: 'link', title: '暂无自定义音源',
        desc: '导入本地 .js 或从 URL 安装音源脚本。未安装时仍可使用官方接口或离线示例。',
      }));
      return;
    }
    this.sources.forEach((s) => {
      const platforms = Object.entries(s.sources || {})
        .filter(([, v]) => v.qualitys && v.qualitys.length)
        .map(([k]) => PLATFORM_LABEL[k] || k)
        .join(' · ');
      const card = el('div', { class: 'sourcecard' + (s.enabled ? '' : ' is-disabled') });
      const head = el('div', { class: 'sourcecard__head' });
      head.appendChild(el('div', { class: 'sourcecard__name' }, s.name));
      const meta = el('div', { class: 'sourcecard__meta' });
      if (s.version) meta.appendChild(el('span', {}, `v${s.version}`));
      if (s.author) meta.appendChild(el('span', {}, s.author));
      if (platforms) meta.appendChild(el('span', { class: 'sourcecard__platforms' }, platforms));
      if (s.error) meta.appendChild(el('span', { class: 'sourcecard__error' }, [icon('alert'), '初始化失败']));
      head.appendChild(meta);
      card.appendChild(head);

      if (s.description) card.appendChild(el('div', { class: 'sourcecard__desc' }, s.description));

      const actions = el('div', { class: 'sourcecard__actions' });
      const toggle = el('label', { class: 'toggle' });
      const cb = el('input', { type: 'checkbox', 'aria-label': `启用 ${s.name}` });
      cb.checked = !!s.enabled;
      cb.addEventListener('change', () => this.onToggle(s.id, cb.checked));
      toggle.appendChild(cb);
      toggle.appendChild(el('span', { class: 'toggle__slider' }));
      actions.appendChild(toggle);
      actions.appendChild(el('span', { class: 'muted', text: s.enabled ? '已启用' : '已停用' }));
      actions.appendChild(el('button', { class: 'btn btn--small btn--danger', onclick: () => this.onRemove(s.id) }, [icon('trash'), '删除']));
      card.appendChild(actions);

      this.sourceList.appendChild(card);
    });
  }

  async onQualityChange() {
    const q = this.qualitySelect.value;
    try {
      await api.setQuality(q);
      store.set({ sourceQuality: q });
      this.onToast(`默认音质已设为 ${QUALITIES.find((x) => x.key === q)?.label || q}`);
    } catch (e) {
      this.onToast('设置音质失败：' + e.message);
    }
  }

  onLyricBgChange() {
    const v = this.lyricBgSelect.value;
    store.set({ lyricBg: v });
    window.dispatchEvent(new Event('guman:lyricbgchange'));
    this.onToast(`歌词背景已设为 ${LYRIC_BGS.find((x) => x.key === v)?.label || v}`);
  }

  async onPickDir() {
    if (!window.gm?.pickDownloadDir) return this.onToast('当前环境不支持选择目录');
    try {
      const dir = await window.gm.pickDownloadDir();
      if (!dir) return;
      store.set({ downloadDir: dir });
      this.pathVal.textContent = dir;
      this.onToast('下载路径已设置');
    } catch (e) {
      this.onToast('选择目录失败：' + e.message);
    }
  }

  renderProxyStatus() {
    if (!this.proxyStatus) return;
    const p = this.config.proxy;
    this.proxyStatus.textContent = p
      ? `当前状态：已启用代理 ${p}（音源网络请求将经过该代理）`
      : '当前状态：未使用代理，音源请求直连';
  }

  async onSaveProxy() {
    const v = this.proxyInput.value.trim();
    this.proxySaveBtn.disabled = true;
    try {
      const r = await api.setProxy(v);
      this.config.proxy = r.proxy || '';
      this.renderProxyStatus();
      this.onToast(v ? `已启用代理：${r.proxy}` : '已关闭代理（恢复直连）');
    } catch (e) {
      this.onToast('保存失败：' + e.message);
    } finally {
      this.proxySaveBtn.disabled = false;
    }
  }

  async onImportFile() {
    if (window.gm?.openFileDialog) {
      try {
        const fp = await window.gm.openFileDialog({ filters: [{ name: '音源脚本', extensions: ['js'] }] });
        if (!fp) return;
        this.onToast('正在导入音源…');
        const r = await api.loadSource({ path: fp });
        this.mergeSource(r);
        this.onToast(`已导入「${r.name}」`);
      } catch (e) {
        this.onToast('导入失败：' + e.message);
      }
      return;
    }
    if (!this.installFile) {
      this.installFile = el('input', { type: 'file', accept: '.js,text/javascript', style: 'display:none' });
      this.installFile.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
          this.onToast('正在导入音源…');
          const code = await file.text();
          const r = await api.loadSource({ code });
          this.mergeSource(r);
          this.onToast(`已导入「${r.name}」`);
        } catch (err) {
          this.onToast('导入失败：' + err.message);
        }
      });
      document.body.appendChild(this.installFile);
    }
    this.installFile.click();
  }

  async onInstallUrl() {
    const url = this.urlInput.value.trim();
    if (!url) return this.onToast('请输入音源脚本 URL');
    if (!/^https?:\/\//i.test(url)) return this.onToast('URL 需以 http(s):// 开头');
    this.urlInstallBtn.disabled = true;
    const oldHTML = this.urlInstallBtn.innerHTML;
    this.urlInstallBtn.textContent = '正在下载…';
    try {
      const r = await api.loadSource({ url });
      this.mergeSource(r);
      this.urlInput.value = '';
      this.onToast(`已安装「${r.name}」`);
    } catch (e) {
      this.onToast('安装失败：' + e.message);
    } finally {
      this.urlInstallBtn.disabled = false;
      this.urlInstallBtn.innerHTML = oldHTML;
    }
  }

  mergeSource(r) {
    this.sources = this.sources.filter((s) => s.id !== r.id).concat(r);
    api.invalidateSources();
    this.renderSources();
  }

  async onToggle(id, enabled) {
    try {
      const r = await api.toggleSource(id, enabled);
      const idx = this.sources.findIndex((s) => s.id === r.id);
      if (idx >= 0) this.sources[idx] = r;
      api.invalidateSources();
      this.renderSources();
      this.onToast(enabled ? '音源已启用' : '音源已停用');
    } catch (e) {
      this.onToast('切换失败：' + e.message);
      this.load();
    }
  }

  async onRemove(id) {
    if (!confirm('确定删除这个音源？')) return;
    try {
      await api.removeSource(id);
      this.sources = this.sources.filter((s) => s.id !== id);
      api.invalidateSources();
      this.renderSources();
      this.onToast('已删除');
    } catch (e) {
      this.onToast('删除失败：' + e.message);
    }
  }
}

// 颜色输入框只接受 #rrggbb；设置里可能存了 rgba()，统一转 hex
function toHex(c) {
  if (!c) return '';
  if (c.startsWith('#')) return c.slice(0, 7);
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return '';
  const [r, g, b] = m[1].split(',').map((x) => parseInt(x, 10));
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
