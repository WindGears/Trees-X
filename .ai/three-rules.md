# 当前实时渲染约束（2026-10-13）

- 打字机实时入口为 `?product=typewriter-study&renderPipeline=realtime`；默认 WebGL 与钢琴／汽车原管线保持。旧 hybrid 的 128／1024 样本与 OIDN 只属于历史静止精修入口，不是此阶段要求。
- 固定 Three 0.185.1，唯一 TresCanvas／renderer／实际绘制时钟。WebGPU 受检桥接集中在 `realtime/clock`，检查版本及私有形状；隐藏、离屏停钟，设备恢复卸载旧宿主后重建。
- 完整帧拥有相机完整投影、世界矩阵与实例历史；MRT 用 `motion`，最终呈现成功后才提交 previous。不能让阴影／反射辅助 draw 的原生 velocity 更新提前消费历史。刚体之外的 morph／skinning 不直接套用此实现。
- 整体画质是最高优先级。保留已有摄影棚完成度，用同资产、同取景、同曝光比较；技术更新、像素变化和低耗时不能单独作为晋级依据。画面退步时先修正或保留原效果，不因算法名称更先进而替换已验收入口。
- 共享六信号 G-buffer：HalfFloat normal／原生导数调整后 roughness，baseDiffuse 使用 RGBA HalfFloat 并以 alpha 保存清漆透过权重；存储 40 字节／像素、WebGPU 对齐验证成本 44 字节／采样点，明确请求 `maxColorAttachmentBytesPerSample: 64`。原输出比例和源纹理尺寸保持，不自动降画质掩盖失败。当前 SSR quality 1、thickness 0.035，参数收益必须实机核对。
- 地台平面反射沿用唯一 renderer 的离屏绘制，Basic 材质捕获权重为零，排除 SSR 替换；不能把它与商品完整 IBL 再重复相加。保留屏幕外舞台反射不等于已经接入世界空间射线追踪。
- 支持的基础 Physical 支路用自有运行 NodeMaterial、受检 r185 DFGLUT 捕获环境辐射单次散射项与 AO／清漆透过权重。SSR 只给命中辐射；`reflectionResolve` 在过滤前逐射线组合：命中=`rawSSR × AOcoat`，未命中=`nativeSingle`，再统一过滤 RGB＋ray length，最终为 `beauty + filteredReplacement − nativeSingle`。保留 native miss、多次散射和清漆，未支持像素不应用修正。非默认 IOR／specular 参数或贴图、独立 envMap 等支路不参与替换。不得全局改 PhysicalLightingModel 原型，不直接叠加完整 SSR 与完整原生 IBL，不回馈完整替换到已含 IBL 的 beauty 冒充多跳追踪。
- 命中必须在过滤前由原始 SSR alpha 的 ray length 判定；时域／空间过滤后的 alpha 不保证仍是原始 ray length，不能拿它当 hit/miss。此前反射颜色与 coverage 独立过滤的非线性权重不一致，radius 5 后仍有明显噪点；该支路已移除并保留历史结果，当前不能继续描述为独立 coverage 合成。统一 resolve 自有 RTT／历史／过滤器由局部 owner 释放；四项生产核心与六组契约通过，不由公式或工程 PASS 推断画质通过。
- 当前统一替换信号过滤半径为 5。实时舞台 HDR 合成权重 0.5／0.68 属于反射／接触阴影视觉校准，旧 hybrid／WebGL 保持 0.28／0.46；不得称为 BRDF 等效或普适物理参数，需新截图核对。旧 coverage flickerSuppression=0 仅为历史试验参数，当前已无独立 coverage 支路。
- SSGI 是屏幕空间经验贡献，官方实现含亮度 7 的限制；不得称为完整物理 irradiance、严格无截断或路径追踪等效。字符／铭牌透明贴片、微表面与细边需单独近景核对；当前键帽本体不透明，不能把贴片计数误称玻璃材质数。
- 源 geometry／material／原尺寸纹理由 loader 唯一释放；运行材质只借纹理，卸载恢复源身份，不得 dispose 源材质做重编译。历史、环境辅助图、过滤目标与监听各自唯一拥有。
- r185 将表达式隐式转为 RTT 的调用必须有显式目标／quad 材质释放方；不能假定效果节点 dispose 会递归释放输入。EnvironmentNode 的 PMREM 节点生成器亦由受检局部桥接释放，不能仅释放源 HDR 后保留 LOD／ping-pong 资源。保护 loader 资源，固定版本与形状检查，真实重载验证后再声明无增长。
- r185 的共享 geometry 多 RenderObject 附加 GPU attribute 由 `realtime/geometryOwnership` 受检桥接补齐释放。汇总真实绘制使用的 attribute，交错 view 按共享 backing 引用记录；loader 继续唯一拥有源 geometry，桥接只处理遗漏的 GPU 数据释放，不提前 dispose 源数据。释放顺序为协调器→controller／环境→桥接，卸载恢复原生方法，不留全局原型补丁。8 项真实模块机制测试不能替代完整重载实测。
- 阶段 1 尚未完整验收：当前核心、六组公平对照契约、管理取景、故障、尺寸兼容及实际 20 分钟操作通过；52 正式循环的固定预热资源无增长，不代替 30 次卸载重载。六组静图仍有前罩噪点、字母颗粒和地台倒影不足，画质未通过。503 取消按严格窗口及真实恢复分类，不全局忽略 ERR_ABORTED；回调接入与实际设备销毁证据区分。三轮 JS 提交计时不代表 GPU 或实际呈现预算。当前 30 次真实重载及默认 WebGL 五项操作回归已通过；真实隐藏因本机环境未暴露 hidden 仍待验收，本人走查待完成，旧 coverage 版重载不替代新链，默认保持 WebGL。DDGI／FFX／BVH 不扩展，证据见 [实时渲染验收](realtime-rendering-validation.md)。

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
