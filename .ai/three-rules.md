# 渲染一致性补充约束（2026-10-18）

- 桌台可见 TSL 材质与 DDGI 标量追踪材质分别拥有职责。`loungeTraceMaterial` 拥有独立的单材质／数组追踪视图及 `traceMaterial` 绑定恢复，代理借用这些材质，`loungeAssets` 继续独占纹理；不得通过修追踪响应修改商品材质、源几何或可见光比。
- 明亮端点必须卸下岩板追踪贴图并恢复基线；暖夜端点使用白色 tint 与粗糙度标量 1，让输入贴图只贡献一次。约 0.42 秒过渡明确为 palette-only 近似；绑定变化才更新图集，标量／颜色变化走材质值更新，不逐帧重建场景。
- 追踪材质数组须保持槽位顺序；数组或单材质身份变化进入结构变更，材质值／贴图变化进入既有追踪更新通道。清理恢复之前的 `traceMaterial` 属性描述，不释放借用贴图、原材质、geometry 或实例属性。
- Speedball 材质图共用 UV 变换且不追踪完整清漆 BRDF；岩板粗糙度按底色 UV 采样、追踪使用几何法线的限制必须明示。不得把材质同步称为逐像素 Physical／TSL 等效。
- `camera`／`pose` 表示连续变化；`camera-cut`／`pose-jump` 表示离散跳变。指定进度、复原、减弱动态的即时操作及键盘离散步进必须通知正确事件，在下一完整绘制前失效 SSR 历史并重建刚体／实例运动基线；连续输入不能每帧清历史。
- `signedHistory.resetHistory()` 仅禁用历史有效性、取消未提交状态，不分配或销毁目标。姿态／镜头 cut 不重建 SSR、DOF、SMAA 或合成图；组合图只随模式或 receiver 绑定结构变化重建，保留完整帧提交规则。
- cut 不代表清空全部渲染信号：DDGI 仍按上游自身时域求解；被反射物体的 hit-point 历史、主软箱动态自阴影与背景／HDR 匹配未在本节点解决。验证结果见 [一致性修补验收](rendering-consistency-validation.md)，待跑项目不能写为通过。

# 当前实时渲染约束（2026-10-16）

- 当前用户要求回归渲染管线，图像空间／素材分层暂停扩展，旧入口与证据保留。实时打字机继续 v2，默认 WebGL 及其他商品不变。下方历史“DDGI 未接入”不覆盖当前可选增强。
- 商品平面反射只借用唯一 renderer，局部捕获必须在 finally 恢复背景、clear、根节点可见性与原生钩子；RGBA 同核过滤并解预乘，不能将完整房间 RGB 当商品覆盖率。`planarReflection=scene|off` 仅作对照。
- 2026-10-18：面板造成的非对称投影必须同步到平面反射。受检 r185 局部桥接只镜像虚拟 PerspectiveCamera 的水平主点 P[8]，先于原生斜裁剪计算；主相机、P[9] 与 flipX 采样保持。禁止锁屏倒影或平移采样 UV 掩盖错位，禁止全局修改 Three 原型；商品／scene 捕获共用桥接，销毁恢复原方法。实际检查范围见 [反射构图验收](reflection-framing-validation.md)。
- Speedball 固定 0.8.0／a997aee5b0791be61b49719377e811c41720df59，独立低层 field，不用材质 installer。单体积 16×9×10、64 rays/probe、98,304 rays/tick 上限；禁止自动缩减预算或开启探针镜面。代理只借源资源；field、代理与组合目标各自唯一释放。
- DDGI 在同一时钟内与绘制串行，读取上个完成姿态；场景 beforeRaster 不得为探针额外执行离屏 draw。失败或迟到结果不能留旧 receiver 或覆盖新商品。源材质 AO 和 native dielectric 能量响应保留，DDGI 与 SSGI 不同时贡献同一像素的间接漫反射。
- Speedball dirty 也表示合法重建，不能将 clean→dirty 一律视为失败。首次暖夜贴图绑定可从材质值更新升级 fresh-build；灯光缓存也可要求重建。仅真实 backoff／异常走错误回退，重建期间保留基础画面并在探针再次就绪后接回；resident kernel 复用同样是正常完成，不要求无意义的 shader 重编译。
- 所有 TSL 链式节点来自同一 three/webgpu＋three/tsl 打包运行时；禁止直接从 three/src 引入另一个节点运行时。r185 私有桥接须明确版本和形状检查。DDGI 的 SH9／面灯中心点／着色法线偏置／辅助贴图重采样都是近似，不能冒充完整 Physical 等效。
- FFX 正 radiance 输入与当前 signed Δ 不兼容，未实现专门信号组织前不直接替换或串联；独立 BVH 镜面／阴影仅在实际缺口证据后研究。工程成功不等于画质或实际帧预算通过，证据见 [本轮管线记录](realtime-ddgi-validation.md)。

