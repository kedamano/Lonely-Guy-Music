'use strict';
/**
 * 多平台搜索：跳出网易云元数据，直接按平台检索。
 *
 * 平台与数据来源：
 *   tx (QQ 音乐) —— vkeys 公共 API，返回 songmid，可交给洛雪音源取链
 *   kg (酷狗)    —— 酷狗 songsearch 接口，返回 FileHash，可交给洛雪音源取链
 *   wy (网易云)  —— 由 NCM 反代处理，不经过本模块
 *
 * 统一曲目结构（渲染层只认这一套）：
 *   { id, platform, platformId, name, artist, album, albumPic, duration, playable, musicInfo }
 * - id 带平台前缀（tx:xxx / kg:xxx），避免与网易云纯数字 id 冲突
 * - musicInfo 是音源脚本需要的平台特定字段，取链时原样回传给 /api/sources/resolve
 *
 * 网络：复用 source-manager 的 requestAsync，遵循用户在设置里配置的代理（默认直连）。
 */
const { requestAsync, resolveSearch } = require('./source-manager');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT = 12000;

const PLATFORMS = {
  wy: { key: 'wy', label: '网易云音乐', searchable: true, playlist: true },
  tx: { key: 'tx', label: 'QQ 音乐', searchable: true, playlist: false },
  kg: { key: 'kg', label: '酷狗音乐', searchable: true, playlist: false },
  // 咪咕 / 汽水：官方搜索接口已加签名/登录态，汽水更完全闭源，没有可公开访问的搜索入口。
  // 因此搜索与取链走同一条路——委托给已导入的洛雪音源脚本（source-manager.resolveSearch）。
  mg: { key: 'mg', label: '咪咕音乐', searchable: true, playlist: false, viaSource: true },
  qs: { key: 'qs', label: '汽水音乐', searchable: true, playlist: false, viaSource: true },
};

function platformList() {
  return Object.values(PLATFORMS).map((p) => ({
    key: p.key,
    label: p.label,
    playlist: !!p.playlist,
    searchable: !!p.searchable,
    viaSource: !!p.viaSource,
  }));
}

async function getJson(url, headers = {}) {
  const r = await requestAsync(url, {
    timeout: TIMEOUT,
    headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...headers },
  });
  if (r.statusCode >= 400) throw new Error(`上游返回 HTTP ${r.statusCode}`);
  if (r.body && typeof r.body === 'object') return r.body;
  try { return JSON.parse(String(r.body || '')); } catch { throw new Error('上游返回的不是合法 JSON'); }
}

// "4分29秒" / "3:45" / 225 → 毫秒
function toMs(raw) {
  if (raw == null) return 0;
  if (typeof raw === 'number') return raw > 10000 ? raw : raw * 1000;
  const s = String(raw).trim();
  const cn = /(?:(\d+)\s*分)?\s*(?:(\d+)\s*秒)?/.exec(s);
  if (/分|秒/.test(s) && cn) {
    const m = Number(cn[1] || 0);
    const sec = Number(cn[2] || 0);
    if (m || sec) return (m * 60 + sec) * 1000;
  }
  const colon = /^(\d+):(\d+)$/.exec(s);
  if (colon) return (Number(colon[1]) * 60 + Number(colon[2])) * 1000;
  const n = Number(s);
  return Number.isFinite(n) ? (n > 10000 ? n : n * 1000) : 0;
}

// ============== QQ 音乐（vkeys） ==============

async function searchTx(keyword, page, limit) {
  const url = `https://api.vkeys.cn/v2/music/tencent?word=${encodeURIComponent(keyword)}&num=${limit}&page=${page}`;
  const j = await getJson(url);
  if (Number(j.code) !== 200 || !Array.isArray(j.data)) {
    throw new Error(j.message || j.msg || 'QQ 音乐搜索失败');
  }
  const list = j.data
    .map((x) => {
      const mid = String(x.mid || '');
      const singers = Array.isArray(x.singer_list) && x.singer_list.length
        ? x.singer_list.map((a) => a.name).filter(Boolean).join('/')
        : String(x.singer || '');
      const name = String(x.song || x.name || '');
      return {
        id: `tx:${mid || x.id}`,
        platform: 'tx',
        platformId: mid || String(x.id || ''),
        name: name || '未知曲目',
        artist: singers || '未知艺人',
        album: String(x.album || ''),
        albumPic: String(x.cover || ''),
        duration: toMs(x.interval),
        playable: !!mid,
        // 洛雪音源 tx 平台所需字段
        musicInfo: {
          songmid: mid,
          songId: String(x.id || ''),
          name,
          singer: singers,
          albumName: String(x.album || ''),
          interval: Math.round(toMs(x.interval) / 1000),
          img: String(x.cover || ''),
        },
      };
    })
    .filter((t) => t.name);

  // vkeys 不返回总数：有满页即认为可能还有下一页
  const hasMore = list.length >= limit;
  return { list, total: page * limit + (hasMore ? limit : 0), hasMore };
}

