'use strict';
/**
 * 孤男音乐 · Electron 主进程
 *  - 启动同进程后端（server/index.js）：托管 UI + /api（在线网易云 / 离线示例），端口动态分配
 *  - 无边框窗口 + 自定义标题栏（min/max/close/mini 经 IPC）
 *  - 系统托盘驻留、媒体键（Windows app-command + 全局快捷键）、托盘播放控制
 *  - 电源阻止（播放防休眠）、任务栏进度条、窗口尺寸预设、下载落盘、桌面歌词窗口
 *  - 首启用户协议确认、主进程日志落盘（userData/logs）、自动更新（打包后）
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, dialog, shell, screen, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const iconMod = require('./assets/icon');
const mainLog = require('./main-log');

let mainWindow = null;
let tray = null;
let quitting = false;
let miniMode = false;
let normalBounds = null;
let lyricWindow = null;      // 桌面歌词窗口
let powerBlockerId = null;   // 电源阻止句柄
let hostServer = null;       // 同进程后端（server/index.js），getPort() 取实际端口

// 传给每个窗口 preload 的元数据（preload 环境没有 app 模块，
// 读 app.isPackaged/app.getVersion 会让 preload 整体崩掉、window.gm 消失）
// 版本号只传裸版本（1.2.1），前缀 v 由渲染层统一加 —— 两边都加会出现「v v1.2.1」。
const gumanMetaArgs = () => [`--guman-meta=${app.getVersion()}|${app.isPackaged ? '0' : '1'}`];

// 窗口尺寸预设（与设置页 → 基本设置 → 窗口尺寸 对应）
const WINDOW_SIZES = {
  sm: { width: 1000, height: 680 },
  md: { width: 1200, height: 780 },
  lg: { width: 1360, height: 860 },
  xl: { width: 1560, height: 940 },
};

// ---- 单实例锁（必须在启动后端之前）----
// 若已有实例在跑（含托盘驻留），直接退出：不重复拉起后端、不争抢 Chromium 缓存
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

  // 日志落盘：打包后开发者工具不可见，用户侧故障诊断全靠 userData/logs/guman.log
  mainLog.init(path.join(app.getPath('userData'), 'logs'));
  const nativeConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: (console.info || console.log).bind(console),
  };
  console.log = (...a) => { nativeConsole.log(...a); mainLog.log(...a); };
  console.warn = (...a) => { nativeConsole.warn(...a); mainLog.warn(...a); };
  console.error = (...a) => { nativeConsole.error(...a); mainLog.error(...a); };
  console.info = (...a) => { nativeConsole.info(...a); mainLog.log(...a); };
  // 全局兜底：未捕获异常/未处理拒绝只记录不崩溃（播放不能因一处缺陷整体退出）
  process.on('uncaughtException', (e) => mainLog.error('uncaughtException:', e));
  process.on('unhandledRejection', (reason) => mainLog.error('unhandledRejection:', reason));

  // 启动后端（同进程 express，端口动态分配）；实际端口经 hostServer.getPort() 获取
  hostServer = require('./server');
}

// 等待后端监听完成（动态端口已确定）；超时/失败返回 false
function waitForServer(timeoutMs = 20000) {
  return Promise.race([
    hostServer.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('后端启动超时')), timeoutMs)),
  ]).then(() => true).catch((e) => { console.error('[boot] 后端启动失败:', e); return false; });
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
      additionalArguments: gumanMetaArgs(),
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${hostServer.getPort()}/`);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 最大化状态同步给渲染层（用于切换最大化/还原图标）
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:max-state', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:max-state', false));

  // 渲染进程崩溃/无响应：落盘诊断（打包后唯一可见的线索）
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    mainLog.error('render-process-gone:', JSON.stringify(details));
  });
  mainWindow.on('unresponsive', () => mainLog.warn('主窗口无响应'));
  // 渲染层 console 错误落盘：打包后用户侧前端异常的唯一诊断来源
  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 3) mainLog.error(`[renderer] ${source}:${line} ${message}`);
  });

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

/* ---------- 首启用户协议 ---------- */
// 首次启动展示使用声明与免责条款，同意后写标记文件；直接关窗视为不同意并退出。
const AGREEMENT_FILE = path.join(app.getPath('userData'), '.agreed');
let agreementWindow = null;
let agreementResolver = null;