- 当前暖夜运行候选仅服务 realtime WebGPU 打字机，明亮／暖夜切换保持唯一 Canvas、renderer 与实际绘制时钟。`loungeLook` 只写舞台与三个软箱，不修改商品节点或镜头；0.42 秒 GSAP 补间由既有 beforeRaster 推进，快速切换杀旧补间，减弱动态直接到目标。切换不重置外观、结构、动作或当前部件；明亮恢复既有舞台。此前深灰绿暗场属于历史，WebGL、hybrid、钢琴／汽车保持原通道。
- 酒吧全景是 8-bit sRGB LDR 可见背景，不得替代原 Studio Small 05 HDR 或宣称从图片恢复灯光。固定 LOD 3.5 背景虚化、接缝带混合和极点淡出仅为 TSL 采样保护，不是专业 HDR、真实 DOF、无缝源图或一比一场景重建。HDR 本身保持，三个软箱允许按明暗环境过渡颜色与强度；不把这一布光变化隐入旧版同输入技术对照。
- 暖夜岩板底色来自原生生成图的逐字节副本，repeat 1；不得把未通过平铺检查的底色宣称为无缝材质。roughness／normal 是独立固定种子数学场的技术数据，512²、NoColorSpace、repeat 8，不从底色反推高度，不烘死商品反射或部件互遮挡；不是扫描 PBR。
- `loungeAssets` 固定同源四图与摘要，下载、解码、Texture 和 ImageBitmap 只有一个释放方。首次暖夜异步加载，失败保留基础可操作舞台并可重试；取消后迟到 bitmap 只清理，不挂入新舞台。原生成母版保留，生命周期与实机画质分别验收；本批实际结果由主代理写入 [暖夜运行验收](amber-lounge-runtime-validation.md)，不得引用下方历史成绩宣称本批通过。

