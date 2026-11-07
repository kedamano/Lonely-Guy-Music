<div align="center">

<img src="docs/icon.png" width="96" alt="Guman Music logo">

# Guman Music · 孤男音乐

**🎧 An Electron desktop music client that takes both music discovery and soundstage experience seriously**

NetEase online library · LX Music custom sources · Live spectrum · Karaoke lyrics · 10-band EQ · Desktop lyrics · Local music

[![Version](https://img.shields.io/badge/version-1.4.3-ff6a2c?style=flat-square)](https://github.com/kedamano/Lonely-Guy-Music/releases)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Tests](https://img.shields.io/badge/tests-523%20checks-passing-3fb950?style=flat-square)](#-ui-regression-tests)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-8957e5?style=flat-square)](https://github.com/kedamano/Lonely-Guy-Music/releases)
[![License](https://img.shields.io/badge/license-MIT-c9d1d9?style=flat-square)](LICENSE)

English | [简体中文](README.md)

**[⬇️ Download](#-get-started)** · **[✨ Features](#-features)** · **[🎮 Shortcuts](#-global-shortcuts)** · **[🧱 Architecture](#-architecture)**

![Guman Music main window](docs/screenshots/soundstage.png)

</div>

---

## Why this project

Most desktop music players force a choice: either a "library portal" or a "local player".
Guman Music aims to do both well —

- **Library side**: a NetEase-Cloud-Music-like discover / explore / search experience, plus a **LX Music custom-source system** — import community source scripts and search, resolve URLs, and play across the web;
- **Soundstage side**: this is not a "just play the file" player — **live circular spectrum, 10-band graphic EQ, word-by-word karaoke lyrics, desktop lyrics, sleep fade-out**, all wired into the real Web Audio graph instead of being decoration.

> Inspiration: UI/UX references [Moli Music](https://yy.juhuang.xyz/); the source system is compatible with the [LX Music custom source API](https://lxmusic.toside.cn/desktop/custom-source). All credits to them.

---

## ✨ Features

### 🎵 Library & Playback

| Feature | Description |
|---|---|
| Discover / Explore / Search | Playlist walls, category browsing, type-to-search (300ms debounce) + Enter, keywords preserved across tabs |
| **Multi-platform search** | Switch between **Aggregate / NetEase / QQ Music / Kugou / Kuwo / Migu / Qishui**; aggregate search merges the same song into one row with source badges and "N sources", auto-switches source when playback fails — **QQ / Kugou / Kuwo search and play without any source script; Migu searches natively and resolves via cross-platform fallback** |
| Playlist detail | Play all / shuffle / queue the whole playlist |
| Playback controls | Play/pause/prev/next, list·single·sequential loop, draggable progress & volume |
| Play queue | Drawer management: add, remove, jump; insert at top or bottom |
| Favorites & history | Removable/clearable, persisted across sessions, per-song resume position |
| **Cloud playlists (editable)** | Read "Liked Songs" and every playlist from your NetEase account and play instantly; **create, rename and delete your own cloud playlists, and add/remove tracks from the client** — changes are written back to your account and show up on your phone |
| **QQ Music sign-in** | Paste your QQ Music cookie in Settings to auto-extract `uin` / `qm_keyst`, or fill in both fields manually. Takes effect immediately and unlocks native QQ vkey playback — no more editing `platform-auth.json` by hand |
| Pagination | Server-side (30/page) for explore & search, client-side (50/page) for long playlists |

### 🔊 Soundstage (desktop-exclusive)

| Feature | Description |
|---|---|
| 🎚 Live spectrum | Web Audio `AnalyserNode` circular spectrum + waveform, with idle animation |
| 🎛 Graphic EQ | 10-band EQ with presets (pop/rock/vocal/classical/bass boost…), applied to the real audio graph |
| 🎤 Karaoke lyrics | LRC line highlight + word-by-word fill + current-line scaling, click any line to seek |
| 🖥 Desktop lyrics | Frameless transparent always-on-top window, 3-color customization, font size/weight/alignment, click-through lock |
| 💤 Sleep timer | Fade-out then pause, live countdown in the panel |
| 🎨 Lyrics background | Cover blur / cover dominant color / plain background — lyrics stay readable in all modes |

### 🧰 Desktop-grade capabilities

| Feature | Description |
|---|---|
| 📂 Local music | Drag in files/folders (mp3/flac…), same player and soundstage as the online library |
| ⬇️ Download | One-click download from track rows and lyrics page; naming rules and directory configurable |
| 🪟 Mini mode | Custom title bar + real resizable always-on-top window; system tray |
| ⌨️ Global media keys | `MediaPlayPause` etc. + tray playback controls |
| 🧭 OS media session | Windows/macOS media panel shows track info; taskbar icon shows live progress |
| 🌐 Trilingual UI | 简体中文 / 繁體中文 / English, instant switch |
| 🎭 4 accent colors | Signal Amber / Neon Purple / Electric Cyan / Rose — all colors derived via CSS `color-mix` |
| 🪶 Performance friendly | 6 font sizes, 4 window sizes, animations can be disabled |

### 🛡 Reliability details

- **Covers never break**: covers and audio go through the same-origin proxy; on failure it falls back to a generated gradient cover + note icon, and to artist image when album art is missing;
- **Human-readable failures**: failed URL resolution summarizes every source attempt; technical error codes are translated into plain language;
- **Honest mode badge**: runtime mode is polled continuously — a slow NCM cold start never leaves a stale "offline" badge;
- Playback blocks system sleep; playback errors auto-skip to the next track; startup auto-resumes the last song and position.

---

## 🚀 Get Started

### Option 1: Download the installer (recommended)

Grab the build for your platform from [**Releases**](https://github.com/kedamano/Lonely-Guy-Music/releases):

| Platform | File | Notes |
|---|---|---|
| Windows x64 | `GumanMusic-x.y.z-x64.exe` | NSIS installer |
| macOS Intel | `GumanMusic-x.y.z-x64.dmg` | Use `-arm64.dmg` on Apple Silicon |
| Linux x64 | `GumanMusic-x.y.z-x86_64.AppImage` | `chmod +x` and run |
| Debian / Ubuntu | `GumanMusic-x.y.z-amd64.deb` | `sudo dpkg -i` |

> **Signing & notarization**: since v1.4.3 the build pipeline supports Windows code signing and macOS Developer ID signing + notarization. Certificates are read only from environment variables / GitHub Secrets, so **no certificate ships with the repo and default artifacts are still unsigned** — Windows may show SmartScreen ("More info → Run anyway") and macOS requires approval in System Settings → Privacy & Security. On macOS the configured secrets enable signing + notarization automatically. On Windows, CAs stopped issuing exportable `.pfx` files in 2023, so public distribution requires a cloud signing service plus a post-build signing step in CI. See [docs/code-signing.md](docs/code-signing.md) for application steps and provider options.

### Option 2: Run from source

```bash
git clone https://github.com/kedamano/Lonely-Guy-Music.git
cd Lonely-Guy-Music
npm install
npm start
```

- `npm start` boots a local NetEase API (dynamic port) and serves the UI — online mode by default;
- If the NetEase API is unreachable, it falls back to a built-in demo library (full interactivity offline);
- Offline demo only: `ENABLE_NCM=0 npm start`;
- Backend-only debugging: `ENABLE_NCM=0 npm run server`, then open `http://localhost:3000`.

### Build from source

```bash
npm run dist        # NSIS installer into dist/
npm run dist:dir    # unpacked directory only
```

---

## 🖼 Screenshots

| Main window + soundstage panel | Karaoke lyrics (cover color background) |
|:---:|:---:|
| ![Soundstage](docs/screenshots/soundstage.png) | ![Karaoke lyrics](docs/screenshots/lyrics-karaoke.png) |

| Live search | LX custom source management |
|:---:|:---:|
| ![Search](docs/screenshots/search.png) | ![Sources](docs/screenshots/sources.png) |

---

## 🎮 Global Shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| <kbd>Space</kbd> | Play / pause | <kbd>/</kbd> | Jump to search |
| <kbd>←</kbd> / <kbd>→</kbd> | Seek ±5s | <kbd>L</kbd> | Lyrics overlay |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Volume ±5% | <kbd>M</kbd> | Mini mode |
| <kbd>Q</kbd> | Play queue | <kbd>Esc</kbd> | Close overlay / queue / mini mode |
| Media keys | play/pause · prev · next | Tray menu | Playback controls |

---

## 🧱 Architecture

```mermaid
flowchart LR
    subgraph Electron["Electron app"]
        MAIN["main.js<br/>main process<br/>windows / tray / media keys / IPC / auto-update"]
        PRE["preload.js<br/>contextBridge"]
        RENDER["renderer/<br/>ES modules<br/>store · player · ui · settings · i18n"]
        LYRIC["lyric-window.html<br/>desktop lyrics window"]
        MAIN <-->|IPC| PRE --> RENDER
        RENDER -.-> LYRIC
    end

    subgraph HostServer["Express host server (same process, 127.0.0.1)"]
        UI["static renderer/"]
        API["/api/* NetEase reverse proxy"]
        PROXY["/api/proxy<br/>same-origin audio/cover proxy"]
        SOURCES["source-manager.js<br/>LX source runtime (vm sandbox)"]
        PLAT["platform-aggregate / platform-url<br/>multi-platform search & resolution"]
    end

    NCM["NeteaseCloudMusicApi<br/>child process (dynamic port)"]
    NET["Internet source APIs<br/>kw / kg / tx / wy / mg / qs"]

    RENDER -->|same-origin /api| HostServer
    HostServer --> NCM
    SOURCES --> NET
    PROXY -->|same-origin stream| RENDER
```

**Three key design decisions:**

1. **Single-origin architecture, no CORS** — the backend serves both the UI and `/api`; the renderer only talks to same-origin endpoints, so Electron `webSecurity` stays on;
2. **Same-origin audio proxy** — cross-origin media is muted (tainted) once routed into Web Audio; `/api/proxy` re-serves remote audio as a same-origin stream so EQ and spectrum actually work;
3. **Sandboxed source scripts** — third-party source scripts run in `vm.runInNewContext` with only standard JS globals + the `lx` API; no `require`/`fs`, and all HTTP goes through the backend.

<details>
<summary><b>📁 Project layout</b> (click to expand)</summary>

```
main.js               Electron main process: windows/tray/media keys/IPC/log fallback/auto-update
preload.js            contextBridge secure exposure (contextIsolation, no nodeIntegration)
main-log.js           Log persistence & rotation (userData/logs/guman.log, 2MB)
server/
  index.js            Host server: UI + /api reverse proxy or offline mock + source API + audio proxy
  mock.js             Offline demo data (NetEase-compatible response shapes)
  source-manager.js   LX source runtime: vm sandbox, lx API, parallel resolution & timeouts
  song-utils.js       Text normalization (NFKC/Traditional→Simplified), scoring, dedupe & cross-platform merge (pure)
  loose-json.js       Fault-tolerant Kuwo pseudo-JSON parser (no eval)
  audio-probe.js      Range-probes audio headers to reject preview placeholders/error pages/bad bitrates (pure)
  ncm-client.js       Local NeteaseCloudMusicApi wrapper (cross-source fallback; cookies never logged)
  platform-search.js  Single-platform search facade: shared post-processing + 5-min cache (QQ/Kugou/Kuwo/Migu)
  platform-aggregate.js Aggregate search: concurrent recall, merge into one row, alternatives, cache
  platform-url.js     Resolution orchestration: native + aggregate alternatives + NetEase/Kuwo/Kugou fallback + probe/cache
  platforms/          Platform adapters: qq / kugou / kuwo / migu + metadata registry
  account.js          Account features
  library.js          Local library
  translate.js        Lyric translation
renderer/
  index.html          Structure (SVG icon system / title bar / sidebar / views / soundstage / playbar / queue / lyrics)
  lyric-window.html   Desktop lyrics window (frameless transparent always-on-top)
  styles.css          Design system (Midnight Soundstage theme, responsive + mini mode)
  assets/fonts/       Self-hosted fonts (@fontsource subsets, 113 woff2 files, zero external requests)
  js/
    store.js          State & persistence
    api.js            API client (timeout, track normalization, source availability cache)
    i18n.js           Trilingual runtime (dictionary + templates + dynamic sentence matching)
    lyrics.js         LRC parsing & line timing (karaoke word durations)
    visualizer.js     Live spectrum (circular + waveform, idle animation)
    player.js         Playback engine (Web Audio: queue/EQ/analyzer/sleep fade/source resolution/media session)
    ui.js             DOM/icons/covers/empty states/lists/paginator
    settings.js       Settings page (10 sections)
    app.js            Orchestration: routing/views/search/queue/playback/shortcuts/settings dispatch
assets/icon.js        Self-contained icon generation (zlib-encoded PNG/ICO, no binary assets)
scripts/
  build-fonts.js      Font subset build
  ui-check.js         Playwright UI regression (29 checks + screenshots)
  ui-smoke.js         Full smoke test (65 checks)
  proxy-check.js      Proxy mechanism unit tests (12 checks)
```

</details>

---

## 🎼 LX Source System

Fully compatible with [LX Music custom source scripts](https://lxmusic.toside.cn/desktop/custom-source) (`globalThis.lx` event model: `inited` / `request` / `updateAlert`):

- **Sandboxed execution**: scripts run in a Node `vm` sandbox with `lx.request` (full HTTP: headers/body/form/formData/timeout/redirects/byte cap) and `lx.utils` (buffer/crypto/zlib); loopback and private-network literal targets are rejected by default (best-effort SSRF guard, `allowPrivateHost` can opt in). Note that `vm` is **not a security boundary** — only run trusted source scripts;
- **All platforms**: Kuwo(kw) / Kugou(kg) / QQ(tx) / NetEase(wy) / Migu(mg) / Qishui(qs);
- **Quality fallback**: FLAC 24bit / FLAC / 320K / 192K / 128K with automatic downward fallback;
- **Multi-source fault tolerance**: enabled sources are resolved **in parallel** (8s per-source timeout) and the first success wins; when all fail, the toast summarizes every source's failure in registration order;
- **Source management**: Settings → Custom Sources: import local `.js`, install from URL, enable/disable, delete;
- **Explicit proxy control**: source requests are **direct by default and never read system proxy env vars** (a broken local proxy can't break every source); set one in Settings → Network Proxy when needed, effective immediately.

<details>
<summary><b>🔌 Source HTTP API</b> (for secondary development, click to expand)</summary>

| Method | Description |
|---|---|
| `GET /api/sources` | List sources + config |
| `POST /api/sources/load` | Load a source `{ path?, url?, code? }` |
| `POST /api/sources/toggle` | Enable/disable `{ id, enabled }` |
| `POST /api/sources/remove` | Remove `{ id }` |
| `POST /api/sources/quality` | Set default quality `{ quality }` |
| `POST /api/sources/proxy` | Set network proxy `{ proxy }`, empty = direct |
| `POST /api/sources/resolve` | Resolve play URL `{ sourcePlatform, musicInfo, quality?, sourceId? }` |
| `POST /api/sources/action` | Generic action `{ action: 'musicUrl'/'lyric'/'pic', ... }` |
| `GET /api/platform/list` | Platform list (with `available` / `reason` / `playback`) |
| `GET /api/platform/search` | Single-platform search `{ platform, keywords, page, limit }` |
| `GET /api/platform/search-all` | Aggregate search `{ keywords, page, limit, sources? }` — merged rows + `sources[]` |
| `POST /api/platform/alternatives` | Alternative sources `{ platform, name, artist, duration }` for "switch source" |
| `POST /api/platform/url` | Platform resolution `{ platform, musicInfo, name, artist, duration, quality, alternatives? }` |
| `GET /api/cache/stats` · `POST /api/cache/clear` | Cache stats / one-click clear (covers, URLs, search, aggregate) |

</details>

---

## 🔗 Multi-Platform Track Resolution

QQ / Kugou / Kuwo / Migu tracks do not hard-depend on the NetEase API or on source scripts — resolution degrades through four layers:

| Order | Layer | Notes |
|---|---|---|
| 1 | LX source script | Used first when an enabled source supports that platform; can deliver FLAC / 320K |
| 2 | Platform native | Kugou mobile `playInfo` and Kuwo `anti.s` return full direct links anonymously; QQ uses the official `vkey` once a cookie is pasted under Settings → QQ Music sign-in; NetEase goes through local NCM |
| 3 | Aggregate alternatives | Rows from aggregate search carry `sources[]`; if the current platform fails, other platforms' copies of the same song are tried by relevance (each is validated) |
| 4 | Cross-platform fallback | Search NetEase → Kuwo → Kugou by title + artist + duration and play the same track |

Every platform-resolution candidate is first probed with `Range: bytes=0-65535`: HTML/JSON error pages, Kuwo's 181521-byte preview placeholder, tiny files, abnormal bitrates and duration-mismatched clips are rejected; **only validated results are cached** (the cache key includes quality, and failures get a 60s negative cache). When a fallback or an alternate recording is used, the playbar and toast state the actual source explicitly; tracks are never swapped silently.

**Why QQ can't be reverse-proxied like NetEase**: NetEase's URL endpoint hands out 128K even when anonymous, and returns a stateless, server-signed CDN link. QQ's `vkey` is bound to `uin + guid`, and anonymous calls return an empty `purl` (observed `104003` / `1000`) — a login state is mandatory. Kugou's `play/songinfo` requires a `signature` whose salt changes with each web release, but its mobile `playInfo` endpoint works anonymously; Kuwo's `antiserver` is anonymous too — which is why native resolution is enabled for Kugou and Kuwo.

**Known limitations**:

- Free catalogue entries are mostly 128K; VIP tracks (e.g. Jay Chou originals) usually resolve only to covers or other recordings.
- Native QQ quality needs a cookie from a signed-in account (Settings → QQ Music sign-in); credentials stay on this machine in `userData/platform-auth.json` and must be re-pasted when they expire.
- Cloud playlist editing requires the NetEase online API and a signed-in account. Offline mode still browses cached playlists but blocks writes with a clear message.

---

## 🧪 UI Regression Tests

Playwright-based real-interaction regression (**523 assertions** total):

```bash
npm start                        # or ENABLE_NCM=0 node server/index.js
node scripts/ui-check.js         # 65 interaction checks + screenshots
node scripts/ui-smoke.js         # 73 full smoke checks (covers/pagination/settings/i18n/cache/prefetch…)
node scripts/proxy-check.js      # 12 proxy mechanism unit tests
node scripts/search-guide-check.js # 19 search-guide & i18n checks
node scripts/platform-search-check.js --offline # 51 aggregate-search/resolution checks (normalization/merge/probe/SSRF)
node scripts/platform-url-check.js # 19 platform resolution (scoring + Kugou link + four-layer fallback)
node scripts/version-check.js     # 5 version-string contract checks
node scripts/source-search-check.js # 23 LX-source search checks (parallel fallback + capabilities + Qishui)
node scripts/lx-url-validate-check.js # 10 LX-source URL validation checks (dead-link block + source fallback + negative cache)
node scripts/sound-sources-check.js # 17 default-sound-source checks (page parse + idempotent auto-import + URL-change update)
node scripts/platform-auth-check.js # 47 platform sign-in checks (cookie parse + atomic write + no credential leak + wiring)
node scripts/cloud-playlist-check.js # 47 cloud-playlist editing checks (NCM write contract + cache invalidation + UI wiring)
node scripts/np-overlay-check.js # 26 now-playing isolation checks (opaque base + stacking + no bleed during fade + queue/mini regressions)
GUMAN_NP_URL=http://127.0.0.1:3000/ node scripts/np-overlay-check.js # adds 7 real-Chromium hit-test checks
node scripts/signing-check.js # 52 signing-config checks (state machine + entitlements + no certs in repo + CI wiring + config naming)
node scripts/ci-gate-check.js # 45 release-gate contracts (needs graph + aggregation list + secrets wiring)
npm run check:syntax        # syntax-check 65 JS files (cross-platform, Node-based)
npm run check:all           # release gate: aggregates 12 node-only scripts, fails on any error
npx electron scripts/tray-check.js # 5 tray icon checks (ICO empty-image regression + real bounds)
npx electron scripts/cache-check.js # 7 disk-cache checks (write → measure → clear → idempotent)
node scripts/cache-e2e.js         # 7 on-device storage checks (needs a GUI, full IPC path)
```

Covers: live search / tab switching / playback / seek dragging / favorites / queue / lyrics overlay / soundstage EQ & sleep / local audio import & playback / mini mode / responsive layout / every settings section / real cover-load assertions / runtime console error checks. Screenshots go to `scripts/shots/`.

---

## 🗺 Roadmap

- [x] **Multi-platform search**: Aggregate / NetEase / QQ Music / Kugou / Kuwo / Migu queried directly, Qishui via LX sources; cross-platform merge, source badges, one-click source switching
- [x] **Cloud playlist sync / account login**: QR code + phone captcha + email password; cloud playlists play directly
- [x] **macOS / Linux installers**: dmg / zip / AppImage / deb, built by a three-platform GitHub Actions matrix
- [x] **Audio chain extensions**: spatial audio (M/S widening + convolution reverb + compression) and 5 scene presets
- [x] **Auto-update loop**: `electron-updater` against the GitHub Releases feed — new versions prompt on launch
- [x] Native Migu search; Qishui search requires an imported LX source that supports it
- [x] **Offline download manager**: download online songs with lyrics & cover into the local library — playable offline when the network or upstream is down; configurable path, naming, and quota auto-cleanup
- [x] **Platform health probes**: periodic probes of each platform's search/link health, persisted; a first-screen banner shows which platform broke and since when, with a settings dashboard and manual "check now"
- [x] **LX-source URL validation & auto-fallback**: resolved links are content-probed; dead/expired links fail over to the next source, and total failure falls back to native + cross-platform resolution; a failed playback auto-retries with source switching
- [x] **Default sound sources (built-in) + LX list auto-probe**: on first launch auto-imports and enables the five community sources (SixYin / LX-Official / Flower / Huibq / JuheApi); periodically probes the lxmusic.ijinshan.com source list to sync the latest addresses; settings page can trigger an immediate update
- [x] **Cloud playlist editing + QQ sign-in UI**: create / rename / delete cloud playlists and add / remove tracks from the client, written straight back to NetEase; paste a QQ Music cookie in Settings to auto-extract `uin` / `qm_keyst` — no more editing `platform-auth.json` by hand
- [x] **Release test gate**: a `test` job (syntax check + 12 node-only regression scripts) runs inside the tag-triggered release workflow; all three platform builds and the publish job `need` it — no package is produced when tests fail
- [x] **Code signing / notarization pipeline**: `electron-builder.config.js` conditionally enables Windows SHA256 + RFC3161 timestamp signing and macOS Developer ID + hardened runtime + notarization; builds degrade to unsigned automatically when no certificate is configured, and no certificate ever enters the repo

---

## ❓ FAQ

<details>
<summary><b>Why won't some songs play?</b></summary>

Some NetEase VIP tracks return an empty URL. With a source imported, most songs resolve through it. When every source fails, a per-source reason summary is shown.
</details>

<details>
<summary><b>A source stopped working — what now?</b></summary>

Upstream sources are maintained by third parties and can go offline. The app skips failing sources automatically; you can disable a dead source or import a new one in Settings → Custom Sources.
</details>

<details>
<summary><b>SmartScreen blocks the installer?</b></summary>

The repo ships no code-signing certificate, so default artifacts are unsigned. Click "More info → Run anyway" (Windows) or approve the app under System Settings → Privacy & Security (macOS). To show a verified publisher and remove the macOS Gatekeeper block, apply for certificates per [docs/code-signing.md](docs/code-signing.md): macOS signs and notarizes automatically once the secrets are set, while Windows needs a cloud signing service and a post-build signing step. Note that signing does not remove the SmartScreen warning instantly — a new certificate's publisher reputation builds over several weeks of real downloads, for OV / IV / EV alike.
</details>

<details>
<summary><b>How much disk does the cache take? Can I clear it?</b></summary>

Settings → Storage shows the disk cache size (covers, fonts, API responses) with a one-click clear, plus a limit (256MB / 512MB / 1GB / 2GB / unlimited) that is enforced automatically in the background. Clearing only removes the HTTP cache — sign-in, playlists, downloads and source settings stay untouched.
</details>

<details>
<summary><b>App crashes on launch / black window?</b></summary>

A few GPU drivers make Electron's GPU process crash repeatedly (`GPU process isn't usable`). Launch with `GUMAN_DISABLE_GPU=1` to run the GPU in-process; UI and playback are unaffected.
</details>

<details>
<summary><b>Do I need a proxy?</b></summary>

Direct by default — system proxy env vars are intentionally ignored (a broken local proxy must not break source loading). If your network requires a proxy for source APIs, set it in Settings → Network Proxy; it takes effect immediately.
</details>

<details>
<summary><b>Does local music survive restarts?</b></summary>

Favorites, history, search history and settings persist across sessions. Local music imports are session-scoped (browser objectURL limitation) and need re-import after restart.
</details>

---

## 🤝 Contributing

Issues and PRs are welcome:

1. Fork → branch (`feat/xxx`) → commit;
2. For UI changes, attach a passing `node scripts/ui-smoke.js` run or screenshots;
3. Do not submit any source scripts themselves (see the disclaimer below).

---

## ⚠️ Disclaimer

- The online library relies on **third-party unofficial NetEase interfaces**, for learning and research only; comply with the platforms' terms of service — no commercial or infringing use;
- This project **does not ship or bundle any source script**; sources are imported by users and maintained by third parties, unrelated to this project;
- All music copyrights belong to their owners — please support official releases.

## 📄 License

[MIT](LICENSE) © Guman Music

Fonts (Anton / IBM Plex Sans / IBM Plex Mono / Noto Sans SC) are self-hosted via [@fontsource](https://fontsource.org/) under their respective licenses — see [NOTICE.txt](renderer/assets/fonts/NOTICE.txt).

<div align="center">

**If this project helps you, consider giving it a ⭐ Star**

</div>
