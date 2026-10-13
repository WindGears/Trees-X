# 历史验收：实时交互与静止精修管线

2026-10-12 的静止精修实施与验收记录。用户随后明确要求操作期间持续保持高质量；当前主线为 [打字机实时组合渲染](realtime-rendering-validation.md)，本页的路径追踪／OIDN 保留为历史和参考入口。不能把目标参数或 CPU 测试视为三件商品画质验收。

## 入口与阶段门

- 已验收的增强 WebGL 工作台继续默认。`?renderPipeline=webgl` 明确使用兼容入口。
- 桌面 `?product=typewriter-study&renderPipeline=hybrid` 接入真实 Tres 工作台、同一个 WebGPURenderer。暂不改变桌面默认。
- 用户最新要求先完成打字机供本人验收，钢琴／汽车新管线留待重新规划。打字机工程检查已通过；本人验收及后续联合默认切换未完成，不能提前切默认。
- API、展示配置 v1/v2/v3、数据库结构及工作台操作不变；不新增 CI、上传或手势。

## 实施契约

`WorkbenchStage` 选择宿主及维护局部精修反馈，`useWorkbenchScene` 管理环境、商品、首帧、可见性和资源生命周期。`controller` 将相机、动作、材质变化明确分类；Tres 普通 invalidate 仅申请帧，不能冒充姿态变化。协调器动态载入，管理单 renderer 的光栅底图、静止采样、引导降噪与完整结果融合。商品适配器不创建 renderer。

原资产由 loader 释放；追踪代理拥有派生几何与 BVH；舞台拥有借用的材质及 HDR；协调器拥有渲染目标、追踪器和降噪网络；Tres 唯一释放 renderer。旧请求、旧商品、旧渲染代次只清理，不能回填当前画面。

固定策略为首个真实光栅帧开放操作、500ms 静止后开始、最低 128 spp 引导 OIDN 完成后 240ms 融入。主动继续精修提高到 1024 spp 原图，不变姿态保留累积，并在采样时显示实际累积原图而非旧降噪缓存；任何新的三维输入取消旧结果并回到常规 128。DOM 标签及说明滚动不清采样。减弱动态直接切完整结果。页面隐藏、离屏、达标后停止计算，返回不恢复商品动作。

引导目标的两附件必须命名为 `output`、`normal`，与 MRT 输出一致。每宿主复用同一 MRT 及法线节点，避免每轮降噪触发新的 Three 渲染上下文缓存；原目标、MRT 和 toneMapping 在 finally 中恢复。引导目标由协调器释放，渲染程序缓存由 Tres 所拥有的 renderer 释放。

参数：完整输出分辨率、renderScale 1、12 反弹／12 透明穿透、MIS、stableNoise；不自动缩纹理、超分或能量截断。光栅离屏目标使用 HalfFloat 与 4× MSAA。实际最低样本回读最多 1Hz，局部反馈最多 15Hz，不逐帧写 Pinia。

OIDN 使用 `oidn-web 0.5.0` 与官方 `rt_hdr_alb_nrm.tza`。权重实际 1,841,160 bytes，SHA256 `e586ef2ff48d7fbb7611986405220ed8fc5c13ca79bfc40be4dc742fbf959e1a`。来源、版本与 MIT／Apache-2.0 许可见 `public/models/denoise/manifest.json`；脚本、模型、权重同源。交付 doctor/prepare 校验实际摘要和 LFS 指针，首次安装需要网络，演示不依赖外网。

## 当前证据与阶段状态

