// 播放引擎：Web Audio 队列播放、图形均衡器、实时分析、睡眠淡出、队列管理
import { api } from './api.js';
import { parseLRC, attachTranslation } from './lyrics.js';
import { store, EQ_FREQS } from './store.js';
import { trackKey } from './ui.js';
import { accountState } from './account.js';

// 音效场景预设：bass 低音增益(dB) / width 立体声宽度倍数 / wet 混响量 / comp 压缩强度(0-1)
export const FX_SCENES = {
  off: { label: '关闭', desc: '原始音频直通，不做任何染色', bass: 0, width: 1, wet: 0, comp: 0 },
  studio: { label: '录音室', desc: '干净紧致的监听感，几乎无混响', bass: 0, width: 1.05, wet: 0.04, comp: 0.18 },
  live: { label: '现场', desc: '厅堂混响 + 更宽声场，像站在台下', bass: 2, width: 1.3, wet: 0.24, comp: 0.22 },
  headphone: { label: '耳机', desc: '强化低频与声场包裹感，适合入耳式', bass: 4.5, width: 1.55, wet: 0.12, comp: 0.12 },
  night: { label: '夜间', desc: '收窄动态范围，深夜不炸耳', bass: -3, width: 1, wet: 0.06, comp: 0.7 },
};

// 平台直链的扩展名 → MIME：酷狗常返回 application/octet-stream，需由代理层纠正
const AUDIO_CT = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', flac: 'audio/flac',
  aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg',
};