// ============== 酷狗音乐 ==============

async function searchKg(keyword, page, limit) {
  const url = 'https://songsearch.kugou.com/song_search_v2'
    + `?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}`
    + '&platform=WebFilter&tag=em&filter=2&iscorrection=1';
  const j = await getJson(url, { Referer: 'https://www.kugou.com/' });
  const d = j.data || {};
  if (!Array.isArray(d.lists)) throw new Error(j.error_msg || '酷狗搜索失败');

  const list = d.lists
    .map((x) => {
      const hash = String(x.FileHash || x.HQFileHash || '');
      const name = String(x.SongName || x.FileName || '').replace(/<[^>]+>/g, '');
      // 酷狗搜索会在命中词上加 <em> 高亮，必须剥掉，否则歌手名带着标签参与匹配和显示
      const strip = (s) => String(s || '').replace(/<[^>]+>/g, '');
      const singer = strip(x.SingerName).split(/[、,&]/).map((s) => s.trim()).filter(Boolean).join('/');
      const album = strip(x.AlbumName);
      const pic = String(x.Image || '').replace('{size}', '480');
      const sec = Number(x.Duration || 0);
      return {
        id: `kg:${hash}`,
        platform: 'kg',
        platformId: hash,
        name: name || '未知曲目',
        artist: singer || '未知艺人',
        album,
        albumPic: pic,
        duration: sec * 1000,
        playable: !!hash,
        // 洛雪音源 kg 平台所需字段
        musicInfo: {
          hash,
          album_id: String(x.AlbumID || ''),
          name,
          singer,
          albumName: album,
          interval: sec,
          img: pic,
          // 原生取链用：三档 hash（flac / 320 / 128），供 platform-url 依次尝试
          hashes: {
            flac: String(x.SQFileHash || ''),
            '320': String(x.HQFileHash || ''),
            '128': String(x.FileHash || ''),
          },
        },
      };
    })
    .filter((t) => t.name && t.platformId);

  const total = Number(d.total || 0);
  return { list, total: total || (page * limit + (list.length >= limit ? limit : 0)), hasMore: !!total ? page * limit < total : list.length >= limit };
}

// 洛雪音源 search 返回的原始曲目 → 统一曲目结构（与 tx/kg 搜索同构）
function normalizeFromSource(it, platform) {
  const name = String(it.name || it.songName || '');
  const singer = it.singer;
  const artist = Array.isArray(singer)
    ? singer.filter(Boolean).join('/')
    : String(singer || it.artist || '');
  const id = String(
    it.songmid || it.songId || it.hash || it.id
    || (it.musicInfo && (it.musicInfo.copyrightId || it.musicInfo.songId || it.musicInfo.id)) || ''
  );
  const album = String(it.album || it.albumName || '');
  const pic = String(it.img || it.albumPic || it.pic || '');
  const sec = Number(it.interval || 0);
  return {
    id: `${platform}:${id}`,
    platform,
    platformId: id,
    name: name || '未知曲目',
    artist: artist || '未知艺人',
    album,
    albumPic: pic,
    duration: sec * 1000,
    playable: true,
    // musicInfo 原样保留：取链时直接回传给洛雪音源（来源与去向是同一份脚本）
    musicInfo: it.musicInfo || it,
  };
}

// ============== 对外入口 ==============

const SEARCHERS = { tx: searchTx, kg: searchKg };

async function searchPlatform(platform, keyword, page = 1, limit = 30) {
  const key = String(platform || '').toLowerCase();
  if (!PLATFORMS[key]) throw new Error(`不支持的平台：${platform}`);
  if (key === 'wy') throw new Error('网易云搜索走 /api/search');
  const kw = String(keyword || '').trim();
  if (!kw) return { list: [], total: 0, page, limit, platform: key, hasMore: false };
  const p = Math.max(1, Number(page) || 1);
  const n = Math.min(60, Math.max(1, Number(limit) || 30));

  // 咪咕 / 汽水等无公开搜索接口的平台：委托洛雪音源脚本完成搜索
  if (PLATFORMS[key].viaSource) {
    const r = await resolveSearch({ sourcePlatform: key, keyword: kw, page: p, limit: n });
    const list = (r.list || []).map((it) => normalizeFromSource(it, key)).filter((t) => t.name);
    const hasMore = list.length >= n;
    return { list, total: p * n + (hasMore ? n : 0), hasMore, page: p, limit: n, platform: key };
  }

  const r = await SEARCHERS[key](kw, p, n);
  return { ...r, page: p, limit: n, platform: key };
}

module.exports = { searchPlatform, platformList, PLATFORMS };
