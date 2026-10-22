# Trees X

## 汽车主软箱自阴影实验（2026-10-22）

汽车摄影棚候选可追加 `carKeyShadow=1`，在开门和分离时计算主软箱对不透明车身、轮拱与座舱的动态遮挡。它是逐光源面积阴影近似，保留其他光照、玻璃和原地面阴影；不宣称路径追踪等效。完整材质首帧即可操作，增强异步准备；普通入口保持，最终观感由用户实机决定。见[实现与验收](.ai/reventon-key-shadow-validation.md)。

## 汽车写实摄影棚样片（2026-10-21）

汽车显式实时入口增加 `carQuality=studio`：独立运行材质和冻结软箱布光、两条不同随机序列的 SSR。加 `carStudioReflections=1` 对照同材质／同灯光的一条射线。仅已核验汽车资源在真实 WebGPU 中启用，不修改商品配置、数据库、4K贴图、机构和其他商品。普通入口保持，画质由用户实机判断；主软箱自阴影未接入。工程与测量边界见[样片记录](.ai/reventon-studio-quality-validation.md)。

## 汽车4K运行候选（2026-10-20）

汽车独立runtime-v2已完成制作与登记：74张运行KTX2最长边4096、UASTC q4／无RDO／完整mip，配套74张仅供间接光CPU图集读取的256²辅助图。只缩原8K AO；模型、UV、节点、轴心及动作保持。包大小473,608,445字节，原包1,744,549,649字节；文件缩小不等同帧率或画质通过。

显式`?product=reventon&renderPipeline=realtime&indirectLighting=ddgi&assetLoading=streaming&reventonAsset=runtime-v2`使用候选；省略候选参数继续原包，普通入口仍WebGL。汽车增加世界变更驱动的15Hz间接光调度与32帧有界SSR历史；不降低输出尺寸或反射强度。公开API、数据库和展示配置版本不变。当前实机、性能及未通过项见[汽车4K验收](.ai/reventon-runtime-v2-validation.md)，默认替换仍待用户确认。

## 汽车 WebGPU 迁移候选（2026-10-19）

汽车新增显式 `?product=reventon&renderPipeline=realtime`，复用现有实时 SSR／间接光管线，保持摄影棚、原 EXR、自由观察、开门、座舱、七组分离及导览。汽车不继承打字机暖夜、桌台或景深；普通入口继续 WebGL，是否替换默认仍待完整验收与本人实机判断。

仅原汽车包可追加 `assetLoading=streaming` 对照按文件校验、取消与有界解码；省略参数保留整包读取对照。原资源与管理员自定义包不改。6张原尺寸 KTX 样片和4组孤立材质对照包仍在制作／验证目录，没有成为正式 `runtime-v2`，不把文件压缩率当作画质、加载或帧率成绩。最新证据及未完成范围见 [.ai/reventon-webgpu-validation.md](.ai/reventon-webgpu-validation.md)。

## 当前黑漆与铭牌样片（2026-10-16）

打字机新增显式 `typewriterAsset=paint-study` 对照资源，保留现有 v2 与所有交互。样片仅改变黑漆微表面分布、轻微擦拭粗糙度和清漆粗糙度，并将 WindGear 换为同金色、同位置的复古连笔字形。原几何、UV、机构和其他字符不修改；金属、铸铁与其他商品本轮不处理。

普通入口不切换。实时体验使用 `?product=typewriter-study&renderPipeline=realtime&typewriterAsset=paint-study&studioMood=light`，与 `typewriterAsset=v2` 在相同 SSGI、灯光和曝光下比较。生成图是美术参考，技术法线由 Blender 数值生成，不宣称实测 PBR。工程证据、画质与性能边界见 [.ai/typewriter-paint-validation.md](.ai/typewriter-paint-validation.md)。

## 当前执行：打字机实时管线接入（2026-10-16）

用户将重点收回渲染修补。实时 WebGPU 打字机默认使用 v2 材质、商品独立捕获的地台反射和同表面约束的有符号 SSR 过滤；`indirectLighting=ddgi` 显式启用固定预算的动态探针间接光，省略参数仍使用 SSGI。DDGI 失败保留可操作的基础光影并显示实际状态，不将回退计作增强成功。

