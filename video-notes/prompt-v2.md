# 任务：用 Remotion 制作「雪乃 Yukino Companion」动态字体宣传片

> v4 · 按「鼠标贯穿全片 + 灵动设计 + 连续动作」重写。
> 定位：**AE 风格的 kinetic typography + 真实界面设计展示 + 一只设计光标串起全片**。
> 工作目录：`E:\JAVA\yukino-companion`（Windows）。新建独立 `video/` 工程，不改应用源码。

---

## 0. 一句话定位

**用艺术字、真实界面和一只会点来点去的鼠标，把「雪乃」做成一支 42 秒的灵动海报。**

- 不做叙事：没有旁白、没有剧情、没有「她的一天」、没有角色对白、没有长字幕。
- **一只设计光标贯穿全片**：它移动、悬停、点击、拖拽、滚轮，速度有快有慢，尺寸有大有小；它点到哪里，镜头和字就跟到哪里。
- 界面是布景：Q 弹、玻璃、圆角、光晕、按键回弹要自然出现在镜头里，像不经意扫过，而不是设置教程。
- 角色是活的：用现有模型的真实 clips、视线跟随、摸头、贝雷帽、表情符号（anime reactions）设计一套连续动作，不要只让她站着。
- 交互仍在迭代：**不要因为当前代码的解锁/触发限制，就砍掉视线、换装、贝雷帽、摸头这些镜头。** 以拍摄当天的构建为准；能触发就拍，触发不了就分镜拆拍，不要伪造。

**核心创意概念**：整支片把「教室黑板的粉笔艺术字」当作字体系统（`brush` / `outline` / `ribbon` / `block`，来自 `src/ui/scene-artwork.mjs`）。而鼠标是这支片的“手”：它写字、点字、翻卡片、摸头、扶正贝雷帽。

---

## 1. 硬性规格

| 项目 | 值 |
|---|---|
| 主片 | **42 秒**（40–44 可微调） |
| 精华版 | **15 秒** |
| 分辨率 | 1920×1080 |
| 帧率 | 60fps；预览可 30fps |
| BPM | 120（60fps 下 1 拍 = 30 帧，半拍 = 15 帧） |
| 输出 | H.264 MP4，主片 + 15 秒版 |
| 字体授权 | 只用 Google Fonts（Noto Sans SC / Noto Sans JP / Space Grotesk 等） |
| 音乐 | 只留占位 cue，不下载任何有版权风险的音频 |
| 语音 | 不使用、不生成雪乃的合成语音；台词只放 `lines.json` |

所有切点、字落地、转场、重拍必须落在 1 拍或半拍上。

---

## 2. 先核实：以本节为准（拍摄前 1 天再跑一遍）

把本节连同源码行号写进 `video-notes/feature-manifest.md`。**拍不到依据的功能一律不拍。**

### 2.1 场景（当前 10 个内置场景）

| id | 界面名称 | 内容 | 源码 |
|---|---|---|---|
| classroom | 放课之后 | 室内教室、窗边课桌；窗外日光与室内灯分开变化；挂钟显示本机时间 | `src/scenes/classroom.mjs`、`classroom-clock.mjs` |
| city | 晚归灯火 | 蓝白罗森招牌便利店、货架、湿地与雨丝 | `src/scenes/lawson.mjs` |
| bookshop | 街角余温 | 街边书店 + 拉面店、木格窗、纸灯笼、红圆凳 | `src/scenes/bookshop-ramen.mjs` |
| forest | 风过竹间 | 高竹、竹节、枯枝篱笆、苔藓石与 T 字路口 | `src/scenes/arashiyama.mjs` |
| school | 春日回廊 | 校门与校园，夜间窗灯亮起 | `src/scenes/school.mjs` |
| wedding | 潮声誓约 | 海边婚礼礼堂、26 阶石阶、枝叶树冠 | `src/scenes/surf-hall.mjs` |
| kasai | 海风来信 | 海滨玻璃建筑与步道，白昼/暮色/夜景照明 | `src/scenes/kasai.mjs` |
| inage | 未说出口 | 稻毛天桥、窄阶、绕墩弧形坡道 | `src/scenes/inage-overpass.mjs` |
| kyoto | 朱影寻春 | 清水寺西门、三重塔、朱红鸟居通道 | `src/scenes/kyoto-temple.mjs` |
| sakura | 花影随流 | 垂樱小路、清浅溪流、落花随水 | `src/scenes/sakura-stream.mjs` |

- 光照：`presentation.followTime` 跟随本机时间；或 `followTime:false` + `fixedHour`（`src/ui/scene-time.mjs`）。
- 教室挂钟始终读本机时间（`src/scenes/classroom-clock.mjs`）。
- 自动定位/天气（Open-Meteo）拍摄时关闭。
- 场景切换：约 1.55–1.65 秒圆形扩散 + 模糊（`SceneBackdrop.jsx`）。
- 另有导入场景（`imported-scene.mjs`、`electron/scene-imports.cjs`），片子里不演导入流程。

### 2.2 微缩总览（真实交互）

