# 应用更新与正式版发布

主窗口会检查 GitHub 上的正式发行版，只有严格大于应用版本的 `v主.次.补丁` 标签才会提示。预发行版不参与自动更新；没有基础安装包的正式版仍会提示并提供 GitHub 入口。基础安装包下载后按 GitHub 资产 SHA-256（或发行版的 `SHA256SUMS.txt`）和大小校验，用户需运行安装包并选择现有安装目录。安装器保留用户数据和 `Yukino-Data`。

发布新的基础正式版：

1. 递增 `package.json` 和 `package-lock.json` 中的版本，完成相应功能与安全验收。基础安装器的版本和文件名由 `package.json` 生成。
2. 手动运行 `Base installer: validate first, explicit publication only` 工作流，同时选择 `confirm_publish` 和 `publish_stable`。该工作流在验证全部通过后才发布对应的 `v主.次.补丁` 正式版；不要复用已有标签。
3. 验证发行版包含 `Yukino-Companion-主.次.补丁-Base-Setup.exe` 和校验值，并从较旧版本验证检测、下载及原位更新。若只发布测试版，保持 `publish_stable` 关闭。

资源镜像仍指向独立的 `v0.4.0-resources.1` 发行版，与应用正式版编号无关。其他历史候选版工作流和旧引导包仍固定在 0.4.0；不要用它们发布新正式版。
