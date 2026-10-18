'use strict';
/**
 * 平台元数据与适配器注册表。
 *
 * META 是唯一事实来源：搜索门面、可用性判断、前端 chip 都从这里取。
 * 适配器按需 require（懒加载），避免 platform-search ↔ 适配器之间的循环依赖。
 */

const META = {
  wy: {
    key: 'wy',
    label: '网易云音乐',
    playlist: true,
    searchable: true,
    viaSource: false,
    playback: 'native',
    reason: '',
  },
  tx: {
    key: 'tx',
    label: 'QQ 音乐',
    playlist: false,
    searchable: true,
    viaSource: false,
    playback: 'native',
    reason: '',
  },
  kg: {
    key: 'kg',
    label: '酷狗音乐',
    playlist: false,
    searchable: true,
    viaSource: false,
    playback: 'native',
    reason: '',
  },
  kw: {
    key: 'kw',
    label: '酷我音乐',
    playlist: false,
    searchable: true,
    viaSource: false,
    playback: 'native',
    reason: '',
  },
  mg: {
    key: 'mg',
    label: '咪咕音乐',
    playlist: false,
    searchable: true,
    viaSource: false,
    playback: 'fallback',
    reason: '',
  },
  qs: {
    key: 'qs',
    label: '汽水音乐',
    playlist: false,
    searchable: true,
    viaSource: true,
    playback: 'source',
    reason: '',
  },
};

const ADAPTER_LOADERS = {
  tx: () => require('./qq'),
  kg: () => require('./kugou'),
  kw: () => require('./kuwo'),
  mg: () => require('./migu'),
};

/** @returns {object|null} 按平台返回适配器；网易云走 NCM，无本地适配器 */
function getAdapter(key) {
  const k = String(key || '').toLowerCase();
  const load = ADAPTER_LOADERS[k];
  if (!load) return null;
  return load();
}

function platformListMeta() {
  return Object.values(META).map((p) => ({ ...p }));
}

module.exports = { META, getAdapter, platformListMeta };
