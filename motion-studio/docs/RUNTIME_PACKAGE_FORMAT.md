# 运行时动作包格式

`.motion.json` 是工作台专用的版本化 UTF-8 JSON。顶层 `format` 为 `yukino-motion-runtime`，当前 `version` 为 `1`。`projectId` 与 `name` 指向源工程，`modelId`、`asset` 和 `mappings` 指向播放所需模型资源与语义映射，`fps`、`tracks` 和 `modules` 保存播放数据。运行时轨道省略编辑用的 `locked` 字段。

关键帧模块携带实际通道数据。引用到的程序模块携带过程标识、版本与参数定义，具体片段保存参数覆盖值。运行时包只收集片段引用的模块，任何片段缺少模块时读取失败。播放端需要兼容的程序模块求值器。播放器默认从零秒开始，工程保存的播放头不随动作包导出。

独立播放器入口为 `/player.html`。它通过 `readRuntime` 载入动作包，用 `projectDuration` 得到秒数区间，以 `evaluateProject` 从绝对时间生成姿势。播放器无需读取编辑器窗口、手动输入或撤销历史。

```ts
import { evaluateProject, projectDuration, readRuntime } from './src/motion/index.ts';

const timeline = readRuntime(jsonText);
const durationInSeconds = projectDuration(timeline);
const pose = evaluateProject(timeline, Math.min(1, durationInSeconds));
```

后续整合可以直接复用 `src/motion/` 的 TypeScript 模块。工作台的 Three.js 环境通过 `ModelRig.apply` 将缓冲写入角色。对其他运行时需实现等效的四元数与坐标换算，并保留时间线层的绝对求值规则。单个 `Pose` 是一帧稀疏结果，接收端每帧都要从参考姿态开始应用。各角色的通道约定见 [语义映射与参考姿态](MODEL_ADAPTER_GUIDE.md)。

资源引用仍需指向本地实际模型。独立播放器按包内模型 ID 选择内置资源。若包引用本地导入的文件，按界面提示定位原 GLB，或同时提供原 glTF 及其依赖。包能提供运动学动作通道，能否显示某一骨骼或表情取决于播放所用模型的实际能力。
