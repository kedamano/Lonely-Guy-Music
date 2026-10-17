'use strict';
/**
 * 托盘图标回归测试。
 *
 * 背景：Windows 下 nativeImage.createFromBuffer 只走 Chromium 的 PNG/JPEG 解码器，
 * 喂 ICO 容器会得到 0x0 的空图。以前 main.js 直接用 ICO buffer 建 Tray，
 * 不报错但托盘里是个「看不见的空白位」，用户表现为「安装版没有托盘图标」。
 *
 * 这里锁定三条契约：
 *   1) createFromBuffer(ico) 必须是空图 —— 证明这条路径不可用（防止有人改回去）
 *   2) createFromBuffer(buildPng(n)) 必须非空且尺寸正确 —— 托盘走这条
 *   3) Tray 用 PNG 建出来必须拿到非零屏幕坐标 —— 说明系统真的给它分配了托盘位置
 *
 * 用法：node_modules/electron/dist/electron.exe scripts/tray-check.js
 */
const { app, nativeImage, Tray, Menu } = require('electron');
const path = require('path');
const os = require('os');

// 若 shell 里残留 ELECTRON_RUN_AS_NODE=1，electron 会退化成纯 node 运行，
// require('electron') 只拿到一个路径字符串 —— 直接给出可操作的提示
if (!app || typeof app.whenReady !== 'function') {
  console.error('本脚本必须在 Electron 主进程里运行。\n'
    + '当前 ELECTRON_RUN_AS_NODE=' + (process.env.ELECTRON_RUN_AS_NODE || '(空)')
    + '\n请先 unset ELECTRON_RUN_AS_NODE，或用 npm run check:tray。');
  process.exit(2);
}

// 独立 userData，避免和正在运行的客户端抢单实例锁
app.setPath('userData', path.join(os.tmpdir(), 'guman-tray-check-' + Date.now()));
// 这个脚本不开窗口，只验证托盘；无窗口时 Chromium 会反复拉起 GPU 进程并崩溃（0xC0000005），直接关掉
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('in-process-gpu');

const results = [];
const check = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`);
};

app.whenReady().then(async () => {
  const iconMod = require('../assets/icon');
  const { ico } = iconMod.getIconBuffers();

  // 1) ICO buffer 不可用于 createFromBuffer
  const icoImg = nativeImage.createFromBuffer(ico);
  check(icoImg.isEmpty(), 'createFromBuffer(ICO) 为空图（证明该路径不可用）',
    `empty=${icoImg.isEmpty()} ${icoImg.getSize().width}x${icoImg.getSize().height}`);

  // 2) PNG buffer 各尺寸可用
  for (const size of [22, 32, 256]) {
    const img = nativeImage.createFromBuffer(iconMod.buildPng(size));
    const s = img.getSize();
    check(!img.isEmpty() && s.width === size && s.height === size,
      `createFromBuffer(PNG ${size}px) 可用`, `${s.width}x${s.height}`);
  }

  // 3) 真实 Tray 能拿到托盘位置
  const icon = nativeImage.createFromBuffer(iconMod.buildPng(process.platform === 'darwin' ? 22 : 32));
  let t = null;
  try {
    t = new Tray(icon);
    t.setToolTip('孤男音乐');
    t.setContextMenu(Menu.buildFromTemplate([{ label: 'check', enabled: false }]));
    await new Promise((r) => setTimeout(r, 600));
    const b = t.getBounds();
    check(b.width > 0 && b.height > 0, 'Tray 在托盘区获得非零尺寸',
      `bounds=${b.x},${b.y} ${b.width}x${b.height}`);
  } catch (e) {
    check(false, 'Tray 创建成功', e.message);
  } finally {
    // TRAY_KEEP=1 时保留图标若干秒，并截取托盘区域供人工核对
    if (process.env.TRAY_KEEP) {
      const b = t ? t.getBounds() : null;
      console.log(`[keep] 托盘保持 ${b ? b.x + ',' + b.y + ' ' + b.width + 'x' + b.height : 'n/a'}，等待截图…`);
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const { desktopCapturer, screen } = require('electron');
        const d = screen.getPrimaryDisplay();
        const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: d.size });
        const shot = srcs[0].thumbnail;
        const sz = shot.getSize();
        const cw = sz.width, ch = Math.min(72, sz.height);
        const cropped = shot.crop({ x: 0, y: sz.height - ch, width: cw, height: ch });
        const out = path.join(__dirname, '_tray-shot.png');
        require('fs').writeFileSync(out, cropped.toPNG());
        console.log(`[keep] 已截图 ${out}（屏幕 ${sz.width}x${sz.height}，裁 ${cw}x${ch}）`);
        console.log(`[keep] 托盘坐标 ${b ? b.x + ',' + b.y + ' ' + b.width + 'x' + b.height : 'n/a'}`);
      } catch (e) {
        console.log('[keep] 截图失败:', e.message);
      }
      await new Promise((r) => setTimeout(r, Number(process.env.TRAY_KEEP) || 8000));
    }
    if (t) { try { t.destroy(); } catch (_) {} }
  }

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n================ 汇总 ================`);
  console.log(`通过 ${pass}/${results.length}`);
  console.log(`platform=${process.platform} electron=${process.versions.electron}`);
  setTimeout(() => app.exit(pass === results.length ? 0 : 1), 300);
});
