# Yukino Companion · 雪乃数字人

浅蓝色、无边框的 Windows 桌面聊天框架。当前重点是 UI 与可配置 API。

[下载 Windows EXE](https://github.com/fqxxzyw/Yukino-Companion/releases) · [完整需求](docs/开发需求与技术方案_v0.1.md)

## 当前实现

- 无边框窗口，折叠侧边栏、新建/搜索/删除本地会话。
- 人物展示位可左右切换、隐藏；折叠侧栏后自动重新靠边。
- 浅蓝与蓝色默认主题，背景色、强调色、人物宽度可自定义。
- 多个兼容 Chat Completions 的 API 配置；主进程请求、流式响应、停止、超时、连接测试。
- 密钥由系统安全存储加密；会话与设置以本地 JSON 原子写入。
- 可编辑角色提示词、用户手动维护的记忆（可导入导出），作为请求上下文。

## 尚未实现

3D / Live2D 渲染、桌面透明人物、本地预训练模型、GPT-SoVITS、自动记忆提取、屏幕识别、GitHub 社区读写。界面保留明确的扩展位置，不用假数据演示成功。

社区网站与 EXE 独立发布，后续共同接入 GitHub 社区内容。当前社区按钮仅打开项目页。原 v0.1 文档是完整愿景，不代表本版完成范围；见 [框架范围](docs/FRAMEWORK.md)。

## 开发

Node 24。`npm install` → `npm run build` → `npm start`。
`npm run dev` 只预览 UI；浏览器预览不发送 API、不会保存密钥。
Windows 打包：`npm run dist:win`。构建输出 `release/Yukino-Companion-0.1.0-Setup.exe`。

填入服务的 API 基础地址（如包含 /v1 的地址），保存模型名称和密钥，再测试连接。仅支持 HTTPS 或本机 HTTP。请求会把当前会话最近 40 条消息、人设和启用的手动记忆发送到该服务。不要把私人内容写入公共仓库。

## 发布顺序

先提交代码 → Windows Actions 构建 → 发布带 EXE 的预览 Release → 再运行自动测试。发布不意味着已完成全部测试；查看对应 Actions 结果与验证记录。安装包暂未代码签名。

角色资源未随包分发。软件工作名与最终美术仍可调整。