function ensureAgreement() {
  return new Promise((resolve) => {
    try { if (fs.existsSync(AGREEMENT_FILE)) return resolve(true); } catch (_) { /* ignore */ }
    agreementResolver = resolve;
    try {
      agreementWindow = new BrowserWindow({
        width: 620,
        height: 660,
        resizable: false,
        minimizable: false,
        maximizable: false,
        title: '使用声明',
        icon: nativeImage.createFromBuffer(iconMod.getIconBuffers().ico),
        backgroundColor: '#0e0d0b',
        // 隐藏菜单栏（设置项而非方法调用：Electron 新版本已移除 setMenuBarVisible）
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          additionalArguments: gumanMetaArgs(),
        },
      });
      agreementWindow.loadFile(path.join(__dirname, 'renderer/agreement.html'));
      // 兜底决策通道：页面 preload 失效时用 hash 导航传递决定（见 agreement.html decide()）
      agreementWindow.webContents.on('did-navigate-in-page', (_e, url) => {
        if (/agreement\.html#agree$/.test(url)) agreementDecide(true);
        else if (/agreement\.html#decline$/.test(url)) agreementDecide(false);
      });
      // 渲染进程报错落盘：打包后用户侧协议窗异常的唯一诊断来源
      agreementWindow.webContents.on('console-message', (_e, level, message, line, source) => {
        if (level >= 2) mainLog.warn(`[agreement] ${source}:${line} ${message}`);
      });
      agreementWindow.on('closed', () => {
        const r = agreementResolver;
        agreementResolver = null;
        agreementWindow = null;
        if (r) r(false);
      });
    } catch (e) {
      // 协议窗建不起来也不能挡住主程序：记录后放行
      mainLog.error('[agreement] 创建协议窗失败，跳过:', e);
      agreementResolver = null;
      agreementWindow = null;
      resolve(true);
    }
  });
}

ipcMain.handle('agreement:decide', (_e, ok) => {
  agreementDecide(!!ok);
  return true;
});

// 统一的协议决策出口（IPC 与 hash 兜底通道都汇到这里；只生效一次）
function agreementDecide(ok) {
  if (ok) {
    try { fs.writeFileSync(AGREEMENT_FILE, new Date().toISOString()); } catch (e) { mainLog.warn('写入协议标记失败:', e.message); }
  }
  const r = agreementResolver;
  agreementResolver = null;
  if (agreementWindow && !agreementWindow.isDestroyed()) agreementWindow.close();
  if (r) r(!!ok);
}

// 打开日志目录（设置页 → 关于）
ipcMain.handle('shell:openLogDir', async () => {
  try {
    await shell.openPath(mainLog.logsDir());
    return true;
  } catch (_) {
    return false;
  }
});

/* ---------- 自动更新（仅打包后；未配置发布地址时检查失败静默跳过） ---------- */
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = {
      info: (...a) => mainLog.log('[updater]', ...a),
      warn: (...a) => mainLog.warn('[updater]', ...a),
      error: (...a) => mainLog.error('[updater]', ...a),
    };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (e) => mainLog.warn('[updater] 检查更新失败（忽略）:', e.message));
    autoUpdater.on('update-downloaded', (info) => {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '发现新版本',
        message: `孤男音乐 v${info.version} 已下载完成`,
        detail: '重启应用后生效。',
        buttons: ['稍后重启', '立即重启'],
        defaultId: 1,
        cancelId: 0,
      }).then(({ response }) => {
        if (response === 1) autoUpdater.quitAndInstall(false, true);
      }).catch(() => {});
    });
    autoUpdater.checkForUpdatesAndNotify().catch((e) => mainLog.warn('[updater]', e.message));
  } catch (e) {
    mainLog.warn('[updater] 初始化失败（忽略）:', e.message);
  }
}

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
      additionalArguments: gumanMetaArgs(),
    },
  });
  lyricWindow.loadURL(`http://127.0.0.1:${hostServer.getPort()}/lyric-window.html`);
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
    if (!(await waitForServer())) {
      dialog.showErrorBox('孤男音乐启动失败', '本地服务未能启动，请到日志目录查看详情后重试。');
      app.quit();
      return;
    }
    // 首启用户协议：未同意前不创建主窗口
    if (await ensureAgreement()) {
      createWindow();
      setupAutoUpdate();
    } else {
      app.quit();
      return;
    }
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
