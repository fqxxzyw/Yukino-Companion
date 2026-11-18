# 服装物理与导出审计（2026-11-18）

## 结论摘要

- 已验收 Blender final 在一个对象自定义属性里保存了 `charakit_spring_plan_v1`，只列出需要弹簧的网格与骨链名称（braid、side_lock、head_bow、skirt_00～07、waist_negative/positive）。
- final 中没有弹簧参数、碰撞体、阻尼、重力、命中半径，也没有可运行的物理约束或缓存。
- 导出的 GLB 没有 `VRMC_springBone`；`Idle_Breathe` 对这些 CK 骨骼只有 2 个关键帧，属于烘焙姿态/循环，不是逐帧物理。
- 下载目录中的 5 份“新版VRM补充”带有 `VRMC_springBone` 和碰撞球，但状态为 `PRIVATE_PREVIEW_NOT_RUNTIME_VALIDATED`，源工程日期早于已验收 final，不能冒充已验收资产。
- 因此当前 App 没有可接回的“已验收运行时物理配置”。没有用通用摆动或正弦动画伪造物理；缺失项是每套服装的运行时弹簧参数与碰撞体导出。

## 黑色旗袍腰部横缝

### 现象

App 实际加载 `qipao-v2` 时，上身与裙片之间露出背景横缝；同一模型重新导入 GLB 后也复现，而已验收 Blender final 正常。

### 根因

final 中 `Spring_01_skirt` 的 `TemporaryRootAttachment` 修改器 `show_render=false`，裙片在验收渲染中是静态的；GLB 导出把该网格写成带 `skin` 和 `JOINTS_0/WEIGHTS_0` 的蒙皮网格，运行时被裙骨下移，裙片上缘离开上身下缘。

### 修复

- 新文件：`public/characters/05-qipao-v2-fixed.glb`
- 只移除 `Spring_01_skirt` 节点的 `skin` 及其图元的 `JOINTS_0/WEIGHTS_0`。
- 保留几何、骨骼、绑定矩阵、贴图、形态键、动作和其它网格。
- 目录条目改为新文件，SHA-256：`44a864b8de2c356627a9f05d77d31eb09d3c2175483e3aab5e2d1c8cbdd45976`。
- 原始导出和已验收 `.blend` 均未覆盖。

## GLB 校验错误

“骨骼属性没有关联的 skin.joints 列表”发生在只移除 `node.skin`、却保留 `JOINTS_0/WEIGHTS_0` 的中间版本。最终文件同时移除节点 skin 和骨骼属性，`inspectGlbSkinning` 返回 7 个已校验图元、0 个附加权重图元，正常导入不再报错。

## 仍需上游提供的物理资产

每套服装至少需要：

1. 骨链与父子顺序（final 已有部分名称）。
2. 每关节的 stiffness、dragForce、gravityPower、gravityDir、hitRadius。
3. 碰撞体（节点、形状、半径、碰撞组）。
4. 头发与裙摆分开的配置；黑色旗袍裙片不套用普通伞裙参数。

没有这些数据时，只能播放现有的 2 帧骨骼循环，不能声称具备重力、惯性或碰撞。
