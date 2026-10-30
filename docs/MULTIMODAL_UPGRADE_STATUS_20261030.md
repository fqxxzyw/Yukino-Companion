# 2026-10-30 多模态、语音与 API 管理升级状态

这是在现有 Electron + React 项目上的增量修改。保留既有人格、记忆、历史对话、翻译、GPT-SoVITS、桌宠、人物资源和安装方式。旧测试版 `v0.4.0-test.41015168431` 不包含本文全部修改，不能作为本轮新版交付。

## 已实现并完成本地验证

| 范围 | 实际修改与行为 | 主要文件 |
| --- | --- | --- |
| 外观与壁纸 | 壁纸归入外观；自定义多图、轮播和圆形扩散；新增 0–100% 不透明度，默认 100%，0% 显示主题底色；文本与控件不透明度不变 | `src/ui/AvatarPresentationSettings.jsx`、`SceneBackdrop.jsx`、`avatar-presentation.mjs`、`bundled-wallpapers.mjs` |
| 设置导航 | 常规、外观、API 管理、对话与主动陪伴、语音输入、语音输出、视觉感知、人物与桌宠、双语与翻译、本地资源十类；旧入口保留映射 | `src/main.jsx` |
| API 管理 | 服务卡片、官方 HTTPS 链接、中文七步教程、动态鉴权字段、配置复制/修改/移除；聊天、主动、视觉、ASR、翻译独立分配 | `src/ui/ApiManagementSettings.jsx`、`electron/api-management.cjs`、`task-routing.cjs` |
| 密钥与证据 | 密钥沿用系统 safeStorage；端点绑定；凭据变化清除旧证据；模型/连接/视觉/真实转写分别记录；复制凭据独立；并发变化不能获得旧成功状态 | `electron/api-service-manager.cjs`、`main.cjs`、`preload.cjs` |
| 实时语音接口 | 接入阿里云 Qwen realtime WebSocket 协议；16kHz PCM、部分/最终转写、点击/按住/自由语音、服务端 VAD、输入电平、静音、停止与打断；终止立即撤销麦克风许可 | `electron/aliyun-asr.cjs`、`src/speech/voice-input-session.mjs`、`microphone-capture.mjs`、`VoiceInputControl.jsx`、`VoiceInputSettings.jsx`、`public/audio/` |
| 方案 B 链路 | 最终转写复用正常人格/历史聊天；独立日语翻译；现有 GPT-SoVITS 与音频播放器。翻译失败保留中文，不将中文冒作日语；停止清除旧音频。未分配语音输出时不自动朗读 | `electron/main.cjs`、`bilingual.cjs`、`src/main.jsx`、`src/speech/session.mjs` |
| GPT-SoVITS | `.ckpt` / `.pth` 分开选择、下载、检查与删除；不删除或覆盖自定义文件；公共模型、参考录音检查/播放、设备参数、独立真实试听和中文帮助 | `src/speech/VoiceSettings.jsx`、`VoiceAudition.jsx`、`ReferenceAudioCheck.jsx`、`VoiceGuide.jsx`、`electron/voice-resources.cjs`、`voice-reference.cjs` |
| 语音配置向导 | 首次提示、稍后再说、固定入口恢复；复用 API 与声音设置；真实转写/试听确认/完整链路分别验证；配置签名变化使旧证据失效；跳过不显示成功 | `src/speech/VoiceChatWizard.jsx`、`voice-chat-wizard-state.mjs` |
| 云端视觉与主动陪伴 | 独立视觉配置；已授权观察事件经冷却、去重、免打扰、最近互动和未回复限制决定主动回复；观察作为不可信数据；停止或切换观察取消在途生成 | `electron/companions.cjs`、`companion-reminders.cjs`、`companion-visual.cjs` |
| 下载与目录 | 只复用当前选定目录；迁移应用管理路径，保留自定义路径；运行环境/模型/缓存临时文件跟随资源目录；最终磁盘检查后才报告完成；不完整参考文本不阻止资源下载 | `electron/setup.cjs`、`runtime-manager.cjs`、`resource-packs.cjs`、`worker-client.cjs`、`main.cjs` |
| 窗口与角色 | 服装关闭按钮固定；人物卡显示姓名/介绍/头像与模型预览或“无”；真实时间日照，有位置时计算太阳高度，无位置明确为时间模拟 | `src/ui/` 既有人物、服装、位置设置组件 |

## 服务接入与实际验证边界