- `Ctrl + 滚轮` 缩小到微缩场景；`Ctrl + 拖动` 水平环视；`Ctrl + Shift + 滚轮` 也可环视。
- 松开 `Ctrl` 后约 1.65 秒缓慢回位。
- 小菜单有「按住查看上帝视角」按钮。
- 源码：`environment-backdrop.mjs`、`scene-overview.mjs`、`SceneQuickMenu.jsx`。

### 2.3 黑板（真实彩蛋）

- 直接在教室黑板上拖动鼠标写白色笔迹；无工具栏、提示、边框。
- 笔迹：`#ffffff`、4.4px、圆头；墨水层透明。
- 提交：人物面板拖过黑板 / 开新对话 / 停笔 180 秒。
- 提交后导出 1568×444 PNG（底色 `#183c30`），走「视觉」任务；需要配置视觉服务。
- 助手板书：模型返回 JSON，应用用 `scene-artwork.mjs` 逐字/逐笔动画；风格 `brush` / `outline` / `ribbon` / `block`；颜色 white/pink/yellow/blue/green。
- **助手板书必须真实采集**；拿不到就只拍用户笔迹，用 Remotion 粉笔字代替，不要假装成助手回复。

### 2.4 人物、服装与动作（重点更新）

- 内置角色：雪之下雪乃；可创建最多 100 个本地角色（`src/companion/characters.mjs`）。
- 仓库 `resources/character-models.json` 有 17 条旧目录；运行时还会从本机服装目录 `catalog.json` 加载候选服装（`electron/local-yukino-outfits.cjs`）：
  - `beret` 蓝色开衫贝雷帽（对应 `yukino-02-v1`）
  - `black-qipao` 黑色旗袍（对应 `yukino-05-v1`）
  - `kimono` 蓝色花纹和服（对应 `yukino-04-v1`）
  - `summer-uniform` 夏日制服（新增）
  - `swimsuit` 白色连体泳装（对应 `yukino-03-v1`）
  - `twin-tail` 双马尾（新增）
  - `winter-uniform` 冬季制服（新增，待补口型）
- 运行时候选服装每个都有 6 个动作 clip（见 2.10），并带 `actionPack`；旧 GLB 的 13 个丰富 clips 只在 `yukino-07-*` 预览模型上。
- 换装动画：`prepare → exit(左) → commit → enter(右) → greet(Nod_Subtle)`（`avatar-presentation.mjs`、`model-runtime.mjs`）。
- 主界面人物框：滚轮 1–2.2、拖动旋转、方向键、Home 复位。
- 桌面人物窗口：滚轮改窗口大小、拖动旋转。
- **Live2D 可选**：人物场景选项里可切「2D 形象」；模型需本机自备（`src/ui/live2d/README.md`）。片子里只在真机准备好时使用。

### 2.5 贝雷帽、摸头、表情（新增，必须按实际拍）

- **贝雷帽互动是真实功能**（`src/ui/beret-interaction.mjs`、`model-runtime.mjs`）：
  - 鼠标按住帽子拖动；帽子上抬最多 0.156m，左右 ±0.065。
  - 抬得越高，头越仰（最多 20°）、瞳孔上移、眉眼变“生气/惊讶”；松手后播放约 1.07 秒（30fps，72 帧）的掉落序列，末尾眨眼。
  - **只在 `beret` 运行时候选服装上可用**（VRM 校验通过时），换到其它服装不要演帽子互动。
  - 这是全片最可爱的“主角镜头”，优先拍。
- **摸头/点脸**（`src/ui/avatar-touch.mjs`、`src/companion/touch-interaction.mjs`）：
  - 头顶轻点/抚摸 → `shy` / `happy` / `chide` 三选一，带脸红/汗滴等表情；冷却 4.2 秒。
  - 反复点脸或靠近肩边 3 次 → `boundary`（请留空间）；宣传片不演拒绝，只演一次摸头。
- **Anime reactions**（`src/ui/anime-reactions/`）：
  - 10 种：`surprise`、`confused`、`angry`、`embarrassed`、`shy_talking`、`flustered`、`happy`、`pout`、`heart`、`broken_heart`。
  - 每种约 3.5 秒；图标包括 `!`、`?`、怒气、汗滴、闪亮、爱心、心碎、省略号。
  - 同时驱动面部 morph 与头顶图标；支持和服/贝雷帽/泳装/夏日制服/双马尾/冬季制服/黑色旗袍。
  - 这些图标非常适合做“灵动可爱”的强调符号，但一次只给一个。
- **眨眼/头发物理**：旧目录里 `blink:false`、`hairPhysics:false`；不要写“眨眼”字幕，也不要依赖头发飘动。贝雷帽掉落末尾有真实眨眼。

### 2.6 桌面陪伴

- 模式：仅聊天 / 桌宠 / 3D 人物窗口 / 两者（`electron/companions.cjs`）。
- 关窗：每次询问 / 留下桌宠 / 留下人物窗口 / 两者都留 / 完全退出（`CompanionSettings.jsx`）。
- 置顶默认开；鼠标穿透可开；托盘恢复。
- 桌宠：`electron/companion-view/assets/spritesheet.png`（1536×2288）、`walking-left/right.png`、`video-preview/*.webm`（640×640、24fps、VP9 alpha）。
- 互动：点击、摸头、歪头、跳、散步、坐下；右键菜单；语录；专注计时。

