# 汽车 WebGPU 迁移与优化（更新至 2026-10-19）

## 当前范围

用户批准先迁移汽车的新实时组合管线，再制作独立运行资源及优化加载。保留摄影棚、原 EXR、取景、配色、双门、座舱观察、七组分离、导览和管理预览；不复制打字机暖夜／桌台。普通入口继续 WebGL，候选使用 `?product=reventon&renderPipeline=realtime`，探针增强仍需 `indirectLighting=ddgi`。资源优化候选预留 `reventonAsset=runtime-v2`，未制作及未验收前不得声明可用。

当前先完成同资产迁移节点。主软箱新自阴影、独立 BVH 反射与 FidelityFX 不在已接入能力中。API、数据库及 ProductPresentation v1/v2/v3 不变；代理、派生材质、环境、阴影与源 loader 各自唯一释放，复用同一 Tres 宿主及绘制时钟。

## 已核实的原包事实

运行清单 77 文件、1,744,549,649 字节：GLB 101,099,092，75 张 PNG 共 1,618,267,931，EXR 25,182,626。模型 142 节点、135 网格／材质、1,500,363 三角；全部纹理外置，221 个 texture 定义实际对应 75 个 image/sampler 组合，现有 loader 已共享解码，不能将其描述成 221 次图片解码。

纹理为 74 张 4096²、1 张 8192²；55 张为 16-bit PNG。按唯一图像各上传一次、RGBA8、完整 mipmap 估算约 6.50 GiB，非实际显存测量，未计环境／附件／驱动。原包不覆盖、不减面、不缩尺寸。

旧 2026-10-11 WebGL 报告的冷载中位约 30.79 秒、JS 提交间隔等不移用为新管线成绩。新的加载秒数先实测再确定；动态目标为本机实际输出 1440×1000、至少 95% 呈现间隔不超过 41.7ms。没有呈现证据时维持待验收。

## 迁移设计

- 内部注册商品 profile 按 adapterId 路由。汽车不启用 lounge mood/DOF；显式入口中汽车和打字机可复用 GPU 宿主，钢琴继续原后端。
- 汽车探针按真实 GLB POSITION 包围与原 v3 控制器的 101×101 开门／分离组合确定，独立覆盖七运动组；不沿用打字机台桌。最长轴16、64 rays/probe、98,304 rays/tick 上限不降低。
- 场景追踪必须包含注册汽车与明确标记的真实地面，图像布景和阴影覆盖仍排除。
- 原汽车接触阴影以 2048²、65-tap 双向模糊和相同高度公式迁到 TSL。薄玻璃采用局部 NodeMaterial，不把旧 GLSL onBeforeCompile 当作 WebGPU 适配；原生透明／透射支路与 source 所有权保留。
- 至少提交一个完整实时帧后才进入探针 tick；首帧不等待 DDGI。后续 compute/draw 仍串行，使用既有活动门控与离散历史失效。

## 本节点实现与验收

实施中。10 月 18 日第一轮工程检查通过：103 个 Vitest 文件、626 个用例，以及既有 49／23／36／14 项工具测试；生产准备及真实 API 启动通过。该批次在后续纹理／加载修复之前，不能代替新批次验收。

已保存原资产 WebGL 的整车、开门、座舱、分离、轮胎、车漆及车门截图与 API 配置，位于忽略目录 `artifacts/car-webgpu/baseline`。基准 `whole.png`／`front-panel.png`／`doors.png`／`cabin.png`／`separated.png`／`wheel.png`／`paint.png`／`door-close.png` 为有效截图；同目录早期 `front.png`／`rear.png`／`side.png` 存在切相机后截图早于合成的问题，不参与对照。输出1440×1000；此轮静图使用减弱动态完成一致端点，不作为正常动态性能成绩。

原包 WebGPU 首轮未通过：页面 DOM 与截图请求超时，当时 NVIDIA 整机显存为 7,561／8,151 MiB，可用物理内存约189 MiB。关闭唯一汽车测试页后显存回到1,243 MiB、可用物理内存约6.9 GiB。这是容量压力与页面无响应的观测，不等同于已捕获浏览器 OOM／设备丢失事件。以下修复及新实机结果不改写这个失败记录。