保留自由观察、击发、结构、平铺、热点、导览和管理取景。普通 WebGL、hybrid、钢琴／汽车、HTTP、数据库和展示配置版本不变。先前图像空间分层方案暂停扩展，仅保留实验入口。FidelityFX 未接入有符号反射修正，独立 BVH 阴影／镜面仍为有证据才启动的后续候选；DDGI 内部射线查询不等于已完成这些镜面功能。

工程验证与画质验收分开，固定预算不代表 GPU 或真实呈现性能达标，当前仍待用户实机判断与最终联合验收。证据及局限见 [.ai/realtime-ddgi-validation.md](.ai/realtime-ddgi-validation.md)。以下记录中的“未接入 DDGI”仅指其历史批次。

2026-10-16 空间实验调整：按用户反馈撤下突兀的椅桌／台灯分层贴图，保留实体厚桌台。空间方案仅由 `loungeSpatial=box|depth` 开启；`box&loungeLayers=1` 现在只使用去家具的 clean-room 房间底图，不加载或创建家具卡片，`loungeDof=1` 仍可选真实深度景深。默认入口与 DA² 深度代理路径不变。

这是图像空间的 2.5D 验证：桌台与商品是真实几何，生成隐藏墙面不等于完整三维房间；原有观察范围不受暗中限制。撤下的家具素材和既有分层试验记录保留，历史成绩不改写为当前版本的验收。工程、素材与画质结论见 [.ai/lounge-spatial-validation.md](.ai/lounge-spatial-validation.md)。

2026-10-15 当前暖夜舞台：显式 `?product=typewriter-study&renderPipeline=realtime` 的 WebGPU 打字机提供“明亮／暖夜”原位切换，`studioMood=light` 可从明亮开始。暖夜使用本项目生成的酒吧全景和单块岩板底色，配合独立制作的粗糙度／微法线数据；它们不是扫描材质。全景是 8-bit LDR 可见背景，固定 LOD 3.5 取样形成背景虚化，并加接缝／极点采样保护；不宣称真实景深、源图已无缝或专业 HDR。商品照明继续使用原 Studio Small 05 HDR，三块软箱的颜色与强度随环境过渡。

切换通过既有时钟推进约 0.42 秒 GSAP 补间，减弱动态时直接到目标；保持同一 Canvas／renderer，以及当前镜头、外观与动作状态。首次暖夜异步读取四张同源图片，失败显示重试并保留基础可操作舞台；明亮恢复既有舞台效果。普通 WebGL、hybrid、钢琴／汽车、API 和数据库不变。本批实机与画质验收由主代理记录，当前不预填通过成绩，见 [.ai/amber-lounge-runtime-validation.md](.ai/amber-lounge-runtime-validation.md)。

2026-10-15 深灰绿暗色试用（历史）：实时 WebGPU 打字机曾试用深灰绿摄影棚与石墨地台，保留商品原光照、材质、交互和浅色玻璃工具；加 `studioMood=light` 对比原亮色。该配色已由上方暖夜候选覆盖，旧证据保留于 [.ai/typewriter-dark-studio-validation.md](.ai/typewriter-dark-studio-validation.md)，不将历史检查等同本批验收。

2026-10-15 当前接入：用户要求继续 WebGPU，把工程检查成功的改进逐项导入可用入口，整体画质由本人肉眼判断。显式 `?product=typewriter-study&renderPipeline=realtime` 默认使用打字机 v2 的微表面材质与 WindGear 铭牌，`typewriterAsset=v1` 保留旧材质对照；普通 WebGL、钢琴／汽车、管理员自定义包及数据库不变。自由观察、敲键、聚焦、分层、平铺、导览和管理预览继续原工作台。

本批默认在原有八个反射滤波 tap 上加入像素 IGN 与成功完整帧 golden-angle 旋转，`reflectionKernel=static` 提供原固定核对照。采样数量、半径、Physical 参数与唯一 renderer／时钟不改，失败／取消不推进 phase；这沿用 Three MIT 核旋转思路，不宣称新算法。check、生产构建与 API 启动、真实 WebGPU 对照及 v2 交互／生命周期／管理取景检查通过；整体画质待用户评定，实际呈现预算与 P95 仍待验证。DDGI／FidelityFX／BVH 尚未接入，证据集中于 [.ai/typewriter-webgpu-rollin-validation.md](.ai/typewriter-webgpu-rollin-validation.md)。下方 dated 段落属于对应历史批次，其中“画质未过不接入”及旧入口约定不限制本次用户授权。

