# 0.4.0 基础版发布记录

记录日期：2026-10-26。发布标签：`v0.4.0-base.6`。

[下载基础安装器](https://github.com/fqxxzyw/Yukino-Companion/releases/download/v0.4.0-base.6/Yukino-Companion-0.4.0-Base-Setup.exe) · [完整发行页](https://github.com/fqxxzyw/Yukino-Companion/releases/tag/v0.4.0-base.6) · [社区与帮助](https://fqxxzyw.github.io/Yukino-Companion/)

## 已发布资产

| 项目 | 记录 |
| --- | --- |
| 安装器 | `Yukino-Companion-0.4.0-Base-Setup.exe` |
| 文件大小 | 129,519,453 字节（约 123.5 MiB） |
| SHA-256 | `6e3d27fc2e6b8635fe8e24a504f03f4cd8e57ecd51d82816cbbfcedcaf18521e` |
| 应用源码提交 | `b9eba97ca22f36118b047fa751b9a7a350d818f9` |
| 校验工作流提交 | `b9eba97ca22f36118b047fa751b9a7a350d818f9` |

安装器已经上传。**发布后验证已通过。** 对应 [GitHub Actions 验证任务 40283145788](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40283145788)。应用与验证工作流使用同一提交。

验证包括：真实 Windows 中文安装界面、中文路径安装、已安装 EXE 首次启动、升级保留个人文件、拒绝未知非空目录及卸载保留个人文件；内置 aria2 的真实 HTTPS 下载与哈希校验；210 项 Node 测试、49 项 Python 测试及 80 项界面检查。已取回 30 张界面截图和 3 张原生窗口截图，并复核首次启动、安装器和场景／衣装界面。实际已安装应用启动日志没有错误或警告。

界面回归使用明确标记的合成对话和资源状态，不代表本次重新完成真实大模型、GPU 或音色质量验收。公共环境当前提供 CPU 下载方案，仍需用户在自己的硬件上安装资源后测试。

可在 PowerShell 中核对下载文件：

```powershell
Get-FileHash -LiteralPath '.\Yukino-Companion-0.4.0-Base-Setup.exe' -Algorithm SHA256
```

## 本次交付

- 基础 Setup 安装桌面程序，安装过程中不下载模型、音色或运行环境。打开软件后，在资源向导选择需要的功能，也可以跳过并配置 API 文字聊天。
- 安装界面修正中文编码，采用浅蓝与白色布局。Python 与推理环境不内置在基础安装器中。
- 内置 aria2，提供多连接、断点续传、资源校验及备用来源处理；实际速度取决于网络与源站。
- 独立资源发布在 [v0.4.0-resources.1](https://github.com/fqxxzyw/Yukino-Companion/releases/tag/v0.4.0-resources.1)，登记 18 个资源文件。模型与环境按对应清单下载，不把程序安装成功当成所有本地推理资源已经齐备。
- 社区 Pages 已部署并通过浏览器检查，展示真实 GitHub Issues 内容。投稿明确跳转 GitHub 登录和确认，首版没有网站内独立 OAuth 登录会话。
- 场景渐变背景与以人物位置为中心的扩散交互已接入。衣装切换和视线跟随提供适配接口，真实 3D 骨骼、衣装与动作仍待资源接入和视觉验收。
- 情绪、好感度、体力与签到已有基础本地状态；尚未接入自动情感分类或付费权益验证。签到资格标记不代表已经提供对应真实皮肤。

个人广告仍待用户确认，未插入公开帮助正文。完整需求、已实现范围与后续验收条件见 [下一阶段功能文档](NEW_FEATURES_0.5.md)。

历史测试版 `v0.4.0-base.3` 在真实安装测试中发现目录保护检查使用无效安装器常量，不能完成安装；请使用本记录指向的修正版。修正版同时固定校验文件换行和 UTF-8 读取，避免 Windows 验证脚本的编码误报。
