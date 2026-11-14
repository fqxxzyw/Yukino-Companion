# Yukino Companion · 安卓版

这是基于液态玻璃界面、从 Windows 桌面版重做的 API 优先安卓应用，位于本仓库的 `android/` 目录。它使用 Capacitor 7 + React 19 + Vite，在手机上加载已接入的 VRM 形象，并通过你自行配置的云端接口完成对话、翻译、语音和视觉。

本目录**不包含**桌面版中的本地大模型、本地翻译、GPT-SoVITS、预录音频包，以及 Python / PyTorch / CUDA / llama.cpp 运行时。密钥、聊天记录、记忆和角色设定只保存在这台设备上，除发往你指定的接口外不会上传到其他地方。

## 需要准备什么

- Node.js 20 或更新版本
- JDK 21
- Android SDK（建议 compileSdk / targetSdk 35，minSdk 23）
- 将 `JAVA_HOME`、`ANDROID_HOME` 写入环境变量，或复制一份 `scripts/env.local.sh`（此文件不要提交）

人物模型体积较大，不在 Git 中。打包前需要先下载发行版中的模型包。

## 下载 3D 模型

六套已接入服装（和服、夏日制服、泳装、黑色旗袍、双马尾、贝雷帽）的加载清单与动作包已提交在 `public/models/`。对应的 VRM 文件请从预发行版 [yukino-models-20261114](https://github.com/fqxxzyw/Yukino-Companion/releases/tag/yukino-models-20261114) 获取。

在 `android/` 目录执行：

```bash
npm run models
```

脚本会下载 `Yukino-3D-Models-20261114.zip`，校验压缩包 SHA-256（`d51fde3acd9674577c7d0092207522bfc2d20ff98e94c7353e043cf655fc965a`），解压到 `public/models/local-yukino-outfits/`，再按 `catalog.json` 核对每个 VRM 的大小与 SHA-256。

冬季制服仍是未接入的候选模型（口型待补），不要放进本目录，也不要提交进仓库。

## 调试包

```bash
cd android
npm install
npm test
npm run models          # 若尚未下载 VRM
source scripts/env.sh   # 或先写好 env.local.sh
npm run apk
```

产物为 `Yukino-Companion-debug.apk`，以及 `android/app/build/outputs/apk/debug/app-debug.apk`。调试包使用 Android Debug 证书，部分品牌的系统会拒绝安装。若遇到「缺少开发证书」一类提示，请改打下面的正式签名包。

开发时也可先运行 `npm run dev`，用浏览器查看界面。

## 正式签名包

仓库**不包含**签名密钥。请自行生成并保管 keystore，不要把 `.jks`、`.keystore` 或 `keystore.properties` 提交到 Git。

示例（请改用你自己的密码和可联系到的标识，密码不要写进仓库）：

```bash
mkdir -p "$HOME/yukino-android-keys"
keytool -genkeypair -keystore "$HOME/yukino-android-keys/release.jks" \
  -alias yukino -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Yukino Companion"
```

再在同一目录创建仅自己可读的 `keystore.properties`：

```properties
storeFile=/绝对路径/release.jks
storePassword=你的密钥库密码
keyAlias=yukino
keyPassword=你的密钥密码
```

将 `YUKINO_KEYSTORE_PROPERTIES` 指向该文件后打包：

```bash
export YUKINO_KEYSTORE_PROPERTIES="$HOME/yukino-android-keys/keystore.properties"
npm run models
npm run apk:release
```

脚本也会在 `$HOME/yukino-android-keys/keystore.properties` 或仓库上一级的 `yukino-android-keys/keystore.properties` 中自动查找。产物为 `Yukino-Companion-android.apk`。Gradle 会启用 v1 / v2 / v3 签名；`minify` 默认关闭。当前版本号为 versionCode 2、versionName 1.1。

更换签名证书后，需要先卸载手机上已安装的旧包（例如原先的调试包），否则系统会拒绝覆盖安装。

## 在应用里配置 API

安装后打开「设置 → 模型与 API → 添加 API」，按任务分配服务：

- **对话**（必需）：任意 OpenAI 兼容接口，例如 DeepSeek、阿里云百炼兼容模式、OpenAI、硅基流动、Kimi、智谱。需要接口地址、API 密钥和模型名。
- **翻译**（双语或日语朗读时建议配置）：同样使用 OpenAI 兼容聊天接口，可以和对话共用一个服务。
- **语音识别**（可选）：支持 `/v1/audio/transcriptions` 的服务。需要麦克风权限。
- **语音合成**（可选）：支持 `/v1/audio/speech` 的服务。
- **视觉**（可选）：支持图片输入的聊天模型。未单独配置时会尝试使用对话服务。

服装可在「角色」或「外观与场景」中切换，选择保存在本机。陪伴页默认循环播放 `Idle_Breathe`；思考时使用 `Listen_Attentive`，朗读时播放 `Speak_PhraseCadence`（短语节奏口型，不是逐音素唇形）。

## 目录说明

```text
android/                         # 本安卓子项目（位于仓库根目录下）
├─ src/                          # React 界面、API 客户端与人物加载
├─ public/models/                # 服装清单、动作包；VRM 需另行下载
├─ scripts/fetch-models.sh       # 从发行版下载并校验模型
├─ scripts/build-apk.sh          # 调试包
├─ scripts/build-release-apk.sh  # 正式签名包
├─ tests/                        # Node 测试
└─ android/                      # Capacitor 原生工程
```
