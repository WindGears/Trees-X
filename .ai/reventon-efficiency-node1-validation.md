# 汽车效率节点一：生命周期、真实PSO预热与高斯采样复用

日期：2026-10-21。代码起点`2e90f16`。本节点按用户“借鉴3A游戏，在保留画质前提下提高效率”实施。保持源模型、4K运行资源、灯光、曝光、2048²接触阴影、实际1440×1000输出及动作机构；普通WebGL入口保持。本节点不等于整车稳定30帧或全部效率问题已解决。

## 实现范围与所有权

1. **正确的资源交接**：`useWorkbenchScene.load`先等旧原生任务结束，在新preparation lease之前卸载旧协调器／适配器，使Speedball单例实际释放。`ddgi/field`将proxy.sync、底层构造及初始化纳入同一异常清理，底层释放抛错仍清理代理；不强清上游单例、不重建日常renderer。
2. **真实PSO预热**：场景适配器增加局部可选prepare协议，controller只委托当前适配器。汽车先准备真实私有阴影，再准备surface六MRT及beauty双MRT；复用唯一renderer、停用中的绘制时钟和当前加载lease，串行await。每次选择有独立取消信号，迟到结果不得发布；原生compile不能中途撤销，输入资源仍保活至结算。
3. **缓存变体与状态一致**：MRT使用实际线性HDR、HalfFloat输出、samples=0及既有附件格式；只在准备期临时关闭注册商品的视锥剔除，保留mesh可见性、层和真实相机。透射材质的单独延后规则见下文，真实绘制状态不改。阴影分别准备depth、无深度横向blur、有深度纵向blur，显式匹配r185 compileAsync读取的renderer.depth／stencil。相同shader不代表不同附件布局可以共用PSO。
4. **同核采样复用**：高斯仍为radius32／sigma13，源和目标同为2048²、线性过滤、无mip。相邻正权重合并为一个双线性采样，从每方向65次降至33次；原核范围与归一化权重不变，不降低阴影分辨率或反射质量。WebGL未改。

`preparationState`保存并在finally恢复target／MRT／viewport／scissor／输出映射／opaque／transparent／context／XR／阴影开关／depth／stencil、scene override／background／name及camera layers；临时剔除与blur uniform也恢复。编译不清阴影dirty、不提交运动历史、不宣告首帧成功；仍等待真实完整实时帧后才开放交互。原始loader、运行材质、探针、阴影和Tres renderer分别保持唯一释放方。

