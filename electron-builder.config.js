'use strict';
/**
 * electron-builder 配置（JS 版，替代原来的 electron-builder.yml）。
 *
 * 为什么换成 JS：签名配置必须「有证书才开启」。原来 yml 里写死的
 *   mac.identity: null / hardenedRuntime: false / gatekeeperAssess: false
 * 会把 macOS 签名彻底关掉；而直接改成 hardenedRuntime: true 又会让
 * 没有证书的 CI 在 ad-hoc 签名下因 library validation 启动崩溃。
 * electron-builder 支持配置文件导出函数，于是这里按环境变量动态决定：
 *
 *   无证书            → 与旧 yml 行为一致，三平台照常出未签名包；
 *   有 Windows 证书   → CSC_LINK / CSC_KEY_PASSWORD + SHA256 + RFC3161 时间戳；
 *   有 macOS 证书     → Developer ID + hardenedRuntime + gatekeeperAssess；
 *   再有 Apple 凭据   → 追加 notarize（公证）。
 *
 * 证书、密码、Apple 凭据**只从环境变量读取**，绝不写进仓库或配置文件。
 * 完整接入步骤见 docs/code-signing.md。
 */

const has = (env, key) => typeof env[key] === 'string' && env[key].trim().length > 0;

/** 纯函数，供 scripts/signing-check.js 在任意 env 组合下断言，不产生副作用。 */
function signingState(env = process.env) {
  const win = has(env, 'WIN_CSC_LINK') || has(env, 'CSC_LINK');
  const mac = has(env, 'MAC_CSC_LINK') || has(env, 'CSC_LINK') || has(env, 'CSC_NAME');
  const apple =
    (has(env, 'APPLE_API_KEY') && has(env, 'APPLE_API_KEY_ID') && has(env, 'APPLE_API_ISSUER')) ||
    (has(env, 'APPLE_ID') && has(env, 'APPLE_APP_SPECIFIC_PASSWORD') && has(env, 'APPLE_TEAM_ID')) ||
    (has(env, 'APPLE_KEYCHAIN') && has(env, 'APPLE_KEYCHAIN_PROFILE'));
  return { win, mac, apple, notarize: mac && apple };
}

module.exports = function buildConfig() {
  const s = signingState();
  if (has(process.env, 'GUMAN_SIGN_DEBUG')) {
    console.log('[builder] signing state:', JSON.stringify(s));
  }

  return {
    appId: 'com.guman.music',
    productName: '孤男音乐',
    copyright: 'Copyright © 2026 孤男音乐',

    directories: {
      output: 'dist',
      buildResources: 'build',
    },

    // 只打必要文件；devDependencies 会被自动剪掉（playwright 等不进包）
    files: [
      'main.js',
      'main-log.js',
      'preload.js',
      'assets/**',
      'server/**',
      'renderer/**',
      'package.json',
      '!**/*.md',
      '!**/*.map',
    ],

    asar: true,
    // NCM 子进程用真实 node 进程 spawn app.js，asar 内的路径不是真实文件；
    // 连同它自身依赖一起解出（npm 扁平安装，依赖就在 node_modules 下）。
    asarUnpack: ['**/node_modules/**'],

    win: {
      icon: 'build/icon.ico',
      target: [{ target: 'nsis', arch: 'x64' }],
      // 产物名用 ASCII，避免中文文件名在部分工具链/杀软下出问题
      artifactName: 'GumanMusic-${version}-${arch}.${ext}',
      // electron-builder 26 起签名参数收在 signtoolOptions 下，放 win 顶层会被 schema 拒绝。
      // 只用 SHA256（SHA1 已弃用）；RFC3161 时间戳让证书过期后签名仍有效。
      // 未配置 CSC_LINK 时这些选项不产生任何作用，构建行为与未签名包一致。
      signtoolOptions: {
        signingHashAlgorithms: ['sha256'],
        rfc3161TimeStampServer: 'http://timestamp.digicert.com',
      },
    },

    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: '孤男音乐',
      menuCategory: false,
      deleteAppDataOnUninstall: false,
    },

    mac: {
      icon: 'build/icon.png',
      category: 'public.app-category.music',
      darkModeSupport: true,
      // identity: null 会让 electron-builder 直接放弃签名；只在没有证书时保留。
      // 有证书时留空，走 CSC_LINK / CSC_NAME 自动发现 Developer ID。
      ...(s.mac ? {} : { identity: null }),
      hardenedRuntime: s.mac,
      gatekeeperAssess: s.mac,
      // 显式 false 才会跳过公证；有证书但缺 Apple 凭据时同样跳过（只签名不公证）。
      notarize: s.notarize,
      // entitlements 由 build/entitlements.mac.plist / .inherit.plist 自动加载，
      // hardened runtime 下 Electron 必须要有 allow-jit 等权限，否则 arm64 会启动崩溃。
      target: [
        { target: 'dmg', arch: ['x64', 'arm64'] },
        { target: 'zip', arch: ['x64', 'arm64'] },
      ],
      artifactName: 'GumanMusic-${version}-${arch}.${ext}',
    },

    linux: {
      icon: 'build/icon.png',
      category: 'AudioVideo',
      synopsis: '桌面音乐客户端',
      description: '孤男音乐 · 在线曲库 + 洛雪音源 + 实时频谱 + 卡拉OK歌词的桌面音乐客户端。',
      maintainer: 'kedamano <1392806889@qq.com>',
      target: [
        { target: 'AppImage', arch: ['x64'] },
        { target: 'deb', arch: ['x64'] },
      ],
      artifactName: 'GumanMusic-${version}-${arch}.${ext}',
      desktop: {
        entry: {
          Name: '孤男音乐',
          GenericName: 'Music Player',
          Comment: '桌面音乐客户端',
          Categories: 'AudioVideo;Audio;Player;',
        },
      },
    },

    // electron-updater 以 GitHub Releases 为更新源
    publish: [
      {
        provider: 'github',
        owner: 'kedamano',
        repo: 'Lonely-Guy-Music',
        releaseType: 'release',
      },
    ],
  };
};

module.exports.__signingState = signingState;