## 既有阶段记录

2026-10-14 最新执行：用户要求直接进入打字机 v2 材质制作，并将机身铭牌从 Kimi 改为 WindGear。独立候选补缺失 UV、标准切线与共享 2048²微表面输入，保留原机构、语义部件、操作与 v1 原件；默认仍为 v1＋增强 WebGL。验收入口为 `?product=typewriter-study&typewriterAsset=v2`，WebGPU 对照再加 `&renderPipeline=realtime`；公开 API、数据库、配置版本、钢琴与汽车不变。此前 SSR 画质门槛仍未通过，此次是用户明确调整执行顺序，不表示旧节点已通过或整体质感已达到路径参考。制作与待验收记录见 [.ai/typewriter-v2-validation.md](.ai/typewriter-v2-validation.md)。下方“v2 未开始”等表述仅指其标注批次。

2026-10-14 最新候选：打字机实时实验采用支持掩码约束的有符号反射修正，暖历史全未命中时 GPU 修正严格归零，完整帧成功后才推进历史。敲键、结构、平铺和六个冻结取景完成工程检查；整体质感仍未通过，金属近景仍有点噪。默认 WebGL 和其余两件商品保持，材质 v2／DDGI 未开始。证据见 [.ai/typewriter-signed-reflection-validation.md](.ai/typewriter-signed-reflection-validation.md)。

2026-10-14 最新状态：打字机实时实验修复了中间纹理误用 RGBA8 导致的 HDR 与反射距离截断，真实 GPU 和六个冻结取景已确认修复。完整画质仍未通过，默认增强 WebGL 保留；不以此独立修复宣称完成材质 v2、DDGI 或整套实时升级。Cline 参与诊断，实际测试与整合由 Codex 执行，见 [.ai/typewriter-hdr-rtt-validation.md](.ai/typewriter-hdr-rtt-validation.md)。下方成绩分别属于其标注日期的历史实现。

2026-10-13 当前推进打字机实时组合渲染：自由观察、敲键、分层和平铺持续使用真实 Three.js WebGPU 光栅，结合随机 SSR、SSGI、内置运动重投影与降噪。实验入口为 `?product=typewriter-study&renderPipeline=realtime`；普通首页仍使用增强 WebGL，钢琴／汽车保持原管线。源模型、原尺寸贴图、界面、管理/API 与配置版本沿用，不等待静止路径追踪或 OIDN。

用户明确**整体渲染质量最优先**：新管线必须保留已有材质、地台反射与照明完成度，并通过同资产、同取景、同曝光的全景、近景、分层和运动对照证明收益。前版恢复地台、消除黑地台／异常宽亮带，但独立反射颜色与覆盖概率过滤在校准后仍有明显点噪，画质未通过。当前统一 resolve 在每条射线过滤前选择命中反射或稳定原生环境单次贡献，再使用同一过滤信号，保留多次散射和清漆；四项核心与六组公平对照契约已通过，仍未证明整体画质超过 WebGL。

统一 resolve 的 check（375 单测＋48 工具测试）、生产准备、核心与六组公平对照契约、管理取景、故障恢复、尺寸兼容及实际 20 分钟持续操作通过，持续段固定预热资源无增长。当前三轮提交计时仅为 JS 口径，实际 GPU／屏幕呈现预算未验证。新生产图仍有前罩噪点、文字颗粒和地台倒影不足，画质未通过；当前 30 次真实重载及默认 WebGL 五项操作回归已通过；真实隐藏因本机环境未暴露 hidden 仍待验收，本人走查待完成，旧 coverage 重载不替代新链。默认保持 WebGL，DDGI／FFX／BVH 与完整动作调度不扩展，不宣称整套计划完成或原创已有算法。研究定位为“面向可逆结构探索的状态感知混合渲染与调度策略”，证据见 [.ai/realtime-rendering-validation.md](.ai/realtime-rendering-validation.md)。下段 hybrid 为历史静止精修成果。

