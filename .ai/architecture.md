# 新版目标架构与当前实现

## 图像空间实验（2026-10-16）

`rendering/studio` 只在实时 WebGPU 的显式 `loungeSpatial=box|depth` 参数下启用 `loungeSpatialTable` 厚桌台，并同步平面反射与接触阴影尺寸。`loungeSpatialGeometry` 拥有有限盒体或径向代理的几何和 NodeMaterial，借用 RGB 纹理；`loungeDepth` 校验实际 DA² 512×256 Float32 距离。预测地面经尺度标定拟合桌体底面；跨深度三角形剔除暴露的洞使用原图远盒补底，不能称为遮挡重建。

`loungeSpatialLook` 统一编排投影与 mood 可见性，并在 `box&loungeLayers=1` 下拥有三图资源包和固定家具卡片。`loungeLayerAssets` 独占 Texture／ImageBitmap；`loungeImageLayers` 只拥有派生平面／材质并借纹理。先释放卡片、投影，再释放图片，迟到取消也遵循该顺序。层图不再完整打光；不加额外循环或逐帧响应式状态。

`realtime/signals` 可选 `loungeSpatialDof`：真实 view-Z 与当前商品／实例包围盒确定清晰范围，在线性 HDR 合成后景深，最后一次 ACES／sRGB 与 SMAA。RTT、DOF 自有目标及 r185 遗漏的内部 blur 子节点由受检 owner 释放；不销毁共享 quad 几何或 loader 资源。无参数时保留现有通道。测试工具校验运行清单、模型身份、同输入相机、状态保持和实际模式，不将图像差异计作视觉通过。

## 当前暖夜舞台与原位切换（2026-10-15）

`WorkbenchStage` 的局部环境状态只作用于实时 WebGPU 打字机；`WorkbenchStudioMood` 提供明亮／暖夜入口和加载失败重试。场景通道把环境意图交给既有适配器与 `rendering/studio`，`loungeLook` 管理舞台 NodeMaterial、背景采样及三软箱过渡，不写商品节点、镜头或 Pinia 高频状态。明亮恢复既有舞台；普通 WebGL、hybrid、钢琴／汽车、HTTP API、数据库与 ProductPresentation v1/v2/v3 保持。

`loungeAssets` 是四图的唯一加载通道：固定同源白名单核验字节数、SHA-256 与尺寸，使用显式翻转的 ImageBitmap，Texture.flipY=false；全景／底色为 sRGB，粗糙度／法线为 NoColorSpace。返回包唯一拥有 Texture 与 bitmap，由 `loungeLook` 释放；失败、取消、迟到解码和重复 dispose 各有清理路径，不建全局缓存。`scripts/amber-lounge/build.mjs` 逐字节复制生成 r2 原图，独立生成 512²周期数值微表面图；运行清单与原母版分开保存。

全景仅是 LDR 可见背景，TSL 固定 LOD 3.5 虚化并作接缝／极点采样保护，不是源图修复、真实 DOF 或 HDR 照明重建。Studio Small 05 HDR 保持，三软箱颜色／强度由 `loungeLook` 过渡；地台单块底色不要求平铺，技术法线不读取底色亮度。GSAP 补间约 0.42 秒、暂停式创建，只由已有 `studio.beforeRaster` 时钟推进；快速切换取消旧补间，减弱动态直接到目标。首次暖夜异步读四图，失败保留可操作舞台并可重试，不借切换重建宿主或恢复商品默认状态。

本节是实施边界，实机结果由主代理更新于 [暖夜运行验收](amber-lounge-runtime-validation.md)，不预填通过或性能成绩。下节深灰绿方案保留为此前批次。

## 可见舞台配色与照明隔离（2026-10-15，深灰绿历史）

`studio/palette` 选择可见舞台 light/dark 配色，实时 WebGPU 打字机默认 dark，`studioMood=light` 对照。`rendering/studio` 按 renderer 的已注册实时身份传给 `studioGeometry`，只变天空、地台、地面与派生 traceFloor 颜色；capture 路径强制 light，不改变照明环境。`studioPreset` 同步实际背景／雾色，WebGL 与 hybrid 原值保持。Stage 的 DOM mood 依赖实际后端与商品能力，局部 CSS 只调整暗背景上直接绘制的文字／引线；不改变浅色玻璃面板、不增加 Three 所有者或逐帧响应式状态。配置版本与接口保持。验证见 [暗色舞台](typewriter-dark-studio-validation.md)。

## 当前 WebGPU 接入与反射核调度（2026-10-15）

用户要求工程检查成功后逐项接入实时入口，画质交由本人肉眼判断。`typewriterCandidate` 对显式 `renderPipeline=realtime` 默认选择 v2；`typewriterAsset=v1` 显式保留旧材质。原适配器、包 ID、版本与摘要校验仍限制替换范围，普通 WebGL、其他商品和管理员自定义包不变，不写数据库或修改展示配置版本。

`signedSpatial` 保持原有八个几何引导 tap、半径与 signedDelta 语义，加入像素 IGN 和每个成功完整帧的 golden-angle 核旋转；`reflectionKernel=static` 沿用原固定核用于同输入对照。`reflectionResolve` 在已有 prepare／commit／cancel 通道管理 phase：只有历史目标成功提交后才推进，失败或取消复用 phase。沿用 Three MIT 的 Vogel 核旋转组织思路，不新增 renderer、绘制循环、采样数量或 CPU 像素回读，不修改 Physical 参数。

