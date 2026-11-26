# Yukino Companion 文档目录

本页是项目内全部核心 Markdown 文档的导航索引。文档按职责分为**接口与后端**、**人设与角色**、**发版与更新**、**推理与本地资源**、**架构与前端功能**及**模型训练**六大类。

> 最近整理日期：2026-11-26（对应线上版本 `v0.4.5` 及 R2 / CUDA 多镜像升级分支）。

---

## 一、接口与云端后端

| 文档 | 说明 |
| --- | --- |
| [API.md](API.md) | 账号、验证码、登录/刷新、云端记忆、好感度/皮肤权益及 `/api/v1/public/downloads`（R2 + GitHub 双源）完整 HTTP 接口文档 |
| [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md) | Cloudflare Workers (`yukino-api`)、D1 (`yukino-account`)、R2 (`yukino-downloads` / `dl.yukino.fqxxzyw.cn`)、Gmail OAuth 与上线验证手册 |
| [DEPLOYMENT_HANDOFF.md](DEPLOYMENT_HANDOFF.md) | 部署交接记录、路径、命令与线上状态核查 |
| [CLOUD_MEMORY.md](CLOUD_MEMORY.md) | 可选云端长期记忆与纯文字对话同步设计（明文边界与冲突控制） |
| [OFFLINE_AND_PROGRESS.md](OFFLINE_AND_PROGRESS.md) | 游客/账号离线进度、每日签到与 ES256 权益快照验签设计 |
| [SECURITY.md](SECURITY.md) | 安全策略、CSP、凭据存储、鉴权与限流边界 |
| [API_MANAGEMENT.md](API_MANAGEMENT.md) | 桌面端多服务商 API 管理与按任务路由（对话 / 翻译 / 视觉 / 语音） |
| [API_PROVIDERS.md](API_PROVIDERS.md) | 已支持与待接入的云端模型/语音服务商目录规范 |
| [../server/README.md](../server/README.md) | Cloudflare Worker 后端本地开发、迁移与单测说明 |

---

## 二、人设与角色设定

程序运行时直接读取的雪之下雪乃人设资产位于 [`characters/yukino/`](../characters/yukino/)，行为与自定义规范位于 `docs/`：

| 文档 | 说明 |
| --- | --- |
| [../characters/yukino/CHARACTER.md](../characters/yukino/CHARACTER.md) | 雪之下雪乃完整人物设定档案（108 KB） |
| [../characters/yukino/SKILL_ZH.md](../characters/yukino/SKILL_ZH.md) | 中文互动技能、语气边界与对话细则（115 KB） |
| [../characters/yukino/SKILL_EN.md](../characters/yukino/SKILL_EN.md) | 英文互动技能规范（135 KB） |
| [../characters/yukino/runtime.md](../characters/yukino/runtime.md) | 对话运行时实际注入的系统提示词 |
| [../characters/yukino/compact.md](../characters/yukino/compact.md) | 上下文精简版人设提示词（小模型 / 低预算场景） |
| [../characters/yukino/evidence.md](../characters/yukino/evidence.md) | 原作台词与人物性格佐证摘录 |
| [../characters/yukino/voice.md](../characters/yukino/voice.md) / [training.md](../characters/yukino/training.md) | 音色表现与角色微调说明 |
| [persona-behavior-guide.md](persona-behavior-guide.md) | 角色行为、情绪表达与对话规范总指南 |
| [角色规范与性格专项训练.md](角色规范与性格专项训练.md) | 性格专项训练标准与评测维度 |
| [CUSTOM_CHARACTERS.md](CUSTOM_CHARACTERS.md) | 自定义角色创建、3D 模型（GLB/VRM）与三维场景导入图文指南 |
| [OUTFIT_UNLOCKS.md](OUTFIT_UNLOCKS.md) | 9 套 V2 服装默认开放、登录天数与好感度解锁规则 |

---

## 三、版本记录、打包与增量更新

