# 汽车4K运行候选与实时降噪

日期：2026-10-19 至 2026-10-20。默认仍为WebGL；本文不复用旧批次成绩。

## 资源与入口

- 原包75张PNG：74张4096²、一张8192² AO；原环境2048×1024 EXR。
- 新包在`public/models/reventon-runtime-v2`独立制作，只缩超限AO，排除绒面修正后无人引用的44,657,923字节底色。已完成74张4096²KTX2和74张256²CPU GI辅助图（4,130,678字节）；全部外部图片已核验。
- 完整包473,608,445字节，原包1,744,549,649字节；入口GLB的整个BIN、语义节点、轴心、有效UV/法线和motion文件保持。manifest SHA-256为`0bd2a01fb6f1edc1ddd8a2fa906b8b32981b907b0ab0f651d07a94d688b08ed1`。严格校验0错误；74项MIME警告来自该validator未识别BasisU的KTX2图像类型，上游KTX逐图校验与实际GPU转码另外验证，不用忽略报错代替运行验证。
- UASTC q4、无RDO、完整mip、Zstd18；颜色sRGB，技术图线性，法线保留RGB/OpenGL约定。16位PNG量化为8位、UASTC及设备转码均有损，不称无损。采样wrap仍保留原值，mip边缘和透明细孔待整车近景检查。
- CPU转换耗时依图像内容变化很大。已经完成的图按源/输出摘要复用，不能把进度计数当作完整资源可用。
- `npm run asset:reventon-runtime`制作；编码后先`asset:reventon-finalize`，再`asset:reventon-verify`和`asset:reventon-register`。收束给GLB登记74张256²CPU间接光辅助PNG；上游Speedball跳过压缩图，不能省略此兼容步骤。可见材质始终使用4K KTX2。验证不通过不生成`reventonRuntimeBundle.json`，半包不提供成功入口；登记后拒绝重建或收束改写。
- 原包未提供再分发许可。新增派生二进制保持本机，Git仅收录工具、清单、必要制作记录；不新增公开分发许可声明。
- 永久制作证据保存到`resources/asset-records/reventon-runtime-v2`；本机运行输出及登记JSON保持忽略，避免新检出目录只有完成标记、却因没有二进制而无法重建。重建流程见运行目录README。

## 渲染改动

仅汽车启用；`carRenderTuning=legacy`保留修改前的同资产对照。

- DDGI每次完整预算不变，最多15Hz。纯观察镜头复用缓存；真实部件、材质、灯光和环境变更唤醒，停止后12个完整solve作为有限尾步，再暂停求解。不称为已测得物理收敛。
- signed反射增加有界统计域的二阶矩、同表面命中距离置信度，历史上限32。均值由已过滤RGB在同一统计域重算，是有偏近似；统计第一通道改为连续缺样年龄。实际HDR修正保持正负，不降低反射强度、分辨率或扩大空间核。
- 原初版把当前随机无命中误当历史失效。汽车adaptive改为零新样本参与积累、命中距离/coverage平滑、明确拒绝门控与最多32帧连续缺样硬截止。unsupported、几何失配和cut立即清理；原打字机／legacy不变。不能把现在的随机miss衰减描述成原契约的当帧严格零。
- 新增当前/历史统计共16字节每像素，1440×1000为23,040,000字节目标分配，不代表额外物理驻留显存的实测值。
- 仅不支持表面跳过SSR射线起点，原深度和beauty仍可被其他射线命中。r185桥接只修改当前SSR实例，卸载恢复，不改Three全局。
- profile切换销毁旧信号图并创建新图，不重建共享renderer。

## 已执行证据

- 最新TypeScript、全仓ESLint及117个Vitest文件/766项测试通过（单worker）；汽车资源/测量工具96项通过。`npm run check`在全仓格式检查停止，本批记录格式已修正并逐项通过；另有用户未跟踪`PERFORMANCE_OPTIMIZATION.md`仍未格式化，未改动该无关文档。后续架构（103个Vue组件均≤300行）、模型、demo/realtime-probe/typewriter-v2/paint工具检查另行通过。
- 前端生产构建、`demo:prepare`的后端打包与原三件资源校验通过。
- 真实GPU双附件MRT探针：16×16两附件逐像素读回，负值与统计值最大误差0。修复了初版RTT结构输出标识丢失导致的WGSL编译错误，没有关闭GPU验证。
- 早期真实GPU signed契约在`signed-contract-probe`保存旧策略；不再将其全miss当帧零当作当前adaptive成绩。新`temporal-miss-probe/report.json`验证黑命中负修正、单帧随机miss衰减、32连续miss硬归零、交替命中/缺样达到32历史、显式reset与unsupported严格零。交替样本HalfFloat累计最大误差0.013671875（相对理论幅度2约0.684%），单独容差0.02；原严格零检查未放宽。保留初次量化/预热预期错误记录，不声称无偏。
- 原整车`original-ddgi-current/report.json`核心12项通过，真实模型、101点正反/旋转位移组合、热点聚焦/复原、交互和单宿主通过，无浏览器/GPU错误；本批未开启lifecycle，页面隐藏仅合成事件。
- 候选生产构建`candidate-production-core/report.json`16项通过，确认真实v2与80个实际模型Texture均≤4K、13级mip，格式为`bc7-rgba-unorm`／`bc7-rgba-unorm-srgb`，不请求旧8K。DDGI实际成功，追踪图集保留22 albedo／21 normal／10 roughness／10 metalness层；不是静默丢图。覆盖原整车交互、101点确定性、实际GPUDevice.destroy恢复（最大1Canvas、暂停姿态保留）、打字机/钢琴切换、迟到API、清单失败重试。同源、无非预期浏览器错误。隐藏测试仍仅合成事件，未冒充真实后台测试。
- 原包及候选各15张固定取景与尺寸截图检查通过操作/布局契约，`original-realtime-visual`／`runtime-v2-realtime-visual`均保留。已实际查看候选车漆、轮毂、门窗、座舱和分离截图，未发现明显新增压缩块或透明边缘破坏；近景仍可见原有随机SSR残余，不宣称完全无损或全部画质通过。6取景相机／输出／动作／配色对应已校验，静态对照页在`/artifacts/car-runtime-v2/comparison/index.html`。
- 四组同相机/姿态/光照对照定位沙粒主要来自SSR（native和DDGI-only较干净）。`noise-history-diagnosis`侧门10106支持像素中7971个历史不足3帧，中位1；修正后`noise-temporal-fixed`中位32，不足3帧122个。截图可见颗粒减少，不能等同细孔、运动拖影和整体画质全部验收。
- `admin-preview/report.json`两次真实认证候选预览通过：同一预览保持唯一WebGPU Canvas，右键平移后从实际相机读取position/target，默认镜头与perspective同步，退出卸载、再次进入保留未保存取景；前后持久化JSON摘要一致。测试仅允许读取、登录/退出与非持久化preview POST，不写正式商品。初次测试缺少Tres独立树的sceneHost桥接，保留`initial-test-bridge-failure.json`；修复的是测试读取路径，没有给生产页面新增调试全局。
- Cline以请求强度max只读审查源分类桥接，实际推理强度上游未确认；发现的实例重入、只读属性和恢复残留风险已修正。Cline没有执行测试或直接写核心代码。

