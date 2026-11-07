# 代码签名与公证接入指南

> v1.4.3 起支持。**仓库本身不含任何证书**——这是刻意设计：私钥绝不能进版本库。
> 本指南说明如何把证书放进环境变量 / GitHub Secrets，让三平台产物自动变成受信任签名包。

## 先说清楚：什么能修、什么不能修

| 现象 | 未签名 | 配好证书后 |
|---|---|---|
| Windows SmartScreen「未知发布者」蓝色警告 | 有 | 显示已验证的发布者名称；**信誉仍需随下载量积累**，OV / IV / EV 都一样 |
| Windows 安装时「未知发布者」 | 有 | 显示证书主体名称 |
| macOS「已损坏，无法打开」/ Gatekeeper 拦截 | 有 | 签名 + 公证后直接双击打开 |
| 自动更新（electron-updater） | 可用但会被部分安全软件拦 | 不再被拦 |

**没有证书就无法产出受信任签名**，这不是配置能绕过的：Windows 需要 CA 签发的 OV / IV / EV 代码签名证书，macOS 需要 Apple Developer Program 的 Developer ID 证书。下面做的是把这两条链路完整接好——配了就签，没配就照常出未签名包，**构建不会失败**。

> **2026 年现状（申请前必读）**：自 2023-06-01 起 CA/Browser Forum 的 Code Signing Baseline Requirements 要求公开信任的代码签名私钥必须在 FIPS 140-2 Level 2 / CC EAL 4+ 硬件中生成且**不可导出**，主流 CA 已不再发放可下载的 `.pfx`。因此本文原来的「导出 pfx → `WIN_CSC_LINK`」路径**只适用于自签名内测证书，或 CA 明确提供合规 PKCS#12 的少数产品**；正式分发请走下面的云签名服务。macOS 的 Developer ID 走 Apple 自有 PKI，不涉及该限制，仍可导出 `.p12`，`MAC_CSC_LINK` 链路完全可用。

## 配置是怎么工作的

`electron-builder.config.js`（替换了原来的静态 `electron-builder.yml`）导出一个函数，按环境变量动态生成配置：

| 环境变量状态 | Windows | macOS |
|---|---|---|
| 没有任何证书变量 | 不签名 | `identity: null`、`hardenedRuntime: false`、`notarize: false`（与旧版行为完全一致） |
| 有证书、无 Apple 凭据 | `WIN_CSC_LINK`（pfx 可用时）走 SHA256 签名 + RFC3161 时间戳；云签名服务走 CI 后置签名 step（§1.5） | Developer ID 签名 + hardened runtime + `gatekeeperAssess`，**不公证** |
| 有证书 + 完整 Apple 凭据 | 同上 | 同上 **+ 公证（notarize）** |

`hardenedRuntime` 在无证书时必须保持 `false`：ad-hoc 签名叠加 hardened runtime 会因 library validation 让应用启动即崩。`build/entitlements.mac.plist` / `.inherit.plist` 提供 Electron 必需的 `allow-jit`、`disable-library-validation` 等权限，electron-builder 会自动加载。

状态可用 `GUMAN_SIGN_DEBUG=1` 打印（只打印布尔值，不打印任何凭据）。`npm run check:signing` 会在任意凭据组合下回归这套状态机。

> **为什么配置文件叫 `electron-builder.config.js` 而不是 `electron-builder.js`**：根目录若存在与 CLI 同名的 `electron-builder.js`，`npx electron-builder` 以及 npm scripts 里的 `electron-builder` 会把它当作要执行的本地脚本——配置文件只导出函数、没有任何副作用，于是命令静默 `exit 0` 却一个包都不打（主干 CI 实测踩到过：`dist/*.exe` 不存在）。因此所有打包命令都显式带 `-c electron-builder.config.js`，`npm run check:signing` 也把「根目录不得存在同名文件 + 所有命令必须带 `-c`」锁成了断言。

---

## 一、Windows（代码签名证书申请）

### 1.1 申请前必须知道的三条规则

| 生效时间 | 规则 | 对你的影响 |
|---|---|---|
| 2023-06-01 | CA/B Forum Code Signing BR：私钥须在 FIPS 140-2 L2 / CC EAL4+ 硬件中生成且不可导出 | **拿不到可下载的 `.pfx`**；USB token 也插不进 GitHub-hosted runner → CI 签名必须走云签名服务 |
| 2024-08 | 微软从受信任根移除 EV 代码签名 OID | **EV 不再让 SmartScreen「立即放行」**，OV / IV / EV 一律靠下载量积累信誉。别为躲警告多花 EV 的钱；EV 现在只对内核驱动签名 / WHQL 是必需的 |
| 2026-03-01 | CSC-31：单张证书最长 460 天（部分 CA 执行 458 天） | 多年套餐 = 逐年免费重签，不是「买完一劳永逸」；**每次签名务必加 RFC3161 时间戳**，否则证书一到期旧包就失效 |

