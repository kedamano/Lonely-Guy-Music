'use strict';
/**
 * 孤男音乐 · Electron 主进程
 *  - 启动同进程后端（server/index.js）：托管 UI + /api（在线网易云 / 离线示例）
 *  - 无边框窗口 + 自定义标题栏（min/max/close/mini 经 IPC）
 *  - 系统托盘驻留、媒体键（Windows app-command + 全局快捷键）、托盘播放控制
 *  - 电源阻止（播放防休眠）、任务栏进度条、窗口尺寸预设、下载落盘、桌面歌词窗口
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, shell, screen, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const iconMod = require('./assets/icon');

let mainWindow = null;
let tray = null;
let quitting = false;
let miniMode = false;
let normalBounds = null;
let lyricWindow = null;      // 桌面歌词窗口
let powerBlockerId = null;   // 电源阻止句柄

// 窗口尺寸预设（与设置页 → 基本设置 → 窗口尺寸 对应）
const WINDOW_SIZES = {
  sm: { width: 1000, height: 680 },
  md: { width: 1200, height: 780 },
  lg: { width: 1360, height: 860 },
  xl: { width: 1560, height: 940 },
};

// ---- 单实例锁（必须在启动后端之前）----
// 若已有实例在跑（含托盘驻留），直接退出：不抢占 3000 端口、不争抢 Chromium 缓存
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 用户再次启动时，把已有实例的窗口从托盘唤出
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    if (tray) tray.displayBalloon({ title: '孤男音乐', content: '程序已在运行，窗口可能最小化在系统托盘。' });
  });

  // 默认启用在线网易云曲库；设置 ENABLE_NCM=0 可强制离线示例模式
  if (!('ENABLE_NCM' in process.env)) process.env.ENABLE_NCM = '1';
  // 把 Electron userData 目录传给后端，用于持久化音源脚本与配置
  process.env.GUMAN_USER_DATA = app.getPath('userData');
  require('./server'); // 启动后端（同进程 express，监听 3000）
}

function waitForServer(retries = 40) {
  return new Promise((resolve) => {
    const tryOnce = (n) => {
      fetch('http://localhost:3000/api/__mode', { signal: AbortSignal.timeout(800) })
        .then(() => resolve(true))
        .catch(() => (n > 0 ? setTimeout(() => tryOnce(n - 1), 250) : resolve(false)));
    };
    tryOnce(retries);
  });
}

function createTray(icon) {
  tray = new Tray(icon);
  const ctx = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => (mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()) },
    { type: 'separator' },
    { label: '⏯  播放 / 暂停', click: () => mainWindow?.webContents.send('player:control', 'toggle') },
    { label: '⏭  下一首', click: () => mainWindow?.webContents.send('player:control', 'next') },
    { label: '⏮  上一首', click: () => mainWindow?.webContents.send('player:control', 'prev') },
    { type: 'separator' },
    { label: '▣  迷你模式', click: () => toggleMiniMode() },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setToolTip('孤男音乐');
  tray.setContextMenu(ctx);
  tray.on('click', () => (mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()));
}

function createWindow() {
  const { ico } = iconMod.getIconBuffers();
  const icon = nativeImage.createFromBuffer(ico);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 940,
    minHeight: 620,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0e0d0b',
    icon,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL('http://localhost:3000/');
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 最大化状态同步给渲染层（用于切换最大化/还原图标）
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:max-state', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:max-state', false));

  // 页面内 target=_blank / window.open 一律交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 关闭改为最小化到托盘（除非真正退出）
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Windows 媒体键
  mainWindow.on('app-command', (_e, cmd) => {
    const map = {
      'media-play-pause': 'toggle',
      'media-nexttrack': 'next',
      'media-prevtrack': 'prev',
    };
    if (map[cmd]) mainWindow.webContents.send('player:control', map[cmd]);
  });

  createTray(icon);
}

// ---- IPC：渲染层 → 主进程 ----
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => (mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()));
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.on('window:mini', () => { if (!miniMode) toggleMiniMode(); });
ipcMain.handle('window:toggleMini', () => toggleMiniMode());
ipcMain.handle('window:isMax', () => mainWindow?.isMaximized() || false);

// 窗口尺寸预设：按当前屏幕居中缩放，避免超出工作区
ipcMain.handle('window:setSize', async (_e, key) => {
  const size = WINDOW_SIZES[key];
  if (!mainWindow || !size) return false;
  if (miniMode) { normalBounds = { ...normalBounds, ...size }; return true; }
  try {
    const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const w = Math.min(size.width, Math.max(940, work.width - 40));
    const h = Math.min(size.height, Math.max(620, work.height - 40));
    const x = Math.round(work.x + (work.width - w) / 2);
    const y = Math.round(work.y + (work.height - h) / 2);
    mainWindow.setBounds({ x, y, width: w, height: h });
    return true;
  } catch (_) { return false; }
});

// 播放防休眠：开始播放时启用，停止/退出时释放
ipcMain.handle('power:preventSleep', async (_e, on) => {
  try {
    if (on && powerBlockerId == null) {
      powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!on && powerBlockerId != null) {
      powerSaveBlocker.stop(powerBlockerId);
      powerBlockerId = null;
    }
    return powerBlockerId != null;
  } catch (_) { return false; }
});

// 任务栏进度条：ratio 0~1，null/负值清除
ipcMain.on('taskbar:progress', (_e, ratio) => {
  if (!mainWindow) return;
  try {
    if (typeof ratio === 'number' && ratio >= 0) {
      mainWindow.setProgressBar(Math.max(0, Math.min(1, ratio)), { mode: 'normal' });
    } else {
      mainWindow.setProgressBar(-1);
    }
  } catch (_) { /* 非 Windows 平台忽略 */ }
});

