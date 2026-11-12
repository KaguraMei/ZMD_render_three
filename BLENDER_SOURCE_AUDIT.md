# Blender 源工程检查记录

检查日期：2026-11-12。检查使用 Blender 5.3.0 后台只读进程读取源文件，没有保存或修改 `.blend`。

## 检查对象

- 当前导出来源：`C:\MOD\庄方宜\庄方宜\ZhuangFangyi_no_futa.blend`
- 旧源文件对照：`C:\MOD\庄方宜\庄方宜\ZhuangFangyi.blend`
- 当前 Three 贴图目录：`public/textures/`
- 后台审计数据：`C:\MOD\庄方宜\庄方宜\render_export\_work\source_audit_no_futa.json`、`source_audit_original.json`
- 当前模型 UV 预览：`C:\MOD\庄方宜\庄方宜\render_export\_work\uv_previews_no_futa\`

## 已确认

### 头发 ST、HN 与切线

- 当前源模型的 `Hair` 网格有 `UVMap` 和 `UV1`，活动 UV 为 `UVMap`；34,888 个面都分配给 `Hair` 材质。
- `Hair` 材质引用打包的 `T_actor_laevat_hair_01_ST.png`（512×512）及 `T_actor_laevat_hair_01_HN.png`（2048×2048）。ST 节点接入 Bump 的 Normal，HN 接入法线节点与漫反射节点。
- `.blend` 中解包所得的 ST、HN 像素与 `public/textures/` 对应文件逐像素相同。ST 在 Blender 源材质接入 Bump.Normal，不是可直接当 SpecularMask 使用的遮罩。Hair 网格可从活动 UV 计算切线；已用导出脚本生成 `render_export/ZhuangFangyi_render_tangent.glb`，其 Hair primitives 带有 TANGENT 属性。
- UV 预览显示 ST 贴图和 Hair 活动 UV 同处一个坐标空间。Three 当前改用导出的 TANGENT；原查看器把 ST.R 当高光遮罩的绑定已移除。

### Face SDF 与 refine 通道

- 源工程打包了一张 1024×1024 的 `T_actor_common_female_face_01_SDF.png`，与 `public/textures/` 中同名贴图逐像素相同。它是基础 Face SDF；Face 网格活动 UV 为 `UVMap`，叠图可见脸部岛与 SDF 脸部区域大致对齐。
- 这张基础 SDF 没有连接到源工程 Face 材质。它也不是 `_SdfRefineTex`：当前两份 `.blend` 都没有发现独立的 SDF refine 贴图或 Trick 贴图。
- refine 通道语义可由本地 `MyZmdShaders/Assets/MyZmd/ZmdFaceToonMain.hlsl` 确认：R 控制 SSS 权重；G 控制法线/阴影细化权重；B 调制阴影覆盖区域；A 提供边缘光区域遮罩。对应采样和使用位置在该文件第 55、106、113、177、196、321 行附近。
- 不要把基础 SDF 的 A 通道当作 refine A：当前脸部 shader 只用基础 SDF 的 R/G 平均值及 B 通道生成脸部方向阴影；refine A 是另一张贴图的边缘光遮罩。
- 当前查看器新增 `T_actor_zhuangfy_face_01_Refine_Proxy.png`：R/B 由 Face UV 面片覆盖区生成，G 保持中性，A 从 UV 岛边界生成。它按源码通道语义工作，但不是原作手绘 refine 图；原始 `TrickTex` 仍缺失。可运行 `tools/build_face_refine_proxy.py` 重建。

### 布料 cloth_02 分配

- 当前 `no_futa` 源工程中，`Clothing` 有 `M_actor_zhuangfy_cloth_02` 槽，但 7,535 个面全部分配给 `M_actor_zhuangfy_cloth_01`，cloth_02 面片数为 0。
- `LowerArmour` 的 4,310 个面和 `Tail` 的 2,879 个面也都分配给 cloth_01。旧源工程检查结果相同。
- cloth_02 的 D/N/P 贴图确实存在且可从打包资源恢复；目前缺的是面片归属信息。不能把 P02 或 D02 全图套给 Clothing 来代替材质分配。

### 皮肤与眼睛

- 源工程身体对象有多个 UV 与顶点色属性，但没有找到专用皮肤 LUT 或厚度贴图。BodySkin_Albedo 原始文件仍缺失；现有 viewer 身体色图是先前生成的烘焙结果。
- 眼部由 Face 网格中的 `EyeWHite` 区域及独立 `Eye_HL` 网格组成；`Eye_HL` 有独立虹膜材质和高光几何。没有找到独立角膜对象。工程内有打包的 `Copper_Matcap` 和 `matcap_trans` 图像，但它们没有接入眼部材质，不能直接认定为眼部专用 MatCap。

## 对图片生成的判断

手工设定 Ramp 与 skin LUT 色阶，以及从准确 UV 几何生成 refine 代理遮罩，已用于当前 viewer。生成式图像仍可作为美术 Ramp、Trick 遮罩和 MatCap 的视觉草稿。贴图按 UV 岛和已确认通道制作并逐通道检查。切线、厚度、眼球深度和 cloth_02 面片归属必须来自几何、烘焙或场景分配，生成图片不能替代这些数据。

## Codex 接入判断

- 运行中的 Blender 当前由 BlenderMCP 监听 `127.0.0.1:9876`；Codex 当前没有注册 Blender MCP 工具。
- `dsh-blender-plugin` 提供 GUI 会话、Python、截图、无头任务和建模/审计操作，但依赖 DSH Gateway 与它自己的 Blender bridge。它不是可直接加载到 Codex 的 MCP server；README 要求同一 Blender 只启用一个 agent bridge，并注明 Blender 5.x 尚未验证。当前 Blender 5.3.0 运行着旧 BlenderMCP，监听 9876；不能在这个会话里叠装 DSH bridge。
- 建议为 Codex 做一个小型本地 MCP 适配层，先暴露只读场景审计、UV/贴图预览和渲染截图；需要写场景或导出时，再加单独的显式写入工具。也可先评估代理当前 9876 端口的 BlenderMCP，但不要把 DSH bridge 和现有 BlenderMCP 同时装进这个 Blender 会话。
- Codex 插件可打包 MCP 配置和技能，见 OpenAI 插件打包文档：<https://developers.openai.com/plugins/build/plugins>。

## 预览

- `uv_previews_no_futa/hair_uv_over_st.png`
- `uv_previews_no_futa/face_uv_over_sdf.png`
- `uv_previews_no_futa/face_uv_over_albedo.png`



