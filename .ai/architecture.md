# 架构

## Reventón 离线分支（2026-09-25）

`scripts/reventon/` 是独立 Blender 制作管线，不创建浏览器 renderer、不进入 Pinia。源 3dm/VPB 只读恢复为 `artifacts/reventon/source` 的 NPZ/JSON 与 `textures` 的图像；后台 Blender 构建器唯一拥有生成场景、材质、摄影棚和相机，写入打包贴图的 `.blend`，进程退出释放资源。渲染器保存真实 Cycles PNG/线性 EXR 及文件摘要，比较页验证场景/图片同一版本后生成。源几何、额外摄影棚和原图字标贴片分组并保留来源。

此阶段遵循用户离线极致画质要求，不套用实时 GLB 的 10 万三角形或 2 MB HDR 预算。高面数模型不会因此加载进现有前台。最终拟接入视频章节播放器，尚未实现；现有唯一 Canvas 和手势会话所有权保持原架构。静帧视觉门槛未通过前不扩展成片，详见 [验收记录](reventon-validation.md)。

离线分支目前保留三份独立生成物：`reventon-restored.blend` 是旧 Rhino 静帧基线；`reventon-motion-proof.blend` 是使用原开合变体求轴的可编辑动作验证；`reventon-vpb-candidate.blend` 是新的静态画质校准。VPB 候选直接读取原图场景的几何、节点可见性、材质 ID 和逐角 UV，旧 Rhino 几何在其中隐藏。候选禁止相机绑定时间标记覆盖静帧相机。原节点记录与图像只作为数据解析，不执行源工程附带代码。候选材质由 `vpb_cycles_materials.py` 唯一创建；加载、打包、场景写出均在独立后台 Blender 进程完成。视觉通过后再将候选外观和经过验证的动作合并，不将旧动作检查图冒充新候选的动画证据。

```text
src/
  App.vue                         页面装配
  components/layout/              导航与页脚
  components/product/             商品文案、可访问操作
    ProductShowcase.vue           手势桥接提供方、沉浸式展厅装配
    StudioIntro.vue               商品身份、当前配色与结构状态
    StudioControls.vue            配色、部件、结构、导览、手势控制台
  components/three/
    ProductViewer.vue             Canvas 唯一所有者、浏览器降级、加载状态覆盖层
    ProductModel.vue              挂载 GLB，驱动显示状态
    CameraController.vue          OrbitControls、缩放、复位
    Environment.vue               灯光、Room 回退与可取消 HDR/PMREM 生命周期
    CyberStage.vue                高配桌面的粒子与能量环、演出时间线
    Effects.vue                   Half-float Composer、Bloom、暗角与最终 ACES
  components/ui/                  shadcn-vue 源码
  composables/
    useThreeScene.ts              能力检测、显示策略
    useModelLoader.ts             请求、超时、取消、解析、归一化、释放
    useAnimation.ts               GSAP 作用域及生命周期
    useSmoothScroll.ts            Lenis + GSAP 时钟
  stores/product.ts               可序列化商品和交互状态
  lib/three/                      模型预算、归一化、释放等纯工具
    presentation.ts               外壳材质副本与外观结构位移动画适配器
    environment.ts                HDR 预算、解析与异步请求工具
    hologram.ts                   复用模型 geometry 的扫描覆盖层
    cyber.ts                      固定种子粒子缓冲生成器
  data/products.ts                样品配置；未来替换为服务层
  assets/                         打包进构建的样式等
public/
  models/                         自制 GLB + 资源说明
  textures/                       自托管 CC0 HDR 与许可、大小、校验记录
scripts/                          可复现模型制作、工程约束检查
```

## 数据流

DOM 操作 → Pinia 意图（缩放、复位）→ Canvas 内控制器。模型请求状态由独立 loader 返回，展示层负责文案。GPU 实例不进入全局状态。模型 URL 从配置读取，不散落在组件里。

单商品体验的数据流：`products.ts` 声明配色、稳定节点名、镜头偏移与结构位移；Pinia 只保存选择和请求计数；`ProductModel.vue` 把状态应用到局部材质副本和节点坐标；`CameraController.vue` 读取当前节点的实时世界坐标完成聚焦。`ProductShowcase.vue` 提供 bridge，Canvas、控制台和手势面板复用同一个 `focusPart` 意图。

## 所有权

