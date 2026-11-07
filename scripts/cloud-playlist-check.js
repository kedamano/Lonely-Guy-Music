'use strict';
/**
 * 云端歌单双向编辑回归测试（node-only，无需 Electron / 网络）。
 * 覆盖：NCM 写接口契约、api 层业务码翻译与缓存失效、
 *       云歌单新建/重命名/删除/曲目增删接线、卡片菜单委托、图标/样式/i18n。
 */
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.error('  ✗', name, extra != null ? '→ ' + JSON.stringify(extra) : ''); }
}
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ncmModule = (f) => read(path.join('node_modules/NeteaseCloudMusicApi/module', f));

function main() {
  console.log('\n[1] NCM 写接口契约（上游模块）');
  const create = ncmModule('playlist_create.js');
  ok('playlist/create 读取 name', /name:\s*query\.name/.test(create));
  ok('playlist/create 默认 NORMAL 类型', /query\.type \|\| 'NORMAL'/.test(create));
  const del = ncmModule('playlist_delete.js');
  ok('playlist/delete 以 id 组装 ids', /query\.id/.test(del) && /\/api\/playlist\/remove/.test(del));
  const tracks = ncmModule('playlist_tracks.js');
  ok('playlist/tracks 读取 op', /op:\s*query\.op/.test(tracks));
  ok('playlist/tracks 读取 pid', /pid:\s*query\.pid/.test(tracks));
  ok('playlist/tracks 以逗号拆分 tracks', /query\.tracks\.split\(','\)/.test(tracks));
  const nameUpdate = ncmModule('playlist_name_update.js');
  ok('playlist/name/update 只带 id 与 name', /id:\s*query\.id/.test(nameUpdate) && /name:\s*query\.name/.test(nameUpdate));
  const batchUpdate = ncmModule('playlist_update.js');
  ok('不使用会清空 desc/tags 的 playlist/update', /query\.desc = query\.desc \|\| ''/.test(batchUpdate));

  console.log('\n[2] api 层（业务码翻译 / 缓存失效 / 写操作）');
  const api = read('renderer/js/api.js');
  ok('ncmWrite 校验 NCM 业务码', /code !== 200 && code !== 0/.test(api));
  ok('ncmWrite 把上游 msg 抛成可见错误', /r\.msg \|\| r\.message/.test(api));
  ok('ncmWrite 成功后清读缓存', /prefixes\.forEach\(invalidate\)/.test(api));
  ok('cloudPlaylistCreate 走 /playlist/create', /cloudPlaylistCreate:[\s\S]{0,160}\/playlist\/create/.test(api));
  ok('cloudPlaylistDelete 走 /playlist/delete', /cloudPlaylistDelete:[\s\S]{0,160}\/playlist\/delete/.test(api));
  ok('cloudPlaylistUpdate 走 /playlist/name/update', /cloudPlaylistUpdate:[\s\S]{0,160}\/playlist\/name\/update/.test(api));
  ok('cloudPlaylistTracks 走 /playlist/tracks', /cloudPlaylistTracks:[\s\S]{0,220}\/playlist\/tracks/.test(api));
  ok('cloudPlaylistTracks 传递 op/pid/tracks', /op,\s*pid,\s*tracks:/.test(api));
  ok('歌单写操作失效详情与曲目缓存', /'pldetail:' \+ id/.test(api) && /'pltracks:' \+ id/.test(api));

  console.log('\n[3] app.js 云歌单编辑接线');
  const app = read('renderer/js/app.js');
  ok('云歌单 Tab 有「新建云端歌单」按钮', /新建云端歌单/.test(app));
  ok('实现 createCloudPlaylist', /async function createCloudPlaylist\(/.test(app));
  ok('实现 renameCloudPlaylist', /async function renameCloudPlaylist\(/.test(app));
  ok('实现 deleteCloudPlaylist', /async function deleteCloudPlaylist\(/.test(app));
  ok('实现 addTrackToCloudPlaylist', /async function addTrackToCloudPlaylist\(/.test(app));
  ok('实现 removeTrackFromCloudPlaylist', /async function removeTrackFromCloudPlaylist\(/.test(app));
  ok('实现 cloudCardMenu（自建歌单专属）', /function cloudCardMenu\(/.test(app) && /if \(!pl \|\| !pl\.own \|\| pl\.id === LIKED_ID\)/.test(app));
  ok('实现 getOwnCloudPlaylists 供右键菜单', /async function getOwnCloudPlaylists\(/.test(app));
  ok('写操作后失效云歌单缓存', /function invalidateCloud\(/.test(app));
  ok('删除前二次确认且提示云端同步删除', /title: '删除云端歌单'/.test(app) && /danger: true/.test(app));
  ok('未登录 / 离线时禁止写云端', /function cloudWritable\(/.test(app) && /请先登录网易云账号/.test(app));
  ok('仅网易云曲目可写入云端歌单', /function isNeteaseTrackId\(/.test(app) && /无法写入云端歌单/.test(app));
  ok('详情页判断是否自建云歌单', /const isOwnCloud =/.test(app));
  ok('详情页提供删除歌单入口', /deleteCloudPlaylist\(\{ id, name: pl\.name/.test(app));
  ok('详情页提供从云端歌单移除曲目', /removeTitle: '从云端歌单移除'/.test(app));
  ok('右键「加入歌单」列出云端目标', /云端歌单 · 写入网易云账号/.test(app));
  ok('右键菜单提供新建云端歌单并加歌', /createCloudAndAdd/.test(app));
  ok('云歌单列表加载后同步右键缓存', /cloudOwnCache\.uid = uid/.test(app));
  ok('自建歌单网格传入 menuFor', /menuFor: cloudCardMenu/.test(app));

  console.log('\n[4] 网格菜单委托 / 图标 / 样式 / i18n');
  const ui = read('renderer/js/ui.js');
  ok('renderPlaylistGrid 支持 opts.menuFor', /renderPlaylistGrid\(container, playlists, onOpen, opts = \{\}\)/.test(ui));
  ok('菜单按钮不会顺带打开歌单', /act\.dataset\.act === 'menu'/.test(ui));
  ok('卡片右键也能弹菜单', /addEventListener\('contextmenu'/.test(ui));
  ok('委托复用时刷新 opts', /st\.opts = opts/.test(ui));
  const html = read('renderer/index.html');
  ok('新增 i-more 图标', /id="i-more"/.test(html));
  ok('新增 i-cloud 图标', /id="i-cloud"/.test(html));
  const css = read('renderer/styles.css');
  ok('卡片更多按钮样式存在', /\.pl-card__more \{/.test(css));
  ok('QQ 凭证输入区样式存在', /\.qqauth__field \{/.test(css));
  const i18n = read('renderer/js/i18n.js');
  ok('繁中字典含新建云端歌单', /新建云端歌单: '新建雲端歌單'/.test(i18n));
  ok('英文字典含 QQ Music sign-in', /'QQ 音乐登录态': 'QQ Music sign-in'/.test(i18n));
  ok('英文字典含 Remove from cloud playlist', /从云端歌单移除: 'Remove from cloud playlist'/.test(i18n));

  console.log(`\n${failed ? '✗' : '✓'} cloud-playlist-check: ${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

main();
