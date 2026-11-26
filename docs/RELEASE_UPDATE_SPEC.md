# Release and Update Asset Contract

> 更新日期：2026-11-26（已纳入 `0.4.5` `store-asar` 瘦身结构与 Cloudflare R2 `dl.yukino.fqxxzyw.cn` 双源分发规范）。

This file is the build, upload, and verification contract for Yukino Companion releases. Account traffic continues to use `https://yukino.fqxxzyw.cn/api/v1/...`, while release installers and incremental update artifacts are served from **Cloudflare R2 (`https://dl.yukino.fqxxzyw.cn/releases/`)** with **GitHub Releases** retained as the canonical archive and automatic fallback.

## 1. Version, Tag, and Changelog

1. Bump `package.json` `version` with strict semver (`X.Y.Z`).
2. Author matching release notes in `docs/releases/v<version>.md` (and update `docs/releases/README.md`).
3. Commit the source, create an annotated tag `v<version>`, and push both branch and tag.
4. Publish a stable GitHub Release for `v<version>` (never draft/prerelease for production updates).
5. Sync the verified `release/<version>/` artifacts and updated `releases/latest.json` to Cloudflare R2 bucket `yukino-downloads` (`https://dl.yukino.fqxxzyw.cn`).

## 2. Required Release Assets

| Asset | Purpose |
| --- | --- |
| `Yukino-Companion-<version>-Base-Setup.exe` | NSIS installer (`store-asar` + `asarUnpack` since `0.4.5`) used by the updater |
| `Yukino-Companion-<version>-Base-Setup.exe.blockmap` | Differential blockmap; must match the installer byte-for-byte |
| `latest.yml` | Version, installer filename, exact size, and SHA-512 |
| `SHA256SUMS-<version>.txt` | Human and fallback SHA-256 verification |
| `Yukino-Companion-<version>-Portable.exe` | Portable Windows build |
| `Yukino-Companion-<version>-Live2D-Model.zip` | Standalone Live2D model archive |

`latest.yml` and `.blockmap` must come from the exact same `electron-builder` run as the installer. Never edit them by hand or overwrite assets under an already published version tag — always bump to a new version.

## 3. Slim Incremental Layout (`0.4.5+`) and Build Gates

```powershell
npm run release:win
```

Starting from `0.4.5`:

- **Static Asset Unpacking (`asarUnpack`)**: 3D character `.glb` models, wallpapers, textures, guides, provider logos, scene previews, and desktop pet assets are unpacked into `resources/app.asar.unpacked`, reducing `resources/app.asar` from ~456 MB down to **~9.5 MB**.
- **Fine-grained NSIS Blockmap (`store-asar`)**: `scripts/build-update-release.cjs` stores `app.asar` uncompressed inside the NSIS archive and generates a fine-grained `.blockmap`. Future code-only updates (`0.4.5 → 0.4.6+`) download **~0.5–1 MB** instead of the full ~307 MB installer; adding or updating a single 3D model only transfers that model's blocks.
- **Automated Build Gates**: `scripts/build-update-release.cjs` enforces an `app.asar` size ceiling, blocks build-only frontend dependencies (`react`, `react-dom`, `three`, `lucide-react`) from entering `app.asar`, blocks retired `.glb` files, and verifies all 9 V2 outfit models are present.
- **Delta Verification**: Before publishing, run `node scripts/verify-release-delta.cjs <previous-setup.exe> release/<version>` to verify real blockmap delta bytes and SHA-512 reconstruction.

## 4. Dual-Source Distribution (Cloudflare R2 + GitHub)

- **GitHub Releases**: Canonical source of truth at `https://github.com/fqxxzyw/Yukino-Companion/releases/tag/v<version>`.
- **Cloudflare R2 (`yukino-downloads`)**: Synced via `scripts/sync-r2-assets.cjs` (credentials supplied via environment variables only, never committed) to:
  - `releases/v<version>/*`
  - `releases/latest.json`
- **Website (`/api/v1/public/downloads`)**: Serves `https://dl.yukino.fqxxzyw.cn/releases/v<version>/...` as primary download URLs while always preserving `githubUrl` backup buttons on `https://yukino.fqxxzyw.cn/#download`. If GitHub API returns 403/timeout, falls back to R2 `releases/latest.json` and then D1 cache.
- **Client Updater (`electron/app-update.cjs` & `electron/update-blockmap.cjs`)**: Trusts both `dl.yukino.fqxxzyw.cn` and GitHub Release hosts; prioritizes R2 for `latest.yml`, `.blockmap`, and differential Range downloads, and automatically falls back to GitHub on any R2 failure while strictly enforcing SHA-512 verification.

## 5. 客户端分类更新说明（0.4.4 起）

每次发布正式版时，在 GitHub Release 正文添加二级标题 `## 更新内容`，每条内容独占一行，写成 `- 分类：用户可见的具体变化`（如 `桌面人物修复`、`增量更新`、`推理环境`、`账号`、`稳定性` 等）。只列出本版实际发生的变化，并与仓库 `docs/releases/v<版本>.md` 保持一致。

## 6. 安装版与便携版验收标准

安装版启动后 5 秒检查一次，此后每 6 小时检查，支持手动检查。缓存位于 `%LOCALAPPDATA%\yukino-companion-updater`（`installer.exe`、`current.blockmap`、`pending/`）。用户确认「重启并安装」前不会退出应用；启动安装器前会再次核验长度与 SHA-512。

| 场景 | 必须观察到的结果 |
| --- | --- |
| 当前版本与最新正式版相同 | 手动检查显示「当前没有可用的正式版更新」，无安装提示 |
| 有更高正式版 | 显示准确版本号与分类说明，确认前不自动安装 |
| 保留有效旧缓存（`0.4.5+` 纯代码升级） | 差分传输量仅约 0.5–1 MB，SHA-512 校验通过 |
| R2 不可用或返回错误 | 自动回退至 GitHub Release 完成下载与校验 |
| 清除旧缓存 / 破坏旧块图 | 自动切换为完整安装包并完成校验，期间不执行安装器 |
| 下载中断或取消后重试 | 可重新下载，临时 `.part` 文件不覆盖可用安装器 |
| 长度或 SHA-512 错误 | 拒绝执行，保留现有安装与用户数据 |
| 便携版 | 保存全量文件，无原地静默安装、无重启安装按钮 |

用户端简明说明见 [app-updates.md](app-updates.md)。
