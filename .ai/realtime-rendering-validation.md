# 打字机实时组合渲染：阶段 1 证据与技术归因

更新于 2026-10-13。当前只实施 **打字机实时基线**：Three.js WebGPU 光栅、随机 SSR、SSGI、内置重投影与降噪。统一 resolve 的核心、六组公平对照契约、管理取景、故障恢复、尺寸兼容、实际 20 分钟操作及 30 次真实重载通过。新生产截图仍有前罩噪点、文字颗粒和地台倒影不足，**画质未通过**；三轮提交计时不是实际 GPU／屏幕呈现帧间隔。真实隐藏因当前环境未暴露 hidden 仍待验收，本人走查待完成；不称全部生命周期通过，旧 coverage 版记录保留历史，默认保持 WebGL，DDGI／FFX／BVH 不扩展。

当前源码采用 `reflectionResolve`：在每条射线进入过滤前，命中使用 `rawSSR × AOcoat`、未命中使用捕获的 `nativeSingle`，将同一 RGB＋ray length 替换信号统一重投影和过滤，再以 `beauty + filteredReplacement − nativeSingle` 合成，保留原生多次散射、清漆和未支持支路。六附件仍为 40 字节存储，当前四项生产核心与六组公平对照契约已通过，仍未证明整体画质超过 WebGL。`core-hit-preserved-final`／`quality-hit-preserved`／`long-hit-preserved-final` 是此前独立 coverage 机制，不替代当前结果。

此前集中修正将镜面／coverage 半径同步为 5、coverage flickerSuppression 为 0，取得 `quality-calibrated-final` 公平对照契约，但画面仍有明显点噪，质量未通过。随后定位到颜色与 coverage 各自的亮度相关非线性过滤权重不同，不能抵消匹配的原生贡献；当前已移除 `reflectionCoverage`，改为统一 resolve 信号、过滤半径 5。舞台 HDR 视觉校准 strength 0.5／shadow opacity 0.68 保留，不把历史参数或工程 PASS 写成当前画质通过。

用户最新要求以**整体渲染质量为唯一核心优先级**。当前新增 SSR／SSGI 的画质收益仍是**未通过的阻断项**：先保留当前摄影棚、地台反射和材质的完成度，再完成同资产、同取景、同曝光的原 WebGL／实时组合／静止路径参考对照，核对文字、漆面、金属、接触与分层。无收益或退步支路应修正、排除或保留原效果，不因技术更新而晋级。初始提交计时与像素差不能代替这项判断，也不为追求成绩暗降分辨率或画质。

## 入口与范围

- 实验工作台：`?product=typewriter-study&renderPipeline=realtime`。当前 `core-resolved-final`／`quality-resolved-final`／`admin-resolved-final` 及 `faults-resolved-verified`／`visual-resolved-verified`／`performance-resolved-verified` 检查同一 5181 生产构建；初次 core 的开发端口 5183 与旧 hit-preserved 批次另作历史记录，不代表当前完整验收。
- 现有增强 WebGL 仍为普通首页与 `?renderPipeline=webgl` 对照；不支持新宿主的设备明确显示兼容状态。
- 打字机沿用真实 GLB、572 个语义部件、298 个实例批次网格、2257 个实例及 1,257,132 三角面。源几何、原尺寸贴图、UV、源材质与动作文件仍由既有 loader／适配器拥有，没有通过减面、缩图或预渲染影片替换模型。
- 用户旋转、缩放、敲键与结构变化时继续绘制当前真实姿态。此入口不等待 128 样本，不调用 OIDN，也不提供静止精修流程；旧 `hybrid` 与独立路径追踪页保留作历史／参考。
- 钢琴与汽车继续原管线。本轮不新增资源上传、手势、数据库迁移、配置版本或 CI。

## 技术组织与适用边界

### 唯一宿主、时钟与运动历史

`WorkbenchStage` 仍只装配一个 TresCanvas；renderer 工厂按实际能力创建 WebGPURenderer。`useWorkbenchScene` 管理加载与首帧开放操作；`realtime/coordinator` 统一组织舞台辅助绘制、G-buffer、反射、间接光、过滤及最终呈现。

Three 0.185.1 初始化后会启动内部帧记账 RAF。受检 `realtime/clock` 桥接停止该 RAF，由 Tres 唯一绘制时钟在完整帧外层执行 NodeFrame、info 和 inspector 记账。桥接检查版本及私有接口形状，不能把它当作未来 Three 版本的稳定公开 API。隐藏／离屏停钟，恢复时重新确认当前状态；renderer 继续由 Tres 释放。

`realtime/motion` 保存相机完整投影／观察矩阵、对象世界变换及实例局部矩阵。当前帧快照与上一已提交帧分离，只有最终呈现成功后提交一次历史；离屏阴影或反射 draw 不推进 previous。MRT 附件名使用 `motion`，避开 r185 原生 `velocity` 所触发的逐 draw 历史更新。面板构图的 viewOffset 保留，不额外加抖动或清除取景偏移。

这版只实现刚体运动历史，单批实例上限 1024，依据 WebGPU 保证的 64 KiB uniform binding 限制。实例历史使用独立 Float32Array／UBO，不附加或释放源 geometry。morph／skinning 未迁入此机制；直接覆盖 clip-space 的天空盒输出零 motion，由深度拒绝背景光照历史。核心报告记录 303 个被跟踪场景对象、2257 个实例、144,448 字节 previous 实例矩阵数据；这个值不包含全部 CPU 快照与 GPU 场景内存。

### HDR 信号与材质支路

共享 G-buffer 的六个附件为 beauty、packed normal／roughness、albedo／metalness、motion、base specular、base diffuse，另有深度。当前 normal 与 base diffuse 均为 RGBA HalfFloat，附件存储合计 **40 字节／像素**；WebGPU 验证采用对齐后的 **44 字节／采样点**成本，不能用存储字节数代替该上限。宿主明确请求 `maxColorAttachmentBytesPerSample: 64`，不支持的适配器失败后进入兼容路径。完整输出比例保持 1，核心检查实际绘制尺寸为 1440×1000、DPR 1。此前初测使用 RGBA8 normal、32 字节存储；中间版本为 HalfFloat normal、RGB11 base diffuse、36 字节存储，均属于旧参数记录。

