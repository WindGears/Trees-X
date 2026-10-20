# 汽车清后台后的启动、加载与交互审查

日期：2026-10-20。生产代码基线 `80f9304`，仅增加审查工具与记录；未改变渲染质量、运行资源、API、数据库或系统电源设置。用户已有 `TypewriterStudy.vue` 修改与三份未跟踪文档不属于本节点。

本文补充 [首次全面审查](reventon-comprehensive-audit-2026-10-20.md)。正式记录来自本次晚间连续批次；上午／下午被会话中断的批次保留原始材料，不拼接成完整验收，也不据此判定应用崩溃。

## 结论与状态

清除其他应用负载后，汽车仍有加载组织、首次准备与生命周期问题。4K／KTX2候选确实降低文件和纹理逻辑存储，但热缓存并未免除重新解析、转码、上传和管线准备。当前不能宣布汽车整体通过或稳定30帧。

已确认新的阻断缺陷：同一宿主首次重载后，新模型和基础画面就绪，DDGI却因旧探针场未实际释放而退回SSGI。需要先修正所有权交接，再重新进行30次重载验收；不能把回退基础光照算成增强成功。

## 方法与固定输入

- 真实本地API、实际汽车资源、Edge有头窗口，1440×1000、DPR 1；不缩输出、贴图或改灯光。
- 每种加载模式独立创建测试专用持久浏览器目录；冷加载仅清浏览器HTTP缓存，热加载在同一目录／页面普通重载。未清操作系统、驱动shader缓存，不代表重启后的全冷环境。
- 使用CDP真实`responseReceivedExtraInfo.statusCode`统计304。普通`responseReceived.status=200`可能是缓存规范化结果，不能单独判定是否重复下载。
- 加载以导航相对`interactiveMutationAtMs`记录真实工作台ready；完整增强另记`enhancedReadyObservedAtMs`。脚本起止包含截图和诊断取证，不能直接当加载时间。
- 核对真实root、资源摘要、135 mesh、1,500,363三角、实际纹理格式与唯一Canvas／renderer。DOM商品名不单独作为场景身份。
- 性能基线不开CDP trace和GPU时间查询；独立GPU诊断另外采集。JS提交回调间隔、GPU pass时间、实际显示呈现分别报告。
- stress中的拦截器用于拒绝写请求，并会影响HTTP缓存；其重载耗时不纳入冷／热加载统计。

## 已确认的加载证据

四种入口均完成5冷／5热、合计40次。下表单位为秒，中位数后列最小—最大；ready为导航相对的真实工作台状态，增强是实际支路就绪观测，不是GPU呈现或物理收敛证明。

| 入口                     |          冷ready（n=5） |          热ready（n=5） | 冷增强（n=5） | 热增强（n=5） |
| ------------------------ | ----------------------: | ----------------------: | ------------: | ------------: |
| runtime-v2／WebGPU／SSGI | 23.904（18.626—25.131） | 24.606（18.328—26.313） |        23.953 |        24.654 |
| runtime-v2／WebGPU／DDGI | 18.460（18.365—22.230） | 18.530（18.320—18.852） |        25.740 |        25.691 |
| 原包／WebGL／legacy      | 31.669（30.626—33.744） | 32.519（29.017—33.612） |        不适用 |        不适用 |
| 原包／WebGPU／SSGI       | 29.446（22.971—31.869） | 29.278（23.576—31.822） |        29.538 |        29.366 |

跨组含资产、legacy／streaming路径、导航前置停顿及热状态等差异，不是纯更换renderer的消融。尤其不能由表中ready断言DDGI比SSGI初始化快；DDGI的实际增强在ready后约7.1秒被观测到。候选parse→materials中位约11.6—12.0秒，first-frame→ready约5.6—5.8秒；阶段仍含重叠下载／转码及准备，不能命名为纯GLB解析或纯GPU帧。

- runtime-v2热加载每次观测到76个真实304，但GLB仍实际传输约101MB，模型相关传输合计101,122,643字节。不能把HTTP缓存命中当成已缓存解码几何、转码纹理或GPU资源。
- 原包热加载仍传输约965MB，大文件包括约101MB GLB及多张约58—76MB PNG。已有ETag与`Cache-Control: no-cache`，后者不是`no-store`；具体大文件未复用原因尚未独立证明，不能先归咎某条缓存头。
- 原包实时SSGI的第5个热样本真实304为0、传输约1.745GB；该样本保留，不能因不符合“热必命中”预期而删除。DDGI候选热加载有150个真实304，包含74张辅助图，不应与SSGI的76个304混用。
- 连续重载出现HTML已收到但DOM交互／商品config开始仍晚约6—7秒的停顿。这段在模型下载／parse之前，不能计为MySQL或纯模型解析；浏览器／旧资源回收等原因待进一步隔离。
- 首次`first-frame`至ready仍包含实际目标初始化、上传、编译及私有pass绘制，不是单个GPU帧耗时。

