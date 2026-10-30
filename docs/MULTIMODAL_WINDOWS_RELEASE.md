# 本轮 Windows 候选构建与发布

本轮工作流为 `.github/workflows/windows-multimodal-candidate.yml`。将经过私有资源筛选的最终提交推送至 `candidate/multimodal-20261030-safe` 即触发构建。它只拥有读取权限，不发布 Release，也不移动旧 PR 分支。

## 构建内容与证据

1. 从已有公开安装器恢复并校验获准随安装器分发的人物资源；不会将独立模型上传为工件。
2. 通过固定官方 HTTPS 图标地址缓存服务商图标；将来源和 SHA256 写入 `public/provider-logos/manifest.json`。失败项明确记录 `missing`，保留文字回退，不生成仿冒图标。
3. 执行全部 Node、Python 和 community 回归。`npm test` 的前置任务会由摘要固定的传输片重建两张原始 PNG 壁纸；重建或已有文件不匹配即失败。
4. 使用生产 renderer 执行 API 管理、新语音向导和壁纸不透明度界面检查。这些隔离夹具不使用真实密钥、麦克风或计费 API，其通过不代表语音能力验收。
5. 构建 Windows AMD64 应用。ASAR 再校验壁纸原始摘要、17 个人物视觉版本，以及成功缓存图标的官方域名、文件格式和摘要。`build/base-package.json` 单独记录图标缺失项与尚未进行的显示验收。
6. 生成 Setup.exe、源码提交/树/run 绑定记录和 SHA256；同一 run 的 `native_smoke` 安装、启动、升级和卸载精确相同的安装器，并始终保留失败证据。

候选工件名为 `Yukino-revision-candidate-<完整提交 SHA>`。只包含安装器和六个身份/包清单文件；界面证据工件为 `Yukino-multimodal-interface-<完整提交 SHA>`。不要用旧 run 41015168431 的 EXE 交付本轮修改。

## 发布时绑定精确构建

构建结束后，读取 GitHub run 和 `candidate` job，核对 repository、push 事件、分支、完整 SHA 与成功结论。使用该 run 的候选工件，在相同提交 checkout 下核对 `candidate-source.json` 的 commit、tree、runId、EXE 字节数和摘要。

发布使用现有 `scripts/publish-candidate.py`。由固定新 SHA/run 的独立发布工作流调用，从原始 run 下载工件；可以沿用历史提交 `2a830664` 的 `.github/workflows/publish-feedback-candidate.yml` 结构，但必须替换全部旧分支、run、SHA 和工件名。发布脚本创建新草稿，核对远端资产清单、大小与 SHA256 后才公开为测试预发布；不会覆盖、删除或晋升稳定版本。

原生验收未完成时，候选身份记录保持 `nativeInstallLaunchUpgradeUninstall:false`，发布说明指向同一 run 的真实检查结果。完整功能验收保持未完成，不得把安装器构建成功当作实体 GPU、真实 API 或声音播放通过。

## 官方 CUDA 安装的已知边界

本轮生产安装器调用官方 PyTorch cu124 和 llama-cpp-python cu124 wheel 命令；Windows CI 已真实完成下载与 pip 安装，但托管 runner 缺少 NVIDIA 显示驱动。`electron/official-runtime.cjs` 在检查到 CUDA DLL 且系统缺少 `nvcuda.dll` 时返回明确的驱动缺失错误，并保留已有有效环境。

这项下载证据不等于实体 NVIDIA GPU 推理通过。用户机器上的驱动、CUDA 张量、LLM 与 GPT-SoVITS 实际 GPU 推理仍须分别实测。
