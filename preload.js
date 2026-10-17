'use strict';
/**
 * 预加载脚本：向渲染层安全暴露主进程能力（contextIsolation 开启）。
 * 渲染层通过 window.gm 调用窗口控制、外链打开、接收托盘/媒体键指令，
 * 以及电源阻止、任务栏进度、下载保存、桌面歌词窗口等系统能力。
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('gm', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  mini: () => ipcRenderer.send('window:mini'),
  toggleMini: () => ipcRenderer.invoke('window:toggleMini'),
  isMaximized: () => ipcRenderer.invoke('window:isMax'),
  // 窗口尺寸预设：sm/md/lg/xl
  setWindowSize: (key) => ipcRenderer.invoke('window:setSize', key),
  openExternal: (url) => ipcRenderer.send('open:external', url),
  openFileDialog: (opts) => ipcRenderer.invoke('dialog:openFile', opts),
  pickDownloadDir: () => ipcRenderer.invoke('dialog:pickDir'),
  // 本地曲库导入：绝对路径数组 / 目录；拖拽的 File 用 filePath 取路径（Electron 已移除 File.path）
  openMusicFiles: () => ipcRenderer.invoke('dialog:openMusicFiles'),
  openMusicDir: () => ipcRenderer.invoke('dialog:openMusicDir'),
  filePath: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch (_) {
      return '';
    }
  },
  // 下载保存：{ name, dir, data(number[]) } → 保存路径或 null
  saveDownload: (payload) => ipcRenderer.invoke('download:save', payload),
  // 播放防休眠：播放时开启
  preventSleep: (on) => ipcRenderer.invoke('power:preventSleep', on),
  // 任务栏进度条：ratio 0~1，负数清除
  taskbarProgress: (ratio) => ipcRenderer.send('taskbar:progress', ratio),
  // 桌面歌词窗口
  lyricOpen: () => ipcRenderer.invoke('lyric:open'),
  lyricClose: () => ipcRenderer.invoke('lyric:close'),
  lyricUpdate: (payload) => ipcRenderer.send('lyric:update', payload),
  lyricLock: (locked) => ipcRenderer.send('lyric:lock', locked),
  lyricSeek: (time) => ipcRenderer.send('lyric:seek', time),
  lyricCloseRequest: () => ipcRenderer.send('lyric:closeRequest'),
  lyricActivate: () => ipcRenderer.send('lyric:activate'),
  // 歌词窗口接收主进程转发的当前歌词行
  onLyricLine: (cb) => {
    ipcRenderer.on('lyric:line', (_e, payload) => cb(payload));
  },
  // 主进程（托盘/媒体键）下发的播放控制
  onControl: (cb) => {
    ipcRenderer.on('player:control', (_e, action) => cb(action));
  },
  // 桌面歌词点击跳转
  onSeek: (cb) => {
    ipcRenderer.on('player:seek', (_e, time) => cb(time));
  },
  // 桌面歌词被用户关闭 → 同步设置开关
  onLyricClosedByUser: (cb) => {
    ipcRenderer.on('lyric:closedByUser', () => cb());
  },
  // 最大化状态变化
  onMaxState: (cb) => {
    ipcRenderer.on('window:max-state', (_e, max) => cb(max));
  },
});
