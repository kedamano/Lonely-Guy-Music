# 代码签名与公证接入指南

> v1.4.3 起支持。**仓库本身不含任何证书**——这是刻意设计：私钥绝不能进版本库。
> 本指南说明如何把证书放进环境变量 / GitHub Secrets，让三平台产物自动变成受信任签名包。

## 先说清楚：什么能修、什么不能修

| 现象 | 未签名 | 配好证书后 |
|---|---|---|
| Windows SmartScreen「未知发布者」蓝色警告 | 有 | **OV 证书**随下载量积累信誉后消失；**EV 证书**立即消失 |
| Windows 安装时「未知发布者」 | 有 | 显示证书主体名称 |
| macOS「已损坏，无法打开」/ Gatekeeper 拦截 | 有 | 签名 + 公证后直接双击打开 |
| 自动更新（electron-updater） | 可用但会被部分安全软件拦 | 不再被拦 |

**没有证书就无法产出受信任签名**，这不是配置能绕过的：Windows 需要 CA 签发的 OV/EV 代码签名证书，macOS 需要 Apple Developer Program 的 Developer ID 证书。下面做的是把这两条链路完整接好——配了就签，没配就照常出未签名包，**构建不会失败**。

## 配置是怎么工作的

`electron-builder.js`（替换了原来的静态 `electron-builder.yml`）导出一个函数，按环境变量动态生成配置：

| 环境变量状态 | Windows | macOS |
|---|---|---|
| 没有任何证书变量 | 不签名 | `identity: null`、`hardenedRuntime: false`、`notarize: false`（与旧版行为完全一致） |
| 有证书、无 Apple 凭据 | SHA256 签名 + RFC3161 时间戳 | Developer ID 签名 + hardened runtime + `gatekeeperAssess`，**不公证** |
| 有证书 + 完整 Apple 凭据 | 同上 | 同上 **+ 公证（notarize）** |

`hardenedRuntime` 在无证书时必须保持 `false`：ad-hoc 签名叠加 hardened runtime 会因 library validation 让应用启动即崩。`build/entitlements.mac.plist` / `.inherit.plist` 提供 Electron 必需的 `allow-jit`、`disable-library-validation` 等权限，electron-builder 会自动加载。

状态可用 `GUMAN_SIGN_DEBUG=1` 打印（只打印布尔值，不打印任何凭据）。`npm run check:signing` 会在任意凭据组合下回归这套状态机。

---

## 一、Windows（OV / EV 代码签名证书）

1. 向 CA 申请 **Code Signing Certificate**，导出含私钥的 `.pfx`。EV 证书通常绑定硬件 USB token，CI 上需改用云签名服务或带 HSM 的自托管 runner。
2. 转成 base64（内容可直接作为 `CSC_LINK`）：

   ```powershell
   # PowerShell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\cert.pfx")) | Set-Clipboard
   ```

   ```bash
   # macOS / Linux（或 Git Bash）
   base64 -w0 cert.pfx | clip.exe   # 去掉 -w0 参数亦可，换行不影响
   ```

3. 在仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加：

   | Secret | 值 |
   |---|---|
   | `WIN_CSC_LINK` | 上一步的 base64 字符串（也支持指向 pfx 的绝对路径，仅自托管 runner 适用） |
   | `WIN_CSC_KEY_PASSWORD` | 导出 pfx 时设的密码 |

4. 本地验证（Windows）：

   ```powershell
   $env:CSC_LINK = "C:\path\cert.pfx"
   $env:CSC_KEY_PASSWORD = "******"
   npm run dist
   Get-AuthenticodeSignature "dist\GumanMusic-*.exe" | Format-List Status, SignerCertificate
   # 或：signtool verify /pa /v dist\GumanMusic-1.4.3-x64.exe
   ```

   期望 `Status: Valid`，签名者名称是证书主体，且时间戳为 DigiCert RFC3161（证书过期后签名仍有效）。

---

## 二、macOS（Developer ID + 公证）