本批 check、生产构建与 API 启动、真实 WebGPU 两核六取景对照、v2 动作／复原／重复加载及管理取景检查通过，结果集中记入 [WebGPU 接入记录](typewriter-webgpu-rollin-validation.md)。工程成功不等于视觉、实际呈现间隔或 P95 已通过；整体画质待用户评定，实际呈现预算仍待验证，DDGI／FidelityFX／BVH 尚未接入。下方 dated 实现和门槛仅说明其对应历史批次，新接入规则以本节为准。

## 打字机 v2 资源初始接入（2026-10-14，历史入口约定）

用户明确直接推进 v2，覆盖此前节点一的资产制作门槛；旧 SSR 画质状态和默认入口不变。`scripts/typewriter-v2/build.mjs` 在独立目录生成候选 GLB、原动作文件副本、七张共享 2048²线性数据 PNG、manifest 与 production-record；原 v1 不被覆盖。十个缺 UV 表面分为六个 xatlas 展开和四个确定性局部投影，保留已有 UV0；微表面另用按部件面积标定的 UV1。MikkTSpace 生成切线并按 Three 的 glTF 手性约定转换，退化 fallback 仅修正切线 XYZ，不修改源法线或切线 W。接缝拆点允许，三角形位置、法线、节点姿态、语义映射与 rig 必须由独立校验核对。

`typewriterCandidate` 只在显式 `typewriterAsset=v2` 且原 `typewriter-v1` 适配器、包 ID、版本及摘要完全匹配时返回新的源配置副本；不会覆盖自定义后台包。`loadAdapter` 沿用同源清单校验、加载代次、解码、首帧及取消释放通道，记录实际包版本；没有额外 Canvas、renderer 或绘制循环。`typewriterFinishes` 对 `treesFinishVersion=2` 的已制作材质先整体校验后借用原输入，不再生成 v1 的 128²运行图或改写 v2 材质参数。

新贴图、材质和派生几何由现有 loader 唯一拥有；渲染支路只能借用。GLB 文件增长来自 UV／切线和接缝顶点，并保留制作前数据以便核查；不宣称已经完成体积或显存优化。纹理预算是明确的质量成本，实际加载、GPU 资源与画质仍按 [v2 记录](typewriter-v2-validation.md) 验收。下方反射/HDR 段落保留各历史批次的事实，其“不进入候选 v2”已由用户覆盖。

2026-10-14 新候选：reflectionResolve 组合局部 signedSpatial／signedHistory。raw RGB 是 SSR 命中辐射乘捕获权重后减 nativeSingle，miss／unsupported 为零；空间与历史过滤 signed RGB，最终 beauty 加 filteredDelta 乘 correctionWeight，不再减未过滤 nativeSingle。空间 alpha 为 support，历史 alpha 为有效帧数；raw alpha 仍为 ray length。signals.prepare 按尺寸准备，coordinator 在最终 pipeline 成功且无同步 renderer 错误后调用 commitFrame，失败调用 cancelFrame；复制上一帧 delta／depth／normal 与相机矩阵不发生在 updateBefore。材质、SSR、SSGI、透明混合及接口保持；这是有限八 tap 与表面重投影，不等同原官方自适应核／hit-point 历史。详见 [修正验收](typewriter-signed-reflection-validation.md)。

2026-10-14：realtime/ownedRtt 必须显式设置 HalfFloatType；r185 的非空 options 替换 RTTNode 默认参数，不能只设 depthBuffer 后假定仍为 HDR。目标与 quad 材质保持唯一 owner，上游 pass／loader 纹理只借用。新增 scripts/realtime-probe 为一次性验收工具，只在独立测试页面截取生产已有的四路纹理，不增加产品调度器或逐帧 CPU 回读。实际格式、完整帧及迟到代次保护见 [HDR 修复记录](typewriter-hdr-rtt-validation.md)。

## 实时基线阶段记录（2026-10-13，历史）

节点一改动后，`WorkbenchStage` 仍唯一拥有 TresCanvas／renderer，`realtime/coordinator` 与受检时钟拥有唯一实际绘制调度；`sceneInputs` 使用同一 renderer 的两个 pass：不透明 surface 六 MRT（output、normal／roughness、albedo／metalness、motion、baseSpecular、baseDiffuse），完整 HDR beauty 两 MRT（output、correctionThroughput）。两 pass 深度目标独立，不能描述为所有信号共享同一个 G-buffer pass。不透明六附件存储为 40 字节／像素、对齐成本 44 字节／采样点，请求 64 上限不变；完整 beauty 增加一次不透明绘制及约 16 字节／像素（HDR 色、RGBA8 transmittance 与深度），需实测其成本，不改输出尺寸或源贴图。

源 GLB 的 51 个字符／铭牌贴片直接沿用 loader 材质身份、原贴图 alpha 与 alphaTest=0，不再克隆低阈值裁剪。surface pass 排除透明绘制；完整 beauty 保留透明层与舞台叠层。`correctionThroughput` 的 alpha 使用实际 opacity，通过材质混合累计剩余 transmittance；其 RGB／R 成为 `correctionWeight`，最终为 `beauty + (specularCorrection + diffuseCorrection) × correctionWeight`。这样底层照明增强按前方透明遮挡衰减，不能把 roughness／清漆捕获 alpha 误当 opacity。两 pass／深度由 sceneInputs 唯一释放，runtime Physical 材质仅用于支持的源支路，不释放 loader 源材质与纹理。

实时参考环境通过可中止同源请求加载 Studio Small 05，校验 1,723,695 字节与 SHA-256 `358d532ee8233f17499830eb512591c1e308ce16ed181e0efc938cb7f0f0e11f`；环境强度 0.35、曝光 1。三个既有 RectAreaLight 软箱保持，ambient=0.16，两盏 Directional=0；WebGL 原环境强度 0.9、两盏 Directional=0.75／0.35 不变。商品、地台和线性天空在 HDR beauty 中合成，最终仅一次 ACES／sRGB 后进入 SMAA。WebGL 的天空／叠层顺序不同，不以相同曝光冒充全管线像素等效。

