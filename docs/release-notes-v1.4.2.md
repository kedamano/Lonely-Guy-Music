# 孤男音乐 v1.4.2 发布说明

> 主题：**补齐最后两块体验断层 —— 云端歌单双向编辑 + QQ 登录 UI**

v1.4.1 之后，路线图里只剩两件事没做完：歌单只能单向消费、QQ 登录态要手改 JSON 文件。本版把这两块一次补齐，项目功能面至此闭合。

---

## 一、云端歌单双向编辑

以前「我的 → 云歌单」明确标注「只读不改动云端数据」，用户只能在网易云 App 里整理歌单。现在客户端内即可完整编辑：

| 操作 | 入口 | 上游接口 |
|---|---|---|
| 新建云端歌单 | 云歌单 Tab「新建云端歌单」；右键菜单「新建云端歌单…」 | `GET /playlist/create?name=&privacy=&type=NORMAL` |
| 重命名 | 自建歌单卡片「⋮」→ 重命名；详情页「重命名」 | `GET /playlist/name/update?id=&name=` |
| 删除 | 自建歌单卡片「⋮」→ 删除云端歌单；详情页「删除歌单」 | `GET /playlist/delete?id=` |
| 加歌 | 任意曲目右键 →「加入歌单…」→ 云端歌单分组 | `GET /playlist/tracks?op=add&pid=&tracks=` |
| 移出歌曲 | 自建歌单详情页行内删除按钮 / 右键「从云端歌单移除」 | `GET /playlist/tracks?op=del&pid=&tracks=` |

设计要点：

- **不新增后端写路由**：`/api/*` 通配反代本就把未保留路径透传给本地 NeteaseCloudMusicApi，并由后端注入登录 cookie。本次只在渲染层补写操作，凭证依旧不出后端。
- **业务码翻译**：NCM 写接口失败时 HTTP 仍是 200、用 `code` 表达原因。新增 `ncmWrite()` 统一把 `code != 200/0` 翻译成可见错误，避免「点了没反应」。
- **缓存一致性**：写成功后立即失效 `pldetail:` / `pltracks:` / `personalized` 读缓存，并清空云歌单内存缓存，详情页不会继续显示改动前的曲目。
- **只用「只改名」接口**：官方另有 `/playlist/update`（batch），但它会把 `desc` / `tags` 一并置空；本版改用 `/playlist/name/update`，避免重命名顺手清掉歌单简介与标签。
- **边界保护**：
  - 未登录或网易云接口离线时，写操作直接拦截并提示，不会把请求打到 mock 上得到 404；
  - 只有网易云数字 id 的曲目能写入云端歌单，QQ / 酷狗聚合结果会明确提示「不是网易云曲目」；
  - 「我喜欢的音乐」由网易云自身维护，不提供删除入口；收藏的别人歌单不可删；
  - 删除前二次确认，并说明会同步删掉手机端歌单。

配套 UI：歌单网格新增可选 `menuFor(pl)` 能力，卡片右上角「⋮」按钮与右键菜单等效，点击「⋮」不会顺带打开歌单；普通歌单网格（音乐馆 / 搜索 / 收藏）行为完全不变。

## 二、QQ 音乐登录 UI

以前要拿 QQ 原生音质，得手动在 `userData/platform-auth.json` 里写 `{ "tx": { "uin": "…", "qmKeyst": "…" } }`。现在设置页新增「QQ 音乐登录态」分区：

- **整段 Cookie 粘贴（推荐）**：在浏览器登录 `y.qq.com` 后复制完整 Cookie，粘贴即自动提取 `uin` 与 `qm_keyst`；也兼容直接粘贴整份 `platform-auth.json` 内容；
- **手动两字段**：也可以只填 `uin` 与 `qm_keyst`；
- **保存即生效**：无需重启，下一次 QQ 取链立刻读到新凭证；
- **状态可见**：显示「已配置 / 未配置」、uin 掩码与更新时间，一键清除恢复跨源兜底。

后端新增 `server/platform-auth.js` 与三个同源接口：

| 接口 | 作用 |
|---|---|
| `GET /api/platform/auth` | 只回掩码状态，**不返回 `qm_keyst`** |
| `POST /api/platform/auth` | 解析 → 校验 → 原子写入 `platform-auth.json` |
| `POST /api/platform/auth/clear` | 删除 `tx`，保留其它平台配置 |

实现细节：

- **零耦合**：取链层 `platform-url.js` 每次 `readAuth()` 都从文件读，凭证管理模块只负责写同一个文件，两边天然一致，不需要共享内存状态或互相 require；
- **原子写**：先写 `.tmp` 再 `rename`，避免保存中途断电留下半截 JSON 把登录态弄丢；
- **`uin` 规范化**：QQ 网页 Cookie 的 uin 常带 `o` 前缀或 URL 编码（如 `p_uin=o0123…`）。解析出纯数字 `uin` 供 `comm.uin` 使用，同时保留 `uinRaw` 原样放进 Cookie 请求头；`resolveVkey` 改为 `uin=${auth.uinRaw || auth.uin}`，兼容老配置；
- **凭证不外泄**：HTTP 响应只含掩码；保存成功后清空输入框，凭证不留在 DOM；`qm_keyst` 输入框为 `password` 类型。

