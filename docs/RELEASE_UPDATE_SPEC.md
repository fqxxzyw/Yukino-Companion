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

## Installed update flow (0.4.3+)

Installed NSIS builds use `electron-updater` with the GitHub provider:

1. On startup and every six hours the app checks the published `latest.yml`.
2. It asks electron-updater to download the update. When the previous NSIS
   installer is still in the updater cache, only the changed blockmap ranges
   are downloaded. The reconstructed installer is verified against the SHA-512
   in `latest.yml`; a missing cache or a failed differential attempt falls back
   to the full installer.
3. When the download completes the account-safe app UI shows "重启并安装".
4. The user clicks restart; the app quits and runs the verified NSIS installer.
5. Portable builds keep the manual full-installer save dialog and a "前往
   GitHub" route because they cannot install an NSIS update in place.

The first update installed by the legacy 0.4.1 updater is still full. From
0.4.3 onward, the NSIS installer records itself in the updater cache so later
updates can use the blockmap.