| 文档 | 说明 |
| --- | --- |
| [releases/README.md](releases/README.md) | **版本更新记录总览**（`v0.3.0` ~ `v0.4.5` 汇总表、安装包/R2 资产与升级路径说明） |
| [releases/v0.4.5.md](releases/v0.4.5.md) | 最新正式版 `v0.4.5` 发布说明（桌面人物修复、`store-asar` 小增量瘦身） |
| [RELEASE_UPDATE_SPEC.md](RELEASE_UPDATE_SPEC.md) | 正式版发布契约、`store-asar` 细粒度 `.blockmap` 规范、R2 同步与验收清单 |
| [app-updates.md](app-updates.md) | 面向用户的安装版增量更新与便携版升级说明 |
| [WINDOWS_RELEASE_0.4.md](WINDOWS_RELEASE_0.4.md) / [RELEASE_BASE_0.4.0.md](RELEASE_BASE_0.4.0.md) | Windows 0.4 系列打包结构与历史基础包说明 |

---

## 四、推理环境、语音、翻译与资源下载

| 文档 | 说明 |
| --- | --- |
| [OFFICIAL_RUNTIME_INSTALL.md](OFFICIAL_RUNTIME_INSTALL.md) | Windows CPU / CUDA 12.4 运行环境安装、官方源与国内多镜像（南大 / 阿里云 / 腾讯云 / 中科大 / 自有 R2）自动切换规范 |
| [DOWNLOAD_TASKS.md](DOWNLOAD_TASKS.md) | 进程内下载任务去重、取消所有权与验证记录 |
| [SPEECH_AND_INSTALL_SCOPE.md](SPEECH_AND_INSTALL_SCOPE.md) | 安装位置隔离、语音缓存、分句批处理与作用域说明 |
| [VOICE_INFERENCE.md](VOICE_INFERENCE.md) | 本地 GPT-SoVITS / Aqua-TTS 语音推理与流式调度说明 |
| [TRANSLATION.md](TRANSLATION.md) | 本地 Hy-MT2-1.8B 中日翻译模型与双语链路说明 |

---

## 五、架构、桌面陪伴、3D 场景与前端开发

| 文档 | 说明 |
| --- | --- |
| [../README.md](../README.md) | 项目总览、下载安装、功能边界、整体架构与开发入口 |
| [开发需求与技术方案_v0.1.md](开发需求与技术方案_v0.1.md) | 初始产品需求与整体技术设计方案 |
| [FRAMEWORK.md](FRAMEWORK.md) / [NEW_FEATURES_0.5.md](NEW_FEATURES_0.5.md) | 架构演进与 0.5 阶段功能规划 |
| [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) | 本地开发环境搭建、前端/桌面调试与资产准备 |
| [UI_UX_IMPLEMENTATION.md](UI_UX_IMPLEMENTATION.md) | 界面视觉与交互实现记录 |
| [DESKTOP_COMPANIONS.md](DESKTOP_COMPANIONS.md) / [DESKTOP_PET_PARITY.md](DESKTOP_PET_PARITY.md) / [COMPANION_WINDOWS_ACCEPTANCE.md](COMPANION_WINDOWS_ACCEPTANCE.md) | 桌面 3D 人物、Q 版桌宠、关闭交接与验收标准 |
| [CONTROL_MOTION.md](CONTROL_MOTION.md) / [../motion-studio/README.md](../motion-studio/README.md) | 3D 人物动作控制与独立动作时间线编辑器说明 |
| [SCENE_DIORAMAS.md](SCENE_DIORAMAS.md) / [scene-material-refinement.md](scene-material-refinement.md) / [classroom-blackboard.md](classroom-blackboard.md) | 三维场景景观、赛璐璐材质分层与教室黑板互动 |
| [MODEL_PHYSICS_AUDIT.md](MODEL_PHYSICS_AUDIT.md) | 3D 服装模型蒙皮与物理边界审计记录 |
| [TEST_RESULTS.md](TEST_RESULTS.md) | 阶段性自动化测试与验收结果汇总 |

---

## 六、本地对话模型训练与评测

| 文档 | 说明 |
| --- | --- |
| [../model-service/README.md](../model-service/README.md) | 本地对话模型服务与推理 Worker 说明 |
| [../model-service/persona-data/README.md](../model-service/persona-data/README.md) | 人设训练数据集说明 |
| [../model-service/persona-data/EVALUATION.md](../model-service/persona-data/EVALUATION.md) / [VALIDATION.md](../model-service/persona-data/VALIDATION.md) | 人设模型评测与验证方法 |
| [../model-service/notebooks/](../model-service/notebooks/) | 各轮 A100 LoRA / 纠错 / 原作章节续训说明 |
