# 打字机 WebGPU：v2 导入与反射核去相关

2026-10-15。按用户最新要求，工程成功逐项接入实时入口，实际画质由用户本人观察；不再用未完成的内部审美门槛阻止已核验资源进入 WebGPU。既有提交 `2a53a6e` 已同步 GitHub main，本轮基于该节点继续。

## 当前入口

- `?product=typewriter-study&renderPipeline=realtime`：已核验原打字机包自动使用 v2，默认旋转核。
- 增加 `&typewriterAsset=v1`：同一实时管线使用旧材质。
- 增加 `&reflectionKernel=static`：v2 材质与旧固定核对照。
- 普通无 realtime 的入口保持 v1／WebGL；`typewriterAsset=v2` 仍允许主动查看 WebGL v2。未知参数、hybrid、其他商品和后台自定义包不自动替换。

只有冻结 v1 摘要、包 ID、版本与已注册适配器完全匹配才替换局部资源引用；未写数据库、未升级 ProductPresentation、未改模型或 v2 清单。请求 WebGPU 而硬件回退时显示实际后端，资源选择与后端能力判断分别负责。

## 采样改动与所有权

保留八点 Vogel 盘的数量、半径、深度／法线／粗糙度／原生亮度引导、支持掩码和有符号修正。旋转使用 Three r185 的 `interleavedGradientNoise` 提供像素相位，成功完整帧的有界黄金角序列提供时间相位；没有新增纹理、渲染目标、绘制循环或生产像素回读。

`reflectionSampling` 只拥有一个 uniform 与局部数字状态。resolver 在 history prepare 后使用当前相位；全部 history GPU copy 提交成功后才推进相位。失败、取消或 supersede 重用相位，resetHistory 新建所有者并归零。数值快照按需读取，不在 Pinia 中逐帧同步。静态对照相位恒为零，并关闭像素旋转。

核旋转思路参考 Three MIT 实现 [RecurrentDenoiseNode r185](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/tsl/display/RecurrentDenoiseNode.js)，像素噪声使用 [PostProcessingUtils r185](https://github.com/mrdoob/three.js/blob/r185/src/nodes/utils/PostProcessingUtils.js)。本实现不是官方完整自适应滤波或新提出的降噪算法，仍没有镜面命中点历史重投影。没有采用 Cline 建议的“排除 miss 后仅平均 hit”，避免对有符号修正按命中条件重新归一化。

## 本批检查

| 检查                                               | 状态                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| 资产选择与严格类型                                 | check 通过：424 前端、48 交付、23 probe、36 v2 工具；类型／lint／格式通过 |
| 相位取消、重试、长时间界限和所有权                 | 68 项 realtime 单测通过；包括原生命周期与新增相位测试                     |
| 生产构建和实际 API                                 | demo:prepare 的 build、JAR 与资源回执通过，demo:start 真实 API 就绪       |
| 自动 v2、六取景、101 进度点、50 轮复原、3 次重载   | 通过；真实 WebGPU、572 部件、9 类 v2 材质，正反／复原误差均为 0           |
| 同资产／灯光／材质／姿态／相机的静态核与旋转核对照 | 12 张生产截图、六组输入 hash 相同；实际相机误差均为 0                     |
| 全 miss 暖历史严格零与真黑命中的负修正             | v1 信号契约八次捕获通过；全 miss 严格 0、黑命中保留负值，不混称 v2 画质   |
| 敲键、热点、导览与管理回填                         | v2 真实 WebGPU 交互五项及管理两轮通过，未修改数据库                       |
| GPU／实际呈现预算、20 分钟联合测试和本人画质走查   | 未完成，不沿用旧成绩                                                      |

生产 GPU 测试串行执行。旧 realtime/probe/planar 诊断明确 `typewriterAsset=v1`，保持历史资产和失效路由契约；当前默认 v2 另用资产回归与 kernel 对照核对。报告分别说明真实资产身份，不用旧 v1 测试替代 v2 结论。

`scripts/realtime-kernel-check.mjs` 输出两种核、六取景共十二图，记录真实模型摘要、572 个部件、实际相机、原姿态、材质／灯光输入和采样数值。帧计数是成功命令提交次数，不是 GPU 时间或屏幕呈现；截图、变化幅度、工程通过不能单独证明画质更好。

本批证据均位于 `artifacts/webgpu-rollin/`：`kernel/report.json`、`v2/report.json`、`signed-probe/report.json`、`interactions/report.json`、`admin/report.json`。v2 的三次重载保持 286 个 geometry、83 个 Texture 对象，旧模型登记的 286 geometry／66 material／83 texture 各释放一次；这是场景对象计数与释放事件，不是物理显存测量。管理端前后持久化摘要相同，退出预览注销相机采集且 Canvas 归零。

旋转核在实际成功帧中持续推进，固定核相位恒为 0；六组对照没有改变材质参数或扩大模糊范围。环境像素与 GPU 实例缓冲未独立回读做摘要，依赖固定清单、同源 HDR 校验及已完成动作验证；对照报告不冒充逐像素物理参考或全面渲染等效证明。

已有两条 legacy Vue 命名警告、构建 BVH 重导出和分块体积提示保留，没有新增错误。没有重跑本批 30 次重载、20 分钟、真实隐藏／设备恢复、GPU timestamp 或屏幕呈现测量；这些不因截图和单元测试通过而变成已完成。

## 交付与后续

原始材料、截图和报告保存在忽略的 `artifacts/webgpu-rollin/`。本轮没有新增运行资产下载，也没有接入 DDGI、FidelityFX、BVH 或修改钢琴／汽车。完成工程检查后同步代码，用户通过实时入口直接查看；整体画质记录等待本人反馈，不预设通过。
