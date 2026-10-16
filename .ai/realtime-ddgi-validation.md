# 实时 DDGI 与反射修补验证记录

2026-10-16。打字机实时 WebGPU 的反射修补与可选间接光实验已接入。最终生产构建完成六取景、真实设备恢复、模块失败回退与管理预览检查；整体画质、真实呈现预算及长期联合验收仍未通过。下方明确区分完整早期批次与能量响应调整后的复验，不将两者拼作同一版本的完整成绩。

## 暖夜切换误报修复（后续节点）

用户实际 Edge 页面显示“空间增强不可用”，读回原因是 `Speedball rejected its build or solve`，并非设备不支持：此前已有 589 个 accepted tick，实际场为 1440 探针／64 射线；失败时 `dirty=true`、`buildDirty=true`、`rebuildBackoff=0`。页面实际输出为 2546×1288，该记录仅用于诊断，不是帧预算验收。

首次暖夜异步载入后，`loungeLook` 给桌面增加 map／normalMap／roughnessMap。Speedball 的材质值更新发现贴图绑定发生结构变化，正常调用 `requestRebuild()`，本 tick 暂停求解。旧适配层把任何 clean→dirty 当成失败，阻止了下一次正常重建，并锁定 SSGI 回退。上游源码位置为 `spectral_scene.js:updateMaterialValues`、`gi_probes.js:refreshMaterialValues/requestRebuild`，均是已锁定 0.8.0 实现。

修正后在提交本次变更后、tick 之前取真实 dirty 状态，允许 fresh-build 标记或已知材质／实例／光照变更升级重建；仍检测 rebuildBackoff 和无变更来源的求解失败。重建期间 receiver 暂停，重新就绪后恢复，不隐藏错误、不降低预算、不重建 renderer。新增三项单元覆盖贴图变更后的重建恢复、光照缓存核重建和真实异常仍回退；`npm run check` 通过 96 文件／558 Vitest 及原工具套件，生产 prepare/build/start 通过。证据为 `artifacts/realtime-ddgi-mood-check.log`、`realtime-ddgi-mood-prepare.log`。

生产构建标识：`preparedAt=2026-10-16T10:56:40.505Z`，源码指纹 `d7487a1ae239e5a09e9d1faa2aeb83039c67ac472fa0a67930533fb0f47b6034`，index SHA-256 `6bc33cd51e550a32ee4558df2a6307d97dec12fc0fc7067c2386e66c30f2fcd5`。下文 09:11 构建的成绩保留为上一节点，不自动移作本修复全部联合验收。

新增 `DDGI_RECOVERY_SCOPE=mood` 专项，实际点击明亮→暖夜→明亮→暖夜→明亮，核对同一商品、相机、姿态、Canvas 与 renderer，并要求增强重新就绪且探针输入确实完成重建。首轮测试四个切换都已恢复，但测试误将“必须重编译 shader”当成重建证据而失败；0.8.0 在存储容量足够时合法复用 resident kernel，实际计数由 0→1。首轮材料保留在 `artifacts/realtime-ddgi/mood-first-assertion-failed/`；最终断言检查重新编译或 resident 复用的总次数及增强代次，不把抑制错误或只等待当作通过。

最终专项 `artifacts/realtime-ddgi/mood-fix/report.json` 实测 `passed=true`，四次切换均为 actual=ddgi／ready=true／error=null，同一 Canvas 与 renderer、相机和部件姿态保持。首次贴图改变后增强代次 2→4、resident kernel 复用 0→1、kernel 编译次数维持 1，证明真正完成重建而非屏蔽错误。零非预期控制台／GPU／网络错误，五张实际 1440×1000 截图保留；日志为 `artifacts/realtime-ddgi-mood-browser-final.log`。本专项不重跑上一节点的设备丢失／模块 503 或长测。原用户标签页自动刷新时，浏览器工具被 Work 设置禁用；未宣称该旧标签页已自动更新，需刷新读取修正版。

## 本节点交付状态

