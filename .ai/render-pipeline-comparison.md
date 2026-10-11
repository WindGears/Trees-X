# 同资产渲染比较与当前管线选择

2026-10-12。使用真实打字机，而非概念图或影片，对 Three.js WebGL2、WebGPU 实时光栅和 WebGPU 静止路径追踪作同输入比较。正式入口仍采用增强 WebGL2；路径追踪保留为独立静止质检与照明参考，WebGPU 基础光栅不替换当前工作台。本选择针对已经实际运行的方案，不是对全部 WebGPU 算法的评价。

## 实现与可复现入口

`renderlab.html` 是独立多页入口；`src/lib/renderlab/settings.ts` 锁定比较参数，scene 准备共同 GLB/姿态/材质/灯光/相机，renderer 选择单个真实后端，main 只装配状态和数字证据。它不进入 Pinia 或生产场景，不执行数据库中的代码，不修改商品数据。访问模式或取景会卸载上一文档，每页只有一个 Canvas/renderer；生产工作台仍只有一个 TresCanvas。

生产准备已构建 `index.html` 与 `renderlab.html`。访问 `/renderlab.html?mode=webgl&view=whole`，mode 可为 webgl/webgpu/pathtrace，view 可为 whole/paint/metal/layers/flat。光栅模式可旋转、缩放、平移并按需绘制；路径模式锁定镜头并累计样本，达到目标后停止。隐藏页面暂停，返回不偷偷恢复路径累积；重新加载才能开始新的静止比较。

`npm run test:renderlab` 逐一创建/关闭页面，导出原始 PNG 和数字证据；`node scripts/renderlab-report.mjs artifacts/renderlab/production-final artifacts/renderlab/convergence` 将已通过批次生成静态比较页，不再占 GPU。参数可通过 CHECK_URL、RENDERLAB_OUTPUT、RENDERLAB_SAMPLES、RENDERLAB_VIEWS、RENDERLAB_MODES 调整。每次使用新目录，不覆盖 B0。运行时 HTTP 请求全部同源。

## 共同输入与实验范围

- 实际 GLB：572 语义部件、2257 源 Mesh、1,257,132 三角面，源文件 SHA256 `b61293acf1eb49f2d7cbcba0ae59214346130b8df0c32685cf954502f37ff0f4`。三模式使用相同配置、动作文件、当前姿态与属性字节摘要。
- 共同镜头为各真实配置视角或热点取景；1440×1000、DPR 1、FOV 38、zoom 0.9375、viewOffset -58/16、ACES 曝光 1、sRGB。实际 position/target/quaternion/matrixWorld 均记录；不把相机位置相同误作投影完整一致。
- 共同三盏面积灯、Studio Small 05 自托管 HDR（强度 0.35）、原地台几何及标准 PBR。源贴图保留，AO 在三模式均禁用，环境材质强度归一到 1，源 unlit 贴花统一转为粗糙 PBR。参数与实验改变在每次 settings 中明确列出。
- 所有实验几何共同准备索引、法线与切线；完整源 UV 才计算切线，无 UV 保持缺失并只补零切线。不伪造 UV。路径追踪禁用自动补属性；共同属性实际字节摘要为 `b0b9e5f4fdcfb3f6924503e5e997e314bea8d6465689c0ec9f9e27768e5a24d9`。
- 路径追踪固定 12 次弹射、12 次透明弹射、renderScale 1、最低样本目标、直接/间接光 clamp 均 0；不降噪、不超分、不使用低分辨率反馈。frameBudget 1,000,000 是像素预算，不是毫秒。

共同实验场景没有生产天空盒渐变/地面淡出、Reflector、接触阴影 GLSL、填充环境及方向光；它不复制生产的专属 PMREM 软箱捕获。三个比较模式对这些差异一视同仁。光栅的面积灯没有阴影图，也没有光线追踪的部件互反射。这是共同场景内的算法能力比较；实验光栅截图不能冒充现有增强生产管线。生产舞台的效果另用 `.ai/typewriter-quality-validation.md` 的实机批次验收。

WebGPU 使用实际 GPUDevice/queue，拒绝把 WebGL fallback 记为 WebGPU。LTC 绑定复用共同面积灯库，不能只调用 WebGL 的 Uniforms 初始化。最初黑屏由缺少这个绑定造成，已修正；导出也在同一渲染任务内同步复制 swapchain，拒绝空白或近乎纯色图片。原失败材料保留为诊断，不计入通过结果。

## 实际检查与画面判断