export class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous';
    this.audio.volume = 1; // 音量统一由 Web Audio gain 控制，避免双重衰减
    this.ctx = null; this.source = null; this.analyser = null; this.gain = null; this.eqNodes = [];
    this.eqGains = store.get('eqGains').slice();
    this.queue = []; this.index = -1; this.current = null; this.lyricLines = [];
    this.listeners = {};
    this.sleepTimer = null;
    this._token = 0;
    this._scrobbled = false;
    this._wireAudio();
  }

  on(ev, cb) { (this.listeners[ev] = this.listeners[ev] || []).push(cb); return this; }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach((cb) => { try { cb(...a); } catch (e) { console.error(e); } }); }

  _wireAudio() {
    this.audio.addEventListener('timeupdate', () => {
      this.emit('time', this.audio.currentTime, this.duration);
      this._updatePositionState();
      this._saveProgress();
      this._maybeScrobble();
    });
    this.audio.addEventListener('loadedmetadata', () => {
      this.emit('time', this.audio.currentTime, this.duration);
    });
    this.audio.addEventListener('play', () => {
      this.emit('playstate', true);
      this._setPreventSleep(true);
    });
    this.audio.addEventListener('pause', () => {
      this.emit('playstate', false);
      this._setPreventSleep(false);
    });
    this.audio.addEventListener('ended', () => {
      this._reportScrobble(); // 播完补报一次，覆盖时长不足阈值的短歌
      this._onEnded();
    });
    this.audio.addEventListener('error', () => {
      if (this.audio.error) {
        const name = this.current?.name ? `《${this.current.name}》` : '';
        this._failWith(`${name}音频加载失败（链接可能已失效），试试下一首`);
      }
    });
  }

  // 播放失败统一入口：提示 + （可选）自动切下一首
  _failWith(msg) {
    this.emit('loading', false);
    this.emit('error', msg);
    if (store.get('errorAutoNext') && this.queue.length > 1) {
      // 稍等再切，避免错误提示被立刻刷掉
      setTimeout(() => { if (!this.audio.src || this.audio.error) this.next(true); }, 800);
    }
  }

  // 电源阻止：播放中阻止系统休眠（Electron 主进程）
  _setPreventSleep(on) {
    if (!store.get('preventSleep')) return;
    try { window.gm?.preventSleep?.(!!on); } catch (_) { /* ignore */ }
  }

  // 播放进度记忆（每 5 秒落盘一次）
  _saveProgress() {
    if (!store.get('rememberProgress') || !this.current) return;
    const now = Date.now();
    if (now - (this._progSavedAt || 0) < 5000) return;
    this._progSavedAt = now;
    store.setProgress(trackKey(this.current), this.audio.currentTime || 0);
  }

  /**
   * 听歌记录回写：让网易云端的每日推荐吃到本地收听行为。
   * 阈值取"过半或满 4 分钟"，切歌秒退不算有效收听；本地文件与未登录不上报。
   */
  _maybeScrobble() {
    if (this._scrobbled || !this._scrobbleReady()) return;
    const d = this.duration;
    const need = d ? Math.max(30, Math.min(d / 2, 240)) : 30;
    if ((this.audio.currentTime || 0) >= need) this._reportScrobble();
  }

  _scrobbleReady() {
    const t = this.current;
    if (!t || t.source === 'local' || !/^\d+$/.test(String(t.id))) return false;
    return accountState().loggedIn;
  }

  async _reportScrobble() {
    if (this._scrobbled) return; // 每首只报一次：达标上报过后，播完不再重复
    if (!this._scrobbleReady()) return;
    this._scrobbled = true; // 尽力而为：失败也不重试，避免每 250ms 的 timeupdate 打爆接口
    const t = this.current;
    const played = Math.round(this.audio.currentTime || this.duration / 2 || 30);
    try { await api.scrobble(t.id, played, t.id); }
    catch (_) { /* 上报失败静默，不打断播放 */ }
  }

  get duration() {
    if (this.audio.duration && isFinite(this.audio.duration)) return this.audio.duration;
    return this.current?.duration ? this.current.duration / 1000 : 0;
  }

  _ensureCtx() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.source = this.ctx.createMediaElementSource(this.audio);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this._targetGain();

    // 音频链：source → 低音增强 → 10 段 EQ → M/S 宽度 → 干/湿(混响) → 压缩 → 分析 → 主音量 → 输出
    this.bassNode = this.ctx.createBiquadFilter();
    this.bassNode.type = 'lowshelf';
    this.bassNode.frequency.value = 160;
    this.bassNode.gain.value = 0;

    let node = this.source;
    node.connect(this.bassNode);
    node = this.bassNode;
    this.eqNodes = [];
    EQ_FREQS.forEach((f, i) => {
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'peaking'; bp.frequency.value = f; bp.Q.value = 1.0; bp.gain.value = this.eqGains[i] || 0;
      node.connect(bp); node = bp; this.eqNodes.push(bp);
    });

    // M/S 矩阵：M=(L+R)/2, S=(L-R)/2，输出 L'=M+S·w、R'=M−S·w。
    // w=1 时完全还原原始立体声，>1 拉宽声场，<1 收窄。
    this.splitter = this.ctx.createChannelSplitter(2);
    node.connect(this.splitter);
    this.midSum = this.ctx.createGain();
    this.sideSum = this.ctx.createGain();
    const lMid = this.ctx.createGain(); lMid.gain.value = 0.5;
    const rMid = this.ctx.createGain(); rMid.gain.value = 0.5;
    const lSide = this.ctx.createGain(); lSide.gain.value = 0.5;
    const rSide = this.ctx.createGain(); rSide.gain.value = -0.5;
    this.splitter.connect(lMid, 0); this.splitter.connect(rMid, 1);
    this.splitter.connect(lSide, 0); this.splitter.connect(rSide, 1);
    lMid.connect(this.midSum); rMid.connect(this.midSum);
    lSide.connect(this.sideSum); rSide.connect(this.sideSum);

    this.widthNode = this.ctx.createGain(); // gain = 宽度倍数
    this.sideSum.connect(this.widthNode);
    this.invWidth = this.ctx.createGain();
    this.invWidth.gain.value = -1;
    this.widthNode.connect(this.invWidth);

    const outL = this.ctx.createGain();
    const outR = this.ctx.createGain();
    this.midSum.connect(outL); this.widthNode.connect(outL);
    this.midSum.connect(outR); this.invWidth.connect(outR);

    this.merger = this.ctx.createChannelMerger(2);
    outL.connect(this.merger, 0, 0);
    outR.connect(this.merger, 0, 1);

    // 混响：干湿并行，IR 由程序生成（噪声指数衰减），无需外部音频文件
    this.dryGain = this.ctx.createGain();
    this.wetGain = this.ctx.createGain();
    this.wetGain.gain.value = 0;
    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this._makeImpulse(1.9, 2.8);
    this.merger.connect(this.dryGain);
    this.merger.connect(this.convolver);
    this.convolver.connect(this.wetGain);

    // 动态压缩：夜间模式把动态范围收窄，避免忽大忽小
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = 0;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 1;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.24;
    this.dryGain.connect(this.comp);
    this.wetGain.connect(this.comp);

    this.comp.connect(this.analyser);
    this.analyser.connect(this.gain);
    this.gain.connect(this.ctx.destination);

    this.applyFx();
  }

  // 程序生成混响脉冲响应：声道独立的噪声 × 指数衰减
  _makeImpulse(seconds = 1.9, decay = 2.8) {
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /** 应用当前音效设置（场景预设 + 用户覆盖值）；设置页调用，播放中即时生效 */
  applyFx() {
    if (!this.ctx || !this.bassNode) return;
    const scene = FX_SCENES[store.get('fxScene')] || FX_SCENES.off;
    const rawW = store.get('fxWidth');
    const rawWet = store.get('fxReverb');
    const width = rawW == null ? scene.width : Math.max(0, Number(rawW) || 0);
    const wet = rawWet == null ? scene.wet : Math.max(0, Math.min(1, Number(rawWet) || 0));
    const comp = scene.comp || 0;
    const now = this.ctx.currentTime;
    this.bassNode.gain.setTargetAtTime(scene.bass, now, 0.05);
    this.widthNode.gain.setTargetAtTime(width, now, 0.05);
    this.wetGain.gain.setTargetAtTime(wet, now, 0.08);
    // 混响越多，干声略降，避免整体音量被推高
    this.dryGain.gain.setTargetAtTime(1 - wet * 0.35, now, 0.08);
    this.comp.threshold.setTargetAtTime(comp > 0 ? -(10 + comp * 26) : 0, now, 0.05);
    this.comp.ratio.setTargetAtTime(comp > 0 ? 1 + comp * 7 : 1, now, 0.05);
  }

  _targetGain() {
    return store.get('muted') ? 0.0001 : Math.max(store.get('volume'), 0.0001);
  }

  async _resolveUrl(track, token) {
    if (track.source === 'local') return track.url;
    // 多平台曲目：id 是平台原始标识（songmid / hash），网易云官方接口不认识，
    // 只能交给音源脚本取链；失败时直接报错，不做无意义的官方接口回退。
    const platform = track.platform || 'wy';
    const hasSources = await api.hasEnabledSources();
    if (token !== this._token) return null;

    if (platform !== 'wy') {
      const q = store.get('sourceQuality') || 'flac';
      const errors = [];

      // 1) 自定义音源（用户启用时优先）：能给出 flac/320，质量更好
      if (hasSources) {
        try {
          const res = await api.resolveMusicUrl(platform, track.musicInfo, q);
          if (token !== this._token) return null;
          if (res && res.url) return '/api/proxy?url=' + encodeURIComponent(res.url);
          errors.push('音源未返回链接');
        } catch (e) {
          errors.push('音源：' + e.message);
        }
      }

      // 2) 平台原生取链：酷狗匿名直链；QQ 有登录态则直连，否则跨平台兜底到酷狗同曲
      try {
        const r = await api.platformUrl({
          platform,
          musicInfo: track.musicInfo || {},
          name: track.name,
          artist: track.artist,
          duration: track.duration,
          quality: q,
        });
        if (token !== this._token) return null;
        if (r && r.url) {
          this.lastResolve = { from: r.from, matched: r.matched || null, bitRate: r.bitRate || 0 };
          if (r.matched && r.from !== 'kugou-native') {
            // 换了来源或版本必须告知：用户点的是原曲，实际播的可能是别的收录版本
            const prefix = r.from === 'kugou-fallback'
              ? `${platform === 'tx' ? 'QQ 音乐' : '该平台'}取链受限，已切换到酷狗同曲`
              : '原曲无免费音源，已切换到同曲其他版本';
            this.emit('notice', { text: `${prefix}：${r.matched.name} · ${r.matched.artist}` });
          }
          const ct = AUDIO_CT[r.ext] || '';
          return '/api/proxy?url=' + encodeURIComponent(r.url) + (ct ? '&ct=' + encodeURIComponent(ct) : '');
        }
        errors.push('平台接口未返回链接');
      } catch (e) {
        errors.push('平台：' + e.message);
      }

      throw new Error(`取链失败（${errors.join('；')}）`);
    }

    // 优先走 LX Music 自定义音源（wy=网易云，因为搜索来自网易云）
    if (hasSources) {
      try {
        const musicInfo = {
          source: 'wy',
          songmid: String(track.id),
          id: String(track.id),
          hash: String(track.id),
          musicId: String(track.id),
          name: track.name,
          singer: track.artist,
          artists: track.artist,
          albumName: track.album,
          album: track.album,
          interval: track.duration ? Math.round(track.duration / 1000) : 0,
        };
        const q = store.get('sourceQuality') || 'flac';
        const res = await api.resolveMusicUrl('wy', musicInfo, q);
        if (token !== this._token) return null;
        if (res && res.url) return '/api/proxy?url=' + encodeURIComponent(res.url);
      } catch (e) {
        // 音源失败，继续降级到网易云官方接口（错误信息由降级失败时统一提示）
      }
    }
    // 降级：网易云官方接口 / 离线示例
    let r;
    try {
      r = await api.songUrl(track.id);
    } catch (e) {
      throw new Error(`音源取链失败，官方接口也无法访问（${e.message}）`);
    }
    if (token !== this._token) return null;
    const raw = r.data && r.data[0] && r.data[0].url;
    if (!raw) throw new Error('音源与官方接口均无可用地址（可能无版权或已下架）');
    return '/api/proxy?url=' + encodeURIComponent(raw); // 同源代理 → Web Audio 可用
  }

  async _loadLyric(track, token) {
    let lines = [];
    this.lyricTransFrom = '';
    if (track.source !== 'local') {
      const platform = track.platform || 'wy';
      try {
        if (platform !== 'wy') {
          // 非网易云平台：歌词只能问音源要。没启用音源时不发请求，
          // 否则后端没有该路由会回 404，浏览器控制台会留下红色报错。
          if (await api.hasEnabledSources()) {
            const r = await api.sourceLyric(platform, track.musicInfo);
            if (token !== this._token) return;
            const raw = r && (typeof r.lyric === 'string' ? r.lyric : r.lyric && r.lyric.lyric);
            lines = parseLRC(raw);
          }
        } else {
          const r = await api.lyric(track.id);
          if (token !== this._token) return;
          lines = parseLRC(r.lrc && r.lrc.lyric);
          if (attachTranslation(lines, r.tlyric && r.tlyric.lyric).some((l) => l.trans)) {
            this.lyricTransFrom = 'cloud';
          }
        }
      } catch (_) { lines = []; }
    }
    this.lyricLines = lines;
    this.emit('lyric', lines);
  }

  // 按需补译文（AI 兜底）：只在用户点「翻译」时调用，不自动发起外部请求
  async requestTranslation(target = 'zh') {
    const lines = this.lyricLines;
    const track = this.current;
    if (!track || !lines.length || this.lyricTransFrom === 'ai') return false;
    const missing = lines.filter((l) => !l.trans);
    if (!missing.length) return true;
    const res = await api.translate(track.id, lines.map((l) => l.text), target);
    const trans = res && res.lines;
    if (!Array.isArray(trans)) return false;
    let hit = 0;
    lines.forEach((l, i) => { if (trans[i]) { l.trans = trans[i]; hit++; } });
    if (!hit) return false;
    this.lyricTransFrom = 'ai';
    this.emit('lyric', lines);
    return true;
  }

  async playTrack(track, queue, index) {
    if (!track) return;
    this._ensureCtx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const token = ++this._token;
    this.queue = queue && queue.length ? queue : [track];
    this.index = index != null ? index : this.queue.indexOf(track);
    if (this.index < 0) this.index = 0;

    this.current = track;
    this._scrobbled = false;
    store.setQueue(this.queue, this.index);
    this.emit('loading', true);
    this.emit('trackchange', track, this.index);
    this.emit('queuechange', this.queue, this.index);

    let url = null;
    let resolveErr = '';
    try { url = await this._resolveUrl(track, token); }
    catch (e) { resolveErr = e.message || String(e); url = null; }
    if (token !== this._token) return;

    if (!url) {
      this._failWith(`《${track.name}》暂无可播放源${resolveErr ? '：' + resolveErr : ''}`);
      return;
    }

    this.audio.src = url;
    store.pushHistory(track);
    store.setLastTrack(track); // 记住上次播放的曲目（启动自动播放用）
    this._loadLyric(track, token);
    this._updateMediaSession(track);
    try {
      await this.audio.play();
      if (token !== this._token) return;
      this._fadeIn();
      this.emit('loading', false);
      // 恢复上次播放进度（记住播放进度开启时）
      if (store.get('rememberProgress') && track.source !== 'local') {
        const saved = store.getProgress(trackKey(track));
        if (saved > 0 && saved < (this.duration || Infinity) - 5) {
          this.audio.currentTime = saved;
          this.emit('time', saved, this.duration);
        }
      }
    } catch (e) {
      this._failWith(`《${track.name}》播放失败：${translateAudioError(this.audio.error, e)}`);
    }
  }

  _fadeIn(ms = 280) {
    if (!this.gain) return;
    const now = this.ctx.currentTime;
    const v = this._targetGain();
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0.0001, now);
    this.gain.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), now + ms / 1000);
  }

  _fadeOut(ms = 3000) {
    return new Promise((resolve) => {
      if (!this.gain) return resolve();
      const now = this.ctx.currentTime;
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setValueAtTime(Math.max(this.gain.gain.value, 0.0002), now);
      this.gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
      setTimeout(resolve, ms);
    });
  }

  async _onEnded() {
    const repeat = store.get('repeat');
    if (repeat === 'one') {
      this.audio.currentTime = 0;
      try { await this.audio.play(); } catch (_) { /* ignore */ }
      return;
    }
    await this.next(true);
  }

  async next(auto = false) {
    if (!this.queue.length) return;
    const shuffle = store.get('shuffle');
    let i = this.index;
    if (shuffle) {
      if (this.queue.length > 1) {
        do { i = Math.floor(Math.random() * this.queue.length); } while (i === this.index);
      }
    } else {
      i = this.index + 1;
      if (i >= this.queue.length) {
        if (store.get('repeat') === 'none' && auto) { this.emit('queueend'); return; }
        i = 0;
      }
    }
    await this.playAt(i);
  }

  async prev() {
    if (!this.queue.length) return;
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    let i = this.index - 1;
    if (i < 0) i = this.queue.length - 1;
    await this.playAt(i);
  }

  async playAt(i) {
    if (i < 0 || i >= this.queue.length) return;
    this.index = i;
    store.setQueueIndex(i);
    await this.playTrack(this.queue[i], this.queue, i);
  }

  toggle() {
    if (!this.current) return false;
    if (this.audio.paused) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      this.audio.play().catch(() => this.emit('error', '播放被浏览器拦截'));
    } else {
      this.audio.pause();
    }
    return true;
  }

  seek(t) {
    if (!this.duration) return;
    this.audio.currentTime = Math.max(0, Math.min(t, this.duration));
    this.emit('time', this.audio.currentTime, this.duration);
  }

  seekRatio(r) { this.seek(Math.max(0, Math.min(1, r)) * this.duration); }

  setVolume(v) {
    const vol = Math.max(0, Math.min(1, v));
    store.set({ volume: vol, muted: false });
    this._applyGain();
    this.emit('volume', vol, false);
  }

  toggleMute() {
    const muted = !store.get('muted');
    store.set({ muted });
    this._applyGain();
    this.emit('volume', store.get('volume'), muted);
    return muted;
  }

  _applyGain() {
    if (this.gain && this.ctx) {
      this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.gain.gain.setTargetAtTime(this._targetGain(), this.ctx.currentTime, 0.02);
    }
  }

  setEQ(gains) {
    this.eqGains = gains.slice();
    store.set({ eqGains: gains });
    if (this.eqNodes.length) this.eqNodes.forEach((n, i) => { n.gain.value = gains[i] || 0; });
  }

  setSleep(min) {
    store.set({ sleepMin: min });
    if (this.sleepTimer) { clearTimeout(this.sleepTimer); this.sleepTimer = null; }
    if (min > 0) {
      this.sleepTimer = setTimeout(async () => {
        await this._fadeOut(3000);
        this.audio.pause();
        if (this.gain) this.gain.gain.value = this._targetGain();
        store.set({ sleepMin: 0 });
        this.sleepTimer = null;
        this.emit('sleepend');
      }, min * 60000);
    }
  }

  /* ---------- 队列管理 ---------- */
  addToQueue(track) {
    if (!track) return false;
    const key = trackKey(track);
    if (this.queue.some((t) => trackKey(t) === key)) return false;
    const atTop = store.get('addToQueuePos') === 'top';
    if (!this.queue.length) {
      this.queue = [track];
      this.index = 0;
      store.setQueue(this.queue, this.index);
      this.emit('queuechange', this.queue, this.index);
      return true;
    }
    if (atTop) {
      // 插到当前播放的下一首，保证“顶部”语义直观
      const at = Math.max(0, Math.min(this.index + 1, this.queue.length));
      this.queue.splice(at, 0, track);
      if (at <= this.index) this.index += 1;
    } else {
      this.queue.push(track);
    }
    store.setQueue(this.queue, this.index);
    this.emit('queuechange', this.queue, this.index);
    return true;
  }

  removeFromQueue(i) {
    if (i < 0 || i >= this.queue.length) return;
    const wasCurrent = i === this.index;
    this.queue.splice(i, 1);
    if (!this.queue.length) {
      this.index = -1;
    } else if (wasCurrent) {
      this.index = Math.max(0, Math.min(i - 1, this.queue.length - 1));
    } else if (i < this.index) {
      this.index -= 1;
    }
    store.setQueue(this.queue, this.index);
    this.emit('queuechange', this.queue, this.index);
  }

  clearQueue() {
    this.queue = [];
    this.index = -1;
    store.setQueue(this.queue, this.index);
    this.emit('queuechange', this.queue, this.index);
  }

  /* ---------- 系统媒体控制 ---------- */
  _updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.name || '',
        artist: track.artist || '',
        album: track.album || '',
        artwork: track.albumPic ? [{ src: track.albumPic, sizes: '512x512', type: 'image/jpeg' }] : [],
      });
    } catch (_) { /* ignore */ }
  }

  _updatePositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const d = this.duration;
    if (!d || !isFinite(d)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: this.audio.playbackRate || 1,
        position: Math.min(this.audio.currentTime || 0, d),
      });
    } catch (_) { /* ignore */ }
  }
}

// 浏览器音频错误码 → 用户能懂的原因
function translateAudioError(mediaError, err) {
  const code = mediaError && mediaError.code;
  if (code === 4) return '音频地址无效或格式不支持（音源可能已失效）';
  if (code === 2) return '网络中断，请稍后重试';
  if (code === 3) return '音频解码失败';
  return (err && err.message) || '被浏览器拦截';
}