### 2.7 对话、双语、语音

- 气泡：中文 / 日本語 / 双语，逐条切换（`BilingualBubble.jsx`）；历史消息可补译日文。
- 流式分句：`SmartSentenceStream` → `OrderedSpeechScheduler`（首段先合成、后续小批次、按序播放）。
- 本地语音 GPT-SoVITS；云端 DashScope `qwen3-tts-flash`。
- 语音识别：当前只有阿里云实时识别是 `protocol-implemented`；其它目录项 `catalog-only`。
- 翻译：本地 Hy-MT2 1.8B Q4 或 API。
- 视觉：屏幕/摄像头先预览，确认后才发送。

### 2.8 API 与其它

- 任务路由 6 类：`chat` / `proactive` / `vision` / `asr` / `translation` / `tts`。
- 主题：浅色 / 深色 / 跟随系统；强调色自动对比度 ≥ 4.6。
- 资源按需；隐私本地保存；记忆不是完整长期记忆；签到/好感/体力是本地状态。
- 动作编辑器 `motion-studio/` 可录制/导出动作。
- 版本 `0.4.0`；仓库 `fqxxzyw/Yukino-Companion`。

### 2.9 设计 token

| token | 值 |
|---|---|
| accent | `#477fd1` |
| accent-text | `#3266ad` |
| bg | `#f1f6fc` |
| surface | `#ffffff` |
| surface-soft | `#f6f9fc` |
| text | `#202c3c` |
| secondary | `#4e6076` |
| line | `#19334d1c` |
| shadow | `#3454750c` |
| 黑板底色 | `#183c30` |
| 粉笔色 | `#f8f6e9` / `#f3aeb8` / `#f5d67a` / `#a5d5e5` / `#b9dda6` |
| 圆角 | 人物框 24px、输入框 26px、按钮 15px、卡片 12–13px、图标 9px、品牌标 13px |
| 玻璃 | 侧栏 `blur(34px) saturate(130%)`；输入框 SVG 折射 + `blur(16px)`；弹窗 `17px`；下拉 `25px` |
| UI 弹簧 | `cubic-bezier(.22,.8,.24,1)`；`cubic-bezier(.2,.9,.25,1.12)` |
| 字体栈 | `-apple-system, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif` |

### 2.10 现有模型的动作 clip（设计动作表用）

运行时候选服装（`beret` / `black-qipao` / `kimono` / `summer-uniform` / `swimsuit` / `twin-tail` / `winter-uniform`）都提供：

| clip | 时长 | 循环 | 用途 |
|---|---|---|---|
| Idle_Breathe | 3.96s | 是 | 待机、呼吸 |
| Listen_Attentive | 3.96s | 是 | 听你说话、看向光标 |
| Nod_Subtle | 3.96s | 否 | 点头、回应、收尾 |
| Thoughtful_Glance | 3.96s | 否 | 侧目、思考、看别处 |
| Speak_PhraseCadence | 3.96s | 否 | 说话口型节奏 |
| Gentle_Disagreement | 3.96s | 否 | 轻微不同意、保留态度 |

旧 `yukino-07-*` 预览模型额外有：`Explain_Small`、`Greet_Reserved`、`Look_Left`、`Look_Right`、`Think_Downcast`、`Question_Tilt`、`Reject_Gentle`、`Attentive_LeanReturn`、`WeightShift_Small`、`Shoulders_Relax`、`Walk_Slow_Loop`、`Speak_PhraseCadence`、`Recall_SideThenReturn`、`Courtesy_Bow`、`Clarify_LowHand`、`Hear_SurpriseRecover`、`Idle_Relaxed`。
**这些额外动作只在 07 上可用；换到其它服装时不要假装它们存在。**

---

## 3. 鼠标：全片主线（本片第三个核心）

### 3.1 光标长什么样

- 1080p 下约 30–34px；白色填充 + 深墨描边 + 1px 高光边 + 柔和投影。
- 移动时带 2 个拖尾点（12px，透明度 0.28 / 0.12），停下 4 帧内收掉。
- 点击时：
  - 光标 `scale 1 → 1.28 → 0.92 → 1`，6 帧；同时一个 12 帧的圆环波纹。
  - 被点中的 UI 元素真实按下（按钮 `.965`；卡片可做 1.04 的弹性回应）。
  - 镜头在点击点做 1.02–1.04 的极短 punch-in；大点击（贝雷帽、换装）可到 1.12–1.18。
- 悬停时：24px 柔和光晕；靠近可点元素时轻微放大到 1.08。
- 拖拽时：光标变成“捏住”状态，稍微放大到 1.12，拖尾变短；松手回弹。
- **它不是系统光标**：录制时隐藏系统光标，后期用 `CursorTrack` 画上去。

### 3.2 速度与尺寸

