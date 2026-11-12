# 庄方宜 Three.js 卡通渲染实现记录

## 运行

在本目录执行 `npm run dev`，浏览器打开 Vite 输出地址。当前预览使用 `public/models/ZhuangFangyi_render_tangent.glb` 和 `public/textures/` 中的资源。

## 对照资料与实现路线

实现参考工作区中的 `MyZmdShaders`、《【unity urp】从零模仿复刻实现自己的终末地人物卡通渲染》及《【unity urp】从零模仿实现自己的星铁和少前卡通渲染--复现笔记记录【1】》。核心结构是保留 GLB 的底色/法线等 glTF 材质输入，在 Three.js `MeshStandardMaterial.onBeforeCompile` 的光照结束阶段加入角色 NPR 光照，然后由后处理完成轮廓与色调整理。

主要入口：

- `src/viewer.jsx`：模型与外部纹理加载、材质按源名称绑定、灯光/环境、Stencil、交互控制。
- `src/shaders/characterToon.js`：Ramp、脸部 SDF、皮肤近似散射、头发高光、衣物 P 参数、眼睛 MatCap。
- `src/shaders/endfieldPost.js`：屏幕空间描边、Bloom 与最终色调曲线。
- `public/textures/toon_character_ramp.png`：由 `tools/character_ramp_palette.json` 手工设定色阶并生成的 256×4 RGBA Ramp。四行依次为衣物、皮肤/脸、头发、预留行；A 通道提供明暗辅助权重。
- `public/textures/toon_skin_lut.png`：由 `tools/skin_lut_palette.json` 手工设定的皮肤颜色响应 LUT；这是角色化近似色带，不是原作资源。
- `public/textures/T_actor_zhuangfy_face_01_Trick_Proxy.png`：按 Face UV 手工布局的淡腮红/鼻尖色彩代理；A 通道用于 `map_fragment` 颜色叠加，查看器提供独立强度滑杆。由 `tools/build_face_trick_proxy.py` 生成。

## 当前已实现

| 效果 | 实现方式 | 资源/行为 |
| --- | --- | --- |
| 分材质 Ramp | 主方向光 N·L 查分材质 Ramp 图集；衣物、皮肤/脸、头发选不同的行；Ramp A 通道将直接光乘数从 0.62 调到 1.0 | 已替换为项目内手工设定的静态美术色阶；在受光终止区形成窄过渡，并保留明部平台，不依赖运行时生成色带。原目录中的 `toon_01.bmp` 是 16×16 白图，不能作为有效色带使用 |
| 多光源与阴影 | 主方向光、次方向光、暖色聚光灯、环境光和半球光分开布置；Ramp 现在对每盏直接光的漫反射贡献分别采样；主光/聚光灯可投影 | 顶光暖色仍是 shader 假填光，不作为独立投影灯。脸部 SDF、背光散射和头发高光仍以主方向光为参考 |
| IBL | Three.js `RoomEnvironment` 经 `PMREMGenerator` 生成程序化环境反射，可调强度 | 当前没有匹配角色的 HDR 环境贴图 |
| 衣物参数 | 读取 P 图：R 金属度、G 反射率、B AO、A 光滑度；附加高光与弱 AO | 通道含义按 MyZmd shader 读取方式实现。当前模型只有 `cloth_01` 的面片分配。导出报告列出了 `cloth_02` 材质槽，但检查 GLB 与 FBX 的面片材质索引后确认所有相关网格均为材质索引 0，没有面片使用 `cloth_02`。候选 P02 仍显示在贴图列表，但不会加载进着色器 |
| 面部阴影与 Trick | 基础 SDF RG 计算朝向阴影；独立 refine 代理控制覆盖、SSS 和边缘；另用手工腮红代理叠加颜色 | refine 代理 R=网格覆盖 SSS 权重、G=中性值、B=阴影区域、A=UV 边缘轮廓；Trick 腮红图按 Face UV 覆盖裁切并可独立调强度。二者均为代理；原作 refine 美术图和表情/贴纸动画仍缺失 |
| 皮肤 | 静态手工皮肤 LUT；按视角边缘和主光背光方向叠加轻量散射，Face SSS 按 refine 代理 R 通道调制 | LUT 色阶可在 `tools/skin_lut_palette.json` 修改。尝试从 Body 网格烘焙厚度代理，但仅 13.6% 顶点能沿法线找到对侧表面，候选图未接入实时 shader，避免把稀疏命中显示成斑驳散射 |
| 头发高光 | 优先使用 GLB 的 TANGENT 属性，用 P.R 混合切线方向、P.G 控制反射率、P.A 控制光滑度，并叠加两层各向异性高光 | 已生成并启用 `ZhuangFangyi_render_tangent.glb`；ST 在 Blender 源材质中接入 Bump.Normal，Three 不再把 ST.R 错当高光遮罩。当前未找到独立 SpecularMask，强度使用保守固定值 |
| 眼睛 | 虹膜使用视空间反射向量采样铜色 MatCap，并叠加 Fresnel 与 MeshPhysicalMaterial 清漆；眼白写入 stencil，眼部高光层按 stencil 测试 | MatCap 坐标已按视空间反射修正；没有独立角膜网格/深度，未实现视差折射 |
| 描边 | Three.js `OutlinePass` 对角色整体做屏幕空间描边，像素宽度可调 | 隐藏了 GLB 的 `ZF_Outline_07` 壳网格，因为其与脸部重叠会产生脏点；后处理描边不依赖网格顶点外扩，当前也没有顶点宽度遮罩 |
| 衣物自发光 | 服装 01 使用 E 图和低强度紫色发光 | 当前 E 图仅 512² 且亮区稀疏，效果较轻 |