真实 GPU 原始地台反射 probe 的高亮峰值从 16376 降至 9.4140625；隐藏接触阴影或已知字符贴片时仍为 16376，只有隐藏两盏 Directional 的对照降低峰值，支持方向补光是地台极亮点来源的诊断。未借用扩大模糊、能量 clamp 或降低各向异性掩盖问题。校准后六取景已无原先极亮白块，漆面 SSR 颗粒仍明显，分层／平铺没有明确整体画质收益；该结果不证明文字细边、整体质感或呈现预算通过。

当前节点一 check（385 单测＋48 工具测试）、build、`demo:prepare` 与 `demo:start` 通过；生产六取景的 2 项契约、核心 4 项、管理取景 2 项、故障恢复 4 项检查通过，均使用真实 API、原 GLB 与原生 WebGPU。六组图保留相同资产、源 PBR、姿态、物理相机及三个软箱，但两后端环境与 Directional 强度有意不同，不作为匹配布光的算法消融。故障批次覆盖真实模型 503、受控 renderer.onError 的暂停／同 renderer 重试，以及实际 GPUDevice.destroy 后先释放旧宿主再恢复唯一 Canvas 和检查点；受控回调仅证明集成，不冒充原生 GPU 校验故障。核心真实隐藏未观察到 hidden，未替换合成可见性；本轮 30 次重载与 20 分钟操作未重跑。`fullJointAcceptance=false`、`frameBudgetValidated=false`；完整画质与本人走查未通过，默认 WebGL 保持，不进入 DDGI／FFX／BVH 或候选 v2。详见 [节点一验收](typewriter-quality-node1-validation.md)。

### 2026-10-13 节点一之前的统一 resolve 记录（历史）

以下为本次双 pass／参考 HDR／补光改动之前的实现与测试；保留来源，但其中“当前”只指该历史批次。30 次重载、20 分钟操作、管理及生产图不能替代节点一新实现的验收。

`?renderPipeline=realtime` 仅为 `typewriter-v1` 装配 WebGPU 实验宿主，钢琴／汽车继续原 WebGL。`WorkbenchStage` 的唯一 TresCanvas 仍拥有 renderer；`useWorkbenchScene` 处理商品代次、加载、首帧就绪与管理预览，`rendering/realtime/coordinator` 统一调度舞台辅助 draw、共享 G-buffer、SSR、SSGI、内置过滤和最终呈现。renderer 工厂为该 G-buffer 的 44 字节对齐附件成本明确请求 64 字节上限；不支持设备通过完整宿主卸载进入兼容后端，不叠加 Canvas。

`realtime/clock` 是固定 Three 0.185.1 的受检时钟桥接，Tres 拥有唯一实际绘制时钟；`realtime/motion` 记录完整投影、世界和实例矩阵，最终呈现成功后才提交一次 previous，辅助 draw 不提前更新运动历史。`realtime/materials` 借用源贴图并拥有运行 Physical NodeMaterial，通过 r185 DFGLUT 捕获原生环境辐射的单次散射项，乘原生镜面 AO 和清漆透过权重；不再捕获后直接减掉完整间接镜面。非默认 IOR／specular 参数或贴图、独立 envMap、各向异性／透射等未支持支路保留原生。

`realtime/signals` 的 SSR 只提供屏幕空间命中辐射，环境强度设为零，但保留上游所需 HDR 节点依赖；未命中不再用随机 HDR 采样覆盖稳定原生 PMREM。当前 `realtime/reflectionResolve` 根据原始 SSR ray length，在过滤前逐射线组合：命中为 `rawSSR × AOcoat`，未命中为捕获的 `nativeSingle`，未支持像素为零；同一个 RGB＋ray length 信号统一进入时域重投影与 RecurrentDenoise。最终为 `beauty + filteredReplacement − nativeSingle`，未支持像素不应用修正，保留原生多次散射与清漆，不回馈完整替换到已有 IBL 的 beauty。

此前 `reflectionCoverage` 分别过滤反射颜色与覆盖概率，但两个信号受不同的亮度相关非线性权重影响，不能确保互相抵消匹配的原生环境贡献；半径 5 的校准后仍有明显点噪，画质未通过，已移除这条独立 coverage 支路。它及相应生产图是历史试验，不描述当前实现；当前统一 resolve 已通过四项生产核心与六组公平对照契约，仍未证明全面优于 WebGL。过滤后的 alpha 仍不能当作原始 ray length 判断命中。

`realtime/signals` 的 packed normal／roughness 为 RGBA HalfFloat，roughness 读取原生导数调整后的值；albedo／metalness 保留 RGBA8，base diffuse 改为 RGBA HalfFloat、alpha 保存独立清漆透过权重。六附件存储合计 40 字节／像素，对齐验证成本仍为 44 字节／采样点。SSR 固定 quality 1、thickness 0.035、完整输出比例 1；这些是待画质验证的当前参数，不是已经证明的改善结论。

原摄影棚地台平面反射继续复用唯一 renderer 的离屏目标；它采用原生 Basic 材质、增强捕获权重为零，排除 SSR 基础镜面替换，保留屏幕外整机反射。SSR 负责受支持商品表面的局部反射。不能为了“只用 SSR”删除已有舞台效果而降低整体完成度；画质优先于技术支路数量。

