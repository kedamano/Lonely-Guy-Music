# 孤男音乐 v1.2.5 · 咪咕 / 汽水搜索源接入

> 这个版本把**咪咕音乐、汽水音乐**正式接入搜索（此前只在取链层支持），现在搜索面板能直接选这两个平台搜歌、出结果、可播。

---

## 新功能

### 咪咕 / 汽水搜索源接入

- **搜索面板新增两个平台**：咪咕音乐、汽水音乐。与网易云 / QQ / 酷狗并列，输入即搜、回车执行。
- **走洛雪音源同一条路**：实测咪咕官方 `scr_search_tag` 接口已封（返回 SPA 页面 HTML），汽水无任何公开搜索入口（需登录态/签名）。因此搜索与取链统一委托给已导入的洛雪音源脚本（`mg` / `qs` 本就在 `VALID_SOURCES` 中），不依赖随时会变失效的官方接口。
- **统一结果结构**：音源返回经 `resolveSearch` 规整为与现有搜索一致的曲目结构，`musicInfo` 原样回传供取链使用，前端渲染、收藏、播放逻辑零改动。
- **无音源时优雅降级**：未导入支持该平台搜索的音源时，搜索会明确提示「请导入支持该平台搜索的音源」，不崩溃、不污染错误提示。

**底层改动**：
- `server/source-manager.js`：新增 `resolveSearch()`，按洛雪协议（`info.keywork`）调用各音源脚本的 `search` action；`normalizeSources` 现在保留 `search` 能力声明。
- `server/platform-search.js`：平台清单新增 `mg`(咪咕音乐) / `qs`(汽水音乐)，`viaSource: true`；`searchPlatform` 对这两个平台转交 `resolveSearch`。
- `server/platform-url.js`：对无原生取链的 mg/qs 静默跳过。
- 前端 `renderer/js/ui.js`、`renderer/js/app.js`：平台标签与离线回退清单同步更新。

---

## 下载

| 平台 | 文件 |
|---|---|
| Windows x64 | `GumanMusic-1.2.5-x64.exe` |
| macOS Intel | `GumanMusic-1.2.5-x64.dmg` / `.zip` |
| macOS Apple Silicon | `GumanMusic-1.2.5-arm64.dmg` / `.zip` |
| Linux | `GumanMusic-1.2.5-x86_64.AppImage` / `amd64.deb` |

已装 1.2.4 的用户，启动后会自动收到 1.2.5 更新提示。

---

## 回归

- `scripts/source-search-check.js`（新增，15 项）：平台清单含 mg/qs、`platformList` 暴露 `searchable/viaSource`、mock 音源搜索返回统一结构、qs 无音源时清晰报错、未知平台拒绝。
- 无回归：`platform-url-check` 14/14、`proxy-check` 12/12。
- 全量 **215 项断言** 通过（ui-smoke 73 / proxy 12 / search-guide 19 / platform-url 14 / version 5 / tray 5 / cache 7 / cache-e2e 7 / source-search 15）。

---

## 使用前提（重要）

咪咕 / 汽水的**搜索与播放都依赖先在「设置 → 自定义源管理」导入支持这两个平台 search / 取链的音源**——与现有取链前提一致。未导入时搜索会明确提示，不会崩溃。

---

## 已知限制（未变）

- 免费收录以 128K 为主；VIP 曲目通常只有翻唱或其他收录版本可播。
- 未提供 QQ 登录入口。需要 QQ 原声时，可在 `userData/platform-auth.json` 写入 `{ "tx": { "uin": "你的QQ号", "qmKeyst": "cookie 里的 qm_keyst" } }`，取链会优先走 QQ 官方 vkey。
- 安装包未签名：Windows 弹 SmartScreen、macOS 未公证，需手动「仍要运行」。