## MyZmd shader 对照说明

MyZmd 的 `ZmdToonMain` / `ZmdHairToonMain` 路径把 P/ORM 类贴图作为材质参数输入，再分别叠加 Ramp 明暗、AO、反射/高光等项；头发路径额外依赖切线方向和高光遮罩。脸部路径使用朝向相关的 SDF 阈值，配合 refine/trick 图微调五官附近阴影。Unity 中的 Stencil 和描边壳用于控制面部/刘海/轮廓的绘制次序。

本实现把这些职责映射到 Three.js 的 `onBeforeCompile`、glTF 材质贴图、Stencil 材质状态和后处理 Pass。代码没有逐行移植 URP：Three 与 URP 的光照坐标、阴影接入和渲染阶段不同。当前对每个 Three.js 直接光调用分别调制漫反射 Ramp；脸部 SDF、头发高光和散射仍主要读取第一盏方向光。

## 已完成项与下一步数据需求

1. 已完成：加入衣物、皮肤/脸、头发和预留行的手工 RGBA Ramp；色阶配置可在 `tools/character_ramp_palette.json` 调整。
2. 已确认源 Blender 中 ST/HN 与 Hair UVMap 配套，并已将 TANGENT 导出到当前 GLB。仍缺独立 SpecularMask；当前高光不再采样 ST.R，后续可按 UV 手绘专用遮罩。
3. 已完成：face UV 派生 refine 代理图，并按源码 RGBA 语义接入；另加手工淡腮红 Trick 代理和独立滑杆。基础 SDF B/A 不再被误当作 refine/trick。R/B/A 是几何派生权重，G 保持中性；原始 `SdfRefineTex` 美术数据及 Trick 表情/贴纸动画仍缺失。
4. 已完成：皮肤 LUT 改为手工色阶配置和静态 PNG。已尝试 Blender 法线射线厚度烘焙，但 Body 是开放/不完整表面，射线命中率仅 13.6%；候选图保存在 `tools/body_skin_thickness_candidate.png`，不参与实时渲染。要做可信完整 SSS，仍需闭合皮肤几何或人工厚度贴图及透射参数。
5. 已完成可由现有模型支持的部分：修正 MatCap 视空间反射采样并保留 stencil 高光层/清漆。完整角膜效果仍需要独立几何、眼球深度或视差参数。
6. 若 `cloth_02` 需要参与渲染，需人工确认哪些面片应使用它再分配导出；扫描两份 Blender 源文件后确认 Clothing 的 cloth_02 面片数为 0，LowerArmour/Tail 也全分配给 cloth_01。

## 检查记录

- Vite production build：`npm run build`。
- 浏览器：带 TANGENT 的角色 GLB 与 refine 代理贴图已加载；未观察到 WebGL/JavaScript 错误。
- 可见控制项：Ramp、脸部 SDF、头发高光、Bloom、主光/顶光/皮肤散射/边缘光/IBL/描边宽度。\n
