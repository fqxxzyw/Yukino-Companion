# Release and update asset contract

This file is the upload contract for future Yukino Companion updates. It does
not change the account API: the account client continues to use
`https://yukino-api.fqxxzyw.workers.dev/api/v1/...`.

## Version and tag

1. Bump `package.json` `version` with semver.
2. Commit the source and create an annotated tag `v<version>`.
3. Publish a GitHub Release for that exact tag; do not use a draft/prerelease
   for a stable update.

## Required release assets

| Asset | Purpose |
| --- | --- |
| `Yukino-Companion-<version>-Base-Setup.exe` | NSIS installer used by the updater |
| `Yukino-Companion-<version>-Base-Setup.exe.blockmap` | Differential update map; must match the installer byte-for-byte |
| `latest.yml` | Version, installer path, size and SHA-512 |
| `SHA256SUMS-<version>.txt` | Human and fallback integrity check |
| `Yukino-Companion-<version>-Portable.exe` | Optional portable build |

`latest.yml` and the `.blockmap` must be from the same `electron-builder` run
as the installer. Never edit them by hand or replace an asset under an existing
version; publish a new version instead.

## Build command

```powershell
npm run build
npx electron-builder --win --x64 --publish never
```

The current build targets are NSIS and portable. The NSIS asset name is
`Yukino-Companion-${version}-Base-Setup.exe` so the existing update reader can
find it.

## Future background update flow

The intended flow is:

1. On startup and every six hours, the installed app checks `latest.yml`.
2. It downloads only changed installer blocks through the `.blockmap` and
   verifies the SHA-512 in `latest.yml`.
3. When download completes it shows "更新已下载，重启完成更新".
4. The user clicks restart; the app quits and runs the verified installer.
5. Portable builds show a manual "前往 GitHub" route because NSIS updater
   state is not available.

This flow is a specification for the remaining updater integration. The
current 0.4.1 build still uses the existing manual installer download path.
