# r15 地面反射率对照（2026-10-30）

## 单变量与实际结果

`carStudioFinish=stone` 使用独立 r15；仅将 r14 地板 tint #999999 改为 #dddddd。
地板原贴图、粗糙度、法线、几何、四灯、曝光、车漆和相机保持。
没有新增光源、提高预算、改数据库或覆盖旧烘焙；普通入口仍保持原状。

与 r14 同机位比较，地面纹理和承托更容易辨认，但侧板高光、暗部层次
没有显著改善。因此未通过整体画质验收，也不将此前理想镜面方向的地面
交点比例当成亮度贡献证明。本版仅留显式对照，不用浅地板宣称侧板已修复。

## 制作与工程证据

从实际28网格导出独立源，SHA256为
fbc51819340db17f5b578bc4b4be7fccd57e2969532c4cbb1b4c2222025f9ff6。
后台 Blender Cycles 256样本、12反弹、OIDN、每信号六面1024²，原母版保留。
运行镜面37,358,444字节、间接2,481,568字节，解码总量71,303,168字节；
发光方向检查及半浮点相对误差<0.1%通过。不宣称此为地面lightmap。

`TREES_ROOM_PAIR=stone` 配合 `scripts/reventon-compact-room-check.mjs`，
输出 `artifacts/car-showroom/stone-room`。真实后台 Edge、1440×1000，
两版本各检查默认、侧面、背面、顶部、开门、座舱、0.6分离、复原。
报告passed=true、visualPassed=false：车漆参数、相机、曝光和汽车摘要一致，
每次同一Canvas/renderer，无记录到的页面/GPU错误。图像是实际渲染截图。

摄影棚相关84项单测及生产构建通过；check的typecheck/ESLint通过，
完整单测另跑150文件、956项通过。
格式阶段仍被用户已有PERFORMANCE_OPTIMIZATION.md阻断，未修改用户文件。
本次没有测量实际呈现帧率，不以相同目标分配推断性能达标。

下一步需要从实际可见漆面取样区分漫反射、基础镜面及清漆贡献，再制定
真实灯光/材质调整。暂不继续提高地面亮度，不进入车身世界空间反射。

## 金属漆复核与源辐射诊断（2026-10-31）

在新 `metallic` 漆面固定条件下补跑 r14 / r15 八机位对照，避免用原介电深灰漆
的结论直接推断金属候选。`TREES_ROOM_PAIR=stone TREES_COMPARE_PAINT=metallic`
调用同一脚本，输出 `artifacts/car-showroom/metallic-ground-return`。16张截图、
实际材质/相机/汽车摘要一致性、唯一Canvas/renderer及无错误检查通过，
`visualPassed=false`。已审阅全景与侧面：地面提亮明显，下半门板改善有限，
仍不足以晋级。未改变默认配置，也未新增灯光、烘焙或绘制开销。

新增离线工具 `scripts/reventon-showroom/paint-probe-radiance.mjs`，读取 r14/r15
实际半浮点HDR并核验压缩/解压摘要，通过四盏灯中心的方向和辐射值检查行序。
使用此前真实三角形/法线/镜头样本，求镜面方向的盒体交点，再按捕获位置
查询未过滤源图。四个机位的侧漆地面样本加权线性亮度由约0.035—0.040升到
0.057—0.062，约1.56—1.62倍，证明该部分源辐射发生变化；并非只改变可见地板。
完整结果见 `composition-r13/probe-radiance.json`。

此采样不包含遮挡、法线贴图、PMREM、粗糙度积分、BRDF、SSR或色调映射，
投影三角形面积也不是可见像素覆盖。不能称为最终漆面能量、提亮比例，
不能据此认定GPU绑定或所有过滤环节都已验证正确。源码对照当前r185原生
EnvironmentNode，粗糙度混合法向与清漆支路组织未发现直接偏差；这不是GPU
等效证明。下一步需定位实际像素的原生反射及过滤响应，再决定材质/灯位。

本批只有离线诊断工具和文档变更，运行包、源模型、材质参数及默认入口保持。

## 实际 GPU 响应与读回修正（2026-11-01）

`scripts/reventon-showroom/paint-gpu-response.mjs` 在固定侧面镜头读取真实
surface baseSpecular/baseDiffuse 与 beauty 半浮点附件；r14/r15、完整信号/
原生信号四组通过，三处车漆ROI均100%匹配实际底色与金属度，墙面控制区
全部拒绝。不是语义ID遮罩；结论仅限这些明确区域和静止姿态。

下部门板原生基础镜面线性亮度0.012824→0.015762（约+22.9%），
beauty 0.034849→0.039082（约+12.1%）；上门板镜面约+0.16%，
后翼子板高光约+0.012%。源HDR变化确实进入实际材质和GPU输出，
但对不同部位影响极不均匀，不能把整个侧面偏暗归为“烘焙未加载”。
这些是原生线性信号，不是最终屏幕亮度；完整/原生开关不改变beauty
附件本身，不能用相等数据宣称SSR/DDGI毫无贡献。截图只支持静态比较。

首次读回断言失败，定位到Three r185 readRenderTargetPixelsAsync返回
256字节对齐的行布局，最后一行不填充。新增共享解包工具及13项测试，
修复本次诊断并同步旧 reventon-noise-check 工具。旧工具未处理填充的
历史ROI统计不作为精确像素计数/关联证据；截图及独立工程断言不受影响。
本次GPU最终报告 passed=true、visualPassed=false，无页面/GPU错误，
结果在 `artifacts/car-showroom/paint-gpu-response/report.json`。