- 用户要求 WebGPU 每个工程成功节点落实接入，整体画质由本人肉眼判断；这覆盖旧阶段的接入顺序限制，不将历史未通过项或性能目标改写为通过。显式 `?product=typewriter-study&renderPipeline=realtime` 默认加载 v2，`typewriterAsset=v1` 为旧材质对照。普通 WebGL、其他商品、管理员自定义包、API 与数据库不变；DDGI／FidelityFX／BVH 本轮未接入。
- `signedSpatial` 默认在八个原几何引导 tap 上增加像素 IGN 和成功完整帧 golden-angle 旋转；`reflectionKernel=static` 保持原固定核对照。phase 仅在历史成功 commit 后推进，取消、失败复用；数量、半径、Physical 参数、唯一 renderer／时钟不变。采用 Three MIT 核旋转组织思路，不宣称独创新算法或已解决所有点噪。本批 check、生产构建与 API 启动、真实 WebGPU 对照及 v2 交互／生命周期／管理取景检查通过；整体画质待用户评定，实际呈现预算仍待验证，见 [WebGPU 接入记录](typewriter-webgpu-rollin-validation.md)。
- v2 制作不得覆盖 v1、合并语义部件、减面、改轴心或改 rig；补十个缺 UV 表面，保留已有 UV0，用独立 UV1 采样七张共享 2048²线性 normal／ORM／方向 PNG。UV 接缝与切线接缝可拆点，三角形位置、源法线、572 部件和 2257 表面映射必须保持并核验。Mikk fallback 的正交化只改切线 XYZ，手性按当前 UV 通道独立再生成核查；退化 UV 不冒充已证明手性。
- `treesFinishVersion=2` 材质保持制作时 Physical 参数、法线、粗糙度和各向异性输入，不能被 v1 的运行微纹理替换。loader 唯一释放新纹理／材质／几何，运行材质借用；不新增 renderer、绘制时钟或逐帧响应式输入。PNG 数据不得携带 sRGB／ICC 等色彩解释，不烘死部件间遮蔽。
- WindGear 只替换原 image 50／decal-62 铭牌，保留原位置、UV、材质和尺寸，其他字符图片保持。新字形为代码生成的金色斜体，不改变源页面归属或许可；制作记录继续保留用户自有 Kimi 项目来源。来源、预算与验证见 [v2 记录](typewriter-v2-validation.md)。

- 最新 realtime 候选只过滤 signedDelta，不过滤原生环境亮度。raw hit=SSR.rgb×captureAlpha−nativeSingle，raw miss／unsupported=0；final=beauty+filteredDelta×correctionWeight。每个空间与历史 tap 的 support／边界进入分子和分母，不能只做最终 mask。全 miss 暖历史 GPU 已验证严格零；局部 miss 可接受同表面的有效邻居修正，不把它误写为逐像素 filtered miss 恒为零。保留负修正，不以 RGB black 判断 miss。
- signedSpatial 使用八个几何引导 tap、稳定 native luma 与上述旋转调度；signedHistory 使用四 tap 表面 motion、depth／世界 normal／roughness 拒绝、signed 邻域范围、最多 16 帧。不能称为官方完整自适应核、hit-point 重投影或路径追踪等效。只有成功完整帧后 commit GPU history／depth／normal／camera，取消、错误、尺寸变化及卸载各有清理路径。原固定核的证据见 [有符号修正](typewriter-signed-reflection-validation.md)，不直接当作本批通过成绩。

- 自有 HDR RTT 显式声明 HalfFloatType／线性颜色空间。r185 中 options 替换默认参数，不能只传 depthBuffer 后依赖 HalfFloat 默认。真实 GPU 已确认原 RGBA8 将 HDR 及 10000 哨兵截为 1；诊断只复制成功完整帧，PNG 为后续固定姿态帧，不冒充同提交帧。证据见 [HDR 修复](typewriter-hdr-rtt-validation.md)。