`artifacts/renderlab/production-final/report.json`：五个取景 × 三模式共 15 张通过，零页面/console error。每次真实 Canvas/renderer 数为 1。资产、姿态、几何、材质和设置逐项一致；相机浮点运算尾数最大差 `3.97955973729935e-13`，检查容差 1e-12，原始值完整保留而非舍入后造相等。WebGL/WebGPU 深度范围约定不同，不能直接要求完整 projectionMatrix 字节一致。

交付检查 `artifacts/renderlab/delivery-check.json` 通过：生产工作台实际请求未包含独立 renderlab、three.webgpu 或路径追踪 chunk，保持一个 Canvas，HTTP 请求均同源。静态比较页五个取景均可切换，15 张原图实际尺寸为 1440×1000，没有 Canvas 或额外 GPU 场景。

两种光栅通过实际鼠标旋转和滚轮缩放，真实相机、帧计数和像素变化；停止输入后停止绘制。五张路径图实际 min=max=avg 为 128 spp；同次整机累积另保存最低超过 32 的检查点。达到目标后帧计数停止，不凭时间估计样本。

| 取景 | 真实观察                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| 整机 | 两种基础光栅轮廓、颜色和高光近似；路径追踪增加地台接触软影、右侧漆壳反射层次与键盘内腔遮挡，主体更落地                         |
| 漆面 | 清漆高光可核对；路径追踪增加周围金属的暖色反射。大面 enamel 未安装微图，路径采样噪声不能被称为新漆面纹理                       |
| 金属 | WebGL 与基础 WebGPU 均保留金属和弱方向微纹，未见独立质量跃升；路径追踪的键帽侧壁与暗腔更有层次，128 样本仍有明显颗粒           |
| 分层 | 路径追踪的部件互遮蔽和真实软影能区分悬浮、落地与框体体积；结构姿态由共同控制器决定，不由 renderer 改变                         |
| 平铺 | 路径追踪保留部件高度和柔影，但原共同面积灯也产生较宽软影；图谱式平铺若需更清爽，应独立设计布光，不能偷偷只给一种 renderer 改灯 |

本机 128 样本记录为整机 19.53s、漆面 21.97s、金属 27.60s、分层 16.78s、平铺 16.78s，包含该模式设置/编译/等待和累计，不是 GPU 帧耗时、生产帧率或冷加载总时间。WebGPU 追踪器内部记录约 421 MiB 分配，不能当作浏览器实际显存峰值；WebGL 与 WebGPU 的 info.memory 口径不同，不作直接百分比比较。

为区分采样颗粒与反射收益，另采整机与金属的 1024 样本原图，证据在 `artifacts/renderlab/convergence/`。两张均通过，零页面错误，实际 min=max=avg 1024；整机约 129.90s，金属近景约 198.13s。原始资产、姿态和共同几何摘要与 128 样本批次一致。人工查看确认阴影、壳体边缘层次和暖金互反射仍保留，颗粒明显下降，但不宣称完全无噪或物理真值。静态比较页默认展示这两张高样本结果，同时保留 128 样本原图链接。

## 正式选择与边界

正式交互维持 **Three.js WebGL2＋标准 PBR 微表面＋专属 PMREM 面光源环境＋柔化平面反射＋姿态接触阴影**。这版已完成材质/结构精修及全景、近景、分层检查；原有动作、镜头、标签、管理预览和上下文恢复沿用。没有为选择它而降低画质或缩减资产。

路径追踪已证明静止画面的互反射、遮挡与软影收益；保留作为静止材质、布光和封面质量参考。它当前只在独立验证页运行，尚未实现工作台中“运动时光栅、停下后累计”的自动切换，不宣称已交付动态光追。若要进入工作台，需要验证重采样、动作接管、部件标签、场景恢复和唯一资源归属，不能把累计静帧直接替换连续交互。

基础 WebGPU 不代表 SSGI、SSR 或其他具体增强算法。本轮没有测试这些能力，因此不能得出“WebGPU 永远不如 WebGL”或“WebGPU 自动获得光追”的结论。下一次渲染升级应针对具体 GI/反射方案再比较；当前资产 UV 与材质制作仍是可见短板，不能由更换后端自动补齐。

路径材质实现与光栅 BRDF、环境 PMREM 和纹理 mipmap/atlas 过滤存在差异，所有高光变化不能都解释为 GI。此处没有离线物理真值，也没有整个系统三件等质验收；用户的审美判断仍以原始截图和实际工作台体验为准。

官方技术依据：[Three.js WebGPURenderer](https://threejs.org/manual/pages/webgpurenderer)、[RectAreaLight LTC 初始化](https://threejs.org/docs/pages/RectAreaLight.html)、[three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)。本机锁定 Three 0.185.1、three-gpu-pathtracer 0.0.27；代码与实验记录优先于泛化的版本印象。
