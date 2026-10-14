# 打字机 HDR 中间纹理修复

2026-10-14。**独立格式修复已完成；节点一整体画质仍未通过。** 默认继续 WebGL，钢琴、汽车、模型、灯光、曝光、相机及数据库不变。本记录补充 [节点一验收](typewriter-quality-node1-validation.md)，不把诊断成功当作画质晋级。

## 原因与实现

Three r185 的 RTTNode 默认参数包含 HalfFloatType，但传入 `{ depthBuffer: false }` 会替换整个默认 options。RenderTarget 随后使用 UnsignedByteType，实际 GPU 为 rgba8unorm。HDR RGB 与 SSR 未命中距离 10000 均被截到 1，SSGI 与合成中间纹理也失去 HDR 范围。

realtime/ownedRtt.ts 显式声明 HalfFloatType，保持线性颜色空间。目标和 quad 材质仍由局部 owner 释放一次，上游纹理、源模型及共享 quad geometry 只借用。未增加 renderer、绘制时钟、曝光补偿、模糊范围或能量截断。

1440×1000 六个取景的 Three textureBytes 记账均增加 17,280,000 字节，符合三个全分辨率目标从 4 到 8 字节／像素的变化。这是引擎资源记账，不能称为实际显存或性能成绩。

## 真实 GPU 证据

真实公开 API 加载 kimi-typewriter@1，场景包含 572 个语义部件、2257 个实例，唯一生产 Canvas／原生 WebGPU renderer。诊断只在独立 Playwright 页面安装临时 hook；四路复制在成功完整帧边界、第一次 await 前提交，读取原始 SSR、native baseSpecular MRT、filtered replacement 和 raw RTT。保存实际行 padding、纹理格式、原始字节及 SHA-256；PNG 是后续帧的相同固定姿态截图。

| 同一实时管线诊断                       | 修复前     | HalfFloat 修复后 |
| -------------------------------------- | ---------- | ---------------- |
| raw RTT 实际 GPU 格式                  | rgba8unorm | rgba16float      |
| 整机第 1 次 raw RGB 峰值               | 1          | 2.0078125        |
| raw ray length 峰值                    | 1          | 10000            |
| 整机第 1 次 raw 未命中数／SSR 未命中数 | 0／563535  | 563948／563948   |
| 强制全未命中 raw 未命中数              | 0          | 1440000          |

各批次六次捕获均未检出 NaN／Infinity；随机射线数量可以随帧变化，不作为画质指标。新增 GPU 契约检查覆盖实际格式、完整尺寸、有限输入和哨兵保存，失败会使诊断命令失败。

强制全未命中是明确标记的 synthetic signal，不修改真实几何或原生材质输入，不用其截图评价访客画面。修复后 replacement 减 native 仍有非零残差，第 1 次 supported-miss RGB 合并 RMS 为 0.0008980723833364115。这证明过滤后的全未命中不能完全抵消；它不是感知噪声分数，不证明漆面全部颗粒由此产生。邻域 support 与原生环境过滤仍待处理。

## 同条件画面与回归

六个修复前后取景为整机、漆面、金属、键帽、0.6 分层和平铺。实际模型／姿态／源材质摘要、软箱、环境、曝光和输出一致，全部相机与投影误差为 0；只比较纹理格式修复。跨 WebGL 图的布光不同，仅作视觉方向参考，不用于算法误差比较。

人工检查观察到漆面颗粒减少，整机、地台轮廓、文字和细边未发现新增明显退步；金属近景仍有点噪，分层和平铺未呈现足以晋级的整体质量收益。整体画质及本人验收仍未通过／待验收。

- 完整 npm run check 通过：389 项前端单测、48 项交付工具测试、16 项诊断测试；类型、格式、模型与 102 个 Vue 组件架构检查通过。原有两条 legacy Vue 属性命名警告保留。
- 生产工程检查：六取景契约 2 项、核心互动 4 项、管理预览／取景回填 2 项、故障恢复 4 项、三个桌面尺寸及 390／320px／减弱动态兼容批次 2 项通过。
- 故障含真实模型 503、受控 renderer 错误回调和实际 GPUDevice 销毁恢复；受控回调不冒充原生 GPU 校验错误。
- 当前核心批次未观察到真实 hidden，未用属性覆盖或合成事件补成绩。呈现预算、当前版本 30 次重载、20 分钟操作及本人走查仍待完成，不沿用历史成绩。
- 最终 hook 实机复核六次捕获通过：四路 RGBA16F、完整尺寸、有限输入及哨兵保存契约均通过，hook 正确恢复。捕获帧号记录在 ssr-probe-final/report.json。
- npm run build 与 demo:prepare 通过，前后端产物、三件清单及运行资源摘要已更新；demo:stop 只停止登记且身份匹配的进程，demo:start 恢复 5181／8089 的真实 API 演示。原有 BVH 重导出和构建体积提示保留，没有改数据库。

临时证据位于忽略目录 artifacts/typewriter-quality-node1/：ssr-probe-before、ssr-probe-half-float、ssr-probe-final、quality-half-float、hdr-rtt-comparison、core-half-float、admin-half-float、faults-half-float、visual-half-float。对照入口 hdr-rtt-comparison/index.html；不提交读回文件或临时截图。

## 子代理及后续

Cline 编写纯 Float32 统计及 9 项固定输入测试。任务因轮次耗尽进入 failed，MCP 正确拒绝 apply；Codex 单独审查公开完整提案并手动整合，再运行真实测试。见 [Cline 协作记录](cline-delegation.md)。

本次同步独立 HDR 修复与诊断工具。下一项仍是反射过滤残差与 support 边界，画面通过后再制作 UV／材质 v2。不进入 DDGI／FidelityFX／BVH，不切换默认。