当前两个后端的呈现顺序并不等效：实时 WebGPU 全幅 ACES 包括原 `toneMapped: false` 天空盒，WebGL 天空盒只做输出颜色空间转换；原 WebGL 地台先色调映射后叠层，实时支路先 HDR 混合后 ACES。只读核查确认这些差异，但没有证明白点或完整倒影缺失的根因。当前代码冻结，后续先分离检查固定取景的原始反射纹理与最终合成，不盲调强度或修改 Three。

SSGI 是已着色 beauty 的屏幕空间估计，含官方亮度 7 的限制，不是已物理标定的 irradiance。当前打字机透明材质为字符／铭牌贴片，键帽本体不透明；受控贴片的运行克隆采用低 alphaTest 丢弃透明孔，未宣称完整通用透明 G-buffer 已验收。源几何与原尺寸贴图继续由 loader 拥有。API／配置版本保持不变。

`realtime/ownedRtt` 显式拥有表达式转换所需的 RTT 目标与 quad 材质，替换和卸载时释放；不释放上游 pass、借用纹理或模块共享 QuadMesh geometry。`rendering/environmentPMREM` 固定核查 r185 的 EnvironmentNode 缓存／PMREMNode 所有权：源环境纹理 dispose 触发原生输出目标释放，随后只释放节点生成器的 LOD 几何／材质与 ping-pong 目标并移除缓存。两处桥接均须版本与形状检查，不作为 Three 稳定公开 API；释放修复仍需实际重复加载验证。

`realtime/geometryOwnership` 固定核查 r185 原生 geometry／attribute 管理器，补齐共享 geometry 在多个 RenderObject 中使用时，原生只清理首个 RenderObject attribute 的缺口。桥接汇总实际绘制使用的 GPU attribute，包括节点生成的实例 attribute；按底层 backing 引用记录处理交错 view，最后一个活跃 geometry 释放后才销毁 GPU backing。loader 仍唯一决定源 geometry 的 dispose，桥接不提前释放或改写源数据。`useWorkbenchScene` 局部持有桥接，先销毁协调器，再释放 controller／环境，最后卸载桥接并恢复原生方法；它不改变整个 Three 原型。8 项真实模块机制测试与 radius 1.25 版本的 30 次实机重载已通过，不替代新画质参数检查。

当前统一替换信号的 RecurrentDenoise 半径为 5，不再维护独立 coverage 过滤器或该支路的 flickerSuppression=0 参数。实时舞台叠层在 HDR 中先混合再经 ACES，与原 WebGL 的显示空间混合不同，因此仅实时支路的反射 strength／接触阴影 opacity 保留 0.5／0.68；旧 hybrid／WebGL 保持 0.28／0.46。此为舞台视觉校准，不假定 BRDF 或两个后端像素等效。统一 resolve 的 check（70 文件／375 单测＋48 工具测试）与生产准备通过，已采集六组图，完整质量和最新生命周期联合检查仍待验收。

当前统一 resolve 的核心、六组公平对照契约、管理取景、故障恢复、尺寸兼容及实际 20 分钟操作通过，后者同根节点／宿主完成 52 正式循环，固定预热资源差异为零。check 与 demo:prepare 通过；503 并行取消只在严格窗口且真实同宿主恢复后分类，受控回调与实际 GPUDevice.destroy 分别记录。三轮 JS 提交测量不代表 GPU／实际呈现帧预算。新生产静图仍有前罩噪点、文字颗粒、地台倒影不足，画质未通过；当前 30 次真实重载及默认 WebGL 五项操作回归已通过；真实隐藏因本机环境未暴露 hidden 仍待验收，本人走查待完成，旧 coverage 版重载不替代新链。不以工程成功或提交计时代替图像质量，不扩 DDGI／动作调度／FFX／BVH。详见 [实时渲染验收](realtime-rendering-validation.md)。下方自动光栅／静止追踪与 OIDN 是 hybrid 历史实现，不适用于实时入口。

2026-10-12 混合管线实施：WorkbenchStage 按需注入 Tres renderer 工厂，useWorkbenchScene 承担共享宿主生命周期，rendering/coordinator 管理同一 WebGPURenderer 的光栅、采样与完整 OIDN 融合。协调器与独立比较器各在生命周期内复用一个引导 MRT 节点，避免 Three 按 MRT 身份不断保留渲染程序。主动 1024 续算将实际累积原图写入呈现目标，覆盖此前完整降噪图；128 仍只呈现完整降噪结果。Pinia、HTTP 与配置版本不变；WebGL 默认保留，设备重建需先卸载旧宿主。当前只完成打字机，钢琴／汽车另行规划。资源所有权与阶段状态见 [混合管线验收](hybrid-pipeline-validation.md)。

2026-10-08。目标以官方模板终稿及 workbench-contract.md 为准。本文明确区分已有候选与待实现设计；旧说明见 history/2026-10-08-before-restart/architecture.md。

## 分层

工作台UI管理目录、工具、单活动面板与反馈。展示配置描述资源、能力、镜头、热点、外观、动作与导览。场景适配器管理加载、节点/材质绑定、动作与释放。商品差异通过配置和注册行为表达，不按名称复制页面。

App仅组装页面，按pathname异步装配/admin管理端，原访客/legacy路由保留。访客工作台默认打字机（2026-10-09 用户调整）；管理预览复用WorkbenchStage/Panel/Tools，进入管理列表不挂场景，关闭预览卸载宿主。旧LegacyExperience仅为候选与历史入口，旧商品不能自动算入新项目正式目录。

## 当前前端候选

