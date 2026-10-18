'use strict';
/**
 * 咪咕音乐适配器（原生搜索）。
 *
 * 搜索：H5 `app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do` 匿名可用。
 * 注意：上游忽略 pageSize，固定每页 20 条；分页按 20 计算。
 *
 * 取链：咪咕播放接口需要 App 签名，没有稳定的匿名方案，
 *       因此本适配器不提供 resolve，由 platform-url 的跨源兜底链接管。
 */
const { cleanText } = require('../song-utils');
const { getJson, toMs } = require('./http');

const PAGE_SIZE = 20;

function pickPic(x) {
  const items = Array.isArray(x.imgItems) ? x.imgItems : [];
  const rank = (it) => Number(it && it.imgSizeType) || 0;
  const best = items.slice().sort((a, b) => rank(b) - rank(a))[0];
  let pic = (best && best.img) || (x.albums && x.albums[0] && (x.albums[0].img || x.albums[0].picUrl)) || '';
  if (pic && !/^https?:\/\//i.test(pic)) pic = `https:${pic.startsWith('//') ? '' : '//'}${pic}`;
  return pic;
}

/**
 * 咪咕搜索不返回时长，用音质档位的文件大小反推：
 * LQ≈64kbps、PQ≈128kbps、HQ≈320kbps；size(bytes)*8/bitrate(kbps) 即毫秒。
 */
function durationFromFormats(x) {
  const formats = [
    ...(Array.isArray(x.rateFormats) ? x.rateFormats : []),
    ...(Array.isArray(x.newRateFormats) ? x.newRateFormats : []),
  ];
  const bitrates = { LQ: 64, PQ: 128, HQ: 320 };
  for (const f of formats) {
    const kbps = bitrates[f && f.formatType];
    const size = Number((f && f.size) || 0);
    if (kbps && size > 0) return Math.round((size * 8) / kbps);
  }
  return 0;
}

function singerNames(x) {
  const raw = x.singers || x.singerList || x.singer || [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((s) => cleanText(typeof s === 'string' ? s : (s && (s.name || s.artistName))))
    .filter(Boolean)
    .join('/');
}

function mapSong(x) {
  const contentId = String(x.contentId || x.id || x.songId || '');
  const copyrightId = String(x.copyrightId || '');
  const name = cleanText(x.name || x.songName || '');
  const artist = singerNames(x) || '未知艺人';
  const album = cleanText((x.albums && x.albums[0] && x.albums[0].name) || x.albumName || '');
  const duration = toMs(x.duration || x.length || x.interval) || durationFromFormats(x);
  const pic = pickPic(x);
  const tones = Array.isArray(x.tones) ? x.tones : [];
  const tone = tones[0] || {};

  return {
    id: `mg:${contentId || copyrightId}`,
    platform: 'mg',
    platformId: contentId || copyrightId,
    name: name || '未知曲目',
    artist,
    album,
    albumPic: pic,
    duration,
    playable: !!(contentId || copyrightId),
    vip: Number(x.vipType || 0) > 0,
    sourceApi: 'migu-h5',
    qualityHints: {},
    musicInfo: {
      contentId,
      copyrightId,
      toneId: String(tone.id || ''),
      name,
      singer: artist,
      albumName: album,
      interval: Math.round(duration / 1000),
      img: pic,
    },
  };
}

async function search(keyword, page = 1, limit = 30) {
  const searchSwitch = JSON.stringify({ song: 1, album: 0, singer: 0, playlist: 0, mv: 0 });
  const url = 'https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do'
    + `?text=${encodeURIComponent(keyword)}&pageNo=${page}&pageSize=${limit}`
    + `&searchSwitch=${encodeURIComponent(searchSwitch)}`;
  const j = await getJson(url, {
    mobile: true,
    headers: { Referer: 'https://music.migu.cn/', Origin: 'https://music.migu.cn' },
  });
  const code = String(j.code || j.returnCode || '');
  if (code && code !== '000000') throw new Error(j.desc || j.msg || '咪咕搜索失败');

  const d = j.songResultData || (j.data && (j.data.songResultData || j.data)) || {};
  const arr = d.result || d.resultList || d.content || [];
  if (!Array.isArray(arr)) throw new Error('咪咕搜索返回结构异常');

  const list = arr.map(mapSong).filter((t) => t.name && t.platformId);
  const total = Number(d.totalCount || d.total || 0) || 0;
  // 上游忽略 pageSize，实际固定 20 条/页
  const hasMore = total > 0 ? page * PAGE_SIZE < total : list.length >= PAGE_SIZE;
  return {
    list,
    total: total || page * PAGE_SIZE + (hasMore ? PAGE_SIZE : 0),
    hasMore,
  };
}

module.exports = {
  key: 'mg',
  search,
  __test: { mapSong, singerNames, pickPic, durationFromFormats },
};
