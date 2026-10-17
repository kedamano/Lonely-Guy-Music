# 孤男音乐 v1.2.3 · 托盘图标修复

> 这个版本只做一件事：**让右下角的托盘图标真正出现。**

---

## 修了什么

### 托盘图标不可见

**现象**：安装版启动后，任务栏右下角找不到「孤男音乐」的托盘图标。但程序其实在托盘驻留——关掉窗口后音乐还在放，只是没有任何可见入口。

**根因**：主进程用 ICO 数据去创建托盘图标：

```js
const { ico } = iconMod.getIconBuffers();
const icon = nativeImage.createFromBuffer(ico);   // ← 这里
```

Windows 下 `nativeImage.createFromBuffer` 只走 Chromium 的 PNG/JPEG 解码器，**不认 ICO 容器**。它会返回一个 `0×0` 的空图，而且**不抛异常**——`new Tray(空图)` 照常成功，托盘区于是多了一个看不见的空白占位。

实测对照（Electron 44 / Windows）：

| 调用 | 结果 |
|---|---|
| `createFromBuffer(ICO)` | `empty=true` `0x0` ❌ |
| `createFromBuffer(PNG 32px)` | `empty=false` `32x32` ✅ |
| `createFromPath("icon.ico")` | `empty=false` `256x256` ✅ |

任务栏图标一直是正常的，是因为那来自 exe 内嵌资源（electron-builder 写入），跟这段代码无关。

**修复**：运行时图标一律用 PNG buffer，ICO 只留给 electron-builder 写 exe 资源。

- 窗口 / 任务栏图标：256px PNG
- 托盘图标：Windows 32px、macOS 22pt
- 托盘创建失败会写入 `userData/logs/guman.log`，不再静默

### 顺带修掉的三处隐患

1. **托盘不可用时的「程序消失」**：原来关闭窗口一律 `hide()`。如果托盘没建起来，窗口一关就再也找不回来。现在托盘不可用时，关闭窗口退化为真正退出。
2. **Windows 通知送不到**：补上 `app.setAppUserModelId('com.guman.music')`（与 `electron-builder` 的 `appId` 一致）。缺了它，托盘气泡和系统通知会被静默丢弃。
3. **第一次找不到图标**：Windows 11 默认把新出现的托盘图标折叠进任务栏的 `^` 溢出区。首次运行会给一次说明气泡，讲清怎么把它拖出来固定。只提示一次，之后不再打扰。

---

## 下载

| 平台 | 文件 |
|---|---|
| Windows x64 | `GumanMusic-1.2.3-x64.exe` |
| macOS Intel | `GumanMusic-1.2.3-x64.dmg` / `.zip` |
| macOS Apple Silicon | `GumanMusic-1.2.3-arm64.dmg` / `.zip` |
| Linux | `GumanMusic-1.2.3-x86_64.AppImage` / `amd64.deb` |

已装 1.2.2 的用户，启动后会自动收到 1.2.3 更新提示。

---

## 回归

新增 `npm run check:tray`（`scripts/tray-check.js`），5 项断言锁死这个坑：

```
✅ createFromBuffer(ICO) 为空图（证明该路径不可用） — empty=true 0x0
✅ createFromBuffer(PNG 22px) 可用 — 22x22
✅ createFromBuffer(PNG 32px) 可用 — 32x32
✅ createFromBuffer(PNG 256px) 可用 — 256x256
✅ Tray 在托盘区获得非零尺寸 — bounds=1470,1019 32x49
```

最后一条最关键：`bounds` 非零说明系统真的给图标分配了托盘位置，不再是无形的空位。

同时把 `npm run check:version` 也补进了 README——它守的是 v1.2.2 修掉的「关于面板显示 `v v1.2.2`」那个重复前缀。测试总数 174 → 184。

---

## 已知限制（未变）

- 免费收录以 128K 为主；VIP 曲目（如周杰伦原版）通常只有翻唱或其他收录版本可播。
- 未提供 QQ 登录入口。需要 QQ 原声时，可在 `userData/platform-auth.json` 写入 `{ "tx": { "uin": "你的QQ号", "qmKeyst": "cookie 里的 qm_keyst" } }`，取链会优先走 QQ 官方 vkey。