- 最终 `npm run check` 通过：312 单元测试／61 文件、48 交付工具测试、101 个 Vue 组件行数检查；`npm run build` 通过。既有 legacy Vue 属性命名、上游 BVH 命名导出及大动态块警告单独保留，不以关闭警告替代检查。
- `artifacts/hybrid-workbench/check/report.json` 实际 NVIDIA WebGPU 核心检查 7 组通过：真实 GLB、572 语义部件、298 Mesh／2257 实例、128 最低样本完整降噪、停止空闲渲染、1024 续算请求、鼠标接管、结构暂停／复原。资源来自正式 API，没有另建替代模型。
- 早期上下颠倒问题已修正：上游降噪输出材质适配旧全屏四边形的 UV，新 Three QuadMesh 对呈现降噪结果的 copy quad 做一次 Y 翻转；原追踪、引导图和场景均不翻转。随后五取景和实际 1024 原图方向比较通过。
- 此轮记录首光栅 6.207s、首精细画面 39.143s、降噪 6.440s，均是单次协调器阶段壁钟时间；不等于完整冷加载、GPU 帧耗时或可推广的性能成绩。
- `artifacts/hybrid-workbench/faults/report.json` 4 组通过：真实 API 快速连续选择与迟到隔离、权重 503 保持可操作光栅、重试保留 128 目标并完成降噪、真实 GPUDevice.destroy 后重建唯一宿主并保留相机／暂停结构。原生 device.lost 与 Three 通知去重，主动 dispose 的失效不触发恢复。
- `artifacts/hybrid-workbench/admin/report.json` 2 组通过：真实 Session 管理预览右键平移、实际镜头回填、退出后无 Canvas，原商品数据库响应完全未改变；测试阻止持久化写入。
- 同一管理检查在生产构建再次通过，记录于 `artifacts/hybrid-workbench/production-admin/report.json`，包含动作可选空字段的完整保留。
- `artifacts/hybrid-workbench/production-core/report.json` 7 组真实生产构建检查通过，包含实际 128 样本完整结果与图像方向。此次首光栅 6.765s、首精细画面 39.711s、降噪 6.748s，仍只代表本次阶段壁钟测量。
- `artifacts/hybrid-workbench/production-faults/report.json` 4 组生产故障检查通过，另外覆盖拖动未松手时快速选择、恢复后的实际实例高亮；旧宿主完全释放后才重建。
- `artifacts/hybrid-workbench/production-layout/report.json` 3 组通过：1440×1000／1280×720／1920×1080 复用真实 GPU renderer；390／320px 新页面使用 WebGL 且不下载 GPU 后端与降噪权重；减弱动态实际最低 128 样本完成，无可见融合帧、达标后停钟。手机提示条曾遮住商品栏，调整至底 170px 后重新构建和复核通过；截图集中检查通过。
- `artifacts/hybrid-workbench/webgl-lifecycle/report.json` 7 组原入口回归通过：572 部件姿态、拾取、试色、导览接管、真实 WebGL 丢失恢复、三次钢琴／打字机及汽车／打字机循环、失败重试。预热后打字机返回计数稳定为 284 geometries／68 textures／28 programs；该数值仅属于旧 WebGL 路径，不冒充新 GPU 联合验收。
- 当前完成：以下打字机五取景、1024 原图续算、资源稳定与最终故障检查。待用户本人验收；钢琴／汽车、30 次切换／20 分钟混合联合测试与最终默认切换留待重新规划。此前 WebGL E1 的 20 分钟结果不能作为混合管线的成绩。

## 打字机完成节点（2026-10-12）

### 有效画质对照

独立比较器曾遗漏引导目标附件名称，导致 WGSL 的空输出类型错误。`artifacts/hybrid-workbench/denoise-comparison` 的早期低样本引导降噪图撤回，不用于结论；生产协调器原本已正确命名，不受该实验页问题影响。补充真实 MRT 单元测试，浏览器脚本在 GPU 或降噪错误出现时立即失败。

修正后 `denoise-comparison-guided/report.json` 20 次真实运行通过：整机、漆面、金属、分层、平铺五取景分别累计 32→64→128→1024，记录实际最低／最高样本数，保存 35 张原图／降噪图。五组 128 引导图与 1024 原图已逐图检查文字、金属边缘、透明键帽及结构细边；未发现明显上下颠倒或旧姿态残影，1024 原图仍保留可见采样噪声，不作为物理真值。

