'use strict';
/**
 * 离线降级数据层（mock）
 * 响应结构刻意与 NeteaseCloudMusicApi 保持一致，渲染层无需感知在线/离线差异。
 * 封面图留空 (picUrl='')，由前端按 id/标题生成渐变封面，从而完全离线可用。
 * 音频地址指向 SoundHelix 公开示例曲（需联网）；离线场景可由"本地音乐"功能覆盖。
 */

const ARTISTS = [
  'Buradarrr', '索尼音乐国际', '远程大坝', '洛米Gemini', 'Lelow',
  '小浣熊爱吃小鱼仔', '泽泽不爱吃糖', '丨IIIIIIIIII丨', '霓虹海', '夜航星',
  '陈鸿宇', '房东的猫', '棱镜', '回春丹', '夏日入侵企画',
];
const SONG_NAMES = [
  '开口沦陷', '大梦一场', '秋风拂面', '破碎感深夜', '通勤路上',
  '心灵复苏', '舞力全开', '清新宁静', '治愈磁场', '明亮自然',
  '顶级旋律', '松弛感', '扩次元神曲', '摇滚灵魂', '轻音乐',
  '月光边境', '霓虹城市', '凌晨三点', '海岸线', '余温',
  '像风一样', '晚安', '南方姑娘', '少年', '我记得',
  '夜曲', '稻香', '晴天', '七里香', '告白气球',
  '起风了', '平凡之路', '光年之外', '演员', '成都',
  '斑马斑马', '理想三旬', '海阔天空', '光辉岁月', '突然好想你',
  '温柔', '倔强', '后来', '童话', '遇见',
  '十年', '江南', '一千年以后', '夜空中最亮的星', '追光者',
  '体面', '说散就散', '慢慢喜欢你', '小幸运', '水星记',
];
const PLAYLISTS = [
  { id: 18271967084, name: '欧美R&B｜“顶级旋律 开口沦陷”', playCount: 70000, desc: '开口即沦陷的旋律线，适合深夜独处。', tags: ['R&B', '欧美'], cat: '欧美' },
  { id: 18180542999, name: '美式欧美说唱 | 慵懒旋律松弛感', playCount: 20000, desc: '慵懒的 flows，松弛又带感。', tags: ['说唱', '欧美'], cat: '欧美' },
  { id: 18374591158, name: '【中式美学】大梦一场，醒来归零', playCount: 80000, desc: '一盏茶，一场梦。', tags: ['国风', '民谣'], cat: '华语' },
  { id: 18428485896, name: '扩次元日语潮流神曲 点开就停不下来', playCount: 60000, desc: '日系潮流，循环上头。', tags: ['日语', '流行'], cat: '日语' },
  { id: 18309787841, name: '【高能量轻音】清新宁静 治愈磁场', playCount: 10000, desc: '明亮自然，给电量不足的你。', tags: ['轻音乐', '治愈'], cat: '轻音乐' },
  { id: 18170330057, name: '欧美R&B天花板 | 流行旋律氛围感沦陷', playCount: 5114, desc: '氛围感拉满。', tags: ['R&B', '流行'], cat: '欧美' },
  { id: 18359211192, name: '欧美emo独享｜破碎感深夜伤感旋律', playCount: 1099, desc: '只属于深夜的破碎。', tags: ['emo', '欧美'], cat: '欧美' },
  { id: 26467411, name: '那些你熟悉却又不知道名字的轻音乐', playCount: 130000000, desc: '耳熟，却叫不出名字。', tags: ['轻音乐', '纯音乐'], cat: '轻音乐' },
  { id: 18194128578, name: 'Queen皇后乐队｜摇滚灵魂不朽', playCount: 40000, desc: 'We will rock you. 永远的摇滚。', tags: ['摇滚', '经典'], cat: '欧美' },
  { id: 18339554377, name: '韩流KPOP｜通勤路上｜心灵复苏', playCount: 100000, desc: '一秒回血的通勤歌单。', tags: ['KPOP', '韩语'], cat: '韩语' },
  { id: 18173414425, name: 'KPOP 舞力全开 | 跟着元气节拍一键嗨跳', playCount: 10000, desc: '别坐着了，动起来。', tags: ['KPOP', '舞曲'], cat: '韩语' },
  { id: 18392644351, name: '散步听这首｜秋风拂面的欧美氛围感歌单', playCount: 20000, desc: '配一杯热茶刚刚好。', tags: ['欧美', '氛围'], cat: '欧美' },
  { id: 18290000101, name: '深夜电台｜夜曲与失眠', playCount: 66000, desc: '夜曲、晴天、稻香，把深夜调成单曲循环。', tags: ['深夜', '华语'], cat: '华语' },
  { id: 18290000102, name: '通勤回血｜元气摇滚与节奏', playCount: 88000, desc: '地铁到公司的十五分钟，也要有鼓点。', tags: ['通勤', '摇滚'], cat: '摇滚' },
  { id: 18290000103, name: '治愈电台｜温柔指弹轻音乐', playCount: 42000, desc: '把音量调低一点，世界就温柔一点。', tags: ['治愈', '轻音乐'], cat: '轻音乐' },
  { id: 18290000104, name: '华语金曲收藏夹｜晴天与少年', playCount: 210000, desc: '从稻香到晴天，耳机里的一整个青春。', tags: ['华语', '流行'], cat: '华语' },
  { id: 18290000105, name: '摇滚现场｜把音量开到最大', playCount: 33000, desc: '鼓点、失真与嘶吼，今晚不睡了。', tags: ['摇滚', '现场'], cat: '摇滚' },
];