- 速度分三档：慢速靠近（0.5×）、正常（1×）、快速甩动（3–4×）。
- 每次点击前 4–6 帧做 anticipation：先往反方向轻退 3–5px，再快速点到目标。
- 快速移动时尺寸缩到 0.88，并拉出 4–6px 的动态模糊；慢速时回到 1.0。
- 点击瞬间放大到 1.28；大特写点击可到 1.35。
- 静止时用 `noise2D` 做 0.5px 的轻微呼吸，不要完全不动。
- 所有路径用三次贝塞尔，不要线性；快慢变化必须能被眼睛看出来。

### 3.3 光标的剧本

| beat | 光标动作 | 触发 |
|---|---|---|
| 1 雪乃 | 从黑场滑入，点一下标题 | 标题字弹出、波纹扩散 |
| 2 注视/换装 | 绕人物框一圈；在四角点玻璃色卡 | 眼睛跟随；换 3 套衣服 |
| 3 贝雷帽 | 移到帽檐，捏住，慢慢上抬，松手 | 帽子抬起、掉落、眨眼、怒气/汗滴符号 |
| 4 十景 | 点场景菜单，拖一张卡 | 场景卡飞出、回弹 |
| 5 一眼看尽 | 按住 `Ctrl` + 滚轮 / 拖动 | 微缩总览、回位 |
| 6 写给她看 | 在黑板上画两笔 | 白色笔迹跟随 |
| 7 双语/有声 | 点语言药丸、点发送 | 药丸滑动、气泡 jelly、声波条 |
| 8 留在桌面 | 拖人物框、点桌宠、点关窗选项 | 挤压/吸附、桌宠 pop、玻璃卡片 |
| 9 本地优先 | 点片尾标题卡 | 定格、收尾 |

每次点击都必须有真实结果或设计好的结果；**不要点一个没有反应的东西**。换装部分允许用设计好的玻璃色卡，不必真实点击应用里的衣柜 UI（见 9.3）。

### 3.4 光标文件

- `src/cursor.ts`：`{frame, x, y, scale, speed, click, drag, hold}` 关键帧。
- `src/components/CursorTrack.tsx`：按帧插值，生成拖尾、波纹、点击放大。
- `src/cursor-script.json`：点击帧 ↔ 目标元素 ↔ 期望反应；供自检和后期对齐。
- 光标永远在 UI 之上、主字之下或之上要按镜头决定；**不要挡住角色的眼睛和嘴**。

---

## 4. 界面即布景

界面不是设置页导览，而是电影道具：在字与字之间、在转场边缘、在玻璃反光里自然出现。

### 4.1 真实 UI 动效词表

| UI 瞬间 | 真实动效 | 源码 | 镜头用法 |
|---|---|---|---|
| 回复气泡落地 | `reply-jelly-in` 480ms：`.9/.84 → 1.035/1.055 → .985/.98 → 1`；分段 420ms | `style.css:514`、`BilingualBubble.jsx` | 0.5× 慢放一次，落在重拍 |
| 拖动人物框 | 挤压最多 3.5%；松手 720ms 吸附，末端 ±6px 回弹 | `CharacterPanel.jsx`、`dock-motion.mjs` | 特写边缘果冻拉伸 |
| 按钮按下 | `scale(.965)` 90ms；hover 上移 1px / 320ms 弹簧 | `control-motion.css` | 发送键按下的那一帧当切点 |
| 分段切换 | 药丸 320ms 弹簧滑动 | `control-motion.css` | 中文→日本語→双语，卡半拍 |
| 弹层出现 | `menu-appear` 120ms；设置页 180ms；桌面气泡 160ms | `style.css` | 从画面边缘弹出，不解释 |
| 玻璃折射 | 侧栏 34px；输入框 SVG 折射 + 16px；弹窗 17px；下拉 25px | `GlassFilters.jsx`、`style.css:577` | 让高亮场景从玻璃背后滑过 |
| 人物框光晕 | 鼠标更新 `--glass-light-x/y` | `CharacterPanel.jsx:90` | 光标绕圈时光晕跟着走 |
| 场景切换 | 1550ms 圆形扩散 + 8px 模糊 | `SceneBackdrop.jsx` | 直接当真实转场 |
| 场景加载 | 650ms 圆形揭示，圆心约 `72% 65%` | `scene-loading.css` | 从圆到全屏的字洞 |
| 关窗选择 | 玻璃卡片 + 三个选项 | `CloseDialog` | 「留在桌面」beat 的道具 |
| 桌宠 idle | spritesheet 7 帧，约 6.3s | `view.js` | 从窗口边缘 pop-in |

### 4.2 构图规则

- **真实优先**：能用真实截图/录屏就用；只有玻璃外框、圆角卡片可以按 token 重建，且必须 1:1。
- **边缘露出**：UI 只露 1/3 到 1/2，从画面边缘切入切出；不要整屏设置页。
- **圆角即图形**：24px 人物框、26px 输入框、15px 按钮的圆角当遮罩、转场、边框。
- **玻璃要有内容**：玻璃后面必须有真实场景/人物在动；高光边只给 1px。
- **Q 弹只给一次**：每个动效只在一个镜头出现一次。
- **不解释**：不要写“玻璃拟态”“Q 弹”这类字幕。
- **UI 不抢字**：UI 露出时主字退到边缘或虚焦；主字出现时 UI 退成背景。