2026-10-12 当前交付为打字机混合管线：操作时实时光栅，静止时路径追踪与 OIDN 精修，保留商品观察与动作流程。五取景、128 引导降噪、1024 原图续算、输入接管与资源稳定通过工程检查，待用户本人验收；访客默认保持已验收 WebGL，使用 `?product=typewriter-study&renderPipeline=hybrid` 体验新版本。钢琴和汽车保留现状，新管线随后重新规划，不把打字机检查等同三件完成。详见 [.ai/hybrid-pipeline-validation.md](.ai/hybrid-pipeline-validation.md)、[验收清单](.ai/typewriter-hybrid-handoff.md)。

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

本科毕业设计《基于 Three.js 与 Spring Boot 的三维商品展示与交互系统的设计与实现》。面向商品观察与理解：访客在统一工作台自由观察外观、定位部件、体验动作和主动导览；管理员维护商品、分类及展示配置。

2026-10-08按用户官方模板终稿重新立项。现有代码/资源是候选成果，产品完成条件按新版重新验收。范围依据见 [.ai/restart-baseline.md](.ai/restart-baseline.md)，旧路线归档于 .ai/history/2026-10-08-before-restart/。

## Users

无需注册的访客与单一管理员。桌面为主要环境；移动保证目录、说明与基础操作。不包含交易业务或普通用户账户。

## Stack

Vue3、TypeScript、Vite、Pinia、Three.js、TresJS、GSAP；现有Tailwind/组件源码可复用。Spring Boot4.1.1、Java17、JPA、Flyway、MySQL8、Spring Security会话认证。Blender用于整理、材质与稳定烘焙；展示由真实Three.js运行。

## Capabilities and Constraints

### 新版目标

2026-10-09 用户调整：迁移本人创建的 Kimi 打字机和三角钢琴，音箱撤出当前正式资产计划及访客目录。当前案例为机械打字机、三角钢琴与汽车；打字机保留首页，钢琴加入目录。手表保留候选。以下历史双案例中的音箱仅为可逆控制测试样板，不能继续据此安排音箱制作。

- 目录、搜索、分类、商品详情与深链接。
- 一个工作台：旋转、缩放、预设视角、热点/部件说明、聚焦、外观、特色动作和手动导览。
- 机械打字机、钢琴与汽车共用正式 GLB 通道，程序化模型仅为原型。打字机保留按键/键杠杆/字杆联动、机构分层、部件平铺与复原；钢琴保留整机、剖切、发声结构与全部平铺八段流程；汽车必须双门开合，结构分离按资产条件。至少一件重点打磨材质/光照/取景。
- 基础管理：管理员会话、分类/商品维护、展示配置编辑/预览、上下架与持久化。
- 开发者准备同源模型/封面目录，数据库保存资源引用与来源说明；首版不用在线上传、独立草稿/快照发布、复杂回滚。

### 当前事实

2026-10-12 打字机精修与管线验证（混合管线接入前的阶段记录）：标准 PBR 微表面替换早期专属噪纹，接触阴影随当前姿态刷新，两盖板分层与十个大件平铺路径修正；保持源几何、初始/最终平铺姿态和统一操作。生产确认通过 35 图/10 组检查，指定部件碰撞抽样通过，不宣称 572 部件全连续无碰撞。独立共同输入完成 WebGL2、真实 WebGPU 光栅和静止路径追踪五取景共 15 图比较，并补整机/金属各 1024 样本。当时工作台保留增强 WebGL2，路径追踪仅作独立静止画质参考；随后打字机实验入口已接入自动光栅/追踪切换，默认仍 WebGL，最新状态见本页开头与混合管线验收。该次比较未测试 SSGI/SSR。缺 UV 的 enamel/steel 仍需制作整理，钢琴和汽车未作本轮同等精修。证据见 [.ai/typewriter-quality-validation.md](.ai/typewriter-quality-validation.md)、[.ai/render-pipeline-comparison.md](.ai/render-pipeline-comparison.md)。