// 简单的确定性伪随机，保证每次启动数据一致
function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function buildTracks(playlistId, count) {
  const rand = rng(playlistId);
  const tracks = [];
  for (let i = 0; i < count; i++) {
    const id = playlistId * 1000 + i + 1;
    const name = SONG_NAMES[Math.floor(rand() * SONG_NAMES.length)] + (rand() > 0.6 ? ` (${i + 1})` : '');
    const arCount = rand() > 0.7 ? 2 : 1;
    const ar = [];
    for (let a = 0; a < arCount; a++) ar.push({ id: 1000 + Math.floor(rand() * 999), name: ARTISTS[Math.floor(rand() * ARTISTS.length)] });
    const alName = PLAYLISTS.find(p => p.id === playlistId)?.name?.slice(0, 8) || '精选集';
    const dt = Math.floor(180000 + rand() * 140000);
    tracks.push({
      id,
      name,
      ar,
      al: { id: playlistId, name: alName, picUrl: '' },
      dt,
      // 仅 mock 使用；在线模式由网易云返回
      fee: 0,
    });
  }
  return tracks;
}

function songUrl(id) {
  const n = (id % 16) + 1;
  return `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${n}.mp3`;
}

const LYRIC_POOL = [
  '夜色像潮水漫过窗台',
  '我把心事折成纸船',
  '路灯把影子拉得很长',
  '风穿过空荡的走廊',
  '你说过的话还在回响',
  '时间停在某个瞬间',
  '我们就这样慢慢走远',
  '耳机里循环着那首歌',
  '城市的灯一盏盏熄灭',
  '而我还在等一个答案',
];

function buildLyric(id) {
  const rand = rng(id + 7);
  const lines = LYRIC_POOL.slice().sort(() => rand() - 0.5).slice(0, 8);
  let t = 4;
  const body = lines.map((line) => {
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(Math.floor(t % 60)).padStart(2, '0');
    t += 4 + Math.floor(rand() * 3);
    return `[${mm}:${ss}.00]${line}`;
  }).join('\n');
  return `[ti:示例歌曲 ${id}]\n[ar:孤男音乐]\n[al:离线示例]\n${body}`;
}

function playlistToList(p) {
  return {
    id: p.id,
    name: p.name,
    picUrl: '',
    playCount: p.playCount,
    copywriter: p.desc,
    trackCount: 30,
    tags: p.tags,
    creator: { nickname: p.tags?.[0] || '孤男音乐' },
  };
}

function fullPlaylist(p) {
  const tracks = buildTracks(p.id, 30);
  return {
    playlist: {
      id: p.id,
      name: p.name,
      description: p.desc,
      coverImgUrl: '',
      tags: p.tags,
      playCount: p.playCount,
      trackCount: tracks.length,
      creator: { nickname: p.tags?.[0] || '孤男音乐', userId: 1 },
      trackIds: tracks.map(t => ({ id: t.id })),
      tracks,
    },
    privileges: tracks.map(() => ({ id: 0, fee: 0 })),
  };
}