- 实时入口默认使用商品独立平面反射和同表面约束的 signed SSR 空间／历史过滤。反射覆盖率与 RGB 一起过滤，再解预乘合成；保留 `planarReflection=scene|off` 作对照。固定输入三种反射模式的 18 张图与八项尺寸／界面检查保留于 `artifacts/realtime-complete/reflection/`，没有新增 renderer。
- 可选 `indirectLighting=ddgi` 使用固定预算的真实探针场；省略参数仍是 SSGI。加载或增强失败保留可操作基础画面并报告实际状态，不自动把普通首页切为 WebGPU。
- 最终构建 `preparedAt=2026-10-16T09:11:06.595Z`，源码指纹 `b03b3cc52152379b858173f6a1cc56d0c17acaf7859d145d78a01a97196154fd`，前端 index SHA-256 `621d6595fdf16605bf5d8fb6d415fe926ca9a70a8e364062388da50384dd78eb`。复验目录各存有 `build-identification.json`，同本机 prepared 清单关联。
- 本轮 `npm run check` 通过：96 文件／553 Vitest，加 49 本地工具、23 实时 probe 和 36 v2 制作工具测试。`demo:prepare` 内的前端 build、后端 package 和三件资源摘要检查通过，生产 `demo:start` 与 `demo:doctor` 通过。日志在 `artifacts/realtime-complete-check-final3.log`、`realtime-complete-prepare-native-response-fixed.log`、`realtime-complete-doctor.log`。

### 最终生产复验

| 批次                                       | 实际执行与结果                                                                                                                                              | 未覆盖项                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `artifacts/realtime-ddgi/native-response/` | `DDGI_CHECK_SCOPE=views`，SSGI／DDGI 各六图，六组相机误差 0；原生 WebGPU，错误与失败请求均为空，DDGI 实际就绪、预算匹配                                     | 本 scope 没重跑击发／101 点／50 轮／重复加载，不沿用下文旧批次作为新构建成绩 |
| `artifacts/realtime-ddgi/recovery/`        | 真实 `GPUDevice.destroy` 后释放旧宿主、仅一个 Canvas，旧 renderer dispose 一次；保留 0.6 结构暂停、外观、选择与相机，最大相机误差约 2.91e-7；新 DDGI 场就绪 | 不是 WebGL 上下文模拟事件，不代表隐藏页或 20 分钟验证                        |
| 同一 recovery 批次                         | 实际 `field-*.js` 返回 503，真实错误进入状态提示、actual=ssgi；放大后继续 57 个完整提交帧，原姿态保留                                                       | 没有成功重试该失败模块的独立验收                                             |
| `artifacts/realtime-complete/admin/`       | 两轮真实 v2、实时 SSGI 管理预览、右键平移、取景返回及 perspective 同步；退出后零 Canvas、桥接注销、数据库无持久写入                                         | 不强开 DDGI，不证明 DDGI 管理预览单独联合通过                                |

六取景检查中仍能看到漆面高光颗粒，DDGI 与 SSGI 的整机差异较小；没有据此认定整体画质达到路径参考。浏览对照为 `http://127.0.0.1:5181/artifacts/realtime-ddgi/comparison/index.html`；图库复制在忽略目录，重新 prepare 会清除 dist 中副本，原 PNG 和报告仍留在 artifacts。

## 入口与实现边界

实验入口为 `?product=typewriter-study&renderPipeline=realtime&indirectLighting=ddgi`；省略 `indirectLighting` 或指定 `ssgi` 使用原 SSGI 通道。本批对照额外指定 `studioMood=light`，没有空间分层或 DOF 参数；结果不证明暖夜、图像房间、空间代理及景深与 DDGI 的联合效果。普通 WebGL、hybrid、钢琴、汽车、配置版本、API 与数据库不在本阶段范围。

`realtime/coordinator` 动态加载探针模块，加载期间保留基础光栅；探针就绪才挂接 receiver。模块或探针失败记录原因并回退 SSGI，不将回退计作 DDGI 对照通过。协调器按代次隔离迟到的模块与回调，异步探针 tick 与同一 renderer 的辅助／最终绘制串行；没有新增 Canvas、renderer 或计时循环。