签名能立即解决的是「未知发布者」和篡改校验；SmartScreen 的蓝色警告仍可能在新证书的头几周出现，属正常现象。

### 1.2 按申请主体选路径

| 路径 | 谁能申请 | 公开标价（以结算页为准） | CI 可用性 | 结论 |
|---|---|---|---|---|
| **A. Azure Artifact Signing**（原 Trusted Signing） | 组织限美 / 加 / 欧盟 / 英国（需 3 年以上可核验税务记录）；**个人开发者仅限美国、加拿大** | Basic 约 $9.99/月（5000 次签名） | 最好，GitHub Actions 原生 | 中国大陆个人开发者**不符合地域条件**，先排除 |
| **B. SSL.com IV + eSigner for Code** | **个人可申请**，政府签发身份证件验证，无需营业执照 | IV 证书约 $129/年 + eSigner 云签名订阅 | 可用，私钥留在 SSL.com 云 HSM | ✅ **个人开发者首选** |
| **C. Certum 云签名（SimplySign）** | **个人可申请**（身份证 + 手机号实名证明）；开源非商业项目另有低价档 | 个人版约 600 元/年；标准云签名约 €209 起 | 可用，但需 TOTP 种子进 secrets | ✅ 预算优先 / 有中文代理协助 |
| **D. CA 的 OV/EV + USB token** | 通常要求企业主体（营业执照、法人身份证、对公邮箱、电话回访） | OV 约 1800–4400 元/年，EV 更高 | ❌ GitHub-hosted runner 用不了，需自建 Windows runner 并插入 token | 有公司且愿意自托管时才考虑 |

> 避坑：低于 500 元/年、「免核验 / 当天出证」、单独售卖「离线私钥文件」的多为共享证书或翻新吊销证书，微软随时可能拉黑，且信誉不累计。

### 1.3 推荐：SSL.com IV + eSigner（路径 B）申请步骤

