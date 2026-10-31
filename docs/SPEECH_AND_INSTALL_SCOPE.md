# 语音批处理、缓存、API 表单与安装位置隔离

更新：2026-10-31。场景保持暂停；尚未收到用户要提供的新 HTML / JS。七套草稿模型、材质、hold 与解锁规则不在本阶段修改范围。

## 当前安装独立管理资源

- 正式版默认下载到 **当前 EXE 所在目录 / Yukino-Data**，不因旧安装资源存在而自动判为已安装。
- `speech.json`、`translation.json`、`local-chat.json`、`resource-directory.json`、`speech-cache.json` 及其原子写入临时文件，存入 `userData/installations/<安装作用域 SHA-256>/`。正式版作用域取 EXE 所在目录；源码开发版取当前 checkout；Windows 路径大小写不产生新作用域。
- 同安装目录重启保留该作用域已保存的设置。更换目录不读旧作用域或旧顶层资源设置，不自动继承旧自定义路径。未知归属的旧配置不自动迁移；原文件保留，用户可明确选择资源目录或文件后复用。
- 聊天、角色与加密凭据不放进上述资源白名单，不删除、不迁移。开发版仍在 Electron ready / lock / service import 前设置独立 userData 与 sessionData。
- 默认 bundled 语音与资源包检查不再扫描 legacyDataRoot；资源包显式 legacyOnly 检查只作为明确诊断入口。公共运行环境仍检查当前 dataRoot 与本次 resourceRoot。
- 用户明确选择的资源根记录绑定当前安装目录；切换资源目录须等待下载结束并重启。旧文件不删除，不自动复制数 GB 的权重。
- 目录不可写如实报错，不偷偷改存 AppData 或别的旧安装目录。

## API：先选厂商，再填凭据

- 常见流程为选择厂商 → 官方地址与默认参数预填 → 输入 API Key → 保存；URL、配置名称与自定义参数放在高级设置。地址摘要仍可查看。
- 聊天服务的可用模型从账户列表显式选择；没有列表时可以在高级设置手填，不自动发付费聊天请求来猜测可用性。
- 保留已有自定义 / 代理 URL。切厂商清空未保存的 Key，已配置项目保留为独立配置，不能把旧厂商的凭据带到新厂商，即使二者同 origin。
- 多凭据厂商仍显示实际必填字段。例如腾讯 ASR 的 APPID、SecretID、SecretKey 与引擎型号不能伪装为只需一个 Bearer Key。
- 语音输入页列举 OpenAI、阿里云、火山引擎、腾讯云、Deepgram、ElevenLabs、Google、Azure，提供受信的官网 / 凭据 / 文档跳转。
- 跳转 IPC 只传 providerId 与允许的 kind；renderer 不向主进程传任意跳转 URL。
- **目录不是功能验证**：阿里实时识别协议已接、未做本机真实转写；其余 ASR 仍为目录 / 待接入。没有用付费 API、麦克风或模拟结果冒充实测通过。

## 合成音频缓存

- 入口：设置 → 语音输出 → 合成音频本机缓存。默认关闭，默认保留 7 天，可选整数 1–30 天。
- 正式版固定在 `<本次安装目录>/Yukino-Data/speech-cache`；源码开发版使用当前 checkout 的开发配置命名空间。renderer 无权指定缓存目录。
- 缓存文件是可播放的本机音频，**不是加密存储**。UI 明确提醒能访问目录的人可能听到对话；文件名不包含明文对话或参考文本。
- Key 包含文本与批组边界、声音相关配置，以及 Python / worker / 上游 TTS / 权重 / 参考 / BERT / HuBERT 等关键文件的路径和文件身份。身份使用 dev、ino、size、mtimeNs、ctimeNs，不是每句话重新对数 GB 权重做完整内容摘要。播放音量不影响声音缓存身份。
- 服务层可在命中时直接返回缓存；已有会话预热仍可能提前加载模型，不保证整个 UI 流程完全不分配模型。
- 只接收结构完整、尺寸受限的 WAV；拒绝 symlink / junction / 硬链接条目，检查目录身份，原子发布且不覆盖未知文件。Node 缺少 dirfd / openat，不宣称能完全抵抗同机恶意进程在系统调用间替换父目录。
- I/O 失败不破坏已生成的正常音频；设置页根据真实 IPC 返回确认保存，不匹配或有磁盘错误时不能显示成功。
- 开启、写入、状态刷新与清理检查会检查过期文件；只清理本模块命名的过期条目。关闭缓存不删已有文件，退出后没有常驻定时清理服务。没有新增清空缓存按钮。

## 一次回复的多句处理

- 第一段立即单句合成；后续文本可用时，最多三句、换行拼接总长不超过 500 字符，发一次 `synthesize_batch`。
- GPT-SoVITS 使用同一模型实例的原生 batch：`batch_size=句数`、多句时 `parallel_infer=true`、`split_bucket=false`、`cut0`，不是复制多个模型或并发线程调用同一个可变 pipeline。
- 一组返回一个 WAV，不是每句各返回一个乱序音频。renderer 保持原句序、sentenceIndex 与一个有界预取组；播放当前组时准备下一组。
- 所有句子仍须是包含假名的完整日语译文，不把中文 fallback 送进日语合成。
- 后端单 owner 准入拒绝额外忙请求；拒绝者不能杀掉真正正在推理的 worker。会话 generation / epoch / task 身份保护取消、同 ID 复用、迟到缓存与旧 worker 结果。
- **尚未完成真实 GPT-SoVITS 性能、批组划分、有效生成音频与听感验收**。参数和调度测试通过不能代替模型实测。

## 已执行的验证

