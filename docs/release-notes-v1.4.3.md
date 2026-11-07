# 孤男音乐 v1.4.3 发布说明

> 主题：**把「能用」推到「可放心分发」—— 发版测试门禁 + 代码签名/公证链路**

v1.4.2 收尾时剩下两件事：安装包未签名、CI 无测试门禁。本版把这两块补齐。

---

## 一、发版测试门禁

### 原来的漏洞

`ci.yml` 只在 `push` 到 `main`/`master` 与 `pull_request` 时触发，只跑 5 个脚本；而 `release.yml` 由 `v*` tag 触发，tag push **不匹配 branches 过滤**，且 `build` / `publish` 不依赖任何测试结果。也就是说：打 tag 可以直接绕过全部测试发版。

### 现在

- `release.yml` 新增独立的 `test` job（`ubuntu-latest`、Node 22、`npm ci`），依次跑：
  - `npm run check:syntax` —— 65 个 JS 文件的跨平台语法检查；
  - `npm run check:all` —— 聚合 12 个 node-only 回归脚本，任一失败即以非零码退出。
- `build`（三平台矩阵）`needs: test`，`publish` `needs: [test, build]`：**测试不过，连包都不会开始打**。
- `ci.yml` 改为复用同两条命令，主干/PR 与发版共用一份测试清单，不再各维护一份。

两个新脚本：

| 脚本 | 作用 |
|---|---|
| `scripts/check-syntax.js` | 用 Node 遍历主进程 / preload / server / renderer/js / scripts / 打包配置，替代原来只能在 bash 下跑的 `for f in ...; node --check` |
| `scripts/check-all.js` | 统一聚合 12 个脚本；显式清掉 `GUMAN_NP_URL`，保证门禁不依赖外部服务、Electron 或网易云网络 |

需要真机 DOM / 本地服务的 `ui-smoke`、`cache-check`、`cover-lyric-check` 仍按 README 在本地单独跑；`np-overlay-check` 的浏览器命中测试通过 `GUMAN_NP_URL` 手动开启。

`scripts/ci-gate-check.js`（43 项）把 `needs` 依赖图、聚合清单、secrets 注入、版本一致性全部锁成契约，防止以后被改回去。

## 二、代码签名与公证链路

### 先说明边界

**仓库不含、也不应该包含任何证书。** 没有 CA 签发的 OV/EV 代码签名证书与 Apple Developer ID，就不可能产出「受信任签名」——这不是配置能绕过的。因此本版交付的是**完整可启用的签名链路**：配了凭据就自动签名 + 公证，没配就照常出未签名包，构建不会失败。默认产物仍是未签名包，SmartScreen / Gatekeeper 提示依旧存在，直到按 [code-signing.md](code-signing.md) 配置证书。

### 实现

- `electron-builder.yml` → **`electron-builder.config.js`**：electron-builder 支持配置文件导出函数，于是可以按环境变量动态生成配置，不必维护两份文件、也不会破坏无证书构建。

| 环境变量状态 | Windows | macOS |
|---|---|---|
| 无证书 | 不签名 | `identity: null`、`hardenedRuntime: false`、`notarize: false`（与旧版完全一致） |
| 有证书、无 Apple 凭据 | SHA256 签名 + RFC3161 时间戳 | Developer ID 签名 + hardened runtime + `gatekeeperAssess`，不公证 |
| 有证书 + 完整 Apple 凭据 | 同上 | 同上 **+ 公证** |