beauty 与组合光照在线性 HDR 空间计算，最终使用既有曝光／ACES 与 sRGB 输出。normal 在 G-buffer 中 packed 为 0—1，SSR／SSGI 使用解码后的 signed view normal，内置历史过滤器读取 packed normal。normal.a 使用原生 Physical 的导数调整后 roughness，不再直接写材质粗糙度标量。normal／roughness 已提高到半浮点，albedo／metalness 仍为 RGBA8；源贴图与直接 Physical 着色没有缩小或降格式。半浮点调整仍需通过曲面、细边与微表面近景检查，不等同于已证明全部材质无损。

受支持的不透明、各向同性基础 Physical 支路使用独立运行 NodeMaterial，通过 r185 DFGLUT 计算对应环境辐射的单次散射权重，捕获 `native radiance × singleScattering × specularAO × coatThroughput`；baseSpecular.a 独立保存 `specularAO × coatThroughput`。原生间接镜面的多次散射项不再包含于待替换捕获，清漆保留原生 finish。baseDiffuse.rgb 记录原生基础间接漫反射经清漆的贡献，alpha 独立保存 coatThroughput，不能将镜面 AO 权重错用为新增漫反射透过权重。

SSR 只提供命中辐射，miss 不随机替换原生稳定 PMREM。当前 `reflectionResolve` 在过滤前逐射线选择匹配单次反射的来源：命中为 `rawSSR × AOcoat`，未命中为 `nativeSingle`，未支持像素为零；最终统一替换相应基础单次项。透明、各向异性、透射及其他未支持的 BRDF 支路保留原生材质；非默认 IOR、specularIntensity、specularColor、specular 贴图和独立 envMap 亦排除，不能将 SSR 的标准近似称为这些 Physical 分支的等效实现。统一 resolve 已取得真实生产采集，完整画质仍未通过，不声明严格能量等效。

初次核心记录为 12 种运行材质、233 个被桥接网格及 59 种保留原生的材质，其中透明 54、各向异性 4、其他 1。`core-quality-fixed` 记录受支持基础层仍为 12 种，运行克隆共 63 种、284 个桥接网格，其中 51 种为受控贴片克隆；原生支路数仍为 59。运行克隆数包含字符贴片，不是商品部件数，也不表示全部金属都经 SSR 替换。运行材质仅借用源纹理；卸载恢复源材质身份并只释放自有运行材质，不能调用源材质 dispose 作为重编译手段。

WebGPU 摄影棚地台恢复原有平面反射，复用同一 renderer 的离屏目标和当前商品姿态。反射接收层使用原生 Basic 材质，捕获权重为零，不参与 SSR 基础镜面替换；屏幕空间商品表面反射与地台近似反射按受控支路组织。它弥补仅用屏幕空间射线时容易丢失的地台整机倒影，仍是平面反射近似，不是新增世界空间全局光照，也不以恢复该效果宣称组合画质通过。

### 屏幕空间反射、间接光与过滤

- SSR 采用 r185 随机 GGX 反射、二分细化与全尺寸输出；当前固定 quality 1、maxDistance 8、thickness 0.035。此前初测为 quality 0.5、thickness 0.12，不能把历史计时直接写成当前参数的成绩。没有以动态分辨率或隐藏的射线预算缩减调整测试结果。当前 SSR environmentIntensity 固定为 0，仍装配上游构图所需 HDR 节点依赖；miss 使用捕获的原生单次环境贡献。上游只改变 RGB 而无匹配命中语义的屏幕边缘渐退关闭，由过滤前逐射线判定管理。
- 镜面替换历史先由 Three TemporalReproject 处理运动、深度与法线一致性，再交由 RecurrentDenoise 过滤。外部反馈仅服务这一替换信号历史；不将完整替换重新注入已含 IBL 的 beauty hit-color 或宣称真实多跳追踪。
- **过滤前逐射线 resolve：**原始 r185 SSR alpha 是 ray length，环境 miss 采用 10000；当前在原始输入中仅把 `0 < rayLength < 9999` 判为命中。命中使用 `rawSSR × AOcoat`，miss 使用 `nativeSingle`，未支持像素为零；颜色与原始 ray length 装入同一个有 owner 的 RTT，整体进入同一时域／空间过滤链，半径为 5。最终 `beauty + filteredReplacement − nativeSingle` 只应用于受支持像素，原生多次散射与清漆保留。过滤后的 alpha 不再用于判断命中；关闭降噪的研究对照直接使用统一 resolve 的 raw RGB，不混用过滤阶段。此前独立颜色／coverage 滤波在不同非线性权重下不能抵消匹配原生项，已移除；新的统一策略仍需验证噪声、边缘和运动表现，不能由公式推出质量通过。
- SSGI 当前 sliceCount 4、stepCount 12、radius 1.3、thickness 0.12；关闭要求 TRAA 的内置时域采样路径，使用独立空间过滤。SSGI AO 只影响捕获的漫反射间接光，不统一压暗直接光、清漆或所有镜面层。
- **SSGI 输出不是经严格物理标定的 irradiance**：官方实现从已着色 beauty 估算屏幕空间贡献，并内置亮度 7 的限制。当前根据 albedo、metalness 和基础层权重组合，属于需要经验标定与实机对照的近似，不能据此宣称严格能量守恒、无任何能量截断或与路径追踪等效。
- r185 原生 WebGPU 的 MRT 默认只有 `output` 使用材质混合，其他附件默认 `NoBlending`；不能把 normal／roughness 等附件的 alpha 当成 opacity 来解释当前绘制。该打字机的 54 种 BLEND 材质均为 `decal-*` 字符／铭牌贴片，键帽本体不透明，并不是 54 种玻璃。GLTFLoader 为这些贴片关闭 depthWrite，因此贴片直接覆盖 normal／albedo／motion，而深度保留后方不透明面；未丢弃的 alpha=0 贴片区域也可能写入零捕获权重，抹掉底层的增强资格。须检查键面字符、铭牌软边、整片边界及运动历史；完整通用透明方案未验收，不以原生材质保留证明所有 G-buffer 语义正确。