## DDGI重载的精确根因

`useWorkbenchScene.load()`先等旧native工作结束，然后获取新`withPreparationLease`。旧`realLighting.unload()`却在这个新lease内部执行。`field.dispose()`把底层清理交给`afterPreparation`，因此旧Speedball模块单例要等整个新加载结束才释放；新加载中途先创建新field，立即触发`only one active field is supported per module instance`。

实机失败记录同时确认：root UUID已经改变、同Canvas／renderer、新模型ready、requested=ddgi、actual=ssgi、preparing=false且有明确单例错误。测试严格拒绝将其记为通过。

修复边界：停止旧绘制并等待旧工作 → 在新lease之外卸载旧owners → 再为新加载取得lease。另将`proxy.sync`与`createProbeField`构造异常一起纳入proxy清理范围。目前只完成诊断，未实施生产修复。测试需组合真实延迟释放与严格单例，而非只断言外层dispose被调用。

## 着色器缓存与3A优化的落实方向

用户明确要求借鉴3A游戏优化。优先采用PSO预热、稳定变体、增量失效、按需资源和有界提交；不通过降画质替代组织优化。

当前Three 0.185.1已经有同renderer内的WGSL module／PSO缓存。项目仅一次主场景`compileAsync`，没有完整覆盖实际surface六MRT、beauty双MRT、汽车私有阴影／模糊、玻璃快照、反射过滤、SMAA和DDGI。相同shader在不同目标格式、MRT、混合或采样状态下仍可能需要不同PSO。

下一实施节点应为：

1. 先修DDGI旧owner交接，保证取消与重复加载可靠。
2. 按真实target、MRT、层、override和透明分支预编译必需图形pass，所有临时renderer状态在`finally`恢复。
3. 后效与DDGI按实际依赖分批准备；保持唯一时钟与preparation lease，不能用第二渲染循环假装后台预热。
4. 记录cold/warm、预热命中、漏编译、首次实际pass与动作中pipeline创建；稳定颜色／姿态改uniform，不制造无谓shader变体。
5. 最后按证据评估有限变体保留、资源持久缓存和解码器复用，分别规定字节上限与device失效清理，不常驻多辆高精场景。

WebGPU没有向页面提供可序列化的原生PSO二进制缓存接口；浏览器／驱动底层缓存由实现管理，不承诺导出GPU对象到IndexedDB或跨设备复用。历史诊断互动区间未新增pipeline，故持续低帧仍需另处理重复PBR、动作阴影、间接光与帧调度。

实现时另有两条边界：preparation lease只是资源存活计数，不是renderer互斥锁，实际compile／render须通过停止绘制与同一任务队列串行执行；安装版异步PSO编译的错误路径可能仍让Promise fulfilled，因此还须核查错误并保留首个真实完整帧门禁，不能仅以compileAsync resolve宣告准备完成。