### 4.3 「不经意」的五个手法

1. 气泡当节拍器：四个气泡依次 jelly 落地，每下落在半拍。
2. 玻璃卡片当转场：人物框卡片从镜头前滑过，折射下一镜。
3. 圆角当遮罩：24px 圆角放大成整屏遮罩，圆角内是下一镜。
4. 按键当重拍：发送键 `.965` 那一帧正好切镜。
5. 光晕跟随：光标绕人物框一圈，眼睛、玻璃高光一起走。

---

## 5. 艺术字系统

### 5.1 四种真实字形

1. **笔刷 Brush**：干笔飞白、边缘毛糙、每字 1–2° 旋转；SVG turbulence + mask。
2. **描边 Outline**：空心 + 粗描边；`@remotion/paths` 的 `evolvePath` 画出来。
3. **彩带 Ribbon**：双层错位描边（蓝 + 粉）；3D 轻微扭转。
4. **立体 Block**：3 层挤出 + 8–12px 投影，像贴纸。

规则：每个 beat 只允许 1 种主字形 + 1 种细体副标；主字 900 字重；占画面高度 22%–40%；一行 ≤ 6 字；英文只做小字（全大写、字距 0.2em、≤ 主字 18%）；安全区左右 96px、上下 72px。
禁止：彩虹渐变、发光描边、WordArt 阴影、横向拉伸。

### 5.2 字体

- 中文 `Noto Sans SC` 700/900；笔刷感可用 `Noto Serif SC` 900。
- 日文 `Noto Sans JP` 500/700；拉丁 `Space Grotesk` 700 / `Archivo Black`。
- `@remotion/google-fonts` + `delayRender()`；fallback `"Microsoft YaHei", "PingFang SC", sans-serif`。

### 5.3 动效基元

`KineticText` 支持：逐字 stagger 2–3 帧、总入场 6–10 帧；字距 `0.35em → 0.06em`；遮罩揭示；spring 弹出；3D 翻转；强调词变色 + 下划线 draw-on；冲击帧 2–4px 色差；落地 2 帧回弹。
禁止匀速淡入、禁止整块一起出现。

### 5.4 光标与字的互动

- 光标可以“点”出一个字：点击点作为字的 scale origin。
- 光标可以“拖”动一个字：字跟 2 帧滞后、带 jelly，松手回弹。
- 光标可以“擦”掉一个字：字被波纹擦除，露出下一镜。
- 字也可以作为鼠标的遮罩：光标穿过字洞，进入下一镜。

---

## 6. 连续动作设计（先设计，再拍）

目标：**不让她只是站着**。用现有 clip + 视线 + 贝雷帽 + 摸头 + 表情，拼出一段 16 秒的连续表演；每个动作都可以单独拍，后期用匹配剪辑接起来。

### 6.1 16 秒表演表

| 时间 | 服装 | clip / 互动 | 光标 | 表情符号 | 镜头 |
|---|---|---|---|---|---|
| 0.0–1.5 | beret | `Idle_Breathe` 循环 | 从画面左下慢速进入 | — | 全景 |
| 1.5–3.0 | beret | `Listen_Attentive`（0.3s 交叉淡化） | 从左到右画弧，眼睛/头部跟随 | — | 缓慢推进 |
| 3.0–4.2 | beret | `Nod_Subtle` | 在头顶轻点一下（tap） | `shy_talking`（脸红 + 汗滴） | 面部特写 |
| 4.2–5.0 | beret | `Thoughtful_Glance` | 移到帽檐，悬停 | — | 拉回半身 |
| 5.0–7.0 | beret | 贝雷帽拖拽（真实 `grabBeret`） | 捏住帽檐，慢慢上抬 | `angry` 眉 + 怒气符号 | 1.15× 推近帽子 |
| 7.0–8.1 | beret | 松手掉落（约 1.07s，末尾眨眼） | 松手、后退 | `embarrassed` 汗滴淡出 | 保持近景 |
| 8.1–9.0 | beret | `Nod_Subtle` | 停在半空，轻点两下 | `happy` 闪亮 | 切回中景 |
| 9.0–10.0 | summer-uniform | `Idle_Breathe` | 点一下玻璃色卡 | — | 匹配剪辑 |
| 10.0–11.5 | twin-tail | `Listen_Attentive` | 绕半圈，眼睛跟随 | — | 侧面推进 |
| 11.5–13.0 | black-qipao | `Nod_Subtle` | 点一下标题字 | `happy` 闪亮 | 字与人对切 |
| 13.0–14.5 | kimono | `Gentle_Disagreement` | 后退，停在画面边缘 | `pout` 轻微不满 | 全景 |
| 14.5–16.0 | kimono | `Idle_Breathe` | 退出画面 | — | 落字收尾 |