10 月 19 日核查 Three r185：GLTFLoader 对非默认 texCoord 的 Texture clone 在 WebGPU 中按对象分配，WebGL 的 Source 共享不直接等价。仅汽车 GPU 绑定前严格规范化，合并全部采样状态相同的引用；卸载及绑定失败恢复源引用，原 loader 继续拥有所有纹理。真实 GLTFLoader CPU 解析（PNG 仅读 IHDR、未解码或上传）确认现有座舱修正后的234个引用对象→80个，8K AO 的41个对象→1个。RGBA8全mip理论分配31,943,818,952→7,426,714,176字节（约29.75→6.92 GiB），不含环境和效果目标、不是实际显存；不等同于图片解码次数。修复后真实 NVIDIA WebGPU 整车可操作，下面列出具体边界。

定向阴影按灯门控：相机观察不构成失效，部件姿态、灯光和目标世界变换、阴影投影／尺寸／过滤参数变化触发更新；保留原2048²目标和接触阴影dirty机制。卸载／失败恢复原autoUpdate，不改renderer全局标志。实机 box probe 查到并修复 RT 原点造成的世界 Z 镜像：源盒 (1.15, 2.2)，GPU 接收中心原 z=-2.20018，修正后 z=+2.20018，与 WebGL 差约5e-7。双方向模糊采样使用 screenUV，接收平面使用 uv.flipY；不降低65 tap、σ13、.8 opacity。证据 `artifacts/car-webgpu/shadow-probe`，没有取得独立阴影 GPU 耗时。

加载增加显式 `assetLoading=streaming`，只匹配原汽车包 id、版本、路径和摘要。已校验文件会话提供 read/release/dispose，3路下载、2重解码槽、256MiB压缩字节驻留预约上限；消费后释放预约，不代表解析器容器／像素／GPU纹理也只有256MiB。旧包和自定义资源默认继续原整包屏障。原生解析／转码结清后才释放worker池，不借取消旧代次绕过重任务上限。

`preparationLease` 保活明确登记的 init、环境准备、模型解析／compile及DDGI异步tick。选择变更立即停输入和旧绘制，在自身新lease外等待旧任务结清，然后卸载旧源；退出时先从Tres递归释放图脱离，按局部owner→loader→renderer释放。DDGI field立即逻辑关闭、物理资源延后；宿主替换等待退休lease。该机制等待准备／提交Promise，不声称GPU队列完成，hybrid静止采样也未纳入全部保活。永不结清的原生Promise仍保守等待。私有阴影预热和纹理逐帧上传尚未实施。

真实 GPU 批次均使用生产构建、真实 API／原包、1440×1000 和 NVIDIA WebGPU。单次首帧是观察到 DOM ready 并建立只读桥接的时间，不是屏幕呈现时间；每次新浏览器context，未清OS／驱动缓存，不能据此推断加载收益：

| 批次（忽略目录 `artifacts/car-webgpu/`） | 检查                             | 首个可互动就绪观察值 | DDGI后续完整帧 |
| ---------------------------------------- | -------------------------------- | -------------------- | -------------- |
| original-realtime-final                  | 11项通过，SSGI／旧整包           | 41,820ms             | 不适用         |
| original-ddgi                            | 12项通过，DDGI／旧整包           | 38,426ms             | 50,369ms       |
| ddgi-streaming-lifecycle                 | 15项通过，DDGI／文件会话         | 38,158ms             | 47,828ms       |
| ddgi-boundary-final                      | 12项通过，修正边界合成／文件会话 | 33,629ms             | 44,860ms       |

这些批次确认真实1,500,363三角／2,998源对象／七运动组；双门暂停、继续、反向与分离组合；热点世界位置和投影误差≤1px；聚焦、复位范围、导览接管、减弱动态和面板状态。lifecycle批次实际调用GPUDevice.destroy，观察reason=destroyed、DOM最多1个Canvas，新宿主恢复暂停姿态；汽车→打字机复用GPU，钢琴进入WebGL，真实迟到响应和manifest网络失败重试通过。unexpected browser errors为零。该脚本的visibility为合成订阅检查，不冒充真实页面hidden验收。