针对已知贴片，随后加入独立运行 NodeMaterial：仅 `decal-6..55` 与 `decal-62` 的透明、有贴图源材质使用不小于原 alphaTest 的 `1/255` 低阈值，丢弃透明孔，保留原生 Physical 支路与零增强捕获权重。源材质、source alphaTest、贴图、几何和旧 WebGL 入口不改。相关 7 项材质测试已检查共享运行克隆、原生 lighting model、借图／释放、源身份恢复与未知透明材质排除；这只是工程防护，不是字符软边或完整透明画质通过。当前报告包含 51 种受控贴片克隆，不能再把旧 core 的 12 种 runtime 数当成最新实测。

### 释放修正与版本受检桥接

Three r185 的效果辅助方法会把非纹理表达式隐式转为 RTT；SMAA／过滤器 dispose 不递归释放这些输入。`realtime/ownedRtt` 显式创建并持有 GI 输入、逐射线替换与最终组合的 RTT，替换或卸载时分别释放目标和 quad 材质，不释放借用的 pass／纹理、源 geometry 或模块共享 QuadMesh geometry。`realtime/reflectionResolve` 另拥有替换信号的重投影与过滤目标，历史重建／最终卸载清理旧对象；旧 `reflectionCoverage` 的独立资源链已移除。不能靠重建 renderer 或强制 GC 掩盖增长，新链释放仍需相应回归。

原生 EnvironmentNode 使用按环境纹理缓存的 PMREMNode；仅触发源纹理 dispose 会释放 filtered 输出目标，但遗漏 PMREM 节点生成器的 LOD 几何／材质与 ping-pong 目标。`rendering/environmentPMREM` 在固定 r185 和接口形状检查后，先让原生源监听释放输出目标，再释放节点生成器并移除对应缓存。它不释放产品 loader 的其他资源，也不二次释放 PMREM 输出目标。实际重复加载结果单独列于下文，不由修复代码本身推出稳定结论。

`realtime/geometryOwnership` 是第三处受检 r185 桥接：原生 geometry 清理只包含首次 RenderObject 使用的 attribute，同一共享 geometry 在实例材质／节点支路等不同 RenderObject 中出现时，附加 GPU attribute 可能遗漏。桥接汇总实际绘制的 attribute、index 和 indirect backing，按 geometry 引用记录释放遗漏项；交错 attribute 的多个 view 共用 backing，只销毁一次底层 GPU 缓冲，同时清理各 view 的统计／缓存。loader 仍决定源 geometry 的生命周期，桥接不主动 dispose 或修改源几何。

桥接由 `useWorkbenchScene` 局部安装，检查固定版本、私有管理器形状与唯一宿主 owner；正常卸载先销毁协调器、controller／环境，再解除桥接并恢复该 renderer 的原生方法。存活共享 backing 不提前销毁，解除桥接本身不释放借用源数据，renderer 最终剩余 GPU 数据仍由 Tres 宿主释放。8 项基于真实 Three 模块的机制测试覆盖该局部所有权，不能代替实机 30 次重载无增长的证据。

普通连续相机／刚体变化由真实运动向量处理；材质、环境、尺寸、加载／恢复等全局变更失效有关历史。精确的部件语义事件、连续／跳变区分与局部影响范围调度属于后续研究阶段，当前不能将粗粒度失效接口描述为完整的状态感知调度实验结论。环境纹理身份／版本、异常绘制后 renderer 状态恢复与重载历史须完成针对性回归。

## 已取得的核心证据：历史初测

原始材料位于忽略目录 `artifacts/realtime-workbench/core/`。`report.json` 为 `passed: true`、`scope: core`、`fixture: false`，**`fullJointAcceptance: false`**。这次 headless Edge 使用实际 NVIDIA／Blackwell WebGPU，开始于 2026-10-12 13:26:45 UTC，结束于 13:27:40 UTC；不使用 API 假数据、合成几何或替代 renderer。

| 检查           | 实际证据                                                                                                      | 结论范围                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 真实模型与宿主 | 572 语义部件、2257 实例、1,257,132 三角面、native 1440×1000；每个检查快照核对同一 Canvas／renderer 与模型身份 | 证明本次真实工作台接入；不是 30 次重载稳定性结论 |
| 光照信号开关   | 关闭增强、只开 SSR、只开 SSGI、组合各保存 Canvas 原图与页面图；姿态、相机、投影和材质摘要一致                 | 证明不同信号产生真实像素变化，不证明变化都更好   |
| A 键联动       | 采集实际语义节点姿态及同时增加的完整帧计数；按键返回原姿态，无此次操作累积偏移                                | 证明连续交互时继续渲染，不代替全部按键碰撞验收   |
| 结构与接管     | 分层与平铺继续绘制，鼠标接管暂停在当前进度；关闭面板保留姿态与镜头，复原确定性核对                            | 证明本次流程可操作，不代替完整联合持续演示       |

相对 `signals-none.canvas.png` 的 RGB 像素差如下。RMS 以 8 位分量计算；“变化像素比例”按脚本的每像素总分量差 >12 判定，不是画质评分。

| 输出 |    RMS | 变化像素比例 |
| ---- | -----: | -----------: |
| SSR  | 9.7522 |      9.6567% |
| SSGI | 1.6367 |      1.2426% |
| 组合 | 9.8933 |     10.3154% |

报告没有页面错误、预期错误或失败请求。保存图像包括 `signals-none`、`signals-ssr`、`signals-ssgi`、`signals-combined`、`structure-paused-takeover` 与 `flat-overview` 的原始 Canvas／页面截图。静帧差异尚不评价移动中的闪烁、拖影或漏反射。

核心批次内 renderer 资源统计由初始 453,004,222 字节变为平铺快照 694,938,686 字节，期间创建不同信号／视角所需资源。这是 Three 的内部分配口径，**不是实际显存峰值，也不是已证明的泄漏或稳定平台**。需完成预热后的同序列重复与卸载回归，不能挑取初始低值报告为最终稳态。

## 修正版核心与画质检查：工程通过，画质未通过

`artifacts/realtime-workbench/core-quality-fixed/report.json` 在 5181 生产构建中取得 `passed: true`、四项核心检查、`fixture: false`、**`fullJointAcceptance: false`**，开始于 2026-10-12 14:54:37 UTC，结束于 14:55:31 UTC。本批次仍核对真实 GLB、572 语义部件、2257 实例、唯一 Canvas／renderer、A 键联动与结构接管，输出为 1440×1000。该次首光栅计时记录 6330.8ms，仅为这一批次的准备至首帧值，不是五次冷加载中位数或最终性能成绩。