const routes = {
  '/personalized': async () => ({ result: PLAYLISTS.slice(0, 9).map(playlistToList) }),

  '/top/playlist': async (q) => {
    let list = PLAYLISTS;
    if (q.cat && q.cat !== '全部') list = list.filter(p => (p.cat || '').includes(q.cat) || (p.tags || []).includes(q.cat));
    const limit = parseInt(q.limit || '30', 10);
    return { playlists: list.slice(0, limit).map(playlistToList), total: list.length, more: false, cat: q.cat || '全部' };
  },

  '/playlist/detail': async (q) => {
    const p = PLAYLISTS.find(x => x.id === Number(q.id)) || PLAYLISTS[0];
    return fullPlaylist(p);
  },

  '/playlist/track/all': async (q) => {
    const p = PLAYLISTS.find(x => x.id === Number(q.id)) || PLAYLISTS[0];
    return { songs: buildTracks(p.id, 30) };
  },

  '/song/detail': async (q) => {
    const ids = String(q.id).split(',').map(Number);
    const songs = [];
    for (const id of ids) {
      const plId = Math.floor(id / 1000);
      const p = PLAYLISTS.find(x => x.id === plId) || PLAYLISTS[0];
      const t = buildTracks(p.id, 30).find(x => x.id === id);
      if (t) songs.push(t);
    }
    return { songs };
  },

  '/search': async (q) => {
    const kw = (q.keywords || '').toLowerCase();
    const type = Number(q.type || '1');
    if (type === 1000) {
      const playlists = PLAYLISTS.filter(p => !kw
        || p.name.toLowerCase().includes(kw)
        || (p.desc || '').toLowerCase().includes(kw)
        || (p.tags || []).join(',').toLowerCase().includes(kw)
      ).map(playlistToList);
      return { result: { playlists, playlistCount: playlists.length, more: false } };
    }
    // 默认按歌曲搜
    const songs = [];
    for (const p of PLAYLISTS) {
      const tracks = buildTracks(p.id, 30);
      for (const t of tracks) {
        if (!kw || t.name.toLowerCase().includes(kw) || t.ar.some(a => a.name.toLowerCase().includes(kw))) songs.push(t);
      }
    }
    const limit = parseInt(q.limit || '30', 10);
    return { result: { songs: songs.slice(0, limit), songCount: songs.length, more: songs.length > limit } };
  },

  '/song/url': async (q) => {
    const ids = String(q.id).split(',').map(Number);
    const data = ids.map(id => ({ id, url: songUrl(id), br: 320000, size: 5242880, type: 'mp3', md5: '' }));
    return { data };
  },

  '/lyric': async (q) => ({ lrc: { version: 0, lyric: buildLyric(Number(q.id) || 1) }, tlyric: { version: 0, lyric: '' }, code: 200 }),

  // 每日推荐（离线用示例曲库凑一份，保证首屏在断网时也不空）
  // 键名与上游一致：/recommend/songs 与 /recommend/resource 都返回 recommend 数组
  '/recommend/songs': async () => {
    const songs = buildTracks(PLAYLISTS[0].id, 10).concat(buildTracks(PLAYLISTS[2].id, 6));
    return { code: 200, recommend: songs, explain: '离线示例：按内置曲库生成' };
  },

  '/recommend/resource': async () => ({
    code: 200,
    recommend: [PLAYLISTS[12], PLAYLISTS[13], PLAYLISTS[14], PLAYLISTS[15]].map(playlistToList),
  }),

  '/personalized/newsong': async () => {
    const out = [];
    for (const p of PLAYLISTS.slice(0, 4)) {
      for (const t of buildTracks(p.id, 30).slice(0, 3)) {
        out.push({
          id: t.id, name: t.name, artists: t.ar, duration: t.dt,
          album: { id: t.al.id, name: t.al.name, picUrl: '' },
        });
      }
    }
    return { code: 200, result: out };
  },

  // 歌单订阅：离线模式只回状态，不落库（收藏仍会写进本地命名歌单）
  '/playlist/subscribe': async (q) => ({ code: 200, msg: '离线模式：订阅未同步到网易云', t: Number(q.t || 1) }),

  '/playlist/subs': async (q) => {
    const limit = parseInt(q.limit || '50', 10);
    const offset = parseInt(q.offset || '0', 10);
    const list = PLAYLISTS.slice(0, 6).map(playlistToList);
    return { code: 200, subscribed: list.map((p) => ({ ...p, creator: { userId: 1, nickname: p.creator?.nickname || '孤男音乐' } })), more: false, count: list.length, offset, limit };
  },
};

async function handle(pathname, query) {
  const fn = routes[pathname];
  if (!fn) return null;
  return fn(query);
}

module.exports = { handle, songUrl, PLAYLISTS };