### 6.2 动作规则

- **视线**：`gazeTarget` 把光标位置换算成 `eyeX/eyeY/headYaw/headPitch`；头部偏航约 ±12°、俯仰约 ±7°，平滑约 120ms。光标移动时先眼动、再头动。
- **clip 切换**：交叉淡化 0.3s；不要硬切，除非是节拍匹配剪辑。
- **表情**：在点击帧触发，约 3.5s；图标 0.35s 攻击、0.55s 释放。一次只给一个。
- **贝雷帽**：只在 `beret` 服装；抬得越高，头越仰、瞳孔越上、眉眼越“生气”；松手掉落约 1.07s，末尾眨眼。不要在其他服装上假装有帽子。
- **摸头**：只演一次 `shy`/`happy`，不演 `boundary`（拒绝不适合宣传片）。
- **旧模型限制**：`blink:false`、`hairPhysics:false`；不要依赖眨眼和头发飘动，贝雷帽掉落末尾的眨眼除外。
- **灵动可爱**来自节奏：点击前 4–6 帧 anticipation、点击 6 帧放大、12 帧波纹、0.3s 交叉淡化、1.5× 速度曲线、表情图标出现时 freeze 2 帧。

### 6.3 动作与拍摄的对应

| 镜头 | 需要的素材 | 采集方式 |
|---|---|---|
| 注视/换装 | 每套服装 3–5 秒 `Idle`/`Listen`/`Nod` | 桌面版逐套选择，录 60fps |
| 贝雷帽 | 一次完整的抓取/上抬/松手/掉落 | 桌面版 `beret` 服装，Playwright 拖拽 + 60fps 录屏 |
| 摸头 | 一次头顶 tap + `shy` 表情 | 桌面版，点击头顶；录 60fps |
| 说话 | `Speak_PhraseCadence` 4 秒 | 桌面版，触发说话/或动作舞台 |
| 收尾 | `Nod_Subtle` / `Gentle_Disagreement` | 桌面版，录 3–4 秒 |

如果 `play(name)` 不方便从 UI 触发：写一个只读的 `video/capture/character-stage` 页面，导入 `src/ui/model-runtime.mjs` 的 `GlbAvatarRenderer`，暴露 `playClip(name)`、`setGaze(x,y)`、`seek(t)`；不改应用源码。**优先用真实应用 UI 拍；舞台只用于补齐无法从 UI 触发的 clip。**

---

## 7. 分镜（42 秒，9 个 beat）

| # | 时间 | 主词（艺术字） | 画面与动效 | 光标动作 | UI 露出 | 真实依据 |
|---|---|---|---|---|---|---|
| 1 | 0–4s | **雪乃**（笔刷） | 黑场 + 雪粒；字逐笔出现，字距收紧；镜头穿过「乃」字洞 | 从黑场滑入，点标题 | 品牌图标边缘一闪 | 品牌 |
| 2 | 4–9s | **注视**（描边）→ **换装**（立体） | 光标绕人物框一圈，眼睛跟随；四角点玻璃色卡，换 3 套衣服；真实左右进出场 | 绕圈、点击、拖拽 | 人物框 24px 圆角、鼠标高光、衣柜玻璃卡片 | 2.4 / 2.5 |
| 3 | 9–14s | **扶正**（笔刷） | 贝雷帽主镜头：捏住帽檐、上抬、她仰头/瞪眼、松手掉落、眨眼；怒气/汗滴符号 | 捏、抬、松、后退 | 玻璃光晕跟随 | `beret-interaction.mjs` |
| 4 | 14–20s | **十景**（描边） | 10 张真实场景 4K 静帧做成 2.5D 卡片；同场景日→暮→夜 | 点场景菜单，拖一张卡 | 场景卡圆角 + 1px 高光 | 10 个场景 |
| 5 | 20–24s | **一眼看尽**（彩带） | 10 张卡收拢成微缩环；镜头拉远、环视 | 按住 Ctrl + 滚轮/拖动 | 「按住查看上帝视角」按压态 | `environment-backdrop.mjs` |
| 6 | 24–29s | **写给她看**（四种字形快切） | 黑板真实笔迹 + 四种粉笔字形；粉笔灰 | 在黑板上画两笔 | 聊天气泡里的黑板图 | `BlackboardOverlay.jsx` |
| 7 | 29–33s | **双语 / 有声**（描边） | 气泡中文→日本語→双语；句子切成声波条按序飞出 | 点语言药丸、点发送 | 药丸 320ms、气泡 480ms jelly | `BilingualBubble.jsx` |
| 8 | 33–37s | **留在桌面**（立体） | 3D 人物窗口 + 桌宠 pop-in；关窗玻璃卡片三个选项 | 拖人物框、点桌宠、点选项 | 关窗卡片、置顶/穿透图标 | `companions.cjs` |
| 9 | 37–42s | **本地优先**（描边） | 6 个任务节点连线；锁；片尾标题卡 | 点片尾标题卡 | 设置页只露边缘 1/3 | `api-management.cjs` |