相对关闭增强信号图，该批次 SSR RMS 为 120.0151、变化像素 42.3083%；SSGI RMS 为 1.6495、变化像素 1.2655%；组合 RMS 为 120.0280、变化像素 42.8699%。这些仅证明光照开关确实改变输出，**大像素差不等于改善**。这份信号修正前的 SSR 差异明显增大，随后进一步核对并修正原生间接项捕获、随机 HDR miss 替换与过滤 coverage，当前待重新采集；不能以工程 PASS 结束画质验收。

`artifacts/realtime-workbench/quality-initial/report.json` 已采集原 WebGL 与实时版的整机、漆面、金属、键面、分层、平铺六组固定状态，并对三组近景补充 SSR 开关／重复收敛图。本批次报告为 `passed: false`：比较投影矩阵时未先处理 WebGL／WebGPU 深度范围差异，因此不能将这批“取景未核对通过”的图像视为合格公平对照。脚本随后改为核对共同投影语义并归一化深度范围，旧失败记录保留。

### 修正投影比较后的六组控制契约

`artifacts/realtime-workbench/quality-before-signal-fix/report.json` 在 5181 完成六组固定状态对照，开始于 2026-10-13 00:51:23 UTC，结束于 00:53:16 UTC；Edge 155.0.4283.45、真实 WebGPU 适配器、输出 1440×1000。`passed: true` 只表示两项工程检查通过，**`fullJointAcceptance: false`**，报告仍明确 `visualAcceptance` 为待人工审查。

六组均核对共同 GLB／动作姿态、源 PBR 输入、摄影棚配置、曝光、物理相机和 viewOffset：相机及共同投影分量最大误差为 0，WebGL→WebGPU 深度范围映射最大误差为 2.22×10⁻¹⁶。这里验证的是 `z_webgpu = 0.5 × z_webgl + 0.5 × w`、x/y/w 不变，不能强求两个后端的原始深度投影矩阵全等。运行 NodeMaterial、后端环境预过滤／反射实现／BRDF 支路差异单独记录，不假定像素等效。

该批次没有页面错误或失败请求，三组近景另外采集 SSR 开关与重复收敛诊断。它证明公平对照的共同输入已核实，**没有证明实时版整体优于原 WebGL**；该批次仍早于最新的单次散射／命中 coverage 修正，当前修正需新的实机与视觉检查。静止路径参考亦须核对相同姿态、完整投影和曝光后再用于质量结论。当前没有通过的新管线人工画质结论。

## 历史独立 coverage 版：生产实机证据

`artifacts/realtime-workbench/core-hit-preserved-final/report.json` 开始于 2026-10-13 01:22:25 UTC，结束于 01:23:23 UTC；`origin: 5181`、`passed: true`、`fixture: false`、四项核心工程检查，**`fullJointAcceptance: false`**。仍核对真实 GLB／572 部件／2257 实例／唯一 Canvas 与 renderer、独立信号开关、A 键连续联动、结构／平铺与接管复原。该次首光栅记录 6299.6ms，仅是单批次准备至首帧值，不是冷加载统计成绩。

本批次相对关闭增强的 SSR RMS 为 8.5638、变化像素 7.1944%；SSGI RMS 为 1.6615、变化像素 1.2742%；组合 RMS 为 8.6238、变化像素 7.6826%。旧版 120 量级的 RMS 不再代表当前输出；新值仍只是实际信号差异，不是画质评分或改善幅度。报告没有页面错误或失败请求。headless 最小化仍未暴露真实 hidden 状态，须继续 headed 检查，不合成事件补成绩。

`artifacts/realtime-workbench/quality-hit-preserved/report.json` 开始于 2026-10-13 01:07:25 UTC，结束于 01:09:19 UTC；5181、1440×1000、`passed: true`、**`fullJointAcceptance: false`**。六组共同模型／姿态／PBR 源输入／摄影棚／曝光／物理相机与 viewOffset 契约通过；相机及共同投影误差为 0，深度范围映射误差为 2.22×10⁻¹⁶，三组近景另有 SSR 关闭／重复收敛诊断。

该批截图中的黑地台与异常宽亮带已消除，但仍有点噪，完整画质未通过；报告的 `visualAcceptance` 仍为待检查。不能据契约 PASS、局部修正或更小像素差宣布全面超越 WebGL。运动闪烁、拖影、文字细边与分层中间状态必须分别审查。此后的上一批 check／生产准备记录为：`npm run check` 通过 70 文件、375 项单测、48 项工具测试；`npm run demo:prepare` 完成前端构建与后端 JAR。它们早于当前统一 resolve 改动，不替代新链回归、画质或本人反馈。

## 性能初测与联合验收：未完成

初测证据为 `artifacts/realtime-workbench/performance-initial/report.json`，2026-10-12 13:28:42—13:30:42 UTC，`scope: performance`、`passed: true`、`fullJointAcceptance: false`。实际输出 1440×1000，三轮分别约 30 秒，鼠标真实移动 501／497／496 次，未用另一渲染时钟、合成几何或降低输出比例。本机目标仍为中位帧间隔 ≤33.3ms、P95 ≤45ms；这份初测只能支持下面明确的计时口径，不能宣称整轮完成。

测试窗口的完整帧计时记录 JS 绘制命令提交完成间隔与 CPU 提交时长；不得称为 GPU elapsed time、屏幕实际呈现间隔或硬件光追耗时。需要注明检查浏览器、真实适配器、输出分辨率、信号开关、操作序列及预热范围； GPU 时间只能来自另行受检的 timestamp-query。

| 轮次 | 提交间隔样本数 | 中位提交间隔 | P95 提交间隔 | 中位整帧 CPU 提交时长 | P95 CPU 提交时长 |
| ---- | -------------: | -----------: | -----------: | --------------------: | ---------------: |
| 1    |           2255 |       13.1ms |       14.9ms |                11.4ms |           13.0ms |
| 2    |           2346 |       12.6ms |       14.2ms |                11.0ms |           12.1ms |
| 3    |           2365 |       12.5ms |       14.4ms |                10.9ms |           12.5ms |