- WorkbenchRoot/Catalog/Panel/Tools：导航、目录、能力面板、镜头工具与URL历史。
- WorkbenchStage：唯一TresCanvas、DOM热点、状态覆盖层、局部键盘观察和上下文恢复。恢复Scene，不重复创建renderer。WebGL2探测使用离屏临时上下文并立即释放，不创建renderer；不支持或初始化失败时不挂载Canvas，WorkbenchFallback保留真实商品图文和目录，状态content区别于ready。
- WorkbenchScene：环境目标、首帧编译、可见性与监听器。
- stores/workbench：配置、UI状态与操作意图；Three与高频数据留在场景局部。
- controller：OrbitControls、拾取、相机/动作GSAP。手动观察立即接管，面板滚轮隔离；卸载先杀动画再释放。
- latest/ResourceSlot：API和适配器递增代次、取消、旧失败隔离、迟到释放。
- loadAdapter/glbLoader/glbAdapter：程序化与GLB统一接口；按需decoder，资源和部分解析结果去重释放，环境目标有唯一所有者。
- ProductPresentation v1/v2/v3：v3复用已有资源/舞台并增加进度动作、局部锚点与结构动作引用。源类型、舞台和manifest机制不要求建立后台资源平台。

阶段B已复核共同流程。v3进度动作由motionConfig执行契约/通道校验，motionPose加载时记录初始局部位置和四元数，按轨道区间从基准计算位移或旋转，旋转单段不超过180°。motionPlayback仅用GSAP补间进度，不让旧动作覆盖受控通道。程序化和GLB适配器共用此核心；节点组/任意动画片段仍未实现。

WorkbenchRoot提供局部motionSession，记录数字反馈和上下文恢复检查点，不放Three对象。播放反馈限15Hz；手动定位、暂停、完成即时反馈。Pinia仅保存motionCommand操作意图，不保存实时播放进度。控制器拥有补间，卸载前杀掉并发布暂停状态；商品代次不符的反馈被拒绝。切换商品清空检查点，上下文恢复重载当前商品并在同一进度暂停。

热点可配置anchor局部坐标；adapter.point在当前世界变换下转换，再用于投影与聚焦，父子节点分层后仍对应。旧配置缺anchor时沿用节点原点。音箱structureActionId将旧结构意图映射至explore-layers，不再叠加原布尔分离；旋钮仍独立旋转。汽车open-doors拥有双门旋转，旧分离拥有位移，组合互不覆盖。

## 状态与资源

### 汽车注册适配器（2026-10-10）

`reventon-v1` 复用 `loadBundle/decodeGlb/bindGlb` 与 v3 轨道控制器。源运动采样在制作脚本中提取为两条门旋转轨道和七条分离位移轨道；运行时不请求 motion.json，也不导入旧导演相机。初始局部姿态与四元数为唯一计算基准，旋转与位移通道组合，热点局部锚点跟随当前世界变换。

SceneAdapter 新增可选 attach/beforeRender：控制器把商品灯光与实时接触阴影挂到同一场景，WorkbenchScene 的原时钟仅在真正渲染前调用。汽车适配器拥有两盏 RectAreaLight、两张阴影目标与辅助几何，卸载时先移除并释放；loader 唯一拥有源几何/材质/纹理，loadAdapter 拥有 EXR PMREM。相机、controls 和 renderer 仍由共同工作台拥有。阴影只在部件姿态改变时重绘。

纹理解析采用三任务队列：每张原图解码完成后及时撤销临时 Blob URL 并释放压缩字节引用，避免 1.7 GB 图片同时占用浏览器 Blob 存储。重复源图克隆 Texture 但共用已解码图像，部分失败/迟到结果仍由 ownedResources 去重释放。外部图像按 glTF 约定保留原始行方向；ImageBitmap 中不能预先 flipY，后续 Texture.flipY=false 无法撤销位图内的翻转。汽车专属表面修正只更改已识别绒面底色和透明装饰贴片渲染参数；不复制资源，去掉的底色纹理仍由 loader 的 ownedResources 释放。不改变像素尺寸、格式或几何。进度反馈只拷贝 progress/target/playing 三个数字/布尔字段，防止 GSAP 缓存进入界面与恢复检查点。

资源清单是按字节校验的不可变运行文件，不参与全局格式重写。制作脚本在计算摘要前使用项目格式；管理修复脚本只在全部资源字节核验通过后更新已有清单摘要，保留商品与自定义配置并备份，不放松摘要校验。

### 统一拆解引线标签（2026-10-09）

WorkbenchStage 按配置选取最多12个重点热点并优先保留当前选中项，统一挂载 WorkbenchCallouts。controller.project 读取实际 adapter.pose 的结构/持续动作状态，按节点当前世界变换提供屏幕锚点和显隐依据；恢复后的非重点选中项由工作台业务选择传入，不依赖已清空的局部聚焦状态。

calloutOverlay 只管理DOM/SVG、ResizeObserver与GSAP：拆开渐显、合拢淡出，布局避开标题/工具和紧凑部件中心；calloutLayout确定性分配位置与容量，calloutTransition检查移动轨迹。安全路径平滑移动，相交路径冻结淡出、等旧标签释放占位后重定位并渐显。标签与引线始终采用当前屏幕锚点和实际标签位置，淡出立即取消指针/键盘入口。短暂过渡使用局部GSAP时钟，不额外请求WebGL渲染；静止收敛后注销ticker，页面隐藏及卸载清理监听、观察器和补间。

标签位置、透明度与避让状态不进入Pinia，不持有Three对象，不改变公共API或配置版本。商品代次、ready状态与上下文恢复沿用原场景生命周期；当前统一工作台商品及管理预览共用此层，legacy独立页面保持历史实现。证据见 callout-validation.md。