技术依据：[Epic PSO预热](https://dev.epicgames.com/documentation/unreal-engine/pso-precaching-for-unreal-engine)、[Three Renderer](https://threejs.org/docs/pages/Renderer)、[WebGPU异步pipeline创建](https://gpuweb.github.io/types/interfaces/GPUDevice.html)。当前安装版不含文档新版本的`compileComputeAsync`，不得照搬不存在的API。

## 验证记录与限制

### 操作与生命周期

- 汽车核心16项通过：真实模型／运行包、开门正反与暂停、动作组合与复原、热点跟随、鼠标键盘接管、导览、失败重试、迟到响应、真实GPUDevice销毁恢复及跨商品宿主所有权。合成visibility回调测试不算真实页面隐藏。
- 管理预览2项通过：未保存取景回填、再次预览与返回，正式商品持久化摘要前后一致。浏览器viewport为1440×1000，预览实际输出1125×680，仅证明功能，不算完整尺寸性能验收。报告无独立进程清理确认协议，不能据Canvas已卸载宣称所有原生进程均受验证。
- 正式30次同宿主重载在第1次因上述DDGI单例错误失败，成功重载0次，未进入该任务的20分钟操作；不是“30次都失败”或“20分钟崩溃”。失败浏览器清理已确认。另行fresh-context持续操作和真实隐藏结果须单独列，不覆盖重载失败。
- 独立fresh-context持续操作通过：20分1.454秒、94轮流程、564次正式操作（报告570次含6次预热）、94个检查点。真实1440×1000、同Canvas／renderer、实际DDGI；复原检查点的20个render target、151个geometry、180个program、133个texture及其他受检计数与固定暖基线一致，无新增采集错误。只证明本次固定场景操作和资源平台，不能覆盖重载错误、物理显存泄漏或显示FPS；浏览器清理已确认。
- 独立真实visibility尝试未能让测试页面观测到hidden：已尝试窗口最小化及前台空标签，未伪造属性／事件或用生命周期冻结代替。工具流程完成但该验收明确pending，不算隐藏停钟通过；测试浏览器清理已确认。

### 互动间隔与GPU诊断

DDGI与SSGI各完成3轮、每轮3段约10秒的旋转／开门／分离观察。多数段JS提交回调中位约8—17ms，但DDGI有2段、SSGI有1段未满足动作覆盖；局部出现约992—1007ms间隔，不能用较小中位数换算成显示FPS或宣布稳定30帧。

长间隔期间CDP状态读取仍能以约62ms间隔返回、页面报告visible／focused，GSAP进度同时停顿；因此没有证据把它等同于某个JS函数阻塞约1秒。RAF／浏览器宿主节流、窗口遮挡和GPU等待等仍需专门隔离，当前不能给唯一根因。连续动作不足的段落保留为覆盖失败，不删除长间隔样本。

独立GPU timestamp诊断完成1轮30秒，三段动作覆盖通过，但不满足三轮正式持续时长。未归属compute聚合组323样本中位11.076ms、P95为12.124ms；不能直接叫某个DDGI kernel或每帧总耗时。2048²阴影模糊组中位约1.507ms、P95约2.490ms；SSR组约0.852／1.704ms、空间反射过滤组约1.049／1.835ms。组内含重复draw，不能把各组中位相加当帧耗时。

NVIDIA安装的PresentMon尝试针对测试浏览器GPU进程采集，两次均exit1且无CSV，原因未确认；未提高权限、未停止他人ETW会话。故本批没有可用的实际显示呈现间隔，`presentedFrameBudgetValidated=false`，不能把JS提交或GPU pass计时冒充目标已达成。

### 本机运行条件

20分钟操作区间的599个约2秒硬件采样中，RTX5060 Laptop实际功耗66.75—115.66W、中位94.38W；温度75—88°C、中位86°C。全设备显存已用3923—4255MiB，包含浏览器／系统其他分配，不是汽车独占显存。该区间驱动power.limit字段为N/A，不能据实际最大功耗反推厂商配置TGP；更不能继续称显卡固定限30W。未调整系统电源、超频或结束用户应用。

原始截图、JSON、硬件CSV及测试专用profile位于忽略目录`artifacts/car-clean-20261020/`；不提交临时证据、凭据或未获再分发许可的汽车资源。完整串行任务已结束，工程复检结果另列。

### 复测入口

先用已有`npm run demo:start`确认真实API与生产预览就绪，再串行执行`npm run test:reventon-clean-load`、`npm run test:reventon-performance`及`npm run test:reventon-clean-stress`；不得同时启动多个GPU审查任务。默认加载为四种模式各5冷／5热，压力工具默认30次真实重载、20分钟持续操作；短模式必须明确smoke，不计正式时长。

`REVENTON_LOAD_MODES`可选择`original-webgl`、`original-realtime-ssgi`、`runtime-v2-ssgi`或`runtime-v2-ddgi`；`REVENTON_LOAD_OUTPUT`指定忽略目录输出。压力工具`REVENTON_STRESS_SCOPE`支持独立范围，fresh soak只说明该范围，不覆盖失败的重载。工具仅访问本机、不改正式商品，持久浏览器目录为各自新建测试目录；网络缓存、真实模型身份和清理状态进入报告。

`npm run test:reventon-runtime-tools`包含缓存证据、实际动作覆盖、固定资源平台、截止时间及原运行包工具的纯单元测试，不启动GPU。审查脚本后续加固了直接状态读的期限及先落报告再清理；这些新增纯工具改动不反向改变本次已采GPU记录，报告中的脚本摘要保留实际执行版本。

### 工程复检结果

- `npm run check`：typecheck及ESLint通过，在全仓Prettier检查处因用户已有未跟踪文件`PERFORMANCE_OPTIMIZATION.md`格式失败；该文件未修改、未纳入本提交。因此不能宣称总check通过。
- 已独立补跑被上述短路阻止的后续检查：架构103个Vue组件均不超过300行，基础模型预算检查通过，Vitest 117文件／766测试通过；demo工具49、realtime-probe工具23、typewriter-v2工具36、paint工具14测试均通过。
- 新旧汽车工具合计124测试通过，含新增缓存证据、实际状态覆盖、资源平台、截止时间、只接受本机origin及性能报告清理契约。新增脚本语法、指定文件ESLint／Prettier通过。
- `npm run build`通过。默认资源／渲染入口、生产场景与数据库未修改，仍需后续修复节点重新执行实际GPU／生命周期验收。

本节点交付的是可复现审查工具、完整加载与长测事实及修复依据；不宣称着色器预热、DDGI生命周期或持续帧率已经修复。下一实施优先级为生命周期交接 → 按真实pass的PSO预热与分段计时 → 同画质阴影／重复绘制优化 → 拾取与无变化调度，再用实际呈现证据决定预算是否达标。