初次命令提交间隔中位值为 12.5—13.1ms、P95 为 14.2—14.9ms，满足该脚本按提交间隔设置的阈值。没有由这些值换算实际 GPU 帧率或屏幕呈现帧率。此结果取得在重载资源修复之前，修复后须重新检查性能与相同画面，不能以初测代替最终结果。

此前重复加载检查发现持续资源增长，失败记录保留。隐式 RTT 修正后的 `artifacts/realtime-workbench/long-fixed/report.json` 在第 4 次重载提前失败：相对基线仍多 1 个 renderTarget、12 个 geometry、191 个 attribute、23 个 uniformBuffer，Three 内部分配增加约 28.57 MB；program 数不变。随后修正原生环境 PMREM 生成器及共享 geometry 附加 GPU attribute 的释放；下列完整实机重载检查已取得通过结果，不只依赖修复代码。

原 core 批次的暖机资源增长本身不是泄漏证明；上述问题来自后续重载检查。验收采用预热、连续完整重载并核对同一状态资源平台，包括目标、几何、attribute、program、uniformBuffer、texture 与总分配，而非只数纹理。不能使用单次成功、手动强制 GC 或重建 renderer 掩盖它。

### 30 次真实重载：资源平台通过，非完整联合验收

`artifacts/realtime-workbench/long-hit-preserved-final/report.json` 开始于 2026-10-13 01:24:06 UTC，结束于 01:38:40 UTC；5181、1440×1000、`passed: true`、**`fullJointAcceptance: false`**。同一 Canvas／renderer 连续执行 30 次真实资源卸载、重新下载／解析／装配与首帧检查，逐次核对 GLB 身份、572 部件、2257 实例及固定运动历史；没有强制 GC 或为重载重建 renderer。

以第 3 次预热后的固定基线比较，第 4—30 次资源数均稳定如下：

| Three 统计项   |                 预热基线／后续计数 | 最终相对基线差异 |
| -------------- | ---------------------------------: | ---------------: |
| renderTargets  |                                 24 |                0 |
| geometries     |                                309 |                0 |
| attributes     |                               1127 |                0 |
| programs       |                               1210 |                0 |
| uniformBuffers |                               2689 |                0 |
| textures       |                                104 |                0 |
| 内部分配总字节 | 基线 536,954,284；最终 536,961,657 |           +7,373 |

总字节差为小的固定差，后续平台保持，不构成持续增长；它是 Three 内部统计口径，**不是物理显存、完整进程内存或实际 GPU 峰值**。报告没有页面错误或失败请求。该记录仍使用镜面／coverage radius 1.25，早于当前 radius 5／舞台 HDR 校准；不能直接写成新画质参数或完整演示的通过成绩。20 分钟持续操作、错误恢复、管理预览、headed 隐藏、设备恢复和本人验收仍需各自检查。

### 历史集中校准：输入契约通过，噪声问题未通过

实时地台叠层在 HDR 空间合成后经 ACES；原 WebGL 的反射／阴影叠层在显示空间混合，因此相同 alpha 不保证相同观感。实时分支反射 strength 0.5、接触阴影 opacity 0.68，旧 hybrid／WebGL 仍为 0.28／0.46；它们为视觉校准，不是 BRDF 等效或普适物理参数。此前与镜面／独立 coverage 半径同步为 5、coverage flickerSuppression=0 一起构成校准批次，经 `demo:prepare` 于 2026-10-13 01:45:14 UTC 准备完成。

`artifacts/realtime-workbench/quality-calibrated-final/report.json` 开始于 2026-10-13 01:46:00 UTC，结束于 01:47:51 UTC，工程契约 `passed: true`，**`fullJointAcceptance: false`**；没有页面错误或失败请求。实际截图仍有明显点噪，画质未通过，不能把报告 PASS 写成画质验收成功。随后发现反射颜色与命中概率两个独立过滤器具有不同的亮度相关非线性权重，匹配原生项不能按独立 coverage 稳定抵消；当前已移除此支路，保留报告作为未通过的历史尝试。

此前同时补齐失败态控制与时钟门禁、可见／隐藏期间 retry 恢复的局部机制，新增 3 项聚焦测试；该批 `npm run check` 为 70 文件、375 项单测＋48 项交付工具测试通过。这里仅记录单元证据，真实 GPU 故障注入、停止与重试恢复还待浏览器实测，不能写成完整错误恢复验收完成。

### 当前统一 resolve：核心与对照契约通过，完整画质未通过

`realtime/reflectionResolve.ts` 改为过滤前逐射线选择命中辐射或稳定原生单次项，之后统一过滤同一替换颜色／ray length；最终只减对应原生单次项，多次散射、清漆和未支持支路保留。过滤半径 5、舞台 0.5／0.68 校准保留；已无独立 coverage 滤波器与其 flickerSuppression=0 参数。新链 `npm run check` 通过 70 个文件、375 单测＋48 工具测试；`npm run demo:prepare` 完成前端生产构建／后端 JAR，生产 receipt 为 2026-10-13 01:53:53 UTC。旧 core／quality／30 次重载仍保留历史边界，不借用为当前结论。

`artifacts/realtime-workbench/quality-resolved-final/report.json` 开始于 2026-10-13 01:54:54 UTC，结束于 01:56:45 UTC；5181、1440×1000，真实模型与六组固定姿态同资产／源 PBR／舞台／曝光／物理相机／投影契约两项检查通过，`passed: true`、**`fullJointAcceptance: false`**。无页面错误或失败请求，三组近景另采 SSR 开关／重复诊断。报告仍写明 `visualAcceptance` 待检查，不能把输入匹配 PASS 等同整体渲染质量胜过 WebGL。

`artifacts/realtime-workbench/core-resolved-final/report.json` 开始于 2026-10-13 02:06:55 UTC，结束于 02:07:48 UTC；5181、1440×1000、四项核心检查通过，**`fullJointAcceptance: false`**。真实 GLB 身份、独立信号开关、A 键连续姿态与返回、结构／平铺／接管和复原均有证据，报告无页面错误或失败请求。首光栅记录 6351.3ms，只是本次单次准备至首帧值；SSR RMS 8.2764／变化 7.7376%，SSGI 1.6662／1.2756%，组合 8.4914／8.9189%，仅证明真实输出差异，不是画质评分。headless 最小化仍未暴露真实 hidden 状态，headed 验证仍待完成。