### 打字机注册适配器（2026-10-09）

typewriter-v1 继续通过 loadBundle/decodeGlb 下载和验证清单；572 个稳定 part-* 节点留在已解码 GLB。motion.program 只允许注册的 typewriter-layout-v1 + 同包 motion 文件，不能与 tracks 同时存在；typewriter-strike 只接受有效按键索引。前后端同步校验，v1/v2 和原 v3 tracks 不自动升级，公开 API 与数据库结构不变。

typewriterRig 从每个部件记录的初始/展开/平铺姿态确定性计算位置与四元数；GSAP 仍只补间统一 progress 或 strike 变量，相机独立。2026-10-11 修正两盖板的分层 Z 路径和十个大件的平铺空间避让，源几何、初始姿态及最终平铺端点保留，不能再将中间过程描述为完全照搬原路径。typewriterInstances 把共享几何/材质重新批处理为 InstancedMesh，但保留逻辑节点、instanceId 到部件的拾取映射及世界锚点；每帧只更新已分配矩阵，不重建几何。适配器拥有实例缓冲，loader 唯一拥有源 geometry/material/texture，PMREM 由 loadAdapter 释放。选择使用实例颜色，不破坏用户外壳配色。材质微表面现使用标准 PBR 贴图通道，新增贴图另由 typewriterMicroMaps 唯一管理。

WorkbenchParts 维护局部检索/分组/分页；完整 572 标识仍可选，舞台仅展示当前选中或细节面板的八个重点标记。WorkbenchLayoutMotion 采用整机/分层/平铺按钮，访客不常驻百分比滑块；同一控制核心仍支持连续定位、暂停、回退、复原及上下文恢复。源页面的滚动导演、renderer、相机与 DOM 未迁入。

配置读取、资源下载、解析、材质准备、首帧、ready/error均绑定商品和选择代次。首帧后开放操作，失败重试、不回退假模型。相机与动作分开；复位视角、全景与还原商品语义见契约。动作/分层由基准TRS组合，多个行为不累积覆盖。减弱动态直接完成；页面隐藏暂停非必要活动。

几何、材质、纹理、skeleton、ImageBitmap、decoder、控制器、GSAP、PMREM和监听器均明确释放。稳定AO/表面烘焙可以保留，不能把开门后变化的阴影永久烘死。源/运行资产分开，质量对照后决定压缩，不称KTX2无损。

## 目标后端

Spring Boot单体：Controller处理DTO/校验，Service处理上下架、配置/分类约束与事务，Repository持久化。单管理员Session认证、密码散列、CSRF，同源/api。Java17、Boot4.1.1、JPA、Flyway、MySQL继续锁定现有版本；端口5181/8089。

四类数据：管理员、分类、商品、展示配置。商品关联分类，配置商品一对一。结构版本与基本并发版本分开；配置保存校验、版本冲突返回明确错误。公开只读上架内容，管理员可编辑/预览下架商品。无独立草稿、发布快照或回滚平台。

模型/贴图/封面由开发者管理静态文件，业务记录保存同源资源引用和来源说明。开发工具manifest/来源/摘要可继续使用。正式三件统一GLB，程序化模型为原型/回归。当前会话使用该次配置，更新后重新加载读取新值。

## 阶段D实际实现

SecurityConfig使用Spring Security表单认证端点、Session及默认XOR CSRF。SPA每次写入前GET masked token，登录后的token重新获取；认证401和CSRF403展示重新登录并保留编辑器。演示默认admin/123456，可通过本地环境覆盖；管理员表持久化BCrypt(12)散列，正常重启不修改账号。仅显式设置TREES_ADMIN_RESET=true时事务替换单管理员，配置或散列失败不得先删除旧账号；不持久化重置开关。默认本机HTTP、HttpOnly/SameSite=Strict会话cookie，路径/api，30分钟过期。

AdminProductService事务保存基本信息和受校验的配置；产品revision为JPA乐观锁，配置变动同时更新商品updatedAt，因此配置与上下架共享冲突边界。类别更名同步商品旧category字符串并提升受影响产品版本；category_id外键为关系真值。公开只读过滤listed，下架详情404。保留公开数组列表契约，当前三件目录不引入分页；无运行时数据库代码、上传或快照执行。

AdminRoot/Login/Products/ProductEditor/ConfigEditor/Categories/Preview职责分开；预览POST只验证并返回规范ProductDto，随后调用store.preview安装局部配置；取消公开读取，重试仍使用该预览配置，首帧和释放沿用原代次协议。节点/材质是否实际存在在加载预览时核验，服务端契约通过不能替代资产验收。

写入前无静默自动重试。未保存导航有丢弃提示，会话过期后重新登录保留当前编辑内容。当前不含可视化节点选取、独立草稿/发布快照或上传。

V6追加管理员/分类实体及listed/revision/updatedAt/category_id，沿用原utf8mb4_unicode_ci。现有商品保持上架，slug/封面/展示配置不修改，V1—V5不改。公开过滤与管理读取分开，真实MySQL重启、安全与迁移验收见admin-validation.md。

## 阶段D2编辑草稿与取景

src/lib/admin/productDraft是编辑器局部真值，通过provide/inject传给各表单，不借用Pinia场景状态。item/presentation与JSON缓冲分别管理；JSON显式应用经过完整parseProduct，未应用文本阻止保存/预览。数字字段保留原始空字符串，不写零；分区用v-show保留输入，删除字段销毁自身缓冲。保存成功用服务端返回的配置与revision建立新基线；失败/冲突/重新登录不替换草稿。editor负责标识、引用保护、字段错误定位及镜头回填，Common表单只写自身可编辑字段，不升级结构版本。