- 打字机实时入口为 `?product=typewriter-study&renderPipeline=realtime`；默认 WebGL 与钢琴／汽车原管线保持。旧 hybrid 的 128／1024 样本与 OIDN 只属于历史静止精修入口，不是此阶段要求。
- 固定 Three 0.185.1，唯一 TresCanvas／renderer／实际绘制时钟。WebGPU 受检桥接集中在 `realtime/clock`，检查版本及私有形状；隐藏、离屏停钟，设备恢复卸载旧宿主后重建。
- 完整帧拥有相机完整投影、世界矩阵与实例历史；MRT 用 `motion`，最终呈现成功后才提交 previous。不能让阴影／反射辅助 draw 的原生 velocity 更新提前消费历史。刚体之外的 morph／skinning 不直接套用此实现。
- 整体画质是最高优先级。保留已有摄影棚完成度，用同资产、同取景、同曝光比较；技术更新、像素变化和低耗时不能单独作为晋级依据。画面退步时先修正或保留原效果，不因算法名称更先进而替换已验收入口。
- `sceneInputs` 在同一 renderer 中分离不透明六 MRT 与完整透明 beauty 两 MRT，各自拥有独立深度。surface 的 HalfFloat normal／原生导数 roughness、baseDiffuse 的清漆 alpha 等语义保持；六附件存储 40 字节／像素、对齐成本 44 字节／采样点，明确请求 `maxColorAttachmentBytesPerSample: 64`。完整 beauty 额外增加一次不透明绘制与约 16 字节／像素目标成本，必须测量，不宣称所有信号共享单 pass。输出比例与源纹理尺寸不变，SSR quality 1、thickness 0.035 的收益仍需实机核对。
- 地台平面反射沿用唯一 renderer 的离屏绘制，Basic 材质捕获权重为零，排除 SSR 替换；不能把它与商品完整 IBL 再重复相加。保留屏幕外舞台反射不等于已经接入世界空间射线追踪。
- 支持的基础 Physical 支路用自有运行 NodeMaterial、受检 r185 DFGLUT 捕获环境辐射单次散射项与 AO／清漆透过权重。SSR 只给命中辐射；`reflectionResolve` 在过滤前构造 signedDelta：命中=`rawSSR × AOcoat − nativeSingle`，未命中／unsupported 为零。最终将 `filteredDelta` 与漫反射修正乘完整 beauty 的 `correctionWeight` 后合成；该权重是透明材质 opacity 混合后的 transmittance，不是 roughness 或捕获附件 alpha。保留 native miss、多次散射与清漆，未支持像素不应用修正。非默认 IOR／specular 参数或贴图、独立 envMap 等支路不参与替换。不得全局改 PhysicalLightingModel 原型，不直接叠加完整 SSR 与完整原生 IBL，不回馈完整替换到已含 IBL 的 beauty 冒充多跳追踪。
- 命中必须在过滤前由原始 SSR alpha 的 ray length 判定；时域／空间过滤后的 alpha 不保证仍是原始 ray length，不能拿它当 hit/miss。此前反射颜色与 coverage 独立过滤的非线性权重不一致，radius 5 后仍有明显噪点；该支路已移除并保留历史结果，当前不能继续描述为独立 coverage 合成。统一 resolve 自有 RTT／历史／过滤器由局部 owner 释放；节点一之前的四项生产核心与六组契约通过仅为历史证据，不由公式或工程 PASS 推断本次画质通过。
- 2026-10-13 CPU 审计确认：当前未支持像素写零但仍带普通 ray length，过滤器没有独立 support mask，最终目标像素判断不能阻止邻域黑样本参与。10 月 14 日明确标记的 GPU 全 miss 信号诊断确认过滤后减 nativeSingle 仍有非零残差；不能据此宣称漆面全部颗粒归因已完成。不得将“过滤前 miss 使用 nativeSingle”写成“过滤后完全稳定”；不得重复乘 SSR 已包含的 GGX 权重／DFG。
- 当前统一替换信号过滤半径为 5。实时舞台 HDR 合成权重 0.5／0.68 属于反射／接触阴影视觉校准，旧 hybrid／WebGL 保持 0.28／0.46；不得称为 BRDF 等效或普适物理参数，需新截图核对。旧 coverage flickerSuppression=0 仅为历史试验参数，当前已无独立 coverage 支路。
- SSGI 是屏幕空间经验贡献，官方实现含亮度 7 的限制；不得称为完整物理 irradiance、严格无截断或路径追踪等效。字符／铭牌透明贴片、微表面与细边需单独近景核对；当前键帽本体不透明，不能把贴片计数误称玻璃材质数。
- 51 个源字符／铭牌贴片保留 loader 原材质身份、原 alpha 与 alphaTest=0；不再用运行克隆或 cutoff 修补 G-buffer。surface pass 排除透明绘制，完整 beauty 原生混合；源贴片统计与整个 scene 含三种舞台透明材质的统计分开，细节见 [资产核验](typewriter-asset-audit.md)。
- 实时参考 HDR 固定 Studio Small 05、1,723,695 字节、SHA-256 `358d532ee8233f17499830eb512591c1e308ce16ed181e0efc938cb7f0f0e11f`、强度 0.35、曝光 1；三个软箱与 ambient 0.16 保留，两盏 Directional 强度为 0。WebGL 保持原环境强度 0.9 与 Directional 0.75／0.35。商品、舞台与天空在线性 HDR 合成后统一一次 ACES／sRGB，不为单个技术对照私下调灯，不宣称两入口灯光完全相同。
- 源 geometry／material／原尺寸纹理由 loader 唯一释放；运行材质只借纹理，卸载恢复源身份，不得 dispose 源材质做重编译。历史、环境辅助图、过滤目标与监听各自唯一拥有。
- r185 将表达式隐式转为 RTT 的调用必须有显式目标／quad 材质释放方；不能假定效果节点 dispose 会递归释放输入。EnvironmentNode 的 PMREM 节点生成器亦由受检局部桥接释放，不能仅释放源 HDR 后保留 LOD／ping-pong 资源。保护 loader 资源，固定版本与形状检查，真实重载验证后再声明无增长。
- r185 的共享 geometry 多 RenderObject 附加 GPU attribute 由 `realtime/geometryOwnership` 受检桥接补齐释放。汇总真实绘制使用的 attribute，交错 view 按共享 backing 引用记录；loader 继续唯一拥有源 geometry，桥接只处理遗漏的 GPU 数据释放，不提前 dispose 源数据。释放顺序为协调器→controller／环境→桥接，卸载恢复原生方法，不留全局原型补丁。8 项真实模块机制测试不能替代完整重载实测。
- 当前节点一 check（385 单测＋48 工具测试）、build 与生产准备通过；新生产六取景工程契约 2 项、核心 4 项、管理预览 2 项、故障恢复 4 项通过。确认图中的地台白块已消除，漆面颗粒与整体质感仍未通过；真实隐藏、呈现预算、当前实现的 30 次重载／20 分钟与本人验收仍待完成。真实 GPU 原始地台反射峰值由约 16376 降至 9.414，支持方向补光白点诊断，不代表整体质量达到目标。默认保持 WebGL，DDGI／FFX／BVH 不扩展，证据见 [节点一验收](typewriter-quality-node1-validation.md)。
- 2026-10-13 节点一修改前的历史基线：核心、六组契约、管理、故障、尺寸、30 次真实重载及 20 分钟 52 循环通过，预热资源无增长；当时静图画质仍未通过。503 取消按严格窗口及真实恢复分类，不全局忽略 ERR_ABORTED；回调与真实设备销毁区分。三轮 JS 提交计时不是 GPU／呈现预算；真实隐藏与本人走查待验收。旧成绩不替代本次双 pass、HDR、补光后的联合回归，保留于 [实时渲染验收](realtime-rendering-validation.md)。