TresCanvas 管理 renderer 与声明式场景对象。loader 管理 GLB 的几何、材质、纹理；primitive 禁止二次自动 dispose。Environment 管理自己的 PMREM 目标并在卸载时清空 scene.environment。Cientos 管理 controls。GSAP context 和 Lenis composable 各自清理自己的资源。

展示适配器只拥有外壳材质 clone；清理时先恢复原材质、原坐标并释放 clone，再由 loader 去重释放 GLB 原始资源。结构动画始终从快照坐标计算，不累积位移。相机与结构 tween 都允许新意图覆盖；Canvas 首次 pointerdown 立即终止镜头补间。

Phase 4 的扫描覆盖层拥有覆盖 Mesh 和一份共享 ShaderMaterial，但复用 loader 的 geometry；销毁时先移除覆盖层并释放共享材质，不释放 geometry。Environment 始终先创建 Room PMREM；HDR 通过同源 `fetch` 和 AbortController 加载，原始 DataTexture 转换后立即释放，旧 HDR PMREM、迟到结果和卸载资源各有唯一释放路径。

## 扩展点

手势增量：`GesturePanel.vue` 提供摄像头入口与键盘替代操作；`useGestureSession.ts` 唯一拥有摄像头流、Worker、定时器及页面监听；`lib/gesture/detector.ts` 处理归一化手势与确认状态；`bridge.ts` 在 `ProductShowcase` 范围协调输入所有权。手势面板位于 Canvas 的同级控制台，因此 `useGestureInput.ts` 从最近的 `.product-studio` 查询 `.canvas-host` 尺寸。高频坐标不进入 Pinia。

稳定性修订：`filter.ts` 实现按真实时间戳更新的 One Euro，`selection.ts` 拥有热点吸附/捕获/取消状态，`calibration.ts` 校验两种姿势并生成会话阈值；`useGestureInput.ts` 协调这些纯逻辑及局部诊断数据。Worker 帧携带输入代次与视频长宽比，模式切换、鼠标接管和校准重置后丢弃旧代次结果。控制台内手势入口使用同一商品可用状态；页面隐藏与显式关闭仍停止视频轨道。校准数据只留在当前页面，原始视频不保存。

`public/gesture/worker.js` 使用本地 MediaPipe、CPU 单手推理。SDK 与 WASM 仅开启后加载，视频理想输入 640×480，每秒最多 15 次采样且仅一帧在途。SDK fetch 只允许同源 GET，阻止 1.0.1 的默认遥测外发。后台、显式关闭与卸载停止视频轨道并终止 Worker；离开展示区域暂停帧采样。鼠标、动画、手势共享相机所有权；恢复手势会中断未完成的相机动画。

`ProductViewer.vue` 根据 WebGL2、半浮点渲染、细指针、视口和减弱动态计算实际画质。电影画质模块使用动态 import；离屏、页面隐藏或切换基础画质时卸载 Composer、粒子与扫描层，并让 HDR 回到 Room 环境。高配桌面渲染参数固定为 Composer 1.0、1600 粒子与 8× MSAA，不随性能 tier 下降。Pinia 只保存 `cinematic | eco` 和重播请求计数。

Phase 2 后续可在动画 composable 中增加 ScrollTrigger；相机进入剧情模式时禁用 OrbitControls。Phase 5 新建服务层，避免将 HTTP 放在场景组件中。

## 2026-09-19 多商品整合

`src/data/collection.ts` 将参考项目的六个资产映射为本项目 Product 配置，不直接引用外部 API/store 或原生 Three renderer。`ProductCollection.vue` 提供目录对话框、分类、搜索、空状态与键盘焦点恢复；`ProductSwitcher.vue` 提供前后切换。`useProductNavigation.ts` 将选择写入 product 查询参数，并处理 popstate。

ProductStore 的 selectProduct 原子重置商品相关选择和加载状态。Canvas 不因商品切换重新创建；ProductModel 按 product.id + selectionRevision 重挂载，先释放旧 presentation/扫描层，再由旧 loader 释放 GLB。新 loader 的代次与 AbortController 避免迟到结果污染当前商品。每次 Draco 解析拥有一个 decoder，解析结束（含迟到结果）后在 finally 释放。目录开启时停止手势运动与场景时钟，卸载 Composer/HDR/粒子，关闭后恢复；保留当前配色、结构和聚焦。