所有 Node 测试直接使用 `node --test`，没有触发资源准备 pretest，没有升级依赖。

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 新 batch / cache IPC / main pipeline | 57 项全部通过 | `.local-dev/speech-batch-final-20261031.log` |
| 扩大语音、缓存、API、安装目录与 IPC 回归，23 文件 | 264 项，263 通过、0 失败、1 跳过 | `.local-dev/speech-logic-integration-20261031.log` |
| 相关部署、资源包、默认声音保留、预热回归，5 文件 | 33 项全部通过 | `.local-dev/install-scope-related-20261031.log` |
| Python worker 配置、协议、批参数与错误路径 | 12 项全部通过，无 stderr 读取线程编码异常 | `python -I tests/worker_test.py` |
| Vite 生产构建，独立新输出目录 | 成功；仍有 >500 kB chunk 提示 | `.local-dev/speech-ui-build-20261031.log`，`build/logic-ui-J3d9sh/` |
| 真正 Electron main + preload 设置验收 | 7 项通过：独立 profile、缓存保存 / 重启、厂商切换清空 Key、ASR 目录、阿里预填表单、腾讯多凭据；无渲染错误 / 外部请求 | `build/settings-acceptance-d7EhUU/report.json` 与 5 张 PNG，已实际查看截图 |
| 源码语法与本阶段修改文件空白检查 | 通过 | `node --check`、定向 `git diff --check` |
| 需求目录 SHA-256 / 文件集合 | 与外部基线一致，23 文件、13,294,821 字节 | `E:/JAVA/yukino-requirements-baseline-20261031.json` |

跳过项是当前 Windows 无文件符号链接创建权限的缓存用例；junction 拒绝测试实际通过。此前三项测试时序失败已修复测试启动等待并重跑通过，不是删断言或假造模型完成。扩展 Electron 验收有一次在厂商切换后的 React 更新尚未完成时立刻读取旧输入，导致断言失败（`build/settings-acceptance-Xxnz55/report.json`）；驱动改为等待目标厂商标题与空密码输入实际呈现后重跑，最终 7 项通过，失败证据保留。

Electron 验收通过 `node scripts/verify-speech-settings.mjs` 启动实际源码 app。专属 launcher 先设置一个新的临时 appData，再加载真实 main / preload，不替换业务 IPC；禁止外部网络，跳过部署，不启动模型。它不读取正式 profile、不导入旧资源，也不证明安装器迁移或推理可用。报告与临时 profile 保留作证据，正常退出自己创建的 Electron 和 Vite。由于此次补了专属窗口验收驱动，可用 `/run-skill-generator` 将这套启动与交互流程固化为项目技能。

全仓 `git diff --check` 仍报告先前暂停场景文件 `src/ui/procedural-scenes.mjs:178` 的尾部空行，以及原有 CSS 的 CRLF 提示；本阶段不顺手修改暂停中的场景。没有运行全仓测试，也不把历史不需要的扩展资产 ENOENT 隐藏为通过。

## 真实本机资源与执行阻塞

已实际发现旧安装的 Python、FFmpeg、GPT-SoVITS、GPT / SoVITS 权重、BERT、HuBERT、翻译与本地聊天资源；本机是 RTX 3060 Laptop 6 GiB / RAM 15.69 GiB。**存在文件不等于摘要、依赖、CUDA 内核、模型加载或生成成功，更不等于本次安装已配置。** 未停止用户已有 Python 进程。

### 下载到底是不是 Motrix

源码使用独立 **aria2c 子进程，不是 Motrix UI 或其 RPC 服务**。配置最多 8 连接 / split 8、支持分卷并行，固定摘要、TLS 校验与续传保护仍保留；实际连接数取决于源站。

已真实执行 `python -I scripts/prepare-aria2.py --output build/aria2`，官方 aria2 1.37.0 发布包和源码按仓库固定 SHA-256 校验成功。**随后执行下载器的三分卷实测被外部代码执行权限拦截，未观察到实际连接数 / 并发，不能说多连接下载通过。**

`scripts/smoke-aria2-parts.cjs` 每次新建独立证据目录，三分卷分开存储；不再递归删除固定目录。成功时保留 `verification.json`、连接统计和摘要验证结果。

### 推理

`scripts/verify-local-backends.cjs` 仅接受明确指定的配置路径，诊断输出标记 `diagnosticOnly:true`、`installationConfigured:false`。使用当前源码 worker，把已有语音 engine 复制到新诊断目录，状态与缓存隔离，顺序运行语音 / 翻译 / 本地聊天并释放自有进程。不会导入旧资源为当前安装默认配置。

**运行该诊断命令也被外部 GPT-SoVITS 代码执行权限拦截，整条命令未执行。** 尚无该脚本的真实 WAV、模型加载或生成结果；也没有播放与听感验证。不通过改工具、代理、Electron 包装或测试钩子绕过。

如果用户选择亲自在当前会话执行，可使用 `!` 前缀，输出会进入当前对话：

```text
! node scripts/smoke-aria2-parts.cjs
```

下面一条会显式执行旧安装配置所指向的 Python / GPT-SoVITS 代码、读取其模型，语音引擎先复制到新的诊断目录；它可能耗时并使用显存，但不把旧配置导入当前安装：

```text
! node scripts/verify-local-backends.cjs --speech-config 'C:/Users/77639_wqvlzm6/AppData/Roaming/yukino-companion/speech.json' --translation-config 'C:/Users/77639_wqvlzm6/AppData/Roaming/yukino-companion/translation.json' --chat-config 'C:/Users/77639_wqvlzm6/AppData/Roaming/yukino-companion/local-chat.json'
```

本阶段没有运行安装器覆盖正式版，没有 commit、push、PR、合并或 Release。HTML / JS 尚未到，天气、日光与节日菜单 / 烟花仍等待后续场景文件。
