# 汽车车漆语义绑定修复（2026-10-26）

## 问题与证据

摄影棚 r11 分离审查确认关闭 SSR/DDGI 后车身大块高光与暗侧仍存在。读取原 GLB 的 VPB 材质记录，并用实际 WebGPU 分色渲染核实：15023是黑色哑光塑料，20159才是车漆。原生成脚本把八个15023材质写进finishMaterials，导致外观操作改变饰条/塑料而不改变车身，studio也给这些塑料加了清漆。

`artifacts/car-showroom/signal-audit-r11-materials/semantic-ids.png` 中红色为15023，绿色为20159。`signal-audit-r11-isolation` 保存完整、原生、仅GI、仅SSR、关闭直接光/环境的对照。这些是诊断，不是新的正式材质或画质通过证明。

首轮signal-audit-r11在阴影准备中按秒等待，帧数未增长，对照作废。修订后等待主阴影/DDGI就绪及64个真实完整提交帧。环境隔离改用scene.environmentIntensity：r185无独立envMap时不使用材质envMapIntensity；早期仅改材质强度不构成环境关闭证据。

## 修复

reventonFinishBindings仅针对原始/4K登记摘要、精确旧八项列表、加载后四个车漆材质均带source_vpb_material_id=20159的情况返回四项真实车漆绑定。缺失、重复、自定义绑定及其他包不猜测。数据库/配置/原模型/纹理不改；节点、动作、相机、API保持。

适配器试色与studio校准共用此列表，局部诊断finishBinding记录解析结果。复原仍恢复加载时真实车漆颜色，不擅自改成概念图灰银。生成脚本改选20159，但未执行它覆盖历史初始化。后台明确维护绑定时可用四个20159名称，自定义列表不会被重写。

## 验证

- 21项相关单测通过，含两种核验包、错误来源/自定义/缺失/重复及恢复释放。
- 生产构建、类型及ESLint通过。完整check仍在用户PERFORMANCE_OPTIMIZATION.md格式检查停止，未改该文件。
- 实际1440×1000后台Edge：artifacts/car-showroom/paint-binding/report.json通过。暖白/深墨/原始操作核对四个车漆真实颜色；八个塑料的颜色、粗糙度、清漆不变；开门后车漆保持。唯一Canvas，GPU/page错误为空，保留实机截图。
- 已提交r10摄影棚路径另外复验通过：paint-binding-r10/report.json，同样覆盖三种配色和开门，不依赖r11候选参数；脚本默认复验此路径。
- 全套首次927通过、1个真实HDR校验超过默认5秒。仅将大文件校验超时改为15秒，不改摘要、方向、误差和画质条件；复跑146文件、928项全部通过，记录在paint-binding-tests-rerun.log。

## 剩余

这是语义绑定修复，不代表摄影棚完成。环境高光、地板、边缘残差、构图及用户目视验收待收束。r11是独立未晋级候选，不进入车身世界空间光追节点。
