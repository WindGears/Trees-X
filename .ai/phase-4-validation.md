# Phase 4 高配桌面赛博视觉增强验收

日期：2026-09-15。测试对象为本地开发服务与原创 FORM / 01 概念样品。

## 已实现

- `VisualQuality` 为 `cinematic | eco`，Pinia 仅保存画质与重播请求，不保存 Three 对象。
- WebGL2、`EXT_color_buffer_float`、细指针、至少 1024px 视口且未启用减弱动态时进入电影画质；实际状态显示在场景顶部。
- 电影画质动态加载 Effects、CyberStage、HDR 解码和模型扫描代码。包含 half-float Composer、1.0 输出比例、8× MSAA、Bloom 1.35 / 0.98 / 0.06、Vignette 0.22 / 0.58、最终 ACES 和轻微稳定色散。
- 1600 个固定种子粒子共用 BufferGeometry 与 ShaderMaterial；能量环与扫描层输出 HDR 亮度。扫描覆盖 Mesh 复用原模型 geometry，并随结构节点移动。
- 首次自动演出约 2.4 秒；重播不改相机、配色、结构和部件。拖动、视角、部件、结构和手势接管会立即跳到稳定态。
- 离屏、页面隐藏或切换 eco 时卸载 Composer、舞台与扫描层，释放 HDR PMREM 并停止连续渲染。桌面电影画质不再依据帧时间降低输出比例、粒子或 MSAA。

## 自动验证

- `npm run check`：TypeScript strict、ESLint、Prettier、43 个 Vue 组件 300 行限制、GLB 预算和 39 项 Vitest 通过。
- 单元测试覆盖 HDR 成功、HTTP/预算失败、请求前后取消、迟到结果、环境替换释放；扫描层 geometry 复用、共享材质、重复初始化/销毁；粒子固定种子；帧时间统计。
- `npm run build`：生产构建通过。动态视觉分包为 hologram 2.03 kB、CyberStage 4.16 kB、environment 4.20 kB、Effects 85.67 kB（均为压缩前输出）。主 Three 分包仍有 Vite 的 500 kB 体积提示。
- `npm run test:visual`：Edge 1440×1000 验证单 Canvas、单 Composer、1600 粒子、同源 HDR、自动演出一次、重播、用户中止与真实像素差异；390px、320px、减弱动态均为 eco，未请求 HDR，Composer/粒子计数为 0。
- 最新脚本连续采样 10 秒得到中位帧时间约 5.6ms、P95 约 5.7ms。结果来自本机 Edge 无头模式，只作为记录，不触发桌面画质降级，也不代表答辩电脑或其他 GPU。
- `npm run test:browser`：桌面/移动、视角、缩放、模型失败恢复、WebGL 上下文恢复、WebGL2 降级、键盘和窄屏通过。
- `npm run test:experience`：配色、三个部件聚焦、结构、导览、复位、镜头中断和减弱动态回归通过。
- `npm run test:gesture` 与 `npm run test:gesture-interaction`：同源懒加载、虚拟摄像头、合成 landmarks、确认/取消、校准和移动端布局回归通过。

浏览器报告与截图位于 `.impeccable/review/phase-4-visual-report.json`、`phase-4-desktop.png`、`phase-4-mobile-390.png`、`phase-4-mobile-320.png` 和 `phase-4-reduced-motion.png`。

## 边界

自动化使用 Edge 无头模式和合成摄像头，没有替代真人手势、真实答辩设备 GPU、Safari/真机触控及长时间内存曲线测试。资源清理路径仍然保留；当前视觉目标只面向高配桌面答辩设备。
