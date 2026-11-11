# 庄方宜 Three.js 卡通渲染实现记录

## 运行

在本目录执行 `npm run dev`，浏览器打开 Vite 输出地址。当前预览使用 `public/models/ZhuangFangyi_render.glb` 和 `public/textures/` 中的资源。

## 对照资料与实现路线

实现参考工作区中的 `MyZmdShaders`、《【unity urp】从零模仿复刻实现自己的终末地人物卡通渲染》及《【unity urp】从零模仿实现自己的星铁和少前卡通渲染--复现笔记记录【1】》。核心结构是保留 GLB 的底色/法线等 glTF 材质输入，在 Three.js `MeshStandardMaterial.onBeforeCompile` 的光照结束阶段加入角色 NPR 光照，然后由后处理完成轮廓与色调整理。

主要入口：

- `src/viewer.jsx`：模型与外部纹理加载、材质按源名称绑定、灯光/环境、Stencil、交互控制。
- `src/shaders/characterToon.js`：Ramp、脸部 SDF、皮肤近似散射、头发高光、衣物 P 参数、眼睛 MatCap。
- `src/shaders/endfieldPost.js`：屏幕空间描边、Bloom 与最终色调曲线。
- `public/textures/toon_character_ramp.png`：本项目生成的 256×4 Ramp 图集。四行依次为衣物、皮肤/脸、头发、预留行；RGBA alpha 存辅助明暗曲线。

## 当前已实现

| 效果 | 实现方式 | 资源/行为 |
| --- | --- | --- |
| 分材质 Ramp | 主方向光 N·L 查 Ramp 图集；衣物、皮肤/脸、头发选不同的行；Ramp alpha 调整阴影辅助量 | 本项目生成的色带，不是原项目美术 Ramp。原目录中的 `toon_01.bmp` 是 16×16 白图，不能作为有效色带使用 |
| 多光源与阴影 | 主方向光、次方向光、暖色聚光灯、环境光和半球光分开布置；Ramp 现在对每盏直接光的漫反射贡献分别采样；主光/聚光灯可投影 | 顶光暖色仍是 shader 假填光，不作为独立投影灯。脸部 SDF、背光散射和头发高光仍以主方向光为参考 |
| IBL | Three.js `RoomEnvironment` 经 `PMREMGenerator` 生成程序化环境反射，可调强度 | 当前没有匹配角色的 HDR 环境贴图 |
| 衣物参数 | 读取 P 图：R 金属度、G 反射率、B AO、A 光滑度；附加高光与弱 AO | 通道含义按 MyZmd shader 读取方式实现。当前模型只有 `cloth_01` 的面片分配。导出报告列出了 `cloth_02` 材质槽，但检查 GLB 与 FBX 的面片材质索引后确认所有相关网格均为材质索引 0，没有面片使用 `cloth_02`。候选 P02 仍显示在贴图列表，但不会加载进着色器 |
| 面部阴影 | 根据面部朝向和 SDF RG 通道重算脸部阴影；蓝通道作 refine 权重，A 通道小范围遮罩作 trick 权重，可调强度 | B/A 通道语义是根据贴图形态推断，A 的小遮罩看起来位于鼻部；仍未找到独立的庄方宜 refine/trick 贴图，需美术确认 |
| 皮肤 | 生成暖色 1D skin LUT；按视角边缘和主光背光方向叠加轻量散射 | 这是廉价 NPR 近似，不是厚度图/屏幕空间的完整 SSS |
| 头发高光 | 从 UV 屏幕导数重建切线，用头发 P 参数与 ST 遮罩限制两层各向异性高光 | 当前 GLB 缺少 TANGENT 属性，因此切线为导数近似；ST 来源为同目录的 Laevat 头发遮罩，尚未确认与庄方宜头发 UV 完全对应。若贴图边界错位，可先关掉“头发各向异性高光”或替换匹配遮罩 |
| 眼睛 | 虹膜加铜色 MatCap/fresnel；眼白写入 stencil，眼部高光层按 stencil 测试 | 已有基础分层遮罩；没有独立角膜网格/厚度，未实现视差折射 |
| 描边 | Three.js `OutlinePass` 对角色整体做屏幕空间描边，像素宽度可调 | 隐藏了 GLB 的 `ZF_Outline_07` 壳网格，因为其与脸部重叠会产生脏点；后处理描边不依赖网格顶点外扩，当前也没有顶点宽度遮罩 |
| 衣物自发光 | 服装 01 使用 E 图和低强度紫色发光 | 当前 E 图仅 512² 且亮区稀疏，效果较轻 |

## MyZmd shader 对照说明

MyZmd 的 `ZmdToonMain` / `ZmdHairToonMain` 路径把 P/ORM 类贴图作为材质参数输入，再分别叠加 Ramp 明暗、AO、反射/高光等项；头发路径额外依赖切线方向和高光遮罩。脸部路径使用朝向相关的 SDF 阈值，配合 refine/trick 图微调五官附近阴影。Unity 中的 Stencil 和描边壳用于控制面部/刘海/轮廓的绘制次序。

本实现把这些职责映射到 Three.js 的 `onBeforeCompile`、glTF 材质贴图、Stencil 材质状态和后处理 Pass。代码没有逐行移植 URP：Three 与 URP 的光照坐标、阴影接入和渲染阶段不同。当前对每个 Three.js 直接光调用分别调制漫反射 Ramp；脸部 SDF、头发高光和散射仍主要读取第一盏方向光。

## 已知差距与下一步数据需求

1. 提供庄方宜专用美术 Ramp（含明暗辅助通道），替换程序色带。
2. 找到与该模型 UV 对应的头发 ST/高光遮罩，以及切线或可验证的发束方向数据。
3. 补齐脸部 SDF refine/trick 贴图并确认各通道规范；确认蓝通道区域遮罩与 A 通道小遮罩的语义。当前强度滑杆允许快速压低这两种推断权重。
4. 若要更接近原作皮肤效果，需要皮肤 LUT、美术参数及厚度/透射信息；现有贴图不足以做可信完整 SSS。
5. 若要完整眼部效果，需要角膜独立几何/材质、眼球深度或视差参数，以及对应 MatCap。
6. 若 `cloth_02` 需要参与渲染，需从 Blender 源场景恢复/确认哪些面片应使用它，再将分配后的模型导出；只把 P02 绑定到现有全身网格会把错误 UV 与参数套到布料上。

## 检查记录

- Vite production build：`npm run build`。
- 浏览器：角色 GLB 已加载，角色特写正常；最后检查时没有 WebGL/JavaScript error。
- 可见控制项：Ramp、脸部 SDF、头发高光、Bloom、主光/顶光/皮肤散射/边缘光/IBL/描边宽度。