### 六组静帧审查：仍未达到默认切换条件

对 `quality-resolved-final` 的整机、漆面、金属、键面、分层和平铺进行独立静帧审查，结论为**整体画质尚未证明优于增强 WebGL**。滚筒与前框较前一稿干净，黑地台／异常宽亮带消失；仍有以下可定位缺口，不能用局部改善覆盖：

| 取景／位置               | 当前可检查问题                 | 对照结论与下一次核对重点                              |
| ------------------------ | ------------------------------ | ----------------------------------------------------- |
| 漆面近景的前罩高光、刻度 | 仍有明显点噪，细节不够稳定干净 | 检查反射过滤是否保留刻度与细边，不能只加模糊掩盖      |
| 键面 A／S 与远排字符     | 部分字母比 WebGL 浅且有颗粒感  | 对照字符贴片软边、曝光与实际着色，保护文字可读性      |
| 整机地台倒影             | 偏浅、模糊，并见离散白点       | 既有 WebGL 倒影更完整扎实；核对舞台叠层与局部反射组合 |
| 分层／平铺               | 结构可读，但没有明确质感提升   | 保留共同操作，对照材质分区、接触关系与细部边缘        |

这份静图审查不证明运动中的闪烁、拖影或重新显露区域已经改善，也不是本人完整验收。默认继续 WebGL，当前组合保留实验入口；优先解决上述实际画面缺口，不追加 DDGI／FFX／BVH 来代替现有问题的定位。

随后只读核查确认两处后端合成不等效：WebGPU 最终全幅 ACES 仍作用于原本标记 `toneMapped: false` 的天空盒，原 WebGL 天空盒只进行输出颜色空间转换；地台阴影／反射在原 WebGL 先色调映射后叠层混合，当前 WebGPU 则在 HDR 混合后统一 ACES，非线性处理顺序不同。这解释为什么相同输入或 alpha 不保证像素相等，**尚未证明是白点或完整倒影缺失的根因**。本轮代码冻结；后续先在一个固定取景分别检查原始反射 texture 与最终合成，不补丁修改 Three 或盲调强度／追加算法。

### 管理预览：实际认证与取景闭环通过

`artifacts/realtime-workbench/admin-resolved-final/report.json` 开始于 2026-10-13 02:50:28 UTC，结束于 02:52:06 UTC；5181、`passed: true`，两项检查分别核对真实 GPU 模型宿主与管理员预览闭环。使用真实 Session 认证进入未保存预览，右键平移改变实际相机；回填采集的 position／target 与当前相机对应，返回编辑页卸载唯一预览宿主。`snapshots.adminCapture.persistedUnchanged: true`，说明此次预览／回填没有持久化修改商品；报告无页面错误或失败请求。

该记录证明本次真实认证、预览、取景回填与退出卸载可用，不宣称反复会话失效、所有桌面尺寸或长期管理稳定性都已通过，亦不改变画质未验收的结论。

### 故障检查：严格取消分类后四项检查通过

`artifacts/realtime-workbench/faults-resolved-final/report.json` 于 2026-10-13 02:07:49 UTC 开始，最终 **`passed: false`**。批次记录了真实资源 HTTP 503 重试、受控 renderer.onError 回调下实际结构／绘制时钟停止与明确 retry、实际 GPUDevice.destroy 后卸载旧宿主并恢复相机／选中部件／暂停结构的功能检查。受控错误回调属于应用接入测试，**不是实际 GPU validation 故障**；实际销毁设备单独核验。

最初检查仍有 `model.glb` 和 `rig.json` 两条 `net::ERR_ABORTED` 未分类，导致该批次失败；不能因为局部功能检查完成便把这份失败报告写成通过。该失败记录保留，随后通过具体取消阶段／资源范围进行窄分类复测。

随后 `faults-resolved-classified` 为请求增加真实起止阶段／时间证据，确认这两条取消发生于“Injected model download failure”的真实 HTTP 503 注入阶段，**并非 GPUDevice 销毁阶段**；该报告最终仍为 false，失败记录保留。

`artifacts/realtime-workbench/faults-resolved-verified/report.json` 开始于 2026-10-13 02:52:35 UTC，结束于 02:54:42 UTC，`passed: true`、四项检查、**`fullJointAcceptance: false`**。两条并行 bundle 请求仅在 503 专用严格窗口内，凭相符的资源、真实请求起止阶段和注入响应登记为预期取消；还须在同一 Canvas／renderer 恢复真实 GLB 身份并完成首光栅后才认可。报告最终 `errors`／`failedRequests` 均为空，不是全局忽略 `ERR_ABORTED`。受控 renderer.onError 的停钟／重试是应用回调集成证据；实际 GPUDevice.destroy 的旧宿主卸载、单 Canvas 与相机／部件／暂停结构恢复另有真实设备销毁证据，二者不能混称实际 GPU validation 故障。

### 尺寸与减弱动态：兼容检查通过，非画质验收

`artifacts/realtime-workbench/visual-resolved-verified/report.json` 开始于 2026-10-13 02:54:43 UTC，结束于 02:57:42 UTC，`passed: true`、两项检查，**`fullJointAcceptance: false`**。同批检查 1280×720、1440×1000、1920×1080 的真实 WebGPU 整机及金属近景，390px／320px 的原生 WebGL 兼容入口，以及减弱动态下直接到达分层目标；报告无页面错误或失败请求。另已审查 1280px 和 320px 页面截图，未发现 UI 阻断。

该记录支持本批取景、尺寸兼容与减弱动态行为，不等于金属、文字或倒影的画质通过；前述六组静帧缺口仍成立，不能把文件名中的 visual 或报告 PASS 当作完整视觉验收。

### 当前三轮交互测量：提交口径通过，实际呈现预算未验证

`artifacts/realtime-workbench/performance-resolved-verified/report.json` 开始于 2026-10-13 02:57:43 UTC，结束于 02:59:49 UTC，`passed: true`、两项检查，**`fullJointAcceptance: false`、`frameBudgetValidated: false`**。在同一生产构建、1440×1000、完整比例和真实 pointer 输入下，每轮实际约 30 秒；无页面错误或失败请求，测量结束恢复计时桥接。

