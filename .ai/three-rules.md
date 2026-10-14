# 当前实时渲染约束（2026-10-14）

- 最新 realtime 候选只过滤 signedDelta，不过滤原生环境亮度。raw hit=SSR.rgb×captureAlpha−nativeSingle，raw miss／unsupported=0；final=beauty+filteredDelta×correctionWeight。每个空间与历史 tap 的 support／边界进入分子和分母，不能只做最终 mask。全 miss 暖历史 GPU 已验证严格零；局部 miss 可接受同表面的有效邻居修正，不把它误写为逐像素 filtered miss 恒为零。保留负修正，不以 RGB black 判断 miss。
- signedSpatial 使用八个固定几何引导 tap 和稳定 native luma；signedHistory 使用四 tap 表面 motion、depth／世界 normal／roughness 拒绝、signed 邻域范围、最多 16 帧。不能称为官方完整自适应核、hit-point 重投影或路径追踪等效。只有成功完整帧后 commit GPU history／depth／normal／camera，取消、错误、尺寸变化及卸载各有清理路径。旧统一替换过滤与非零全 miss 结果属于历史；最新证据见 [有符号修正](typewriter-signed-reflection-validation.md)。

- 自有 HDR RTT 显式声明 HalfFloatType／线性颜色空间。r185 中 options 替换默认参数，不能只传 depthBuffer 后依赖 HalfFloat 默认。真实 GPU 已确认原 RGBA8 将 HDR 及 10000 哨兵截为 1；诊断只复制成功完整帧，PNG 为后续固定姿态帧，不冒充同提交帧。证据见 [HDR 修复](typewriter-hdr-rtt-validation.md)。

- 打字机实时入口为 `?product=typewriter-study&renderPipeline=realtime`；默认 WebGL 与钢琴／汽车原管线保持。旧 hybrid 的 128／1024 样本与 OIDN 只属于历史静止精修入口，不是此阶段要求。
- 固定 Three 0.185.1，唯一 TresCanvas／renderer／实际绘制时钟。WebGPU 受检桥接集中在 `realtime/clock`，检查版本及私有形状；隐藏、离屏停钟，设备恢复卸载旧宿主后重建。
- 完整帧拥有相机完整投影、世界矩阵与实例历史；MRT 用 `motion`，最终呈现成功后才提交 previous。不能让阴影／反射辅助 draw 的原生 velocity 更新提前消费历史。刚体之外的 morph／skinning 不直接套用此实现。
- 整体画质是最高优先级。保留已有摄影棚完成度，用同资产、同取景、同曝光比较；技术更新、像素变化和低耗时不能单独作为晋级依据。画面退步时先修正或保留原效果，不因算法名称更先进而替换已验收入口。
- `sceneInputs` 在同一 renderer 中分离不透明六 MRT 与完整透明 beauty 两 MRT，各自拥有独立深度。surface 的 HalfFloat normal／原生导数 roughness、baseDiffuse 的清漆 alpha 等语义保持；六附件存储 40 字节／像素、对齐成本 44 字节／采样点，明确请求 `maxColorAttachmentBytesPerSample: 64`。完整 beauty 额外增加一次不透明绘制与约 16 字节／像素目标成本，必须测量，不宣称所有信号共享单 pass。输出比例与源纹理尺寸不变，SSR quality 1、thickness 0.035 的收益仍需实机核对。
- 地台平面反射沿用唯一 renderer 的离屏绘制，Basic 材质捕获权重为零，排除 SSR 替换；不能把它与商品完整 IBL 再重复相加。保留屏幕外舞台反射不等于已经接入世界空间射线追踪。
- 支持的基础 Physical 支路用自有运行 NodeMaterial、受检 r185 DFGLUT 捕获环境辐射单次散射项与 AO／清漆透过权重。SSR 只给命中辐射；`reflectionResolve` 在过滤前逐射线组合：命中=`rawSSR × AOcoat`，未命中=`nativeSingle`，再统一过滤 RGB＋ray length。最终将 `filteredReplacement − nativeSingle` 与漫反射修正乘完整 beauty 的 `correctionWeight` 后合成；该权重是透明材质 opacity 混合后的 transmittance，不是 roughness 或捕获附件 alpha。保留 native miss、多次散射与清漆，未支持像素不应用修正。非默认 IOR／specular 参数或贴图、独立 envMap 等支路不参与替换。不得全局改 PhysicalLightingModel 原型，不直接叠加完整 SSR 与完整原生 IBL，不回馈完整替换到已含 IBL 的 beauty 冒充多跳追踪。
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

下方为保留的历史约束。涉及 hybrid／OIDN 的“新正式管线”表述仅记录当时阶段，以本页当前实时规则为准。

2026-10-02 当前正式资产阶段优先遵循 [完整路线](implementation-roadmap.md)，下面历史演出说明仅适用于 legacy。

2026-10-12 新正式管线约束：单 Tres renderer，WebGPU 光栅与路径追踪通过协调器切换，不叠加场景 Canvas；追踪代理独立拥有派生几何/BVH，原 loader 不受修改。128 实际最低样本＋完整 OIDN 为固定默认，1024 仅主动续算并呈现真实累积原图。引导 RenderTarget 的附件名称必须匹配 MRT 输出，MRT 节点按宿主复用，不能每轮降噪重新创建。当前只交付打字机供用户验收，默认保留 WebGL；钢琴／汽车新管线另行规划。实验入口与验收见 [混合管线验收](hybrid-pipeline-validation.md)。

# Three 规则

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