| 项目 | 当前真实状态 |
| --- | --- |
| 阿里云实时 ASR | 协议实现及合成协议/实际 ws 依赖测试通过；未使用真实账户、麦克风或计费请求实测，界面保持未验证 |
| OpenAI、火山、腾讯、Deepgram、ElevenLabs ASR | 提供正确类型的字段、官方教程和入口；协议待接入，不能执行或标成可用 |
| Google / Azure ASR | 扩展预留，待接入 |
| GPT-SoVITS | 复用原服务并增强配置/取消/试听证据；本轮未在 Windows 真实播放雪乃合成声音 |
| 屏幕 / 摄像头 | 捕获与授权链路、主动决策和停止逻辑已有实现/测试；本轮未实测真实摄像头或云端图片理解 |
| 官方 GPU 环境下载 | Windows run `41021263600` 已真实下载并 pip 安装 PyTorch/torchaudio cu124 与 511.4 MB llama-cpp-python CUDA wheel |
| NVIDIA 推理 | 托管 runner 缺少 `nvcuda.dll`；DLL 依赖诊断确认需要 NVIDIA 驱动。生产探测已返回明确原因；实体 GPU 张量、文字生成与声音推理均未验收 |
| 官方品牌图标 | Windows run `41026839863` 已从固定官方来源下载并使用原生图片支持解码，13/13 成功、无缺失；均记录允许域名与 SHA256。六家主要 ASR 品牌已在生产 Electron renderer 离线加载真实本地图片，未使用文字回退；没有网络请求。ASAR 验收仍待完整 Windows 构建；下载失败时使用明确文字回退 |
| 嘴型 / 眨眼 / 口型同步 | 本轮没有新增实体硬件验收，不能因源码测试通过而标为已实测 |

## 本地测试证据

- 完整 Node 回归：**926 通过，0 失败，0 跳过**。
- 生产 Vite 构建：通过。保留现有大资源块体积提示，没有伪装为构建失败或运行验收。
- Electron 生产 renderer：API 管理 15、语音向导 20、壁纸不透明度 5、完整设置回归 97，共 **137 项检查通过**；没有计费 API、真实麦克风或 TTS 请求。
- 壁纸像素检查：0% 为主题底色，50% 为正确颜色混合；轮播与扩散两层保持同一不透明度；文本和按钮不透明度为 1。
- 本次再次执行 Python 75、community 19 项回归，全部通过。Windows 新候选工作流会再次执行。
- Linux 运行环境缺少 CJK 字体，截图不能作为 Windows 中文排版验收。

复现命令：`npm test`、`npm run build`。界面脚本：`scripts/capture-api-management.cjs`、`capture-voice-wizard.cjs`、`capture-wallpaper-opacity.cjs`、`capture-ui.cjs`。Linux 无显示环境另加 Electron Ozone headless 参数；Windows 使用原生窗口运行。

## 使用方式与资源依赖

1. 在外观中选择壁纸，调整“不透明度”；设为 0% 暂时只显示主题底色，设为 100% 显示原图。
2. 在 API 管理中选择服务、按教程获取凭据并保存。保存不是验证成功。当前实时输入选择阿里云已接入协议，地域、工作空间与密钥必须对应。
3. 在任务分配中独立选择聊天、语音识别、视觉与翻译。语音输出当前支持本地 GPT-SoVITS；云端 TTS 尚未接入，不会静默换音色。
4. 语音输出中准备 Python/GPT-SoVITS、兼容的 GPT/SoVITS 权重、BERT、HuBERT 和参考录音；不随默认方案下载本地 ASR 或视觉大模型。
5. 使用语音聊天快速向导：先真实转写，再试听并确认声音，最后完整链路测试。没有 API 时仍能文字输入；没有 TTS 时仍显示文字回复。
6. 持续监听默认关闭；选择自由语音并点击后才开始。观察屏幕/摄像头需要分别授权，停止入口会撤销捕获并取消旧主动生成。

新增生产依赖为 `ws@8.22.0`。推理资源按需下载到安装旁或用户选定的资源目录；GPU 运行还需要用户机器上可用的 NVIDIA 驱动。云端服务需要用户自己的账户、权限和额度，费用以官方实时信息为准。

## Windows 构建与发布状态

已准备只读候选工作流 `.github/workflows/windows-multimodal-candidate.yml`，绑定 `candidate/multimodal-20261030-safe`；构建后同 run 原生安装/启动/升级/卸载验收，再绑定精确 SHA/run/EXE 摘要发布。

本轮源码已通过筛选和敏感信息扫描，纯文本修改已同步为未提交 Git tree；没有移动旧 PR #5，也没有把远端 `417c5d` 当作最新全部修改。

**本轮新 EXE 尚未构建和发布。** 自动审批审查拒绝了其中部分用户默认壁纸原图分片向公开 GitHub 上传，理由是无法确认大块编码内容的授权来源，并要求对这两张图的具体公开上传单独确认。已停止该操作，不更换路径或编码绕过，不提交缺片候选。原图本地完整，逐片与用户附件的字节区间/摘要匹配。私有独立模型、权重、密钥和记录均未加入公开同步。
