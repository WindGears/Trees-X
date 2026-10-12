# 实时交互与静止精修管线

2026-10-12。当前为实施与验收记录；不能把目标参数或 CPU 测试视为三件商品画质验收。

## 入口与阶段门

- 已验收的增强 WebGL 工作台继续默认。`?renderPipeline=webgl` 明确使用兼容入口。
- 桌面 `?product=typewriter-study&renderPipeline=hybrid` 接入真实 Tres 工作台、同一个 WebGPURenderer。暂不改变桌面默认。
- 按打字机真实工作台 → 五取景降噪比较 → 钢琴／汽车 → 联合验收推进。三个商品全部通过以前不能切默认。
- API、展示配置 v1/v2/v3、数据库结构及工作台操作不变；不新增 CI、上传或手势。

## 实施契约

`WorkbenchStage` 选择宿主及维护局部精修反馈，`useWorkbenchScene` 管理环境、商品、首帧、可见性和资源生命周期。`controller` 将相机、动作、材质变化明确分类；Tres 普通 invalidate 仅申请帧，不能冒充姿态变化。协调器动态载入，管理单 renderer 的光栅底图、静止采样、引导降噪与完整结果融合。商品适配器不创建 renderer。

原资产由 loader 释放；追踪代理拥有派生几何与 BVH；舞台拥有借用的材质及 HDR；协调器拥有渲染目标、追踪器和降噪网络；Tres 唯一释放 renderer。旧请求、旧商品、旧渲染代次只清理，不能回填当前画面。

固定策略为首个真实光栅帧开放操作、500ms 静止后开始、最低 128 spp 引导 OIDN 完成后 240ms 融入。主动继续精修提高到 1024 spp 原图，不变姿态保留累积；任何新的三维输入取消旧结果并回到常规 128。DOM 标签及说明滚动不清采样。减弱动态直接切完整结果。页面隐藏、离屏、达标后停止计算，返回不恢复商品动作。

参数：完整输出分辨率、renderScale 1、12 反弹／12 透明穿透、MIS、stableNoise；不自动缩纹理、超分或能量截断。光栅离屏目标使用 HalfFloat 与 4× MSAA。实际最低样本回读最多 1Hz，局部反馈最多 15Hz，不逐帧写 Pinia。

OIDN 使用 `oidn-web 0.5.0` 与官方 `rt_hdr_alb_nrm.tza`。权重实际 1,841,160 bytes，SHA256 `e586ef2ff48d7fbb7611986405220ed8fc5c13ca79bfc40be4dc742fbf959e1a`。来源、版本与 MIT／Apache-2.0 许可见 `public/models/denoise/manifest.json`；脚本、模型、权重同源。交付 doctor/prepare 校验实际摘要和 LFS 指针，首次安装需要网络，演示不依赖外网。

## 当前证据与阶段状态

- `npm run check` 通过：308 单元测试／60 文件、48 交付工具测试；`npm run build` 通过。既有 legacy Vue 属性命名、上游 BVH 命名导出及大动态块警告单独保留，不以关闭警告替代检查。
- `artifacts/hybrid-workbench/check/report.json` 实际 NVIDIA WebGPU 核心检查 7 组通过：真实 GLB、572 语义部件、298 Mesh／2257 实例、128 最低样本完整降噪、停止空闲渲染、1024 续算请求、鼠标接管、结构暂停／复原。资源来自正式 API，没有另建替代模型。
- 早期上下颠倒问题已修正：上游降噪输出材质适配旧全屏四边形的 UV，新 Three QuadMesh 对呈现降噪结果的 copy quad 做一次 Y 翻转；原追踪、引导图和场景均不翻转。重跑实际 PNG 方向比较与截图通过，但不能替代下阶段五取景细节验收。
- 此轮记录首光栅 6.207s、首精细画面 39.143s、降噪 6.440s，均是单次协调器阶段壁钟时间；不等于完整冷加载、GPU 帧耗时或可推广的性能成绩。
- `artifacts/hybrid-workbench/faults/report.json` 4 组通过：真实 API 快速连续选择与迟到隔离、权重 503 保持可操作光栅、重试保留 128 目标并完成降噪、真实 GPUDevice.destroy 后重建唯一宿主并保留相机／暂停结构。原生 device.lost 与 Three 通知去重，主动 dispose 的失效不触发恢复。
- `artifacts/hybrid-workbench/admin/report.json` 2 组通过：真实 Session 管理预览右键平移、实际镜头回填、退出后无 Canvas，原商品数据库响应完全未改变；测试阻止持久化写入。
- 同一管理检查在生产构建再次通过，记录于 `artifacts/hybrid-workbench/production-admin/report.json`，包含动作可选空字段的完整保留。
- `artifacts/hybrid-workbench/production-core/report.json` 7 组真实生产构建检查通过，包含实际 128 样本完整结果与图像方向。此次首光栅 6.765s、首精细画面 39.711s、降噪 6.748s，仍只代表本次阶段壁钟测量。
- `artifacts/hybrid-workbench/production-faults/report.json` 4 组生产故障检查通过，另外覆盖拖动未松手时快速选择、恢复后的实际实例高亮；旧宿主完全释放后才重建。
- `artifacts/hybrid-workbench/production-layout/report.json` 3 组通过：1440×1000／1280×720／1920×1080 复用真实 GPU renderer；390／320px 新页面使用 WebGL 且不下载 GPU 后端与降噪权重；减弱动态实际最低 128 样本完成，无可见融合帧、达标后停钟。手机提示条曾遮住商品栏，调整至底 170px 后重新构建和复核通过；截图集中检查通过。
- `artifacts/hybrid-workbench/webgl-lifecycle/report.json` 7 组原入口回归通过：572 部件姿态、拾取、试色、导览接管、真实 WebGL 丢失恢复、三次钢琴／打字机及汽车／打字机循环、失败重试。预热后打字机返回计数稳定为 284 geometries／68 textures／28 programs；该数值仅属于旧 WebGL 路径，不冒充新 GPU 联合验收。
- 尚待：五固定取景 32／64／128 降噪与 1024 原图对照；钢琴形变代理及细线、汽车玻璃与舞台迁移；30 次切换／20 分钟联合测试、离线生产回归及最终默认切换。

原基准和独立比较留在 `visual-quality-baseline.md` 与 `render-pipeline-comparison.md`。临时截图、测量及运行日志位于忽略的 artifacts，不提交；本文件只记录实际验证及限制。