探针读取上个已完成帧的姿态，随后 `beforeRaster` 在现有 `clock.frame` 内执行一次场景／阴影更新。这带来一个调度步的姿态延迟，加上探针自身的时域收敛，运动中的滞后仍需画面验收。

`ddgi/field` 独占低层 probe field 与追踪代理；`ddgi/proxyScene` 只拥有代理对象及变换，借用源 geometry、PBR 材质、纹理和实例属性，不释放 loader 的资源，也不调用默认材质 installer。追踪范围包含打字机与真实桌台，不包含已带照明的图片房间、天空或反射／阴影覆盖层。`realtime/signals` 拥有合成目标与受借用的 receiver 节点连接。

DDGI 在有效体积内替换已捕获的原生间接漫反射；该像素不再叠加 SSGI 间接光。无效深度、体积外或未支持材质保留既有通道。SSR、原生镜面／清漆以及透明 beauty 的透过权重继续走原通道。

## 固定预算与局限

来源锁定为 `speedball-gi 0.8.0`、提交 `a997aee5b0791be61b49719377e811c41720df59`、MIT；适配层检查 Three r185 和包版本。预算定义见 [DDGI 契约](../src/lib/workbench/rendering/realtime/ddgi/contract.ts)，阶段目标见 [实时画质路线](typewriter-realtime-quality-roadmap.md)。

| 项目     | 当前约束／旧批次读回                                             |
| -------- | ---------------------------------------------------------------- |
| 体积     | 单 cascade，覆盖整机、展开、平铺及中间范围                       |
| 探针     | 最长轴 16；旧批次实际为 16×9×10，共 1440 个                      |
| 射线     | 每探针 64；每 tick 固定上限 98,304                               |
| 自动缩减 | 关闭；实际分辨率或预算改变即报错                                 |
| 探针镜面 | `reflectionQuality=off`，不新增探针反射                          |
| 环境     | 实际线性 HDR 投影为 radiance SH9；旧批次源为 1024×512，强度 0.35 |

固定预算仍增加 BVH／探针存储与 compute 成本，上限不等于已证明的 GPU 帧时。SH9 只表示低频环境；Speedball 0.8.0 将矩形面积灯按中心点近似；receiver 使用 G-buffer 着色法线同时计算可见性偏置与入射方向。上游 `spectral_scene.js` 的辅助追踪材质图层固定重采样为 256²，原光栅 PBR 贴图保留源尺寸；两者不能混为全尺寸 Physical 等效。BVH 构建由上游在主线程分步推进，未实现 Worker 构建。此实现不是硬件光追、完整 Physical 等效、实测照度或路径追踪参考。