1. 加入 **Apple Developer Program**，在 Certificates 里创建 **Developer ID Application** 证书，从钥匙串导出 `.p12`。
2. 添加 Secrets：

   | Secret | 值 |
   |---|---|
   | `MAC_CSC_LINK` | p12 的 base64：`base64 -i cert.p12 -o -` |
   | `MAC_CSC_KEY_PASSWORD` | 导出 p12 时的密码 |
   | `MAC_CSC_NAME` | 可选，证书名（如 `Developer ID Application: Your Name (TEAMID)`）。不填则自动发现 |

3. 公证凭据**三选一**（推荐第 1 种，App Store Connect API Key，不需要个人 Apple ID 与专用密码）：

   | 方案 | Secrets |
   |---|---|
   | ① API Key（推荐） | `APPLE_API_KEY`（`.p8` 文件内容的 base64）、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER` |
   | ② Apple ID | `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`（在 appleid.apple.com 生成的应用专用密码，**不是登录密码**）、`APPLE_TEAM_ID` |
   | ③ Keychain profile | `APPLE_KEYCHAIN_PROFILE`，可选 `APPLE_KEYCHAIN`（自托管 runner 上已用 `xcrun notarytool store-credentials` 存好的 profile） |

   三组都不齐时只签名、不公证，构建仍成功；缺字段（例如有 `APPLE_ID` 却没 `APPLE_TEAM_ID`）会被显式判为「未配置」而跳过，不会在打包中途抛错。

4. 本地验证（macOS）：

   ```bash
   export CSC_LINK="$(base64 -i cert.p12)" CSC_KEY_PASSWORD='******'
   export APPLE_API_KEY="$(base64 -i AuthKey_XXX.p8)" APPLE_API_KEY_ID=XXX APPLE_API_ISSUER=xxx
   npx electron-builder --mac --publish never
   codesign -dv --verbose=4 "dist/mac-arm64/孤男音乐.app" 2>&1 | grep -E 'Authority|TeamIdentifier|flags'
   spctl -a -vv "dist/mac-arm64/孤男音乐.app"      # 期望 accepted
   xcrun stapler validate "dist/GumanMusic-1.4.3-arm64.dmg"
   ```

---

## 三、CI 接线位置

`.github/workflows/release.yml`：

- `test` job 跑 `npm run check:syntax` + `npm run check:all`，`build` 与 `publish` 都 `needs` 它，测试不过不出包；
- Windows 打包 step 注入 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`；
- macOS 打包 step 注入 macOS 证书与 Apple 凭据，并用
  `CSC_IDENTITY_AUTO_DISCOVERY: ${{ secrets.MAC_CSC_LINK != '' && 'true' || 'false' }}`
  保证无证书时自动发现仍是关闭状态；
- 未配置的 secret 求值为空字符串，等价于未签名构建，**无需改 workflow 即可启用签名**。

PR 构建不会签名（electron-builder 自身的 `isPullRequest()` 保护），避免不可信分支接触签名凭据。

## 四、自签名（仅用于内部测试，不解决 SmartScreen / Gatekeeper）

如果只是想验证签名链路或给企业内部通过组策略信任的包，可以生成自签名证书。**自签名证书不受系统信任，Windows 仍会提示、macOS 仍会被 Gatekeeper 拦**，请勿当作正式修复：

```bash
openssl req -x509 -newkey rsa:2048 -keyout dev.key -out dev.crt -days 365 -nodes \
  -subj "/CN=Guman Music Dev"
openssl pkcs12 -export -out dev.pfx -inkey dev.key -in dev.crt -passout pass:devpass
export CSC_LINK="$(base64 -w0 dev.pfx)" CSC_KEY_PASSWORD=devpass
npm run dist
```

`dev.pfx` / `dev.key` / `dev.crt` 已被 `.gitignore` 忽略。

## 五、安全约定

- 证书、私钥、Apple 凭据**只从环境变量 / GitHub Secrets 读取**，绝不写进 `electron-builder.js`、workflow 或任何提交文件；
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
| 签名成功但 SmartScreen 仍拦 | OV 证书需要积累下载信誉，或改用 EV 证书 / 云签名服务 |
| 想临时回到未签名构建 | 清空对应 secret，或在本地 `unset CSC_LINK CSC_KEY_PASSWORD` |
