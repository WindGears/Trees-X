# R18 阴影 BVH 局部上传

开门和分离会更新软箱自阴影的顶层加速结构（TLAS）。`three-mesh-bvh` 0.9.16 将 TLAS 节点放在 GPU 节点缓冲开头，把静态三角形树（BLAS）接在后面。`updateTransforms()` 只重写顶层包围盒。Three r185 在缺少更新范围时将整段节点缓冲交给 `queue.writeBuffer`。[BVH 打包与更新源码](https://github.com/gkjohnson/three-mesh-bvh/blob/v0.9.16/src/webgpu/BVHComputeData.js) · [Three WebGPU 缓冲更新源码](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgpu/utils/WebGPUAttributeUtils.js)

汽车阴影资源在原 BVH 所有者中识别已固定的布局，用 TLAS 根缓冲字节数确定更新范围。首次初始化仍写入完整节点数据，之后每次 refit 通过 Three 的 `addUpdateRange` 上传 TLAS 前缀。布局校验不通过时沿用全量更新。变换矩阵仍上传原有 15,120 字节，射线、阴影历史、几何、材质与资源生命周期沿用原实现。

## 1440×1000 后台交叉对照

同一个生产构建依次测试全量、局部、局部、全量。每个样本包含 7.5 秒绕行、开门、分离。四个样本均使用 NVIDIA WebGPU、4K BC7、R18、完整 DDGI、双射线反射和双射线主软箱自阴影。

| 指标                         | 两次全量上传    | 两次局部上传 |
| ---------------------------- | --------------- | ------------ |
| 每次 refit 的节点写入        | 13,452,992 字节 | 6,688 字节   |
| 开门＋分离，两段节点写入总量 | 9.11–10.37 GB   | 5.49–5.50 MB |
| 开门 JS 提交间隔 P95         | 25.8–28.1 ms    | 25.2–25.6 ms |
| 分离 JS 提交间隔 P95         | 26.3–31.1 ms    | 25.1–25.6 ms |
| 开门采样 GPU 队列等待 P95    | 63.0–66.8 ms    | 54.9–56.3 ms |
| 分离采样 GPU 队列等待 P95    | 55.3–68.7 ms    | 52.2–53.2 ms |

四组绕行均没有节点写入，绕行的提交间隔仍有样本波动。GPU 队列等待包含此前已提交工作和浏览器回调调度，实际屏幕呈现待测。各组均只有一次 BLAS 构建，单 Canvas、原分辨率和贴图格式通过核对。

开门前后读回 1440×1000 的原始及过滤可见性目标，均保留有效遮挡和中间可见性，数值与两次全量参考的波动接近。全景、开门、分离和亮橙截图的全画面 8 位 RGB 平均绝对差为 0.022–0.057，重复全量参考为 0.024–0.053。单测逐字验证 refit 前后的静态 BLAS 尾部一致，并覆盖连续 refit 与可见性变化。

原始报告、截图和汇总位于 `artifacts/r18-startup-deep/shadow-node-paired-*`。已部署旧版的独立上传记录为 `shadow-node-write-live-before-r18.json`。

生产构建、1,015 项单测、架构、模型与工具检查通过。三件展品切换、管理取景回填、真实 WebGPU 设备丢失恢复及独立场景射线查询通过。全库 `npm run check` 在已有的 `PERFORMANCE_OPTIMIZATION.md` 格式项处停止，后续检查已单独运行。