AdminPreview提供局部cameraCaptureSession。WorkbenchScene注册按需数字快照读取器，controller读取实际camera.position/OrbitControls.target前退出导览并暂停镜头、动作和进度补间。右键平移只由此局部会话启用，访客默认关闭。快照仅含slug、选择代次和两个Vec3；当前商品、代次、首帧就绪与页面可见全部匹配才接受。恢复场景替换读取器，旧注销不清除新读取器；退出或失效时清空桥接再卸载场景。没有逐帧相机响应式同步，没有新增renderer。

默认回填同步camera和perspective视角，其他回填只改命名视角，缩放范围/外观/运动不改。回填仅更新编辑草稿，手动保存才持久化。API及v1/v2/v3契约不变，本阶段无Flyway迁移；详细检查见admin-usability-validation.md。

## 方案 C 访客界面（2026-10-11）

WorkbenchRoot 的 `wb-floating` 只装配访客全幅舞台、WorkbenchRail、单目录/操作面板与 WorkbenchTools。`workbench-floating.css` 限定在该 class，管理端、管理预览和 legacy 保留原布局与基础主题。快速栏通过真实公开 API 独立读取完整目录，不借用目录抽屉的筛选结果；未就绪仍使用现有首帧门禁，不给 UI 补假资源。

`interfaceMotion` 唯一拥有面板/介绍的 Vue Transition 补间；快速切换先取消旧补间，离场立即设置 inert。同一面板内工具切换立即更新内容并执行 0.22 秒进入补间，不设置嵌套 out-in 等待。Root 管理入口与关闭焦点，Tools 只拥有导航指示块补间。两者卸载清理 GSAP 与 resize/键盘监听。滚轮仍由实际命中的场景或面板处理，产品动作与导览继续沿用现有优先级与生命周期。

`viewportFraming` 在现有 PerspectiveCamera 上维护 zoom/viewOffset，只调整可用观察区域的投影构图，不写 camera.position 或 OrbitControls.target。面板改变时用 0.32 秒 GSAP 横向插值并 invalidate，zoom 只随视口尺寸计算，不因为面板开关缩小商品；尺寸变化与减弱动态直接到目标，不创建 renderer、controls 或额外 RAF。Scene 唯一释放构图补间；热点从更新后的真实投影计算。管理预览仍读取实际位置/观察目标，未接入访客浮动面板策略。

引线标签障碍从访客 Root 收集，纳入快速栏、浮动面板和顶栏；MutationObserver 发现相关 DOM 挂载/卸载后重新收集，ResizeObserver 跟随实际尺寸，不把已移除障碍永久保留。观察器只服务 DOM 布局，卸载全部断开；管理预览继续沿用其原布局范围。

访客 stage 只覆盖浅灰背景与地面色；商品曝光、照明、环境强度、几何/PBR、适配器和资源所有权沿用原配置。未增加墙窗、天空贴图、展厅 HDR 或物理地台。本轮 API、v1/v2/v3 和数据库不变，验收范围见 ui-c-validation.md。

## 验证

### 打字机摄影棚与有限击发（2026-10-11）

`studioPreset` 根据已注册的 `typewriter-v1` 展示源选择摄影棚照明，不按商品名称复制场景。`WorkbenchLighting` 保持共用光源装配，打字机隐藏旧平面地面，其他商品保持原灯光/地面。`studio/` 分为设计、几何、反射、接触阴影和装配；模型、相机与 v3 动作核心不迁入其中。管理预览使用同一舞台，取景回填仍只保存相机数字。

适配器拥有实体圆角地台、地面、无缝天空盒、面光源库引用、一个反射目标和两个阴影目标。`studio/backdrop` 使用六面 BackSide box 与方向渐变，投影去除相机平移并落到远平面，不新增背景贴图或逐帧同步。地面远处透明渐退，不展示有限布景边缘；原墙窗与可见软箱已移除。反射复用唯一 renderer 的离屏渲染；接触阴影仅在姿态变化后刷新。

`createStudioCaptureGeometry` 独立生成临时 PMREM 场景，三块 HDR 软箱沿用面光源布局，但不挂入主场景。临时天空盒/地台/地面/灯板与面光源由环境构建方释放，返回目标由 loadAdapter 唯一释放；主舞台的背景、几何与材质另行唯一释放。实例化、源 geometry/material/texture 的所有权沿用原通道；卸载先移除舞台再释放实例与源资源。默认镜头变化通过真实展示配置及生成器表达，不使用运行时隐式覆盖，管理预览、实际取景回填与前台复位继续使用同一配置。

`typewriterFinishes` 复用已有 Physical 材质的清漆/各向异性，已移除早期微表面的 onBeforeCompile 噪纹；UV 完整的漆面及金属使用 typewriterMicroMaps 一次生成的确定性 128² normalMap/roughnessMap。源贴图、贴花、材质身份与配色保留；混合 UV 的 enamel/steel 仅调整标准参数，不偷偷生成 UV。每种微表面在同一模型内共用两张线性、可重复、带 mipmap 的 DataTexture；重复 apply 不分配新图。新增图由材质 dispose 监听递减引用，最后一个引用释放一次；loader 的 ownedResources 只继续拥有加载时的源图，不承担这些后加贴图。材质参数和贴图本身可供后续渲染对比复用，不代表所有引擎的 BRDF 特性已经等价。

`studio/contactShadow` 仍用当前姿态深度投影和两次模糊，按 dirty 标志刷新；两个 1024² 目标改 HalfFloat，接收平面与正交投影尺寸一致，收紧模糊并减轻高处部件阴影，不改变地台或相机。这是接触阴影近似，不是实时全局光照。