// 迷你模式：保存原窗口尺寸 → 缩成 400×120 的悬浮小条；再次调用还原
function toggleMiniMode() {
  if (!mainWindow) return false;
  try {
    if (!miniMode) {
      normalBounds = mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds();
      miniMode = true;
      mainWindow.setMinimumSize(340, 100);
      const [x, y] = mainWindow.getPosition();
      mainWindow.setBounds({ x, y, width: 400, height: 120 });
      mainWindow.setAlwaysOnTop(true, 'floating');
    } else {
      miniMode = false;
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setMinimumSize(940, 620);
      if (normalBounds) mainWindow.setBounds(normalBounds);
      else mainWindow.setSize(1200, 780);
    }
  } catch (e) {
    console.log('[window] 迷你模式切换失败:', e.message);
  }
  return miniMode;
}
ipcMain.on('open:external', (_e, url) => { if (typeof url === 'string') shell.openExternal(url); });
ipcMain.handle('dialog:openFile', async (_e, opts = {}) => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: opts.filters || [{ name: 'JavaScript', extensions: ['js'] }],
  });
  return result.canceled ? null : result.filePaths[0] || null;
});

// 本地曲库导入：返回绝对路径数组（渲染层 File 对象拿不到路径，需走系统对话框）
const AUDIO_FILTERS = [{ name: '音频', extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'ape', 'dsf'] }];
ipcMain.handle('dialog:openMusicFiles', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: AUDIO_FILTERS,
  });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle('dialog:openMusicDir', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0] || null;
});

/* ---------- 下载 ---------- */
// 选择下载目录
ipcMain.handle('dialog:pickDir', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0] || null;
});

// 保存下载文件：dir 为空则弹保存对话框；返回保存路径或 null
ipcMain.handle('download:save', async (_e, { name, dir, data }) => {
  const { dialog } = require('electron');
  try {
    let filePath = dir ? path.join(dir, name) : null;
    if (!filePath) {
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: name,
        filters: [{ name: '音频', extensions: ['mp3', 'flac', 'm4a', 'wav', 'ogg', 'aac'] }],
      });
      if (result.canceled || !result.filePath) return null;
      filePath = result.filePath;
    }
    fs.writeFileSync(filePath, Buffer.from(data));
    return filePath;
  } catch (e) {
    console.error('[download] 保存失败:', e.message);
    return null;
  }
});

/* ---------- 桌面歌词窗口 ---------- */
function createLyricWindow() {
  if (lyricWindow && !lyricWindow.isDestroyed()) return lyricWindow;
  lyricWindow = new BrowserWindow({
    width: 1000,
    height: 150,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    focusable: false, // 默认不吃焦点；锁定时完全鼠标穿透
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  lyricWindow.loadURL('http://localhost:3000/lyric-window.html');
  lyricWindow.on('closed', () => { lyricWindow = null; });
  return lyricWindow;
}

// 定位到主屏幕底部居中（避开任务栏）
function positionLyricWindow() {
  if (!lyricWindow) return;
  try {
    const primary = screen.getPrimaryDisplay();
    const { width, height } = primary.workAreaSize;
    const w = Math.min(1000, Math.round(width * 0.72));
    const x = Math.round((width - w) / 2);
    const y = Math.max(0, height - 190);
    lyricWindow.setBounds({ x, y, width: w, height: 150 });
  } catch (_) { /* ignore */ }
}

ipcMain.handle('lyric:open', async () => {
  const w = createLyricWindow();
  positionLyricWindow();
  w.showInactive(); // 不抢焦点
  return true;
});

ipcMain.handle('lyric:close', async () => {
  if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.close();
  lyricWindow = null;
  return true;
});

// 渲染层 → 桌面歌词窗口：当前歌词行 / 播放状态
ipcMain.on('lyric:update', (_e, payload) => {
  if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.webContents.send('lyric:line', payload);
});

// 桌面歌词窗口 → 主进程：锁定切换 / 关闭 / 点击跳转
ipcMain.on('lyric:lock', (_e, locked) => {
  if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.setIgnoreMouseEvents(!!locked, { forward: false });
});
ipcMain.on('lyric:seek', (_e, time) => {
  mainWindow?.webContents.send('player:seek', time);
});
ipcMain.on('lyric:closeRequest', () => {
  if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.close();
  lyricWindow = null;
  mainWindow?.webContents.send('lyric:closedByUser');
});
// 点击桌面歌词 → 唤出主窗口
ipcMain.on('lyric:activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

// 全局媒体快捷键（系统级）
function registerShortcuts() {
  const bind = (accel, action) => {
    try { if (!globalShortcut.register(accel, () => mainWindow?.webContents.send('player:control', action))) console.log('[shortcut] 注册失败:', accel); } catch (_) {}
  };
  bind('MediaPlayPause', 'toggle');
  bind('MediaNextTrack', 'next');
  bind('MediaPreviousTrack', 'prev');
}

if (gotLock) {
  app.whenReady().then(async () => {
    await waitForServer();
    createWindow();
    registerShortcuts();

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { /* 保留托盘，不退出 */ });
  app.on('before-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    if (powerBlockerId != null) { try { powerSaveBlocker.stop(powerBlockerId); } catch (_) {} powerBlockerId = null; }
    if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.destroy();
  });
}
