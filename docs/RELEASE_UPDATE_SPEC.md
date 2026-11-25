# Release and update asset contract

This file is the upload contract for future Yukino Companion updates. It does
not change the account API: the account client continues to use
`https://yukino.fqxxzyw.cn/api/v1/...`.

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
| `Yukino-Companion-<version>-Portable.exe` | Portable build |

`latest.yml` and the `.blockmap` must be from the same `electron-builder` run
as the installer. Never edit them by hand or replace an asset under an existing
version; publish a new version instead.

## Build command

```powershell
npm run release:win
```

The current build targets are NSIS and portable. The NSIS asset name is
`Yukino-Companion-${version}-Base-Setup.exe` so the existing update reader can
find it.

## Build verification and publication

The command builds NSIS and portable together and writes verified release assets to release/<version>/. Check the generated SHA256SUMS file and upload the named assets from this directory. Publish a fresh tag for this source revision after testing. The historical Inno base workflow produces previews only.

For a new version, stage the assets in a private draft. On a clean Windows runner use the Verify staged Windows update workflow before making the release public. It installs the previous public version, upgrades to the draft installer, checks restart and inspects saved settings, conversation and model fixtures. Rebuilding after publication requires a new version. Mention Authenticode status in the release notes.

## Installed update flow

### 客户端分类更新说明（0.4.4 起）

每次发布正式版时，在 GitHub Release 正文添加二级标题「更新内容」，每条内容独占一行，写成「- 分类：用户可见的具体变化」。例如新增服装归入「衣橱」，运行环境适配归入「兼容性」，崩溃或数据丢失修复归入「稳定性」。只列出本版实际发生的变化，省略空分类。同一份正文应与仓库 docs/releases/v<版本>.md 对应。

安装版和便携版发现更高正式版本后，在下载前展示版本号与分类说明。说明来自同一 GitHub Release，按文本呈现，保持安装包和块图由 electron-builder 原样生成。旧版发行说明可显示有限长度的正文，没有说明时仍允许查看发行页。没有更新时不显示安装提示。

See [用户更新说明](app-updates.md). The updater reads the latest public GitHub release and its generated manifest. It uses electron-updater's block planner, Chromium network requests and a streaming SHA-512 verifier. Installation requires explicit confirmation. The website gets its Windows links from /api/v1/public/downloads with a 15-minute server cache.

0.4.1 / 0.4.2 → 0.4.3 requires one full download. From 0.4.3 onward, the installed updater attempts a differential download when the previous installer is available.

## 安装版和便携版验收

安装版启动后 5 秒检查一次，此后每 6 小时检查，也提供手动检查。只接受本项目 HTTPS GitHub Release 下的更高正式语义版本。未发现时显示「当前没有可用的正式版更新」。更新日志不得包含凭据、账号令牌或聊天内容。

差分缓存使用 `%LOCALAPPDATA%\yukino-companion-updater`。旧安装器为 `installer.exe`，旧块图为 `current.blockmap`，未完成的文件位于 `pending` 或以 `.part` 结尾。版本匹配的区块表、可读的旧安装器和有效的 HTTP Range 响应是差分复用的前提。区块表损坏、缓存缺失、服务器忽略 Range 或重建失败时，改为完整下载。长度和 latest.yml 的 SHA-512 全部通过后才提交最终文件，用户选择重启时再次核验。

下载页显示模式、已传输字节、预计传输字节、百分比与总包大小。断网、403、404、429、磁盘写入、校验或安装器启动错误均提供原因和重试。下载完成显示「更新已下载」和「重启并安装」，允许稍后处理。用户确认后保存应用状态并交给安装器，安装结束后重启。便携版只保存完整包，提示关闭程序并手动运行。

每个候选版本保存以下验收结果。版本号、下载字节和安装结果必须来自实际执行。

| 场景 | 必须观察到的结果 |
| --- | --- |
| 当前版本与最新正式版相同 | 手动检查显示没有可用更新，无安装提示 |
| 有更高正式版 | 显示准确版本号与该版分类说明 |
| 保留有效旧缓存 | 记录实际网络传输与整包大小，差分传输量明显较小 |
| 清除旧缓存 | 界面改为完整安装包并重新校验 |
| 破坏旧块图 | 回退完整下载，期间不执行安装器 |
| 下载中断或取消后重试 | 可重新下载，临时文件不覆盖可用安装器 |
| 长度或 SHA-512 错误 | 拒绝执行，保留现有安装和用户数据 |
| 完成后选择稍后 | 应用继续运行，只有确认重启才退出 |
| 在隔离 Windows 环境从上一正式版升级 | 新版成功启动，设置、聊天和本地模型保留 |
| 便携版 | 保存全量文件，无原地安装、无重启安装按钮 |