汽车DDGI实际12×8×16=1536探针、64 rays/probe、98304预算，原EXR按2048×1024线性HDR投影SH9。地面超出体积曾出现硬矩形亮块，后在0.25单位padding内平滑权重，并让合成器连续混合signed漫反射替换；体积外保留原生IBL，不同时加入SSGI。完整运动包络内仍为全权重，探针与射线预算不变。最终整车／开门／座舱／分离截图人工检查矩形边界已消失，SSR点噪、透射和线性HDR合成与旧WebGL的观感差异仍需用户评定，不能宣称整体画质已经通过。

首帧 Three 资源计数约127纹理、texturesSize=7,909,433,643字节、total=7,985,351,580字节；这是Three跟踪估计，不是物理显存。纹理仍接近本机容量，必须继续独立运行副本工作；没有把计数下降当作呈现帧率达标。

工程：最后边界合成修正后，`npm run check`通过112个Vitest文件／714项，以及49／23／36／14项工具检查；`npm run build`（由demo:prepare执行）、后端打包、运行资源摘要与实际API启动通过。新资源工具另19项通过，原生GPU测试串行执行。

生产默认WebGL三件回归通过：1440×1000、1280×720、1920×1080、390／320px，22张截图，真实模型、动作、细节、导览、单Canvas和禁止外网／允许本机请求；记录`artifacts/car-webgpu/production-regression`。这不是WebGPU的五尺寸呈现性能成绩。汽车真实管理员预览另3项通过（`admin-preview`）：全程阻止持久化写API，修改未保存X后打开GPU整车，右键平移改变实际position/target，回填camera及perspective，卸载唯一宿主；原商品完整GET结果保持一致，原动作不变。

6张原尺寸 UASTC q4 代表样片已独立复核，KTX validate 均通过；输入241,016,657字节→输出32,862,972字节，仅为这6张的文件体积。5张16位输入转为RGBA8后再有损编码，尚未实机近景批准，未接入公共资产或默认入口。详细摘要、实际材质引用及复核记录在 `artifacts/car-runtime-v2/representative-uastc-q4`。

没有执行的新批次 5 冷／5 热加载、3×30秒互动、30 次往返和 20 分钟长测保持待验收，不能借用历史记录或代码测试成绩。

## 独立纹理样片与后续节点

`scripts/reventon-runtime-v2/`制作与检验四组真实材质的原图／候选夹具，保留选中几何BIN／accessor逐字节相同、原层级轴心及所有PBR依赖。同一生产工作台按实际材质和相机比较；只用fixture API，不写数据库。夹具不能代表完整汽车遮挡、反射和动作。首轮CDP fulfill将101MB GLB编码后超100MiB管道，造成DevTools连接关闭；已改白名单同源真实HTTP流及Node流式摘要，临时dist文件由独立owner清理。这是测试传输故障，不是GPU错误。后续工具修复包括从Tres独立渲染树的sceneHost读取真实checkpoint、配置相机按现有6位小数精度允许1e-6，实际A/B相机／投影一致性仍1e-7。

最终四组八包工程检查通过，证据 `artifacts/car-runtime-v2/material-comparison/browser/verified-camera-final`：原图／候选实际相机、投影、灯光、曝光、源三角数一致；共16张全管线／独立Physical诊断图，所有context及自己暂存的文件均关闭／清理，实际原生GPU校验错误为零。候选颜色纹理GPU格式为`bc7-rgba-unorm-srgb`，技术图为`bc7-rgba-unorm`；4096²保留13 mip、8192² AO保留14 mip。原图仍为未压缩纹理，没有以PNG容器变小冒充GPU压缩。

人工初审：座垫及门板皮革在该取景未见明显新增块状退步；尾灯和透明格栅因原材质透明且选中几何分散，单独夹具对其细节的可读性不足，不能据此批准压缩或整车材质。全效果中SSR噪声也限制细节判断，Physical图只用于隔离材质，不能宣称生产降级后更快。四组`qualityApproved=false`保持，不批量替换、不把工程检查当作目视无差验收。

下一节点依次是代表纹理目视对照、完整runtime-v2、废弃绒面图引用清理、无损Meshopt／未用属性审计和明确的准备／预热接口。当前`reventonAsset=runtime-v2`尚不可用，既有样片没有自动成为正式资源。仍需5冷／5热、3×30秒和实际呈现测量、30次往返、20分钟、真实hidden、联合管理与本人走查，全部保持待验收；不切换默认入口。