**15 秒精华版**：0–1.5 beat 1 → 1.5–5 beat 2 + 贝雷帽快切 → 5–8 beat 4 → 8–10.5 beat 6 → 10.5–12.5 beat 7 → 12.5–15 beat 9。

### 字幕总表（全片就这些）

| 出现 | 中文大字 | 英文/小字 | 日文副标（待校对） |
|---|---|---|---|
| beat 1 | 雪乃 | YUKINO | — |
| beat 2 | 注视 / 换装 | GAZE / WARDROBE | ここにいる |
| beat 3 | 扶正 | FIX IT | — |
| beat 4 | 十景 | 10 SCENES | 十の風景 |
| beat 5 | 一眼看尽 | CTRL + WHEEL | — |
| beat 6 | 写给她看 | BLACKBOARD | — |
| beat 7 | 双语 / 有声 | TWO LANGUAGES / VOICE | — |
| beat 8 | 留在桌面 | STAY CLOSE | そばにいる |
| beat 9 | 本地优先 | LOCAL FIRST | — |
| 片尾 | 雪乃 | Yukino Companion · Windows 测试版 · GitHub fqxxzyw/Yukino-Companion | — |

日文单独列进 `lines.json`，等我校对后再上屏。

---

## 8. 镜头、转场与质感

- **CameraRig**：`perspective: 1800px` 3D 舞台；图层 `translateZ`；推拉摇移、景深、手持抖动（`noise2D`，0.5–1.2px）。
- **速度曲线**：对序列帧做 time remap；只给 2–3 个镜头。
- **动态模糊**：`@remotion/motion-blur`，只给甩镜和 2 个转场。
- **形状转场**：`@remotion/shapes` + `@remotion/paths` 的 `evolvePath`；封装 `ShapeWipe`。
- **匹配剪辑**：`MatchCut`，同一屏幕位置/形状衔接。
- **type-as-matte**：大字做洞，洞后放下一镜。
- **质感层**：颗粒 2–4%、色差、光斑、晕影、网格背景；可开关。
- **粒子**：雪、樱花瓣、粉笔灰；固定 seed；只用在 beat 1、4、6。
- **UI 合成**：真实截图放 3D 空间，带阴影/景深；玻璃外框按 token 重建。
- **禁止**：CSS transition/animation、Tailwind 动画类、`requestAnimationFrame`、`useFrame`；只用 `useCurrentFrame()` + `spring()` / `interpolate()`。

Remotion 4.0.543 写法：`@remotion/media` 的 `<Video>` / `<Audio>`；`<CanvasImage>` / `staticFile()`；`interpolate()` 内联；优先 `scale/translate/rotate`；`Easing.spring({damping})`、`output:'perceptual-scale'`；`useCurrentFrame()` 放最小叶组件；先开 Studio，不默认 render。

---

## 9. 素材采集

### 9.1 两条采集线

| 线 | 用途 | 方式 |
|---|---|---|
| 浏览器 `dev:web` | 场景 4K 静帧、UI 局部、黑板、总览、原始 07 模型 | Playwright 截图/序列 |
| 桌面 `dev:desktop` / 安装版 | 贝雷帽、摸头、表情符号、运行时候选服装、桌宠/人物窗口 | Playwright `_electron` + 60fps 系统录屏 |

原因：运行时候选服装（VRM）、贝雷帽、触摸区、anime reactions 依赖 Electron IPC 和本机服装目录；浏览器预览拿不到。

### 9.2 帧率不够就录视频

- 光标、贝雷帽、摸头、换装 pop、气泡 jelly 这类快速动效：**直接 60fps 录屏**，再抽帧。
- Windows 可用 `ffmpeg -f gdigrab -framerate 60 -draw_mouse 0 -i title="Yukino Companion" ...`；`-draw_mouse 0` 隐藏系统光标，后期叠设计光标。
- Playwright 自带视频通常只有 ~25fps，不适合快速光标；只用于慢速/静态检查。
- 录屏后用 ffmpeg 抽帧，保留原始 60fps；不要用 AI 插帧把 30 补成 60，尤其是文字和 UI。
- 4K 静帧仍用截图：viewport 3840×2160、`deviceScaleFactor:1`。

### 9.3 换装：不必真实点击应用 UI

- 每套服装在桌面版里选一次，录 3–5 秒 `Idle_Breathe` / `Listen_Attentive` / `Nod_Subtle`；**不录衣柜界面**。
- 成片里的换装 UI 可以是设计好的**玻璃色卡/衣柜卡片**：光标点一下、卡片翻转、匹配剪辑到下一套真实服装。
- 这不是“真实衣柜流程”，不要字幕声称是；`capture-list.md` 里注明“换装 UI 为设计过渡，服装画面为真实渲染”。
- 如果真实 `exit/enter` 也拍到了，可以用；没拍到就用 pop/match cut，不要伪造左右走场。

### 9.4 其它采集

