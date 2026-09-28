# Reventón 离线恢复工具

当前阶段是 Blender 静帧校准，最终视觉未通过。另有 16 秒动作验证工程和三张 4K 关键帧，尚未生产完整影片或前台播放器。用户已明确选择先达到原参考图材质光影。完整证据与差距见 [验收记录](../../.ai/reventon-validation.md)。

## 文件职责

| 脚本                                     | 职责                                                            |
| ---------------------------------------- | --------------------------------------------------------------- |
| `extract_3dm.py`                         | 保留所有 Mesh 与 Brep 缓存面，输出几何 NPZ、来源 JSON           |
| `inspect_vpb.py`                         | 只读解压 VPB 分块容器，不执行内嵌代码                           |
| `recover_vpb_images.py`                  | 恢复内嵌 Image 像素、去重和记录摘要                             |
| `recover_vpb_materials.py`               | 提取材质记录、参数与名字，不自动解释完整材质图                  |
| `recover_vpb_cameras.py`                 | 提取保存相机、色调与已识别模型变换                              |
| `recover_reference_metadata.py`          | 读取本地参考 JPG 的相机和制作元数据                             |
| `recover_environment.py`                 | 将原半浮点立方体环境转成线性经纬图                              |
| `materials.py` / `restore_materials.py`  | 基础分类与使用原图像的 Cycles 材质重建                          |
| `build_scene.py`                         | 在独立后台 Blender 构建几何、材质、摄影棚与相机，打包图片并保存 |
| `render_stills.py`                       | OptiX 渲染两个机位、PNG 与线性 EXR、输出摘要和实测耗时          |
| `verify_recovery.py` / `verify_scene.py` | 分别验证解出资源和重新打开的保存场景                            |
| `make_comparison.py`                     | 拒绝过期场景/图片组合，生成本地对照页                           |
| `lighting_study.py` / `tone_study.py`    | 留存的有限光照与色调试验，不属于当前交付重放步骤                |

## 本机复现

从项目根目录运行 PowerShell。依赖 Python 的 NumPy/Pillow，rhino3dm 8.35.0 已局部安装在 `artifacts/reventon/tooling/`。不需要全局安装 Rhino。Blender 使用其自带 Python/NumPy。

```powershell
$reventonPython = 'C:/Users/WindGear/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
$reventonBlender = 'I:/WindGear/blander/blender.exe'

# 完整恢复；已有有效缓存时无需重复。
& $reventonPython scripts/reventon/extract_3dm.py
& $reventonPython scripts/reventon/inspect_vpb.py
& $reventonPython scripts/reventon/recover_vpb_images.py
& $reventonPython scripts/reventon/recover_vpb_materials.py
& $reventonPython scripts/reventon/recover_vpb_cameras.py
& $reventonPython scripts/reventon/recover_reference_metadata.py
& $reventonPython scripts/reventon/recover_environment.py
& $reventonPython scripts/reventon/verify_recovery.py

# 在独立 Blender 后台构建并检查预览。
& $reventonBlender --background --factory-startup --python scripts/reventon/build_scene.py --python scripts/reventon/render_stills.py -- --preview

# 重新打开已保存文件，检查完整性，再渲染最终检查图。
& $reventonBlender --background artifacts/reventon/reventon-restored.blend --python scripts/reventon/verify_scene.py --python scripts/reventon/render_stills.py
& $reventonPython scripts/reventon/make_comparison.py
```

脚本不删除源文件。构建器必须在 `bpy.app.background` 中运行，写入 `artifacts/reventon/reventon-restored.blend`；重新构建会更新该生成物，手工修改应另存新名。源对象标识、原 UV 与坐标缓存用于验证，单独新增的摄影棚、字标贴片清楚分组。程序退出时释放后台 Blender 资源，网页不加载这套高面数模型。

`comparison.html` 可直接用浏览器打开，或在本地 Vite 开发服务器访问 `/artifacts/reventon/comparison.html`。这是开发验收产物，不进入生产构建。图片、缓存及 `.blend` 位于已忽略的 `artifacts/`，源码仓库应保留恢复脚本和文档。输入文件与品牌许可情况见 [资源来源记录](SOURCES.md)。

最终动画通过静帧门槛后另立阶段：固定镜头/灯光流程 → 高精度帧序列 → 编码 → 前台分章播放。不得用这两张检查图的平移缩放冒充三维成片。

## 动作证明与 VPB 直接恢复候选

`analyze_motion.py` 从原开合变体求门轴，`build_motion.py` 构建独立动作工程，`verify_motion.py` 重新打开后检查几何和逐帧变换。`render_motion_stills.py` 渲染三个真实关键状态，`make_motion_review.py` 生成明确标为静帧的动作检查页。

新画质分支由 `recover_vpb_bindings.py` 只读解析场景图和原始数组；`match_vpb_surfaces.py` 记录 Rhino 与 VPB 的可靠匹配及差异。由于几何有差异，`build_vpb_candidate.py` 直接导入 VPB 可见车辆几何，`vpb_cycles_materials.py` 按原材质 ID 重建着色，`calibrate_vpb_studio.py` 单独保存人为摄影棚调整。`verify_vpb_candidate.py` 检查保存结果，`render_vpb_candidate.py` 将试片/4K 检查输出到独立目录。`study_vpb_lighting.py` 仅用于有限诊断，不能当作最终画质证据。

```powershell
& $reventonPython scripts/reventon/analyze_motion.py
& $reventonBlender --background artifacts/reventon/reventon-restored.blend --python scripts/reventon/build_motion.py
& $reventonBlender --background artifacts/reventon/reventon-motion-proof.blend --python scripts/reventon/verify_motion.py --python scripts/reventon/render_motion_stills.py
& $reventonPython scripts/reventon/make_motion_review.py

& $reventonPython scripts/reventon/recover_vpb_bindings.py
# 可选诊断，不是候选构建依赖；逐顶点对应可能需要数分钟。
& $reventonPython scripts/reventon/match_vpb_surfaces.py
& $reventonBlender --background artifacts/reventon/reventon-motion-proof.blend --python scripts/reventon/build_vpb_candidate.py
& $reventonBlender --background artifacts/reventon/reventon-vpb-candidate.blend --python scripts/reventon/verify_vpb_candidate.py --python scripts/reventon/render_vpb_candidate.py -- --full
```

候选构建时隐藏旧 Rhino 和人工字标贴片，读取 VPB 节点可见性与完整层级变换；静态工程清除时间线的相机绑定，以免关键帧标记覆盖检查机位。旧静帧、动作和新候选分别保存，三者的验证报告不得混用。当前凹凸重建、粗糙度转换和 Cycles 光照不是 VRED 着色器逐节点等价迁移。