`typewriterRig` 保留有限 0.35 rad 击发与键帽/杠杆联动。分层对后挡板 part-095 和前罩 part-097 加确定性 Z 避让；平铺对十个大件采用错开的横移、转向及下降区间，仍从源基准姿态计算，不使用逐帧碰撞求解或累积位移。真实 GLB 三角面测试覆盖指定部件与抽样进度；初始及平铺端点保持。未声明全 572 部件连续无碰撞，也未声明工厂机械精度。生产确认通过 10 组检查、35 张截图和零浏览器错误；本轮事实与范围见 typewriter-quality-validation.md。

### 独立渲染比较（2026-10-12，混合管线接入前的对照）

`renderlab.html` 为独立多页入口，`src/lib/renderlab` 分离共同设置、场景、后端与页面状态。每页仅创建一个真实 WebGL2 或 WebGPU renderer，不使用第二个工作台 Canvas；切换模式卸载旧页面，资源与时钟由该页唯一释放。工作台仍由 TresCanvas 创建 renderer，不导入实验场景；后续混合入口使用独立的共享渲染协调器按需载入追踪器。比较读取现有同源资产，不改 API、商品配置、数据库或 Pinia。

三个模式复用同一 GLB、姿态、标准 PBR 输入、相机投影、HDR 与面积灯。实验统一移除生产 Reflector、接触阴影 shader、天空盒/地面渐退及专属 PMREM 捕获，不能把实验光栅截图当作现有增强生产画面。后端校验实际 GPUDevice 并拒绝 fallback；路径模式锁定镜头，实际样本达到目标后停钟。光栅按需渲染；隐藏暂停，关闭释放控制器、目标、几何、材质和纹理，无生产逐帧监测。

当时五取景三模式的 15 图检查与整机/金属各 1024 样本补测通过，路径追踪仅为静止材质与布光参考。随后打字机已接入工作台混合入口，默认仍保持增强 WebGL2；接入与当前验收以 hybrid-pipeline-validation.md 为准。基础 WebGPU、SSGI/SSR、完整 GI 方案不能混为一谈；该次比较仅覆盖已实现后端。BRDF、PMREM 与纹理过滤存在差异，缺 UV 的漆面也未补图。历史输入、原图和结论见 render-pipeline-comparison.md。

OrbitControls 的 change 事件通过无参数回调调用 Tres invalidate，避免事件对象污染按需渲染帧数；卸载注销同一回调。`controller.test.ts` 在空闲帧验证真实控件事件、数字帧数与注销行为。详见 typewriter-studio-validation.md。

### 本机交付与联合验收（E1）

scripts/demo.mjs 只编排诊断、准备、生产启动和停止；scripts/demo/ 分离配置、资源摘要、进程身份、控制锁和真实就绪检查。Java 直接运行指定 JAR，Node 直接运行本地 Vite 生产预览，固定本机端口。控制状态和日志位于忽略目录，不保存数据库密码；停止依据 PID、启动时间、可执行路径、完整命令和运行标识，拒绝结束外部进程。演示过程不调用 Maven 或安装依赖。

数据库交付脚本只读正式库备份，隔离恢复限定 trees_x_restore_test，拒绝非空目标与会切换数据库的 SQL；恢复后核对全部表、列、结构与行摘要。运行资源另有清单，SQL 不能替代模型文件备份。HTTP API、结构版本与数据库迁移均未增加。

联合与帧间隔采集只存在测试浏览器：实际 Three 节点、变换、热点和资源释放证明身份/生命周期，生产构建另外检查真实画面和操作。生产组件不增加持续遥测。联合预检发现钢琴21个LineSegments最终材质漏释放，loader的唯一资源收集方扩展到Line/Points，实际glTF解析回归覆盖迟到结果和重复释放。

### 钢琴注册适配器（2026-10-09）

`piano-v1` 沿用 loadBundle/decodeGlb 的清单、摘要、取消与首帧协议，decodeGlb 同时返回动画片段。仅允许 v3 配置绑定一个 `piano-sound-path-v1` 程序，结构 ID 必须一致；不能混入任意轨道、旧动作或 explosion。前后端同时验证，API 与数据库结构不变。

`pianoRig` 验证823语义节点、表面映射与透明度曲线；原生 AnimationMixer 定位 `piano-sound-path`，覆盖位移、四元数、缩放与34个形变网格。透明度和可见性独立采样，同一进度可正反向重复定位。热点按可见 section/flat 表面的预计算局部边界转换，拾取回到稳定语义节点；高亮保存并恢复材质状态。loader 唯一释放原 geometry/material/texture，适配器解绑 mixer，loadAdapter 拥有专属 PMREM，控制器拥有 GSAP/相机/监听。环境临时场景只释放一次。

`WorkbenchPianoMotion` 提供八个具名章节、暂停/继续/复原和独立章节取景；不复制 Canvas、相机或源页面 DOM。关闭面板保留状态、观察接管暂停动作，隐藏与恢复保持暂停检查点。暖白舞台与深色工具继承已有体系；部件聚焦时收起舞台介绍，顶栏保留商品身份。Tailwind 扫描限制为 src，避免导入大 GLB 时开发工具误扫资产。

本地check/build、契约/生命周期和真实API浏览器测试；正式模型单独测量。后台阶段另加授权、CSRF、冲突、分类约束、上下架和配置更新。主桌面三个尺寸，移动基础兼容。拟6—8人形成性任务测试，手势不进入核心完成条件。

新路线见 implementation-roadmap.md。历史旧测试只说明过去特定构建，不直接证明新版质量或安全。