2026-10-11 打字机质量样片：共用工作台中的实体圆角地台、实时柔化倒影、随拆解更新的接触阴影及现有漆面/金属精修保留；按用户反馈将墙窗/可见软箱撤换为包围场景的无缝银灰绿天空盒，软箱只用于反射环境。默认整机取景收近，分层和平铺保留各自宽取景。A 键字杆摆角修正避免原先扫入滚筒，保留键帽/杠杆联动及分层/平铺。真实 GLB、自由观察、配色、热点和管理预览继续原通道；钢琴/汽车未套用新舞台。当时尚未接入 WebGPU/路径追踪实验，不宣称概念图或工厂 CAD 级等效。原样片见 [.ai/typewriter-studio-validation.md](.ai/typewriter-studio-validation.md)，本次收束见 [.ai/typewriter-skybox-validation.md](.ai/typewriter-skybox-validation.md)。

2026-10-09 统一工作台增加拆解引线标签：所有展示源复用部件投影，拆开时渐显、合拢时淡出，关闭工具面板保留标签。相机变化时平滑避让商品中心、标题和工具；相交路径短暂淡出后重定位，选中部件优先保留。默认最多12个配置重点标记，不把全部零件一次铺满画面；完整部件仍可在细节中查询。标签随舞台明暗调整文字和细线，小屏空间不足抑制低优先项目。验收见 [.ai/callout-validation.md](.ai/callout-validation.md)。

2026-10-09 钢琴迁移：恢复用户自有 Kimi 网页中的程序化源文件，离线整理剖切封口、分层透明度、完整部件与形变数据，形成同源 GLB 与注册的 `piano-v1` 适配器。`piano-cfx` 已通过管理 API 保存到真实 MySQL 并加入目录，打字机首页保持。823 个建模单元可检索、选择和聚焦；八段结构按钮支持暂停、继续、反向与复原，镜头独立；九步导览由用户主动推进。运行资源约 124.5 MB，未减面或缩纹理。原网页没有音频，本轮不提供弹奏发声；模型是参考轮廓重建的结构教学演绎，不是工厂 CAD。来源、实机对照、资源与测试见 [.ai/piano-migration-validation.md](.ai/piano-migration-validation.md)。

2026-10-09 打字机迁移：从用户自有 Kimi 源模型直接导出 GLB，保留 572 个独立部件、原几何及装配/分层/平铺姿态，恢复漆面和金属 shader。浏览器资源包约 26.5 MB，未减面、未缩纹理；这不是工厂 CAD。`typewriter-study` 已通过管理 API 写入真实 MySQL 并替换首页，`form-01` 下架但资源与 legacy 保留，此条是打字机迁移时的历史状态；精细汽车随后已迁入正式目录。正式打字机的自由观察、三种配色、全零件检索/拾取、A 键联动、具名结构按钮及五步主动导览统一进入原工作台，不嵌入源页面或第二 renderer。证据与限制见 [.ai/typewriter-migration-validation.md](.ai/typewriter-migration-validation.md)。

2026-10-08新增双案例可逆探索原型：音箱可按连续进度分层，汽车双门按同一核心开合；支持播放、暂停、指定进度、回退和复原。观察操作暂停播放，热点跟随当前部件姿态。v3契约兼容v1/v2，数据库仅升级默认样板配置。结果仍来自程序化样板及GLB工程夹具，不代表正式模型质量或形成性用户实验。见 [.ai/progress-validation.md](.ai/progress-validation.md)。

基础管理端位于/admin，支持单管理员登录/退出、分类创建/修改/约束删除、商品创建/编辑、上下架与并发冲突恢复。商品和配置事务保存；公开接口只返回上架商品，下架详情404。事实与证据见 [.ai/admin-validation.md](.ai/admin-validation.md)。三件原始流程样板保留作兼容测试；正式汽车已迁入共同工作台，联合用户验收仍未完成。资产prototype/formal不等于上架状态或来源许可。