| 轮次 | 鼠标移动次数 | 提交间隔样本数 | 中位提交间隔 | P95 提交间隔 | 中位整帧 CPU 提交时长 | P95 CPU 提交时长 |
| ---- | -----------: | -------------: | -----------: | -----------: | --------------------: | ---------------: |
| 1    |          465 |           1938 |       15.1ms |       19.4ms |                13.1ms |           16.7ms |
| 2    |          461 |           1913 |       15.4ms |       18.4ms |                13.6ms |           16.0ms |
| 3    |          452 |           1890 |       15.3ms |       19.7ms |                13.5ms |           17.2ms |

三轮均满足脚本的 JS 命令提交间隔阈值；这些值**不是 GPU elapsed time、屏幕实际呈现帧间隔或实测帧率**，正式 33.3／45ms 呈现预算仍未验证。初始 performance-initial 数据保留为历史，不与当前参数混写，更不能用低提交耗时代替仍未通过的质量检查。

### 真实隐藏：当前环境未暴露 hidden，最终待验收

此前 `visibility-resolved-verified` 的 headed 最小化未产生 hidden，失败记录保留。最终 `artifacts/realtime-workbench/visibility-resolved-final/report.json` 于 2026-10-13 03:41:51 UTC 开始，仍为 **`passed: false`、`fullJointAcceptance: false`**：采用实际 headed Edge、独立 BrowserContext、原生窗口最小化及真实前台空白 tab 后，工作台仍观测为 visible，报告明确保留隐藏／恢复待验收。

本批没有覆写 visibility 属性、合成事件或替换为 CDP 生命周期暂停；`visibility.syntheticVisibilityUsed: false`。这是**当前测试环境没有暴露真实 hidden 状态**，尚不能确定为应用停钟缺陷，也不能记成隐藏／恢复通过。本轮停止重复尝试，后续在能产生真实 hidden 的本机操作或浏览器环境中验收；离屏检查另按对应证据，不以 20 分钟／30 次稳定性成绩替代。

### 当前 20 分钟持续操作：实际时长与资源平台通过

`artifacts/realtime-workbench/soak-resolved-final/report.json` 的持续操作段在 2026-10-13 03:05:10 UTC 开始、03:25:32 UTC 结束；`passed: true`、两项检查，**`fullJointAcceptance: false`**。一次完整操作预热后，Node 单调时钟实际经过 1,221,560.7ms，墙钟经过 1,221,851ms，完成 52 次正式循环和 21 个资源检查点。每类操作共 53 次含一次预热：敲键、展开暂停、定位当前结构控制器、鼠标观察、热点聚焦、导览前后、反向复原和面板关闭重开；没有用假计时或只等待页面补足时长。

报告始终核对同一真实 GLB 根节点、572 部件、2257 实例与同一 Canvas／renderer，实际姿态有限且能复原；增加 62,869 次完整帧提交，说明连续绘制调度仍运行，不等同 GPU 完成或实际屏幕呈现帧数。全部资源检查点及最终值相对固定预热基线无增长：

| Three 统计项   | 预热基线／最终计数 | 最终差异 |
| -------------- | -----------------: | -------: |
| renderTargets  |                 19 |        0 |
| geometries     |                297 |        0 |
| attributes     |               1091 |        0 |
| programs       |               1211 |        0 |
| uniformBuffers |               2661 |        0 |
| textures       |                 96 |        0 |
| 内部分配总字节 |        401,203,838 |        0 |

该数值为 Three 内部估算，**不是物理显存、进程峰值或 GPU 耗时**；报告无页面错误或失败请求。这证明当前统一 resolve 的持续操作与固定资源平台，不替代资源反复卸载／下载的 30 次重载、真实隐藏、动态画质或本人验收。

### 当前 30 次真实重载：独立资源平台通过

`artifacts/realtime-workbench/long-resolved-final/report.json` 开始于 2026-10-13 03:27:05 UTC，结束于 03:41:26 UTC，`passed: true`、两项检查，**`fullJointAcceptance: false`**。同一 Canvas／renderer 完成 30 次真实卸载、重新解析／装配及首帧，每次产生新的真实模型 root；572 部件、2257 实例与语义模型身份保持正确，没有用只改 DOM 名称或复用旧 root 替代加载。以第三次重载后的固定预热基线比较：

| Three 统计项   |                 预热基线／后续计数 | 最终差异 |
| -------------- | ---------------------------------: | -------: |
| renderTargets  |                                 21 |        0 |
| geometries     |                                309 |        0 |
| attributes     |                               1127 |        0 |
| programs       |                               1211 |        0 |
| uniformBuffers |                               2686 |        0 |
| textures       |                                 99 |        0 |
| 内部分配总字节 | 基线 485,113,558；最终 485,121,071 |   +7,513 |

计数全部不增，总分配只存在固定 7,513 字节差，无持续增长；报告无页面错误或失败请求。该数据仍是 Three 内部统计，**不是物理显存、完整进程内存或 GPU 峰值**。重载批次和持续操作批次各自的预热过程不同，因此资源平台数不能直接互减当作泄漏证据；本批次使用当前统一 resolve，与旧 radius 1.25／独立 coverage 的历史 30 次明确分开。通过稳定性不代表画质、真实隐藏或本人验收完成。

全量 `check-resolved-complete` 的 375 单测＋48 工具测试已重跑通过，生产构建源码未变化；当前真实 30 次与 20 分钟分别有独立报告，不借用旧 radius 1.25／独立 coverage 成绩。

### 当前正式验收状态

原增强 WebGL 的 `artifacts/realtime-workbench/webgl-regression-verified/report.json` 已完成五项回归，`passed: true`、`fixture: false`、`errors: []`。使用真实 572 部件／2257 实例，在同一 Canvas／renderer 核对分层暂停／继续、平铺及精确动作复原、A 键与字杆联动、语义查找／聚焦及世界热点；动作复原不重置镜头。`scripts/typewriter-check.mjs` 改为读取生产可用的既有 VNode 桥接及当前具名视角 select，没有修改生产应用；首次旧脚本依赖开发专属 DOM 桥接而失败的 `webgl-regression-final` 保留历史。该检查确认当前默认操作未回退，不等于新实时管线画质通过。