1. 在 [SSL.com IV Code Signing](https://ssl.com/zh-CN/产品/软件完整性/代码签名/iv/) 下单，有效期选 1 年即可（更长也要逐年重签）。
2. **密钥存储 / 递送务必选「eSigner 云签名」，不要选 YubiKey 实体代币**——后者无法用于云 CI。
3. 提交个人身份材料：政府签发的身份证件、可回访的电话、个人邮箱；完成电话回访验证（标准 3–5 个工作日）。
4. 订单签发后进入 SSL.com 账户，把该订单 **enroll 到 eSigner**：设置 4 位 PIN、把二维码扫进 TOTP 认证器（**保存 TOTP 种子**，CI 无人值守签名要用）。
5. CI 侧用 `CodeSignTool`（只上传文件哈希，不上传代码）对打好的 `.exe` / NSIS 安装包做后签名，凭据为账户名、密码、Credential ID、TOTP 种子，具体变量名以 SSL.com 官方 GitHub Action 文档为准。

### 1.4 备选：Certum 云签名（路径 C）申请步骤

1. 选「个人版 / 开源版」+ **SimplySign 云端**（不要选卡片 / UKey 版，那样 CI 签不了）。
2. 个人材料：身份证、手机号实名证明（如运营商缴费发票）、个人邮箱；企业版另需营业执照、法人身份证、企业域名邮箱、经办人授权书。
3. 审核通过后激活 SimplySign，同样**保存激活时显示的 TOTP 二维码种子**，并记下证书主体名称（签名时 `signtool /n "<主体>"` 要用）。
4. CI 侧安装 SimplySign 客户端后调用 `signtool sign /fd sha256 /tr <时间戳服务> /td sha256 /n "<主体>"`，并用 `signtool verify /pa` 强校验通过后才允许发布。

### 1.5 当前 CI 接线状态（重要）

`release.yml` 已注入 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`，`electron-builder.config.js` 也已配好 SHA256 + RFC3161 时间戳。**这条链路对「能拿到 pfx」的场景直接可用**（自签名内测、CA 明确提供合规 PKCS#12 的产品）。

但 B / C 这类云签名服务不提供 pfx，因此**还需要在 Windows 打包 step 之后补一个独立的签名 + 校验 step**（对 `dist/*.exe` 逐个签名 → `signtool verify /pa` → 失败即中止 job），否则产物仍是未签名包。这一步涉及新增 secrets 与 workflow 改动，等证书选定后按 CA 的官方 Action 接入即可，不影响现有构建。

### 1.6 `WIN_CSC_LINK` 路径（pfx 可用时）

1. 拿到合规的含私钥 `.pfx` 后转 base64：

   ```powershell
   # PowerShell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\cert.pfx")) | Set-Clipboard
   ```

   ```bash
   # macOS / Linux（或 Git Bash）
   base64 -w0 cert.pfx | clip.exe   # 去掉 -w0 参数亦可，换行不影响
   ```

2. 在仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加：

   | Secret | 值 |
   |---|---|
   | `WIN_CSC_LINK` | 上一步的 base64 字符串（也支持指向 pfx 的绝对路径，仅自托管 runner 适用） |
   | `WIN_CSC_KEY_PASSWORD` | 导出 pfx 时设的密码 |

3. 本地验证（Windows）：

   ```powershell
   $env:CSC_LINK = "C:\path\cert.pfx"
   $env:CSC_KEY_PASSWORD = "******"
   npm run dist
   Get-AuthenticodeSignature "dist\GumanMusic-*.exe" | Format-List Status, SignerCertificate
   # 或：signtool verify /pa /v dist\GumanMusic-1.4.3-x64.exe
   ```

   期望 `Status: Valid`，签名者名称是证书主体，且带 RFC3161 时间戳（证书过期后签名仍有效）。

---

## 二、macOS（Developer ID + 公证）

**这一侧链路已完整接通，配好 Secrets 即可生效，无需改代码。**

1. **加入 Apple Developer Program**：在 [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/) 用 Apple ID 注册，选 **Individual / 个人**（不需要公司主体、不需要 D-U-N-S）。费用 **99 USD/会员年**，需 Visa / Mastercard 信用卡；Apple ID 必须开启双重认证，且姓名须与身份证件上的法定姓名完全一致（用昵称会被打回）。个人账号审核通常 24–48 小时，组织账号要 1–2 周。
2. **创建 Developer ID Application 证书**：进入 [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/add) → `+` → 选 **Developer ID Application**（G2 Sub-CA，别选成 Developer ID Installer）→ 上传 CSR → 下载 `.cer`。
   - 有 Mac：`钥匙串访问 → 证书助理 → 从证书颁发机构请求证书`，存盘生成 `.certSigningRequest`；双击 `.cer` 装入 **登录** 钥匙串，确认「我的证书」里该证书能展开出私钥。
   - 没有 Mac 也能办（CI 在 macOS runner 上签名，本机不需要 Mac）：
     ```bash
     openssl req -new -newkey rsa:2048 -nodes \
       -keyout developer-id.key -out developer-id.csr \
       -subj "/emailAddress=you@example.com/CN=Your Legal Name/C=CN"
     # 下载 .cer 后合成 p12（必要时把 Apple 中间证书用 -certfile 一并打进去）
     openssl x509 -inform DER -in developerID_application.cer -out developerID_application.pem
     openssl pkcs12 -export -inkey developer-id.key -in developerID_application.pem \
       -out developer-id.p12 -passout pass:'你的强密码'
     ```
3. **导出 / 生成 `.p12`**：钥匙串里选中证书与私钥两项 → 右键导出 2 items → 设强密码。转 base64：`base64 -i cert.p12 -o -`（macOS）或 `base64 -w0 cert.p12`。`.p12` 与密码绝不入库。
4. **取公证凭据**：推荐在 App Store Connect → 用户和访问 → 集成 → **Team Keys** 生成 Developer 角色的 API Key，`.p8` **只能下载一次**，同时记下 Key ID 与 Issuer ID；个人账号也能用 Apple ID + 应用专用密码（在 appleid.apple.com 生成）+ Team ID。
5. 添加 Secrets：

   | Secret | 值 |
   |---|---|
   | `MAC_CSC_LINK` | p12 的 base64：`base64 -i cert.p12 -o -` |
   | `MAC_CSC_KEY_PASSWORD` | 导出 p12 时的密码 |
   | `MAC_CSC_NAME` | 可选，证书名（如 `Developer ID Application: Your Name (TEAMID)`）。不填则自动发现 |

6. 公证凭据**三选一**（推荐第 1 种，App Store Connect API Key，不需要个人 Apple ID 与专用密码）：

   | 方案 | Secrets |
   |---|---|
   | ① API Key（推荐） | `APPLE_API_KEY`（`.p8` 文件内容的 base64）、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER` |
   | ② Apple ID | `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`（在 appleid.apple.com 生成的应用专用密码，**不是登录密码**）、`APPLE_TEAM_ID` |
   | ③ Keychain profile | `APPLE_KEYCHAIN_PROFILE`，可选 `APPLE_KEYCHAIN`（自托管 runner 上已用 `xcrun notarytool store-credentials` 存好的 profile） |

   三组都不齐时只签名、不公证，构建仍成功；缺字段（例如有 `APPLE_ID` 却没 `APPLE_TEAM_ID`）会被显式判为「未配置」而跳过，不会在打包中途抛错。

7. 本地验证（macOS）：

   ```bash
   export CSC_LINK="$(base64 -i cert.p12)" CSC_KEY_PASSWORD='******'
   export APPLE_API_KEY="$(base64 -i AuthKey_XXX.p8)" APPLE_API_KEY_ID=XXX APPLE_API_ISSUER=xxx
   npx electron-builder -c electron-builder.config.js --mac --publish never
   codesign -dv --verbose=4 "dist/mac-arm64/孤男音乐.app" 2>&1 | grep -E 'Authority|TeamIdentifier|flags'
   spctl -a -vv "dist/mac-arm64/孤男音乐.app"      # 期望 accepted
   xcrun stapler validate "dist/GumanMusic-1.4.3-arm64.dmg"
   ```

---

## 三、CI 接线位置

`.github/workflows/release.yml`：

- `test` job 跑 `npm run check:syntax` + `npm run check:all`，`build` 与 `publish` 都 `needs` 它，测试不过不出包；
- Windows 打包 step 注入 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`（适用于能拿到 pfx 的场景；若最终选云签名服务，按 §1.5 在此 step 之后补签名 + 校验 step）；
- macOS 打包 step 注入 macOS 证书与 Apple 凭据，并用
  `CSC_IDENTITY_AUTO_DISCOVERY: ${{ secrets.MAC_CSC_LINK != '' && 'true' || 'false' }}`
  保证无证书时自动发现仍是关闭状态；
- 未配置的 secret 求值为空字符串，等价于未签名构建，**无需改 workflow 即可启用签名**。

PR 构建不会签名（electron-builder 自身的 `isPullRequest()` 保护），避免不可信分支接触签名凭据。

## 四、自签名（仅用于内部测试，不解决 SmartScreen / Gatekeeper）

如果只是想验证签名链路或给企业内部通过组策略信任的包，可以生成自签名证书。**自签名证书不受系统信任，Windows 仍会提示、macOS 仍会被 Gatekeeper 拦**，请勿当作正式修复。这也是目前唯一能合法自行产出 `.pfx` 的场景——CA/B Forum 的硬件私钥规定只约束公开信任的 CA 证书，不约束自签名：

```bash
openssl req -x509 -newkey rsa:2048 -keyout dev.key -out dev.crt -days 365 -nodes \
  -subj "/CN=Guman Music Dev"
openssl pkcs12 -export -out dev.pfx -inkey dev.key -in dev.crt -passout pass:devpass
export CSC_LINK="$(base64 -w0 dev.pfx)" CSC_KEY_PASSWORD=devpass
npm run dist
```

`dev.pfx` / `dev.key` / `dev.crt` 已被 `.gitignore` 忽略。

## 五、安全约定

- 证书、私钥、Apple 凭据**只从环境变量 / GitHub Secrets 读取**，绝不写进 `electron-builder.config.js`、workflow 或任何提交文件；
- `.gitignore` 忽略 `*.pfx`、`*.p12`、`*.cer`、`*.pvk`、`*.key`、`.env*`；
- `GUMAN_SIGN_DEBUG` 只输出布尔状态；CI 日志不会打印凭据（GitHub 也会自动掩码 secret）；
- `npm run check:signing` 与 `npm run check:ci-gate` 可离线验证上述全部契约。

## 六、故障排查

| 现象 | 原因 / 处理 |
|---|---|
| 构建日志 `skipped macOS application code signing` | 未注入 `MAC_CSC_LINK`，或 `CSC_NAME` 与钥匙串里的证书名不匹配 |
| `skipped macOS notarization` + `options were unable to be generated` | Apple 凭据三选一没配齐，检查 secret 名称拼写 |
| macOS 签名后应用启动即崩 | entitlements 缺失；确认 `build/entitlements.mac*.plist` 已随仓库提交、含 `allow-jit` |
| Windows 签名报 `SignTool Error: No certificates were found` | `WIN_CSC_LINK` base64 含换行/空格被截断，或 `WIN_CSC_KEY_PASSWORD` 不对 |
| 签名成功但 SmartScreen 仍拦 | 正常：新证书信誉从零开始，需几周真实下载量积累。EV 自 2024-08 起也不再即时放行，换 EV 无用；保持发布者名称一致并持续签名即可 |
| CA 说「不提供 .pfx」| 符合 2023-06 起的行业规定，不是刁难。改选该 CA 的云签名服务（eSigner / SimplySign / KeyLocker），并按 §1.5 补 CI 后置签名 step |
| 云签名在 CI 里需要输 OTP | 用激活时保存的 TOTP 种子在 CI 中动态生成一次性密码，不要试图把动态口令写死 |
| 想临时回到未签名构建 | 清空对应 secret，或在本地 `unset CSC_LINK CSC_KEY_PASSWORD` |