下方以及上文中带日期的旧批次门槛与成绩为历史记录；“不进入候选 v2”或“画质未过不接入下一项”不再限制当前用户授权。涉及 hybrid／OIDN 的“新正式管线”表述仅记录当时阶段，以本页当前实时规则为准。

2026-10-02 当前正式资产阶段优先遵循 [完整路线](implementation-roadmap.md)，下面历史演出说明仅适用于 legacy。

2026-10-12 新正式管线约束：单 Tres renderer，WebGPU 光栅与路径追踪通过协调器切换，不叠加场景 Canvas；追踪代理独立拥有派生几何/BVH，原 loader 不受修改。128 实际最低样本＋完整 OIDN 为固定默认，1024 仅主动续算并呈现真实累积原图。引导 RenderTarget 的附件名称必须匹配 MRT 输出，MRT 节点按宿主复用，不能每轮降噪重新创建。当前只交付打字机供用户验收，默认保留 WebGL；钢琴／汽车新管线另行规划。实验入口与验收见 [混合管线验收](hybrid-pipeline-validation.md)。

# Three 规则

- 2026-10-16 图像空间实验只对显式实时打字机开放。分层 PNG 保持原生尺寸与 alpha，不用数值脚本修图；数值深度生成与运行代理允许独立计算。深度是相对径向距离，不是米或相机 Z；先校准地面再生成网格，跨深度边缘剔除不能冒充补全。固定家具卡片不自动 billboard，不暗中限制相机来制造完整环绕通过；侧背面限制必须随证据交付。
- 空间模式沿用单 Tres renderer／时钟，实体桌台、反射及阴影覆盖相同范围，原商品局部坐标和机构不改。背景图自身明暗不重复完整打光；可选 DOF 必须来自实际深度，先关闭检查几何，不能用模糊掩盖破洞。新资源包、代理几何／材质和效果目标各自唯一释放，原纹理／geometry 继续由原 owner 管理。

