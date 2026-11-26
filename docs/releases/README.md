# 版本发布记录（Release Changelog）

本目录保存 **Yukino Companion** 各正式版本的发行说明，与 [GitHub Releases](https://github.com/fqxxzyw/Yukino-Companion/releases) 及 Cloudflare R2 镜像（`https://dl.yukino.fqxxzyw.cn/releases/`）保持对应。

- **官网下载（国内 R2 优先，保留 GitHub 备用）**：<https://yukino.fqxxzyw.cn/#download>
- **发布资产与增量更新规范**：[../RELEASE_UPDATE_SPEC.md](../RELEASE_UPDATE_SPEC.md)
- **用户升级指南**：[../app-updates.md](../app-updates.md)

---

## 正式版本总览

| 版本 | 发布日期 (UTC) | 核心变化 | 安装版体积 | 详细记录 |
| --- | --- | --- | --- | --- |
| **`v0.4.6`**（当前最新正式版） | 2026-11-26 | CPU 推理环境兼容 AMD/老 CPU（`0xc000001d` 非法指令），安装包内置 AVX2 + 通用兼容 wheel 并支持 R2/官方源回退；CUDA 环境命中同一错误时可降级 CPU wheel 继续运行；客户端全面接入 Cloudflare R2 优先 + GitHub 回退，CUDA 12.4 推理环境支持官方源与国内镜像多路线自动切换。 | `321.9 MiB` (`337,496,271` B)，`0.4.5` 实测增量 `17.44 MiB` | [v0.4.6.md](v0.4.6.md) |
| **`v0.4.5`** | 2026-11-25 | 修复关闭主窗口切桌面人物永久报错、切装误触转盘 IPC 报错及 WebGL 丢失后「重新加载模型」卡死；拆分静态素材至 `app.asar.unpacked` 并启用 NSIS `store-asar` 细粒度 `.blockmap`，`app.asar` 由 456 MB 瘦身至 9.47 MB，后续纯代码增量降至约 0.5–1 MB。 | `307.4 MiB` (`322,356,092` B) | [v0.4.5.md](v0.4.5.md) |
| **`v0.4.4`** | 2026-11-25 | 安装包补齐 `runtime-catalog.json`、默认语音参考音频与 `aria2`，修复 0.4.3 推理环境未准备；域名切换至正式站 `https://yukino.fqxxzyw.cn`；新增分类更新说明展示、自定义角色云备份与赛璐璐材质分层。 | `376.4 MiB` (`394,717,262` B) | [v0.4.4.md](v0.4.4.md) |
| **`v0.4.3`** | 2026-11-19 | 引入 NSIS + `.blockmap` 应用内差分更新与「重启并安装」流程，支持断点/区间校验与失败回退整包。 | `372.5 MiB` (`390,578,978` B) | [v0.4.3.md](v0.4.3.md) |
| **`v0.4.2`** | 2026-11-19 | 重构「账号与会话」设置页；统一 `shared/outfit-rules.json` 服装解锁规则（登录第 2/3 天与好感度分级解锁）；新增可选云端文字记忆与注册昵称流程。 | `372.2 MiB` (`390,251,402` B) | [v0.4.2.md](v0.4.2.md) |
| **`v0.4.1`** | 2026-11-18 | 完整 Live2D 雪乃随包发布；修复黑色旗袍腰线与头部骨骼接合；新增「环境跟随时间」并默认关闭主窗口保留桌面 3D 人物。 | `372.2 MiB` (`390,277,944` B) | [v0.4.1.md](v0.4.1.md) |
| **`v0.4.0`** | 2026-11-18 | 首个 0.4 正式版：集成 9 套过审 V2 服装、修复 T 字首帧、上线账号服务与官网基础架构。 | `363.1 MiB` (`380,692,839` B) | [v0.4.0.md](v0.4.0.md) |
| **`v0.3.0`** | 历史版本 | 早期框架版本归档记录。 | — | [v0.3.0.md](v0.3.0.md) |

---

## 升级路径速查

- **`0.4.1 / 0.4.2 → 0.4.6`**：建议直接升级到最新正式版（官网优先通过 `dl.yukino.fqxxzyw.cn` 下载，或在应用内直接更新）。
- **`0.4.3 / 0.4.4 → 0.4.5`**：属于一次性的小增量目录结构切换（实测增量下载约 `177–184 MiB`，节省约 `40–42%`），完成结构迁移并修复桌面人物加载报错。
- **`0.4.5 → 0.4.6`**：实测增量下载 **`17.44 MiB`**（`17,932,710` B 数据区块 + `356,299` B blockmap，节省 `94.58%`），首次加入内置 CPU 兼容 wheel。
- **`0.4.6+`**：已切换至 `store-asar` + `asarUnpack` 结构，后续纯代码更新仅需下载约 **`0.5–1 MB`** 变化区块（节省 `> 99%`）；新增或优化单个 3D 模型时也仅下载对应变动文件。

---

## 0.4.6 变更（已发布）

> 以下改动已随 `v0.4.6` 发布并推送到 `codex/local-yukino-models-20261113`；官网与 R2 存储桶同步为 R2 优先、GitHub 自动回退。

- **下载加速**：Cloudflare R2 存储桶 `yukino-downloads` 与自定义域名 `https://dl.yukino.fqxxzyw.cn` 继续作为首选源，全量共享依赖模型资源、CUDA/CPU 轮子、安装包与增量更新均优先走 R2，GitHub Release 保留为正式归档与自动回退。
- **CUDA 推理环境**：内置多路线官方源与国内镜像（PyTorch 官方、南京大学、阿里云、腾讯云 + 阿里云、中科大 + 阿里云、上海交大 + 清华；`llama-cpp-python` 自有 R2 镜像 + `abetlen.github.io` 官方源），支持失败自动切换路线并在首次配置向导提供路线策略选择。
- **应用内更新器**：允许信任 `dl.yukino.fqxxzyw.cn`，支持 GitHub API 受限时回退 R2 `releases/latest.json`，并优先从 R2 拉取 `.blockmap` 与 Range 差分区块。

### CPU 指令集兼容修复（AMD / 老 CPU，0xc000001d）

- **现象**：部分 AMD（如锐龙 1000–5000，无 AVX-512）或老 CPU 选择「CPU 通用环境」时，自检 import llama_cpp 报 OSError: [WinError -1073741795] Windows Error 0xc000001d（非法指令）。
- **修复**：自检命中该错误时自动依次安装 AVX2 版、通用兼容版（无 AVX）llama-cpp-python==0.3.36；安装包内置 `resources/cpu-wheels/{avx2,compat}` 优先离线修复，其次回退 `dl.yukino.fqxxzyw.cn/wheels/cpu/{avx2,compat}/`，AVX2 另有 abetlen 官方源；CUDA 环境命中同一错误时也降级为 CPU wheel 保证可运行。界面显示中文提示而非 Python 堆栈。
- **构建**：`translation/prepare_runtime.py` 以后默认 GGML_NATIVE=OFF、GGML_AVX512=OFF、GGML_AVX2=ON，并支持 GitHub / PyPI 两个固定哈希源码包。
- **镜像**：CUDA PyTorch 新增 上海交大 + 清华 PyPI 路线。