| 验收项                          | 当前结论 | 证据／边界                                           |
| ------------------------------- | -------- | ---------------------------------------------------- |
| 核心真实模型、交互与单宿主      | 通过     | core-resolved-final 四项                             |
| 现有默认 WebGL 的打字机操作回归 | 通过     | webgl-regression-verified 五项，真实资产／同宿主     |
| 六组同资产、取景、曝光输入契约  | 通过     | quality-resolved-final；不是画质 PASS                |
| 管理认证、未保存预览与取景回填  | 通过     | admin-resolved-final，未持久化修改                   |
| 503、错误回调、实际设备销毁恢复 | 通过     | faults-resolved-verified，严格取消分类               |
| 桌面、小屏兼容与减弱动态        | 通过     | visual-resolved-verified；不是画质 PASS              |
| 当前三轮 JS 提交计时            | 通过     | performance-resolved-verified；实际呈现预算未验证    |
| 20 分钟真实操作与固定资源平台   | 通过     | soak-resolved-final，52 正式循环、21 检查点          |
| 当前统一 resolve 的 30 次重载   | 通过     | long-resolved-final；第三次预热后固定资源平台        |
| 真实页面隐藏与恢复              | 待验收   | 最小化与真实空白 tab 均未暴露 hidden，不认定应用故障 |
| 整体画质与运动中稳定细节        | 未通过   | 六组静图有明确缺口，动态质量仍待检查                 |
| 用户本人完整验收                | 待完成   | 自动化与静图审查不能替代                             |

待完成项目分别如下：

- 六组静帧已审查，发现前罩／刻度噪点、字母浅且颗粒、地台倒影偏浅等缺口，完整画质未通过；修正后还需核对运动序列及同输入路径参考，不能由静图证明动态稳定。
- 当前参数的三轮实际交互提交计时已完成；GPU／屏幕实际呈现帧间隔、明确冷加载／首光栅统计仍待验证，不以历史初测或 JS 计时充当成绩。
- 当前统一 resolve 的 30 次真实重载与 20 分钟实际操作分别通过；旧 radius 1.25 版仅保留历史，快速选择、旧结果隔离和动态画质仍按各自证据检查，不由两份稳定性成绩推导全部场景通过。
- 管理实际认证、未保存预览、右键平移、真实取景回填与退出卸载已通过；重复会话与失效恢复仍按各自检查，不能由本次成功推广全部管理生命周期。
- 故障 503／明确 retry／实际设备销毁恢复四项已通过严格复测；最终 headed 最小化与真实空白 tab 仍未暴露 hidden，隐藏／恢复保留待验收，不定性为应用故障。本轮不再重复尝试或伪造事件；离屏行为按相应证据验收。
- 三个桌面尺寸、390／320px WebGL 基础兼容和减弱动态批次已通过，1280／320 截图无 UI 阻断；此为兼容检查，不替代完整画质与本人走查。
- 用户本人画质与完整操作验收。自动化不能代替审美判断或真人反馈。
- 当前统一 resolve 的 check／生产准备、核心、六组控制契约、管理闭环、故障恢复、尺寸兼容、三轮提交计时、实际 20 分钟及新版 30 次重载通过；真实隐藏仍待验收，原失败记录未省略，不引用旧 hybrid 或独立 coverage 的成绩替代。

## 来源、研究归因与后续候选

本阶段实现是已有技术在可逆结构探索工作台中的组合，不将 SSR、SSGI、GGX、重投影或降噪算法标为 Trees X 原创。Three 固定 0.185.1；依据实际安装源码核查，以下 r185 上游实现用于算法归因：

- [SSRNode 官方说明](https://threejs.org/docs/pages/SSRNode.html)、[r185 随机 SSR 源码](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/tsl/display/SSRNode.js)。
- [SSGINode 官方说明](https://threejs.org/docs/pages/SSGINode.html)、[r185 SSGI 源码及亮度限制](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/tsl/display/SSGINode.js)。
- [TemporalReprojectNode](https://threejs.org/docs/pages/TemporalReprojectNode.html)、[RecurrentDenoiseNode](https://threejs.org/docs/pages/RecurrentDenoiseNode.html)。
- [r185 VelocityNode](https://github.com/mrdoob/three.js/blob/r185/src/nodes/accessors/VelocityNode.js)、[r185 Instance 历史更新](https://github.com/mrdoob/three.js/blob/r185/src/nodes/accessors/Instance.js)、[r185 Animation 时钟](https://github.com/mrdoob/three.js/blob/r185/src/renderers/common/Animation.js)。

**尚未安装／接入的候选与计划：**

- 阶段 2：Speedball 固定 `speedball-gi 0.8.0`，真实打字机动态 DDGI 原型；[受核查集成说明](https://github.com/cl0nazepamm/speedball/blob/a997aee5b0791be61b49719377e811c41720df59/docs/ADVANCED.md)。固定探针范围与射线预算，辅助追踪纹理、面积灯近似及收敛差异分别登记；不能将计划的包版本或仓库说明写成已有运行效果。
- 阶段 3：pmndrs FidelityFX 源码对照拟固定提交 `d2e5b7a14ac8bf2951f7014d5bc20299c6d68e29`；[对应仓库](https://github.com/pmndrs/denoiser/tree/d2e5b7a14ac8bf2951f7014d5bc20299c6d68e29)。它尚不是本轮正式依赖，不以旧 npm 包的名字推断已包含该实现。
- 已安装 `three-mesh-bvh 0.9.16`，但 WebGPU 世界空间补偿实验尚未接入；[上游 WebGPU API](https://github.com/gkjohnson/three-mesh-bvh/blob/master/WEBGPU_API.md)。该接口不自带完整 Physical 材质着色，本轮后续实验限定可见性与不透明表面。
- [AMD FidelityFX SSSR](https://gpuopen.com/manuals/fidelityfx_sdk/techniques/stochastic-screen-space-reflections/) 用作深度层级、任务组织与射线压缩的参考，不能当作已经接入浏览器的原生平台模块。

论文重点可继续采用“面向可逆结构探索的状态感知混合渲染与调度策略”。本阶段可报告真实连续渲染基线及部件帧历史的工程验证；屏幕／世界空间信号融合、动作事件调度、FFX 比较及优化收益只能在后续消融实验完成后形成结论。无收益或退步方案须保留原始证据，不以像素差或新技术名称替代质量与稳定性验收。
