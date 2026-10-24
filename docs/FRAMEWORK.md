# 框架阶段范围（2026-10-24）

用户最新决定：先框架、UI、API；先上传代码，先发布 EXE，然后测试。

采用 Electron + React + Vite；不在此阶段引入本地推理运行环境。
SQLite 留待数据层扩展，目前用 userData 下原子 JSON，API 密钥单独加密存储。
桌面人物模式暂缓，形象区域为可更换适配器的占位。

新增确认：EXE 与网站共享 GitHub 社区数据源，包含同人作品与资源；本地私人数据保持独立。首版只留入口，不实现 GitHub 登录、投稿或同步。

扩展边界：AvatarAdapter（load/state/expression/lipSync/outfit/dispose）；SpeechEngine（load/synthesize/cancel/unload）；LocalModelProvider（load/chat/cancel/unload）。参见 src/contracts.ts。

手动记忆当前可编辑、JSON 导入导出；自动提取尚未实现。语音和本地模型设置明确禁用。后续需要真实素材、硬件和供应商 API 验证。