独立页使用共同 Studio Small 05 HDR、原 GLB 网格，不包含生产摄影棚近似反射／接触阴影、实例批处理及访客投影调整；这些图只能用于该共同输入下的降噪比较，不能冒充生产舞台的同图性能测试。缺 UV 的部分 enamel／steel 未凭空增加微表面，源字符贴图的清晰度也未因此提高。

### 真实工作台与续算

- `production-high/report.json` 11 组通过：真实 572 部件、2257 实例与同一 renderer；最低／最高均为 128 的完整引导结果；128→1024 有效续算；采样中展示方向正确的真实原图而非旧 OIDN；最低／最高均为 1024 后停钟且不再降噪；成图后拖动与采样中滚轮立即回到实时控制，随后新姿态重新完成 128；任意暂停结构与确定性复原保持。
- `production-views-stable/report.json` 6 组、五个真实工作台取景通过。每组保存光栅、完整 128 引导结果、UI 截图与实际相机／投影／部件姿态／材质摘要。五组复用相同 Canvas／renderer，三维场景未被截图脚本替换；网络请求同源，零浏览器错误与失败请求。
- `typewriter-final-faults/report.json` 最终 4 组通过：原 WebGL 不请求 GPU／权重、真实 API 快速选择只保留当前代次、真实权重 503 与重试、实际 GPUDevice.destroy 后唯一宿主恢复并保留相机／暂停结构。只有快速选择主动取消的一次 API 请求记录为 ERR_ABORTED，无非预期浏览器错误。

### 资源与阶段时间

五取景重复精修曾暴露每轮新增 298 个程序的缓存增长。固定引导 MRT 身份后，最终五取景预热计数全部保持一致：1201 programs、579 geometries、94 textures、11 renderTargets；程序字节计数 5,783,566，renderer 记录的总分配字节为 738,720,975。这是 Three 分配统计，不是物理显存占用测量，也不代表 20 分钟联合稳定性结论。

最终五取景单次记录首光栅 6.516s、首次完整精细画面 43.767s；首次引导降噪阶段约 8.677s，包括初始化与编译，随后四次约 206.5—221ms。后四次不包含路径采样时间，不能理解成每次精修只需 0.2 秒。独立比较的 128→1024 续算约 91—161 秒，属于该比较场景的本机壁钟记录，不作为生产通用性能承诺。

首次光栅开放操作，不等待精修完成；在等待或计算期间旋转／缩放应立即接管。当前固定 128 引导默认未因测量而降低样本、输出分辨率或贴图。最终 CPU 检查补充连续五轮 MRT 复用、外部渲染状态恢复、原图目标覆盖及失败释放。

## 复现与本人验收

生产准备／启动仍使用 `npm run demo:prepare`、`npm run demo:start`，访问 `http://127.0.0.1:5181/?product=typewriter-study&renderPipeline=hybrid`。停止使用 `npm run demo:stop`。本人体验顺序及检查边界见 [打字机验收清单](typewriter-hybrid-handoff.md)。

浏览器脚本默认临时测试端口；复现生产验收时显式设置 `CHECK_URL=http://127.0.0.1:5181`：`npm run test:hybrid`，完整原图续算用 `HYBRID_CHECK_SCOPE=high`；故障与管理预览分别用 `faults`、`admin`。`npm run test:hybrid-visual` 运行真实工作台五取景检查，`node scripts/denoise-comparison-check.mjs` 运行共同输入样本比较。不要同时运行多个 GPU 对照影响测量。

原基准和独立比较留在 `visual-quality-baseline.md` 与 `render-pipeline-comparison.md`。临时截图、测量及运行日志位于忽略的 artifacts，不提交；本文件只记录实际验证及限制。