Product.hotspots 使用 GLB 中的实际节点名；localPoint 可定位单体网格里的观察点。ModelHotspot 初始化时缓存各节点局部锚点，结构移动后按节点矩阵重新投影。structureSpace=world 将视觉分离量转换成父节点坐标，避免不同归一化缩放导致拆散过远。单体资产不显示可操作的结构展开，也不进入第三步导览。

手势 bridge 中 GestureTargets 保存非响应的目标提供函数，ModelHotspot 和 GestureTargetButton 在挂载/卸载时注册/清理。DwellCapture 和 TargetCapture 复用统一命中边界，操作触发同一套 Pinia 意图。相机动画恢复手势时校验 inputRevision，旧动画不会夺回鼠标控制。有限惯性由 useGestureMotion 的 GSAP ticker 驱动，停止时移除时钟；识别结果只提交带时间戳的运动样本。

后处理退出时由 Effects.vue 的 renderHandoff.ts 恢复 Tres 的基础渲染入口（当前 post-processing 3.7.4 不自动恢复）。交接在子 Composer 卸载后执行，重用现有 renderer，恢复默认目标/清屏并请求一帧；用 WeakMap 令牌隔离旧卸载回调。生命周期调整必须运行 test:render-handoff 的无 DOM 叠层像素验证。

## 2026-09-21 展厅架构与切换可靠性

ProductStore 的 `panel` 是单一活动面板，与商品、相机和手势会话分离；`cameraStatus` / `cameraStopRequest` 仅用于顶部状态与显式关闭。`StudioControls` 与 `GesturePanel` 保持挂载，通过 v-show 切换呈现，关闭侧栏不销毁 MediaStream。页面隐藏和显式关闭仍由 useGestureSession 停止摄像头。

ProductSelection 为商品配置快照加递增选择代次。模型加载、失败、热点与视觉就绪事件均携带商品 ID 和代次；旧事件不得更新新选择。ProductModel 固定读取自己的快照，清理 bridge 回调前校验所有者。真实模型挂载且 renderer 完成一次绘制后才发布 ready，并记录实际遍历得到的 mesh 名。加载遮罩使用新商品封面，失败不能视为成功。

Canvas render-mode 固定 on-demand；SceneRenderDriver 在 cinematic 的可见前台逐帧 invalidate，eco 只按需绘制。Tres 5.8.3 的 always→manual→always 不会重置内部 frame budget，因此目录暂停通过停止/恢复现有时钟完成，恢复时先 invalidate，禁止改为切换 render-mode。onReady 初始化时驱动一次同步。NoToneMapping 的枚举值为 0，因此显式赋值给现有 renderer，避免库中 truthy 检查遗漏。Effects 的 WeakMap renderHandoff 继续负责 Composer 卸载后的绘制入口恢复。

`data/exhibition.ts` 负责精选顺序、stage、CameraPose/target/zoomRange 与 storySteps。原始资源事实、节点名和结构移动仍放在 collection.ts / products.ts。StageGround 使用模型初始化时一次计算的 Box3 最低点放置承影面；Three 声明式对象由 Tres 释放，原模型由 loader 释放。加入展品只补配置、封面和讲解，不复制 Canvas 或控制台。

首帧按商品预设直接到位；只有用户触发的视角和聚焦使用 800ms GSAP。面板使用 240ms opacity/translate 过渡。轮滚由 OrbitControls 接管，不将手势采样或 Three 对象放入 Pinia。返回全景合拢结构、保留配色；导览退出保留当前观察状态。

## 音箱主动演绎

`data/productFilms.ts` 保存镜头与章节配置；`useProductFilm` 使用 CameraController 提供的现有 camera/controls/target，单一 GSAP timeline 控制镜头、灯位和局部分层进度。bridge 仅在组件范围传递播放、停止、章节与模型访问函数，不创建第二个 renderer。停止保留当前 pose，并调整 controls 最小距离以免从特写接手时弹回。

`SpeakerLighting` 拥有三盏 RectAreaLight 和入场补间；LTC 由 Three 库共享初始化一次。`speakerMaterials` 拥有确定性粗糙度纹理与物理材质替换，释放顺序为 presentation 配色 clone → surface 材质恢复/释放 → loader 原始资源。新增滚花与旋钮顶面挂在 Volume_Dial 下，跟随原结构关系移动。音箱不创建扫描覆盖层，舞台粒子缓冲长度为零，其他商品维持原方案。