## 待完成，不能宣称通过

本轮可归属的实际呈现证据、稳定30帧、30次往返与20分钟持续操作及用户本人画质确认。已完成的编码、登记、候选核心/设备恢复、管理预览和截图操作不重复列为待做。

首轮三次30秒GPU/JS数据已取得，但Chromium泛GPU trace膨胀超过V8字符串上限，原报告`performance-candidate-measured`保留为失败；第三轮还出现约1秒提交间隔，因未记录可见性/焦点不能认定为正常前台成绩。工具已补128MiB总上限、可靠关流、显式证据不可用状态、每段前置窗口及可见性/焦点记录，再做控制变量测量。不能删掉异常轮次后宣称稳定30帧。

`test:reventon-performance`记录实际CSS/DPR/绘制尺寸、GPU查询、JS提交完成和CDP追踪。Three.info纹理计数并非可靠的BC7实际分配：另按初始化后GPUTexture的格式、尺寸、mip和原生对象identity计算模型逻辑存储，候选80个原生对象为1,789,571,840字节；不将约518MB的Three计数冒充真实占用，不把逻辑字节称为物理驻留显存。无法获得可归属当前页面的真实显示时间戳时，30帧目标保持待验收；不以rAF或提交回调替代。

## 运行测量：存在明确长帧，尚未达到目标

以下均为实际1440×1000、三轮各30秒，原包和候选使用同一操作脚本。关闭Trace及GPU查询的对照用于排查测量开销，没有更改材质、灯光、输出或求解预算。三组各段开始/结束均为visible且focused；真实呈现时间戳仍不可用。

| 组别                     | 完整JS提交间隔中位/P95/最大值 | 报告目录                            |
| ------------------------ | ----------------------------- | ----------------------------------- |
| 原包，关闭Trace          | 14.7/31.7/933.1 ms            | `performance-original-no-trace`     |
| 候选，关闭Trace          | 13.2/304.4/1068.6 ms          | `performance-candidate-no-trace`    |
| 候选，关闭Trace及GPU查询 | 13.6/337.8/985.4 ms           | `performance-candidate-submit-only` |

汇总基于每段实际完整帧提交观测，快段样本更多，因此还必须看分段；例如纯JS候选第三轮开门中位499.2/P95 861.4ms。这些不是GPU时间或显示FPS，不能据此宣称30帧。关闭两种诊断仍有停顿，不能把原因简单归为Trace、timestamp或后台标签，也不能宣称候选整体运行已提速。独立试次的温度、驱动缓存和顺序尚未控制，不足以认定KTX为根因。

候选三轮前后资源平台保持133纹理、20目标、Three记账728,556,493字节，原生模型纹理逻辑存储恒为1,789,571,840字节；原包对应7,426,714,176字节，逻辑存储减少75.90%，不是物理显存采样。场景/图集generation及kernelRebuilds均未逐轮增长，不能把长帧直接判为整场景反复重建或资源泄漏。GPU全局passSummary还含warmup和段间复位，比较应使用分段gpuPasses；未区分计算核的compute标签不等于一次DDGI求解耗时。

单次页面ready/DDGI就绪观测分别为原包37.491/46.874秒、候选关闭Trace 26.500/32.304秒、纯JS候选25.824/30.735秒。它们不是五次冷缓存平均，不能计算稳定提速比例。完整冷/热加载统计仍未验收。

追加候选SSGI单轮30秒诊断（Trace/GPU查询均关）仍出现明显长帧：绕行/开门/分离的JS提交中位623.0/547.4/419.1ms，P95 765.4/931.8/731.7ms，不能归因于DDGI独有支路。随后同条件DDGI短对照在鼠标操作期间页面/浏览器关闭，`performance-candidate-ddgi-diagnostic`保留失败，不作有效配对或GPU崩溃归因。下一定位需长帧CPU栈、原生队列等待及更严格的热状态控制；不通过缩画质或删慢段晋级。
