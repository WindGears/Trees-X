# Reventón 实时资产

用于 `/?product=reventon` 的真实 Three.js 模型、烘焙 PBR/AO 和动作数据。Blender 是离线制作工具，浏览器通过 GLTFLoader、MeshPhysicalMaterial、HDR/PMREM 和 GSAP 绘制与驱动实际几何；本目录无影片或预渲染帧序列。

## 来源与许可

源自用户提供的 `lamborghini-reventon-re-made-1.snapshot.2/`，主要为 `2 TEMP.vpb`、其恢复的内嵌纹理与 `6-beauty.jpg`。未提供可再分发许可，不声明 CC0 或商业使用授权；同名品牌不表示合作或背书。

`reference.jpg` 是用户原始离线 beauty 图，仅作为目录封面与对照；**不是浏览器实机画面**。实际效果截图在 `.impeccable/review/reventon/`。资源无 AI 生成图像。每张 PNG/JPG 内附来源文本，写入时保留压缩图像字节；这项无损保证仅针对来源元数据插入，不等于整个跨渲染器转换无损。

原始 VPB SHA-256：`95bddf459624ea0f0612b2c8d7f46650ebe131472c5a14b826f33d1452247f04`。

## 发布规格（2026-09-30）

| 内容            | 实际规格 / 字节                                         |
| --------------- | ------------------------------------------------------- |
| `reventon.glb`  | 101,099,092 B，135 网格，1,500,363 三角形               |
| 源对象          | 2,998；导出器移除 207 个完全重复面，无主动减面          |
| 运动组          | 双门、四轮、后舱盖，共 7 组                             |
| `motion.json`   | 709,240 B；24 fps / 384 采样，383/24 秒，TRS 与相机轨迹 |
| 75 张 PNG       | 1,618,267,931 B；55 张 16 位、20 张 8 位                |
| `studio.exr`    | 25,182,626 B；恢复的原始 2048×1024 HDR                  |
| `reference.jpg` | 3,385,654 B；来源标记后的原图                           |
| 上述资源合计    | 1,748,644,543 B，不含 README/清单                       |

材质母版采用 4096² 通道贴图；固定组 AO 为 8192²，七个运动组 AO 为 4096²。原 UV 与新烘焙 UV 分离，按同一刚性运动组和材质合批。金属/粗糙度打包等导出步骤含 8 位输出，因此不能宣称全流程逐像素无损或与源渲染器严格等价。

AO 仅烘各组自身稳定遮蔽，不烘其他运动组在其上投下的阴影。地面接触投影随 Three 中的当前姿态重算；镜面反射由真实 HDR 和灯光计算，不印在底色上。前后刹车盘保留恢复的原材质反射权重与纹理；前挡/侧窗在运行时校准反射强度并保留真实透射。

## 校验与再生成

`provenance.json` 包含所有实际发布文件的 SHA-256 和字节数，以及源文件摘要。PNG 文件名由原导出图像摘要确定；`exportSha256` 指元数据插入前，`sha256` 指发布后。`browserQualityApproved: false` 表示尚未确认整体效果达到原参考图，不是加载失败。

从工程根目录使用已安装的 Blender 执行以下顺序；每次使用独立后台进程加载只读源 `artifacts/reventon/reventon-vpb-film.blend`，不在用户前台场景直接运行。该源文件的 film 命名是历史遗留，里面保存真实几何、材质与刚性动作。

1. `bake_realtime_materials.py --ids all --size 4096`：材质通道与 Bake UV；已有检查点会复用。
2. `repair_brake_materials.py`：对原 15889/16102 反射适配的局部重烘。
3. `bake_realtime_ao.py`：八个互相独立的刚性组 AO。
4. `assemble_realtime_asset.py`：输出 `artifacts/reventon/realtime/reventon-realtime.blend`、分离式 glTF 与动作数据。
5. 普通 Python 运行 `scripts/reventon/publish_realtime_asset.py`：发布本目录文件并计算最终摘要。
6. 普通 Python 运行 `scripts/reventon/verify_publication.py`：验证 79 个资源摘要、75 张 PNG 原压缩图像块与位深、原 JPG 压缩数据。

Blender 脚本均在 `scripts/reventon/`。当前后台脚本使用 OptiX GPU；不是任意机器开箱执行的 CPU 烘焙流程。公开 `motion.json` 是生成文件，排除手工格式化，避免摘要与生成结果漂移。