- 2026-10-12 混合接入前的比较：独立 `renderlab.html` 验证真实 WebGPU 光栅和静止路径追踪，该实验场景不进入生产工作台。后续打字机通过独立协调器接入混合工作台，默认仍 WebGL；当前阶段以上方约束及混合验收为准。实验页是下方 Tres renderer 规则的明确例外，每页仍只允许一个 Canvas/renderer，切换先卸载，资源/controls/时钟由实验页唯一释放。比较须记录同资产、姿态、材质、灯光及完整投影；共同移除的生产特效、BRDF/纹理过滤差异与缺失 UV 必须注明，不能由基础 WebGPU 对照推导未测试的 SSGI/SSR 结论。样本使用追踪器实际计数，不凭运行时间估计；路径参考图不能冒充连续实机交互。见 [渲染比较](render-pipeline-comparison.md)。

- 2026-10-11 打字机精修：typewriterFinishes 的微表面改用标准 PBR normalMap/roughnessMap，不再为漆面和金属注入专属 onBeforeCompile 噪纹。源图/贴花由 loader 继续拥有；新增确定性 128² DataTexture 按模型内类别共享，材质 dispose 监听由最后一个引用唯一释放，不得再次交给源 loader 重复释放。enamel/steel 存在无 UV primitive，只保留标准参数，不偷偷补 UV；需要完整微表面时再通过明确的制作流程整理 UV。
- 本轮接触阴影保持 dirty 驱动的深度投影与两次模糊，1024² HalfFloat 目标由舞台释放；接收平面与正交相机覆盖范围必须一致，不能缩接收平面造成阴影错位。该近似不宣称多次反射或全局光照。
- 打字机保留源几何、初始姿态与最终平铺端点，允许在有真实几何证据时修正中间路径：当前两盖板 Z 避让和十个大件错开的平铺区间由基准姿态确定性计算。不得把修正后分层/平铺描述为全部未改变，不得以指定部件的离散采样宣称全模型连续碰撞认证。有限击发、自由相机与热点仍独立。证据与限制见 [本轮精修](typewriter-quality-validation.md)。

- 2026-10-10：Reventón 正式工作台复用原 GLB/贴图/EXR；v3 控制旋转与分离、共同 OrbitControls 管理自由相机。固定导演只适用于 legacy。汽车拥有局部面光源与实时接触阴影，不创建额外 Canvas；解析限三张图并及时撤销 Blob URL，禁止通过缩纹理或换影片掩盖加载错误。现有运动资源只在制作时采样，不在访客加载阶段请求。