Three已有同device内的shader／PSO缓存；本次利用正确变体预热和稳定对象身份，不导出原生GPU二进制、不创建跨商品无限缓存。参考 [Epic PSO预热](https://dev.epicgames.com/documentation/unreal-engine/pso-precaching-for-unreal-engine) 的准备／首次使用划分；实际运行依当前固定Three0.185.1源码，不使用不存在的compute编译API。

## 对照入口

候选入口继续为`?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2`。注册汽车的WebGPU默认开启本节点优化；`carPrewarm=off`保留旧主场景编译路径，`carShadowKernel=legacy`保留65次采样。两者只用于受控对照，不新增访客选项、API、数据库迁移或展示配置版本。

局部snapshot的`preparation.sceneInputs`与阴影plain userData记录实际完成状态／核模式，测试同时核对状态、真实模型摘要和native创建请求，不仅检查URL。状态不代表所有后效、DDGI计算或浏览器／驱动缓存已命中。

## 真实GPU结果

同一生产构建，Edge155.0.4283.62，无窗口测试，WebGPU adapter.vendor=`nvidia`、architecture=`blackwell`，输出1440×1000。基线使用off／legacy，候选使用on／paired；未启用GPU timestamp、额外RAF或像素读回。测试实例局部包装真实GPUDevice创建调用，保留返回值、this与异常，最多5000条，不记录WGSL源码、不改全局原型。

| 首次DDGI及12个真实完整帧检查点 |    对照 |    候选 |
| ------------------------------ | ------: | ------: |
| 同步render pipeline创建请求    |     103 |      62 |
| 异步render pipeline创建请求    |      29 |      47 |
| compute pipeline创建请求       |       6 |       6 |
| shader module创建请求          |     227 |     199 |
| 导航至检查点观测（ms）         | 23815.8 | 21349.8 |

各组仅1次，包含driver／OS缓存、下载、资源准备与观测开销；最后一行不是首个可互动帧、GPU耗时或完整冷／热中位数。只能说明本次同步创建减少、更多PSO进入异步准备，不据此宣称固定提速比例。原生创建请求也不能直接称driver cache miss／hit。

对照完成开门、关门、座舱、分离和复原；候选额外完成4次真实同宿主重载，每次root更换、实际DDGI就绪、唯一Canvas／renderer及真实动作均通过，无采集错误，清理确认。候选首次及各次重载后的开关门区间，原生PSO创建计数保持不变。完整后效与DDGI首次准备仍有同步创建，未宣称全链异步化。

先前有窗口测试出现约1Hz帧回调，即使页面active也不能据此推导单帧GPU耗时；该次由监督者主动中止并另存原因，不记应用崩溃。桌面工具因无法可靠确认URL拒绝窗口激活，未绕过限制。[Chromium原生遮挡机制](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/windows_native_window_occlusion_tracking.md) 是后续隔离线索，尚未证明它是本机唯一原因。本批无可用实际显示呈现记录，30帧目标仍待验收。

### 阴影原生目标像素对照

单独测试，SSGI保持相同，依次读取真实2048² RGBA8接触阴影目标；不将读回混入性能记录。每次定位分开提交动作意图、等待实际新帧及队列结算，核对真实进度、核模式与唯一Canvas。三姿态各4194304个alpha像素：

| 姿态        | 最大alpha字节差 | 平均alpha字节差 | 不同像素数 |
| ----------- | --------------: | --------------: | ---------: |
| 全车归零    |               1 |     0.000150919 |        633 |
| 双门全开    |               1 |     0.000144243 |        605 |
| 两通道均0.6 |               1 |     0.000217199 |        911 |

均无大于1字节的差异。理想线性插值的数学测试误差小于1e-14；实际GPU仍有RGBA8／插值舍入，不能宣称逐位相同。全景截图检查未见阴影承托或轮廓退步；随机反射原有颗粒仍存在，本节点不宣称颗粒或整体画质已完成。首次像素脚本把两个意图同批提交导致一条被Vue合并，已修正为分开提交后重跑；保留失败报告，不移作产品回归。

## 工程、生命周期与剩余阶段

### 跨商品透射回归与收束

首次完整回归已通过15项功能但捕获Framebuffer格式错误，不能算通过。追加阶段和实例级只读copy诊断，复现设备恢复、汽车→打字机和失败重试后HDR源`rgba16float`与已初始化的`bgra8unorm`快照不匹配；真实draw stack确认不是可忽略的控制台提示。Three r185异步编译恢复render context后仍执行节点更新／binding，公共纯编译路径不能保证透射viewport无副作用。

候选修补将实时商品统一准备实际MRT（汽车另准备私有阴影），仅预编译期间按唯一材质暂时排除transmission／transmissionNode／backdropNode。保留普通alpha字符、不透明混合组和原可见状态；finally恢复后，透射PSO／快照在唯一协调器提交的真实完整首帧建立，期间加载遮罩保留。没有去掉玻璃、降低精度、过滤错误或修改Three全局原型。透射首次成本仍存在，不宣称全链异步预热。

最终生产构建已重新完成；上述PSO表为透射修补后的`baseline-final`／`candidate-final`，不是修补前数据。汽车核心`core-final`16项通过，包括实际GPUDevice.destroy、双进度暂停恢复、汽车→打字机→钢琴、迟到响应、实际manifest失败及重试；意外错误与格式诊断均为零。四次同宿主重载的18个检查点实际DDGI均正常，开关门、座舱、分离区间的创建计数保持不变。管理`admin-final`2项通过，两次真实认证预览、右键平移与实际取景回填，未写正式配置／数据库。首次管理调用被缺少GPU串行确认标记的前置保护拒绝，保留报告，设置已保留的测试槽后重跑；未将该前置拒绝算应用失败或通过。

工程结果：120个Vitest文件／790项、131项汽车运行与诊断工具测试通过；架构、模型、demo工具、实时probe、打字机v2／黑漆工具分别通过。`npm run check`执行到format阶段，仅既有用户文件`PERFORMANCE_OPTIMIZATION.md`不符合Prettier，未改该文件；typecheck、lint及后续各检查已单独运行通过。`npm run demo:prepare`完成前端build、后端package及三件运行资源核对，生产服务已重新启动。本节点未修改后端代码／数据，未以此宣称本轮新增MySQL测试。用户既有`TypewriterStudy.vue`改动保留在工作区，不纳入本提交。

原始JSON、alpha、截图与进程记录位于忽略目录`artifacts/car-efficiency-20261021/`，不提交临时材料、凭据或汽车资产。

Cline使用`deepseek-v4.1-flash`请求max执行独立辅助任务，返回被长度截断、未形成可应用提交，实际强度仍未获上游确认。未将截断输出整合生产；高斯辅助和验证由主代理实现。另由协作代理完成DDGI严格单例测试及诊断工具，实际GPU与画面判断由主代理统一串行执行。

仍需后续独立节点：不变材质／选择的dirty去重、间接光与绘制调度、重复不透明PBR和玻璃快照共享、拾取加速、解码服务复用、有界GPU在途提交及静止休眠。全部保留画质对照；本节点的4次重载不替代最终30次／20分钟联合验收，最终呈现帧率与用户实机走查保持待验收。