管理端易用性阶段D2：基本信息、热点、外观、镜头、动作与导览采用表单；高级配置保留完整JSON并要求显式应用。各分区共享本地编辑草稿，标识稳定、引用删除受保护，未改动的资源/舞台/动作轨道保留。新建明确选择已有配置起点，默认下架。整页预览复用唯一Canvas，提供仅管理预览可用的右键平移；取景回填到默认或已有预设视角，默认取景同步全景复位，只改镜头且不落库。会话失效关闭场景、保留草稿，保存与预览请求期间禁用编辑。操作说明与本轮证据见 [.ai/admin-operations.md](.ai/admin-operations.md)、[.ai/admin-usability-validation.md](.ai/admin-usability-validation.md)。

旧打字机机构、固定汽车演示、手势与其他模型保留为历史入口，不能与三件正式目录混淆。精细汽车的新工作台入口支持自由观察；来源许可边界继续记录在原 provenance 与本轮资源清单中。

## Brand Commitments

模型为主、中文清晰、工具按需、操作一致。默认打字机，不自动长演出。目录左侧，操作右侧/底部，同时一个面板，开关保留状态。打字机采用暖白舞台，深色工作台工具保留；整机默认不遮满热点标签，细节或当前选中时才展示。UI实现以DESIGN.md为记录；未来视觉改动单独验收，不仅改文档宣称完成。

自由鼠标优先于导览，拖动/滚轮退出导览控制保留姿态。复位视角仅镜头；返回全景合拢并保留外观；还原商品恢复默认外观/动作/结构/镜头。不能支持的能力隐藏。

## Evidence on Hand

旧成果记录：workbench-validation.md、stage-0-baseline.md、stage-1-acceptance.md。新版阶段A已建立范围/脚本/契约，阶段B的共同流程、内容回退与键盘观察通过真实API/浏览器复核，见 [.ai/restart-validation.md](.ai/restart-validation.md)。无WebGL2或初始化失败时保留实际封面与说明，按图文状态展示；不会宣称3D首帧完成。三件程序化样板封面已补入原先空的数据库字段，迁移不覆盖自定义封面。此段记录阶段B/D当时证据；当前三件正式资产接入、品质边界与联合验收以各商品迁移记录及demo-validation.md为准。

候选资源：旧音箱GLB、572零件打字机演绎、汽车GLB/PBR/AO/运动/Blender母版。来源与缺口见restart-baseline.md及原manifest/provenance，不虚构品牌、参数、结构或许可。

## Product Principles and Next Phase

阶段B共同流程、B2双案例、D基础管理及D2表单/取景工具保留。打字机、钢琴与精细汽车已迁入共同工作台；不继续音箱制作。后台配置维护沿用兼容 v1/v2 的 v3 契约；汽车使用既有位移/旋转轨道，不新增数据执行代码。详见 [.ai/implementation-roadmap.md](.ai/implementation-roadmap.md)。

2026-10-10 汽车迁移：`/?product=reventon` 使用原 1,500,363 三角形与 75 张 PBR/AO 贴图，提供自由观察、外观方案、十个语义热点、双门开合、七组分离和七步主动导览。开门和分离可组合；用户观察暂停动作，关闭面板保留状态，动作复原保留镜头与配色。固定导演仍可由 `?legacy=1&product=reventon` 访问。七组是现有刚性组件，不宣称 2,998 源对象各自可拆、真实维修顺序或照片级等效。接入与证据见 [.ai/reventon-workbench-validation.md](.ai/reventon-workbench-validation.md)。

手势、在线上传、高级版本管理、影视演出为扩展；暂不实施CI。核心不包含交易、推荐、AI、多用户空间或自动真实机械拆解。拟6—8人形成性测试；测试必须实测，不宣称三维普遍优于图片。

## 本机演示闭环（阶段 E1）

三件正式 GLB 完成至少30次循环切换及20分钟持续操作，隔离管理闭环、五次冷加载/三轮交互记录、生产两轮停启、禁止外网浏览器回归及MySQL独立恢复均已通过；工程验收未新增展品或降低画质。汽车冷加载中位约30.79秒、钢琴提交返回间隔中位33.0ms是已记录限制，不代表纯GPU耗时。项目本人按演示清单走查仍待反馈，完整阶段不提前宣告完成。6—8人形成性测试另列后续，未执行前不报告成功率或用户结论。事实与运行方法见 .ai/demo-operations.md、验收见 .ai/demo-validation.md。