MIT 文本自托管在 `public/licenses/speedball-gi-MIT.txt`，1071 字节，SHA-256 `18ba15d896d2923aaadf2243904077fd61340e71ce35e0946105875725daf419`；包和完整性记录于 package-lock，出处见固定提交的 [上游集成说明](https://github.com/cl0nazepamm/speedball/blob/a997aee5b0791be61b49719377e811c41720df59/docs/ADVANCED.md)。

## 已有真实 GPU 批次

本节只对应 [根报告](../artifacts/realtime-ddgi/report.json) 及 [SSGI 子报告](../artifacts/realtime-ddgi/ssgi/report.json)、[DDGI 子报告](../artifacts/realtime-ddgi/ddgi/report.json)。根报告开始时间为 `2026-10-16T06:42:30.017Z`；方法记为真实 API、Edge 原生 WebGPU、1440×1000，`fixture=false`。报告没有源码提交或发布构建摘要，不能据此认定后续源码改动也已实测。

| 报告项目     | 已记录结果                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------- |
| 工程状态     | `passed=true`、`engineeringPassed=true`；两模式均通过                                          |
| 截图         | 每模式 8 张，共 16 张：整机、漆面、金属、按键、分层、平铺、结构暂停、重载恢复                  |
| 固定输入对照 | 六组 `pairs` 均保存 input hash，`cameraError=0`                                                |
| 实际模式     | DDGI 最终 `requested=actual=ddgi`、`ready=true`、无间接光错误；两组 fallback 为空              |
| 结构与加载   | 两组均记录击发、暂停、结构运动、50 次复原检查、3 次重载和 3 个快速重载意图；反向／复原误差为 0 |
| 宿主         | 两组最终原生 WebGPU、一个 Canvas，Canvas／renderer 身份保持                                    |
| 错误分类     | 根与子报告 errors 为空，failedRequests 为空；每组另列 2 个快速选择引发的 API 取消              |
| 保留警告     | 两组均记录 Windows 下忽略 `powerPreference` 的浏览器警告                                       |

整机等六组输入对照不等于图像质量通过。报告明确 `visualAccepted=false`、`frameBudgetValidated=false`；成功完整帧与 accepted tick 是 CPU 提交／求解调用计数，不是 GPU 耗时或屏幕显示 FPS。原始 PNG 与 JSON 位于上述忽略的本机 artifacts 目录，不作为运行资产或 Git 同步材料。

## 能量响应修正、失败记录与剩余边界

旧批次采集后，`materials` 增加原生 r185 漫反射每单位 irradiance 响应，结合介质单次／多次散射的能量分配、基色／金属度、源材质 AO、清漆透过与 Lambert `1/π`。`sceneInputs` 借用既有六 MRT 中的 surface output 保存响应，不加第七附件；`signals` 用该响应把 DDGI irradiance 转为漫反射并减去已捕获的原生间接漫反射。保留源 AO，不再乘 SSGI AO。支持门禁未扩展所有 Physical 特性；替换总 nativeDiffuse 也不保证 lightMap 等其他累计间接光逐项等价，未来接入此类资产须单独限定。

本轮 CPU 回归为 `sceneInputs.test.ts`、`ddgi/field.test.ts` 和两套 coordinator 测试，共 43/43 通过。覆盖六附件响应绑定、四个构造 setter 异常时 field／proxy 唯一释放与借用资源保护，以及异步模块／tick／错误回调边界。`npm run typecheck` 与两份新增回归涉及文件的 ESLint、Prettier 检查通过；这些结果不证明实际 GPU 着色器编译、呈现预算或画质。

首轮新响应 GPU 复验确实失败：直接导入 `three/src/.../PropertyNode.js` 与打包版产生第二套 TSL 运行时，出现 `.mul is not a function`；还有一次 chunk `ERR_NO_BUFFER_SPACE`。失败材料保留在 `artifacts/realtime-ddgi/recovery-native-response-failed/`，不隐藏或记作通过。修正后只使用同一打包版的 diffuseColor × (1−metalness) 与原生多散射方法，并新增真实 finish 节点图构造回归；最终六图与恢复结果见本文顶部。测试脚本对首个非预期 shader／网络／GPU 错误立即失败，不只相信 DOM ready 或协调器计数。

仍待完成：最终构建的 101 点、50 轮、30 次重载、20 分钟联合操作、真实隐藏页、GPU 与真实呈现预算、用户本人六取景与运动画质判断。最终构建专门 GPU 编译／六取景／实际设备恢复已复验通过，但没有扩写为以上未跑项目。暖夜、空间图层／深度及 DOF 组合仍需独立证据。异步 tick 无安全中止接口；若上游 promise 永不完成，调度器会为避免同 renderer 并发而继续等待，当前没有超时绕过。

FidelityFX 固定源码的 [时域输入契约](https://github.com/pmndrs/denoiser/blob/d2e5b7a14ac8bf2951f7014d5bc20299c6d68e29/docs/specs/temporal.md) 以正 radiance 与黑色无反射判定为基础，不接受当前负值合法的 signed Δ 作为直接替代。本节点没有强行串联或伪称完成降噪器对比。独立世界空间镜面／软箱阴影尚未实现，DDGI 内部 BVH 不算这些分支已完成。Cline 本轮只读任务因单轮预算耗尽，没有形成有效审查或代码贡献；验证与整合由 Codex 完成。