- 2026-10-09 钢琴恢复沿用 GLB 通道：原网页剖切几何、封口、材质、34 个形变网格和采样动画离线导出。`piano-v1` 使用原生 Three AnimationMixer 定位进度；GSAP 只补间归一化进度，相机独立。资源包独立预算约 124.5 MB / 1,198,962 三角面，不套历史 10 万面限制。模型、动画和源材质由 loader 唯一释放，适配器释放 mixer 绑定，loadAdapter 释放 PMREM。热点用预计算局部边界结合当前节点世界变换，不逐帧遍历顶点或创建几何。源页面与 Blender 场景不进入运行时。

- 2026-10-09 用户要求先迁自有 Kimi 打字机并撤出音箱正式计划。默认 typewriter-study 为 572 部件 GLB；源/动作资源保留，注册适配器复用唯一 renderer，不导入源网页的渲染器或导演相机。后续正式资产先汽车；下方音箱顺序仅为历史。这个资源有独立 manifest 预算，不套旧 10 万面上限。

- **2026-10-01 当前工作台使用真实 Three 程序化流程样板，这是本轮对下方「交付 GLB」要求的明确例外。** 正式模型之后按音箱→打字机→汽车接入；共用统一 adapter 和 Canvas，不预加载旧汽车资源。旧高精 Reventón 仅在 legacy 入口保留，下面关于其固定流程与画质预算的规则不适用于新汽车样板。

- **2026-09-28 用户强制要求：Reventón 的核心实现原理必须是 Three.js。** Blender 只制作/烘焙资产；浏览器用真实 Three 场景、几何、PBR 材质、相机和 WebGLRenderer 实时执行展示。Vue/TresJS 仅作为装配层，GSAP 管理导演流程。不得用影片、预渲染图片序列或外部查看器冒充实机演示。
- Reventón 按用户质量优先要求，允许保留超过以下通用模型预算的原几何与高分辨率贴图；必须记录实际预算与释放路径，不得据通用 10 万面限制擅自降低该展品品质。静态照明可以烘焙，运动导致的变化阴影不可烘死。细则见 `reventon-realtime.md`。

- 交付 GLB，Y 向上。legacy loader 归一化；新资源包通过配置整体 transform 指定单位/落地位置，不改局部节点轴心；运行时不能在逐帧回调重复求 Box3。
- 旧通用 loader 保留 100,000 面限制；新正式资产通过版本化资源包声明独立预算，运行时核验实际值。不得套用旧上限自动减面。
- 正式资产贴图尺寸由近景质量决定，记录字节数、通道语义、显存估算与实机表现，保留制作母版。旧资源预算只用于 legacy。
- GLB 对象用 shallowRef，切换模型先清理旧请求与旧场景。
- 自制样品没有外部资源；六个导入样品为自包含 Draco GLB。Draco 在 useModelLoader 集中接入，解码器使用已安装 Three 版本的 glTF WASM 构建并自托管。每次解析拥有一个 decoder，在解析成功/失败/迟到返回后释放；请求代次阻止旧模型覆盖新模型。新工作台 GLB 通道另支持 Meshopt / KTX2；其转码器同源，实例每次解析独立释放。
- 模型 geometry、material、texture 分别去重释放，关闭 ImageBitmap；迟到的异步结果也必须释放。
- 生产展示 renderer 只由 TresCanvas 创建与释放；独立渲染实验页遵守上方单 renderer 例外。反射环境不向全局缓存无限追加。
- HDR 必须同源、自托管；新正式资产使用独立预算，旧基础 HDR 的 2 MB 限制仅对旧通道生效。先显示 RoomEnvironment；请求可中止，源纹理、PMREM 与旧环境均由创建方唯一释放。
- 扫描覆盖层可以复用 loader geometry，但不得拥有或释放它；覆盖 Mesh 与共享 ShaderMaterial 由覆盖层自己释放。
- 静态场景按需渲染，GSAP 或 controls 改变相机必须 invalidate。
- 相机、模型移动与 DOM UI 分层；Three 坐标变化不得触发逐帧 Pinia 更新。
- 鼠标拖动旋转以外，提供命名视角按钮供键盘用户观察模型。