- 场景：10 × 3 个时刻（08:00 / 16:30 / 20:30）= 30 张 4K；关掉「缓慢场景动态」。
- 场景序列：classroom、city、sakura、inage、kyoto，3–5 秒，12–20fps 截图或 60fps 录屏。
- 总览：按住「查看上帝视角」1.8 秒 → Ctrl 拖动 → 松开；3–5 秒。
- 黑板：classroom + spread；画 2–3 笔；3–5 秒。
- UI 局部：标题栏、场景菜单、气泡、语音条、设置页、衣柜、关窗、桌宠；2× 截图，1:1 裁切。
- 桌宠：直接复制 spritesheet / walking / video-preview。
- 助手板书：需要真实视觉服务，放手动清单。

### 9.5 手动采集清单

- 60fps 桌面录屏：贝雷帽、摸头、换装 pop、气泡 jelly、玻璃折射、拖动吸附。
- 助手黑板板书（需要我的 API）。
- 如果某套运行时服装没准备好：记录，跳过，不用假素材。
- 日文文案校对。

---

## 10. 工程结构

```
video/
  package.json
  remotion.config.ts
  src/
    Root.tsx
    config.ts          # FPS / 尺寸 / 主片 42s / 15s 版 / 调色
    beats.ts           # 120 BPM 拍点
    ease.ts            # 缓动预设
    theme.ts           # 设计 token
    cursor.ts          # 光标关键帧
    cursor-script.json # 点击帧 ↔ 目标 ↔ 反应
    lines.json         # 中/日文案 + 时间点
    components/
      CameraRig.tsx
      CursorTrack.tsx
      KineticText.tsx
      TypePoster.tsx
      ChalkText.tsx
      ShapeWipe.tsx
      MatchCut.tsx
      KeyCap.tsx
      Overlays.tsx
      ParticleField.tsx
      SceneCard.tsx
      UIFrame.tsx
      GlassCard.tsx
      JellyBubble.tsx
    scenes/
      01-intro.tsx
      02-gaze-wardrobe.tsx
      03-beret.tsx
      04-scenes.tsx
      05-overview.tsx
      06-blackboard.tsx
      07-bilingual.tsx
      08-companion.tsx
      09-endcard.tsx
  public/footage/...
  scripts/capture.mjs
  capture/character-stage/   # 只读动作舞台（可选）
  README.md
video-notes/
  asset-inventory.md
  feature-manifest.md
  ui-motion.md
  character-performance.md
  storyboard.md
  capture-list.md
```

- 脚手架：仓库根目录 `npx create-video@latest --yes --blank --no-tailwind video`。
- `video/` 独立 `package.json`；不改根 `package.json`、`src/`、`electron/`。
- `.gitignore` 忽略 `node_modules/`、`out/`、`public/footage/`、`*.mp4`。
- 音频只留占位：`lines.json` + `config.ts`。

---

## 11. 自检与交付

### 11.1 自检（`npx remotion still`）

每个 beat 至少 3 张关键帧：

- 字不溢出；中/日文不断行错位。
- 素材不拉伸、不模糊；4K 1:1 裁切。
- 没有穿帮：卡片边缘、人物脚底、黑板透视、UI 外框。
- 切点在拍点/半拍；帧数不越界。
- 每个大字 1 秒可读；3 秒能记住。
- UI 露出但不抢字；玻璃后有内容；圆角没拉伸。
- **光标**：路径顺滑、速度有变化、点击有反应、没有盖住眼睛/嘴、没有“死点击”。
- **动作**：clip 切换不跳帧；表情图标只出现一个；贝雷帽只在 beret 服装上。

### 11.2 交付

- `video/README.md`：`npx remotion studio` 预览；`npx remotion render` 主片和 15 秒版；重新采集命令。
- 汇报：每个镜头对应的真实功能/源码；被砍/降级的功能；手动素材清单；日文文案；可调参数。
- 只有「应用跑不起来 / 场景渲染失败 / 缺角色模型 / 助手板书需要我的 API」才停下来问。

---

## 12. 红线

- 只展示代码里真实存在、并写进 `feature-manifest.md` 的功能。
- 不写「已完成 / 全支持 / 完整长期记忆 / 一键训练音色 / 完整还原角色」。
- 赞助、广告、付费权益尚未上线，不演。
- 交互仍在迭代：不要因为当前限制砍掉视线、换装、贝雷帽、摸头；拍摄前重新核实，按当天构建拍，触发不了就拆拍，不伪造。
- 贝雷帽只在 `beret` 运行时服装上拍；不要在所有服装上假装有帽子。
- 摸头/表情符号只在支持运行时候选模型的桌面版拍；不要在原版 GLB 上假装有。
- 换装 UI 可以是设计好的玻璃色卡；不要声称它是真实衣柜流程；服装画面必须真实。
- 光标是设计元素，不是应用功能；不要配“全新光标”之类字幕。
- 每个点击必须有结果；不要拍死点击。
- 黑板发送需要视觉服务；云端只演 DashScope TTS、阿里云实时 ASR、兼容聊天 API。
- 角色只用仓库自带素材；不放动画官方画面/剧照。
- 版本以 `package.json` 为准；开发方式以 README 为准。
- 不做长故事、不做旁白、不做大段字幕；镜头离不开解释就删掉。