- `hardenedRuntime` 在无证书时必须保持 `false`：ad-hoc 签名叠加 hardened runtime 会因 library validation 让应用启动即崩。新增 `build/entitlements.mac.plist` / `.inherit.plist`，提供 Electron 必需的 `allow-jit`、`disable-library-validation`、本地回环监听与文件读写权限。
- Windows 签名参数放在 `win.signtoolOptions` 下（electron-builder 26 的 schema 要求；放顶层会被拒绝——本地真实打包烟测抓到并修正）。
- `release.yml` 的打包 step 注入 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` / `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` / `CSC_NAME` 与三组 Apple 公证凭据；`CSC_IDENTITY_AUTO_DISCOVERY` 改为按 `MAC_CSC_LINK` 是否存在动态取值。未配置的 secret 求值为空串，等价于未签名构建。
- PR 构建不签名（electron-builder 自身的 `isPullRequest()` 保护）。
- `GUMAN_SIGN_DEBUG=1` 只打印布尔状态，不打印任何凭据；`.gitignore` 新增 `*.pfx` / `*.p12` / `*.cer` / `*.pvk` / `*.key` / `.env*` 与 entitlements 例外。

完整申请、导出、配置 Secrets、本地验证（`Get-AuthenticodeSignature` / `codesign` / `spctl` / `xcrun stapler`）与故障排查见 [docs/code-signing.md](code-signing.md)。

`scripts/signing-check.js`（52 项）覆盖：状态机 9 类凭据组合、无证书/有证书/只签不公证三种配置产物、`signtoolOptions` 嵌套、entitlements 完整性、证书绝不入库、CI secrets 接线，以及配置命名与打包命令的 `-c` 契约。

### 两个实测踩到的坑

1. **electron-builder 26 的签名参数位置**：`signingHashAlgorithms` / `rfc3161TimeStampServer` 必须放在 `win.signtoolOptions` 下，放 `win` 顶层会被 schema 拒绝（`configuration.win should be one of these: null`）。本地真实打包烟测发现并修正。
2. **配置文件不能与 CLI 同名**：最初命名为 `electron-builder.js`，结果 `npx electron-builder` / `npm run dist` 会把它当成要执行的本地脚本，静默 `exit 0` 却不出包——主干 CI 的「上传安装包产物」报 `dist/*.exe` 不存在，提前暴露。改名为 `electron-builder.config.js` 并在所有打包命令显式 `-c`，`check:signing` 增加了防回归断言。

## 三、验证

| 项目 | 结果 |
|---|---|
| `npm run check:syntax` | 65 个 JS 文件全部通过 |
| `npm run check:all` | 12/12 脚本通过，0 失败 |
| 本地真实打包烟测 | 干净输出目录下 `electron-builder --win --dir` **exit 0**、产物正常生成；改名后复跑确认 `• electron-builder version=26.15.3`、`[builder] signing state: {"win":false,...}`、`loaded configuration file=electron-builder.config.js`，并进入 packaging |
| 主干 CI | `42335268015` **全绿**：语法检查、全量门禁、`npm run dist` 真实打包出 exe 并上传产物（改名修复前这一步正是失败点） |
| 发版 CI | `42335476363` **completed/success，5 个 job 全绿**：回归门禁（ubuntu，日志实测 `check:syntax` 65 文件 + `check:all` 12/12）→ Windows / macOS / Linux 三平台构建 → 发布；**15 个资产**齐全，`latest.yml` / `latest-mac.yml` / `latest-linux.yml` 均为 `version: 1.4.3` |
| 配置加载器实测 | `getConfig()` 返回 `configFile=electron-builder.config.js`，appId / 产物名 / publish 全部与旧 yml 等价 |
| 全量断言 | **426 → 523**（新增 signing-check 52 + ci-gate-check 45） |

## 四、待办

- 证书本身需要用户自行申请并写入 GitHub Secrets（本仓库不代管凭据）；
- EV 证书常绑定硬件 token，若走 CI 需改用云签名服务或带 HSM 的自托管 runner。

---

## 变更文件

| 文件 | 变更 |
|---|---|
| `electron-builder.config.js` | **新增**（替代 `electron-builder.yml`）：按凭据动态生成签名配置；命名刻意避开与 CLI 同名 |
| `electron-builder.yml` | 删除（避免 yml 优先导致 JS 配置永不生效） |
| `build/entitlements.mac.plist`、`.inherit.plist` | 新增：hardened runtime 下 Electron 必需权限 |
| `.github/workflows/release.yml` | 新增 `test` 门禁 job、三平台与发布依赖它、注入全部签名 secrets |
| `.github/workflows/ci.yml` | 复用 `check:syntax` / `check:all`，测试清单单一来源 |
| `scripts/check-syntax.js`、`check-all.js` | 新增：跨平台语法检查 + 发版门禁聚合器 |
| `scripts/signing-check.js`、`ci-gate-check.js` | 新增 97 项契约断言 |
| `docs/code-signing.md`、本文件 | 新增签名接入指南与发布说明 |
| `.gitignore`、`package.json`、README、README_EN | 证书忽略规则、4 个 check 命令、打包命令显式 `-c`、版本 1.4.3、测试数 523、路线图与 FAQ 更新 |