## 三、歌曲详情页 UI 隔离

打开「正在播放」详情页时，主界面其实并没有被真正遮住：侧栏账号昵称、「搜索 / 声场」等页标题、顶栏当前曲名、以及列表里的按钮文字，会透过半透明封面背景淡淡地浮在歌词后面。

根因是两处叠加：

- `.np` 覆盖层自身**没有不透明底色**，只有 `::before` 一层中心 `alpha .34`、边缘 `.9` 的径向渐变，画面中部几乎是全透明的；
- `.np.open` 还对整个覆盖层做 `opacity: 0 → 1` 淡入，转场的 350ms 里底层 UI 更是完整可见。

此前只给 `playerbar` 写了隐藏规则，标题栏、侧栏、主视图、声场面板都没处理。

修复方式：

- `.np` 增加 `background: var(--bg)` 不透明底色，底层 UI 在封面模糊 / 主色 / 纯净底色三种模式下都无从透出；
- 淡入动画从覆盖层整体移到 `.np__inner` 与 `.np__close`，底色**立即生效**、内容柔和淡入，转场期间也不露底。特意不给 `.np__bg` 加动画——它的 `opacity` 由 `data-mode` 控制，fade 会临时覆盖成 1 导致封面闪白；
- 不删底层 DOM、不改业务逻辑，纯靠底色与层叠隔离：`openNp()` 依旧先关队列，详情页内「播放队列」按钮依旧先关详情页再显示队列，弹窗、迷你模式、响应式布局的既有规则全部保留。

真实 Chromium 复验：详情页背景计算值为不透明 `rgb(13,12,10)`、整体 `opacity: 1`，反馈截图里 5 个红框坐标的 `elementFromPoint` 全部命中详情页元素，底层文字完全消失，封面氛围与歌词可读性保持不变。

## 四、测试与文档

新增三个 node-only 回归脚本，合计 **120 项断言**：

- `scripts/platform-auth-check.js`：Cookie / JSON / 双字段共 9 类输入解析、uin 规范化、非法输入拒绝、原子落盘、掩码与凭证不外泄、clear 保留其它平台字段、前后端接线契约；
- `scripts/cloud-playlist-check.js`：NCM 五个写模块的参数契约、`ncmWrite` 业务码翻译与缓存失效、app.js 全部编辑入口、网格菜单委托、图标 / 样式 / i18n；
- `scripts/np-overlay-check.js`：26 项详情页隔离（不透明底色、`--bg` 无 alpha、z-index 层级、淡入只作用于内容、三种封面背景模式、队列 / 迷你模式 / 弹窗不回归）；设置 `GUMAN_NP_URL` 时再加 7 项真实 Chromium 命中测试。

全量断言数 **306 → 426**；`npm run check:platform-auth`、`check:cloud-playlist`、`check:np-overlay` 可直接运行。另起本地服务做过真实 HTTP 端到端验证：保存 → 掩码回读 → 非法输入 400 → 清除，以及凭证明文只落本机、响应体不含凭证；详情页则做了真实浏览器渲染与命中测试。

路线图最后一项「歌单双向编辑」已勾选，README / README_EN 的已知限制同步更新。

---

## 变更文件

| 文件 | 变更 |
|---|---|
| `server/platform-auth.js` | 新增：凭证解析 / 校验 / 原子落盘 / 掩码状态 |
| `server/index.js` | 引入模块、初始化同一文件、挂载 3 个 `/api/platform/auth*` 路由 |
| `server/platforms/qq.js` | Cookie 头优先使用 `uinRaw` |
| `renderer/js/api.js` | 新增 `ncmWrite` 与 7 个云歌单 / 平台凭证方法 |
| `renderer/js/app.js` | 云歌单新建 / 重命名 / 删除 / 加歌 / 移出、详情页编辑、右键菜单云端分组 |
| `renderer/js/ui.js` | `renderPlaylistGrid` 支持 `opts.menuFor` 与卡片菜单委托 |
| `renderer/js/settings.js` | 新增「QQ 音乐登录态」分区与加载 / 保存 / 清除逻辑 |
| `renderer/index.html` | 新增 `i-more` / `i-cloud` 图标 |
| `renderer/styles.css` | 卡片更多按钮、凭证输入区样式；详情页不透明底色与淡入隔离 |
| `renderer/js/i18n.js` | 繁中与英文新增文案映射 |
| `scripts/platform-auth-check.js`、`scripts/cloud-playlist-check.js`、`scripts/np-overlay-check.js` | 新增 120 项断言（含 7 项可选浏览器命中测试） |
| `package.json`、README、README_EN、本文件 | 版本 1.4.2、测试数 426、路线图与已知限制 |
