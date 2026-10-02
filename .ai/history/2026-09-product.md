# Trees X

**2026-09-30 最新交付范围：用户明确本轮只做技术验证，不再要求极致画质或与参考图照片级匹配。** 当前效果保留，以 Three.js 真实模型、烘焙资产和完整可用动作流程完成本阶段；停止额外材质/灯光精调。下方画质差距是如实记录，不再作为本轮交付阻塞项。

**2026-09-30 已实现：Reventón 真实三维实机演示已接入 `/?product=reventon`。** Three.js 在唯一 TresCanvas 内加载恢复后的完整汽车、75 张同源 PNG、GLB 与 HDR；GSAP 驱动约 16 秒的剪刀门开启、座舱运镜、现有部件分离和复原。提供播放、暂停、四章节、进度与回到开始；默认静态入场，不提供自由轨道操作或影片替代。目录现有九件，原七件商品与打字机保留。

实机身份为 135 个网格、1,500,363 个三角形、2,998 个源对象、7 个运动组；分离只说明可见部件的相对关系，不代表真实维修拆解顺序。加载重试、WebGL 上下文恢复、目录暂停、切换与唯一释放已形成自动化证据；连续播放经过四章、七组实际姿态变化，以及 Home / ArrowRight / End 键盘定位均已验证。最新视觉复核已解决接触阴影、玻璃灰雾、轮内金属过曝和 390px / 320px 目录出口四项问题；整体参考图画质、连续动作的视觉节奏与流畅度、帧率仍未验收，`public/models/reventon/provenance.json` 的 `browserQualityApproved` 保持 `false`。见 [实机验收](.ai/reventon-runtime-validation.md)、[运行证据](.impeccable/review/reventon/runtime.json)、[生命周期证据](.impeccable/review/reventon/lifecycle.json)、[连续播放证据](.impeccable/review/reventon/playback.json)与[四项修正复核](.impeccable/review/reventon/fix-verdict-2.md)。

**2026-09-28 用户纠正（覆盖下方冲突历史）：Reventón 必须是烘焙材质/阴影后的真实三维实机演示。网页现场完成开门、座舱运镜、部件分离和复原，固定流程且不提供自由轨道操作。影片不满足要求，影片目录入口已撤下。** 原模型与 Blender 动作继续复用；该实机方向已于 2026-09-30 实现，整体参考画质仍待验收，见 [.ai/reventon-realtime.md](.ai/reventon-realtime.md)。

2026-09-25：用户新增 Reventón 本地烘焙演示方向，要求 Blender 离线固定流程、纹理光影对照原成片、最终取消该演示自由操纵。当前已恢复本地几何与 VPB 内嵌贴图，另有 16 秒可编辑动作验证工程和三张实际 4K 关键帧，包含开门、座舱与现有部件分离；它们不是已完成影片，也不表示工程级拆解。用户已确定先达到原参考图的材质光影，再渲染完整动画。当前正在以 VPB 原几何及材质绑定校准静帧，网页播放器尚未实施。原七商品前台仍可用。资源许可未在用户目录中提供，不宣称该汽车资产为原创或 CC0。见 [.ai/reventon-validation.md](.ai/reventon-validation.md)。

2026-09-22：新增桌面音箱主动演绎样板，旋钮特写 → 完整轮廓 → 外观分层 → 合拢并交回操作，约 8 秒。该演绎是原创概念样品的造型展示，不表达真实声学、制造或内部结构。默认页面无自动运镜。赛车和绿植的专属演绎仍待后续实施。

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

2026-09-28 用户再次确认：Reventón 演示的核心原理必须是 Three.js。所有展示动作在真实 Three 场景中实时执行；Blender 只提供烘焙资产，Vue/TresJS/GSAP 为装配与流程控制，禁止预渲染媒体替代。

用户指定：Vue 3、TypeScript、Vite、TresJS、Three.js、GSAP、Lenis、Tailwind CSS、shadcn-vue、Pinia。GLB 为交付模型格式。

## Product Purpose

本科毕业设计《基于 Three.js 的 Web 端三维商品展示与交互系统的设计与实现》。以可交互产品为核心，逐步发展为沉浸式三维展示体验。

## Users

待确认：最终消费者画像。当前按浏览商品的访客和演示系统的毕业设计作者设计。

## Capabilities and Constraints

分五期推进：基础场景；动画叙事；部件与材质交互；视觉增强；管理后台。2026-09-19 已整合为七件商品的桌面展示系统：目录分类与搜索、单 Canvas 切换、按模型能力配置的试色/聚焦/分层/导览、惯性手势与悬停/捏合确认，以及 HDR、Bloom、粒子与扫描演出。桌面高画质固定参数，不自动降低品质；兼容路径提供 eco。单个 Vue 文件不超过 300 行，资源生命周期必须可验证。后台、上传与数据库尚未接入 Trees X。

## Brand Commitments

用户指定：深色背景、大面积留白、银灰金属、克制的蓝紫科技光、产品中心视觉；参照 Apple、Legions、Nothing、Sony 的体验品质。工程设计先行。

Reventón 是已确认的局部视觉例外：采用用户原 beauty 图的浅灰摄影棚与现有 Trees X 字体，恢复后的真实汽车主导第一屏，控件克制。该例外不替换其他展品的深色舞台规范。

## Evidence on Hand

用户提供 `I:/ssr/NIXUS/heritage-museum/` 的商品改造版本作为复用来源。六个 GLB 与六张封面来自其 `heritage-web/public`，来源清单记载作者及 CC0 许可；文件校验和、实测面数见 `public/models/collection/manifest.json`。另保留原创 FORM / 01 音箱。GAME / PLAY / WOOD / GROW / ROOM / RACE 为本项目陈列编号，不是厂家型号；不沿用参考项目的演示价格、购物车与未经验证的性能描述。

Reventón 来自用户提供的 VPB、原内嵌图像与 Blender 恢复工程；未提供再分发许可，不宣称原创或 CC0。`public/models/reventon/reference.jpg` 是原 beauty JPG 目录封面与画质对照，**不是实机截图**。真实浏览器截图保存在 `.impeccable/review/reventon/`：`desktop.png`、`开启.png`、`座舱.png`、`展开.png`、`合拢.png`、`mobile.png`、`mobile-320.png`。资源身份与摘要见 [provenance.json](public/models/reventon/provenance.json)。

## Product Principles

- 先验证可运行、可替换、可释放的工程底座。
- 交互围绕商品观察，界面让位于模型。
- 提供加载、失败、无 WebGL 与减弱动态状态。
- 新增效果必须有测量和降级策略。

## 2026-09-21 已确认的展厅体验

默认沉浸式浏览，按需单侧栏、顶部一键完整控制台。三件主展品为桌面音箱、迷你赛车、陶盆绿植，采用独立舞台、镜头和三步导览。其余四件保留资产支持的交互。七张封面为实际模型重新渲染，出处与校验记录见 public/covers/exhibition。

主流程为欣赏 → 外观 / 细节 / 结构 / 手势探索 → 返回全景。滚轮在展示区缩放。侧栏关闭不清空观察状态或摄像头会话；顶部始终能关闭运行中的摄像头。首次手势有可跳过示范、镜像预览和三步引导，悬停为默认确认方式，捏合为进阶功能。

本轮不含后台、AI 讲解、多人空间、截图分享。真人手势稳定性仍需使用真实设备验收；自动化合成输入不能替代人的成功率与舒适度测试。
