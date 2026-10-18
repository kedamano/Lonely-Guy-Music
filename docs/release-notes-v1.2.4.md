# 孤男音乐 v1.2.4 · 存储管理 + 预取下一首

> 这个版本给客户端补上了**缓存上限与清理入口**，以及**静默预取下一首**，让长时间挂着听的体验更顺、磁盘占用可控。

---

## 新功能

### 存储管理（设置 → 存储）

- **占用可视化**：设置页新增「存储」分区，显示当前 HTTP 缓存占用，可手动刷新。
- **一键清理**：立即清理按钮，只清 HTTP 缓存，不动 Cookie / localStorage / IndexedDB，收藏、歌单、登录态都不受影响。
- **缓存上限**：提供 64 / 128 / 256 / 512 / 1024 MB 五档上限。超限后自动触发清理，上限值持久化到 `userData/cache-config.json`，重启后仍生效。
- 后台每 10 分钟自动巡检一次（启动后 90 秒首查），无需手动干预。

**底层**：`main.js` 新增 `cache:stats` / `cache:clear` / `cache:setLimit` 三条 IPC，封装 `session.getCacheSize()` 与 `session.clearCache()`；服务端 `server/index.js` 同步提供 `/api/cache/stats` 与 `/api/cache/clear`（已加入 `isReserved`，避免被 `/api/*` 通配 mock 吞掉）。

### 预取下一首

- 开播后 3 秒静默解析播放列表里的下一首，并预热前 1.5MB 音频（`Range: bytes=0-1572863`），切歌时几乎无等待。
- **流量敏感可关**：设置页「预取下一首」开关，默认开启；关掉后完全不发预取请求。
- 单曲循环、本地曲目自动跳过，不走预取。
- 预取使用安静模式（`_resolveUrl(track, token, { quiet: true })`），不写入播放状态、不弹换源提示。

---

## 下载

| 平台 | 文件 |
|---|---|
| Windows x64 | `GumanMusic-1.2.4-x64.exe` |
| macOS Intel | `GumanMusic-1.2.4-x64.dmg` / `.zip` |
| macOS Apple Silicon | `GumanMusic-1.2.4-arm64.dmg` / `.zip` |
| Linux | `GumanMusic-1.2.4-x86_64.AppImage` / `amd64.deb` |

已装 1.2.3 的用户，启动后会自动收到 1.2.4 更新提示。

---

## 回归

- `npm run check:cache`（`scripts/cache-check.js`）7 项：统计 / 清理 / 上限持久化。
- `npm run check:cache:e2e`（`scripts/cache-e2e.js`）7 项：真实 IPC 调用，实测 1.8MB 缓存清理后释放 1.8MB、上限持久化写入 `{"limitMB":256}`。
- 预取断言使用「整场会话累积 Range 请求」判断，避免单次自动切歌导致的误报。
- 全量 **200 项断言** 通过（ui-smoke 73 / proxy 12 / platform-url 14 / version 5 / tray 5 / cache 7 / cache-e2e 7）。

---

## 已知限制（未变）

- 免费收录以 128K 为主；VIP 曲目（如周杰伦原版）通常只有翻唱或其他收录版本可播。
- 未提供 QQ 登录入口。需要 QQ 原声时，可在 `userData/platform-auth.json` 写入 `{ "tx": { "uin": "你的QQ号", "qmKeyst": "cookie 里的 qm_keyst" } }`，取链会优先走 QQ 官方 vkey。
