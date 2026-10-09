---
version: 1
slug: 'src-components-workbench-workbenchroot-vue'
primary_target: 'src/components/workbench/WorkbenchRoot.vue'
related_targets:
  - 'src/components/workbench/WorkbenchCatalog.vue'
  - 'src/components/workbench/WorkbenchPanel.vue'
  - 'src/components/workbench/WorkbenchTools.vue'
  - 'src/components/workbench/WorkbenchStage.vue'
  - 'src/components/workbench/WorkbenchParts.vue'
  - 'src/components/workbench/WorkbenchLayoutMotion.vue'
  - 'src/components/workbench/WorkbenchScene.vue'
  - 'src/assets/styles/workbench.css'
  - 'src/assets/styles/workbench-parts.css'
  - 'server/src/main/resources/presentations/typewriter-kimi-v1.json'
  - 'src/lib/workbench/controller.ts'
  - 'src/lib/workbench/adapter.ts'
  - 'src/lib/workbench/samples.ts'
  - 'src/stores/workbench.ts'
mode: 'Operate'
---

# 统一三维工作台：打字机正式资产迁移

2026-10-09 文档合并。用户调整为打字机优先，音箱撤出当前正式资产计划及访客目录。默认入口仍为 WorkbenchRoot，首页 typewriter-study 已接入用户自有 Kimi 模型导出的正式 GLB；汽车仍为程序化流程样板，手表只是候选。此表面继续完成自由观察、细节聚焦、配色、动作与主动导览，模式为 Operate，表达沿用 Trees X 模型优先的品牌。2026-10-02 的共同流程记录保留为历史证据，不代表当前默认资产。

## 方向与视觉权威

这次在用户固定工作台中接入真实资产，没有新增全局视觉世界或图像合成稿。视觉依据是 [PRODUCT.md](../../PRODUCT.md) 的品牌承诺、[工作台契约](../../.ai/workbench-contract.md)、当前组件/样式、打字机展示配置及 artifacts/typewriter-migration/visual-final 的实机截图。以下记录已实现选择，不追认一张不存在的设计图。

- **THESIS**：模型先被看清，工具在需要时展开，同一套界面服务正式资产与流程样板。
- **OWN-WORLD**：深蓝灰顶栏、工具与面板，冷银选中态、细线和清楚中文；沿用 Manrope / Noto Sans SC 字体。打字机舞台使用暖纸色承托黑色漆面与金属，舞台文字使用深色主字和辅助字，完整 token 仍由根 DESIGN.md 维护。
- **STORY**：目录选择 → 自由观察 → 外观/细节/结构与动作 → 可选手动导览 → 返回全景或下一件。
- **FIRST VIEWPORT**：顶栏、中文商品身份与“正式展品”标记、真实打字机 GLB、两行共享工具和简短输入提示。首屏不打开目录或检查面板，不自动运镜，整机默认不覆盖热点标签。
- **FORM**：单一 Canvas；目录在左或工具面板在右，互斥打开并收窄场景；手机统一转到模型下方。

## 实现后的布局与状态

桌面：76px 顶栏；目录 310px，右工具面板 340px。1100px 及以下分别变为 280px / 300px。标题位于场景上 32px、左 38px，场景底部 66px 处是两行工具。完整 token 已记录于根 [DESIGN.md](../../DESIGN.md)，不在此另建视觉真值。

760px 及以下：66px 顶栏；场景在上、面板在下，行高使用 minmax(310px, 1fr) minmax(220px, 38%)；下面板滚动，保持相机与探索工具可用。舞台引线标签继续显示并允许长名称换行，容纳不足时抑制次要标签；细节列表继续提供完整部件选择。320px、390px 为基础兼容范围，桌面仍是主要使用环境。

- **目录**：搜索、分类、当前商品、真实资源封面、读取中、错误重试与空结果；按配置区分“正式展品”与“流程样板”，音箱下架后不出现在访客目录。
- **外观**：色样、名称和选中勾；打字机有缎黑、象牙白、墨绿三种展示漆面，说明不代表真实可购款式。
- **细节**：完整 572 个稳定部件均可搜索、分组、拾取与聚焦，列表每次递增 40 条；默认列八个重点部件。“A”精确查找 A 键和 A 字杆，part- 前缀查找稳定编号。整机默认无舞台标签；未展开时细节面板未选中部件显示配置重点标记，选中后只显示当前部件。分层和平铺自动渐显重点引线标签，选中标签优先并可与其余重点标签共存。舞台最多保留 12 个候选，名称不越界并避开介绍与工具；移动保留标签和完整列表。
- **结构与动作**：A 键演绎按键、键杠杆与字杆联动；“合拢整机”“分层展开”“平铺部件”为具名结构按钮，保留暂停、继续和复原动作。访客不常驻百分比滑条；结构变化保留镜头，“展开全景”“平铺俯视”为独立相机预设。分层关系不声称真实维修顺序。
- **导览**：五步手动推进：整机、一次按键的连接、分层、平铺、返回整机。开始、上一步、下一步、完成和退出沿用共同控件，手动输入立即接手。
- **加载/错误**：同一舞台空间中的状态覆盖层；配置读取后仍等待首帧。失败显示可恢复操作，不使用静态样例兜底。
- **焦点/动态**：焦点环、Escape 关闭、导航入口打开后的焦点管理；能力缺失不显示入口，减弱动态直接到达静态结果。

“复位视角”只改相机，“返回全景”恢复动作和结构并保留配色，“还原商品”恢复配色、动作、结构与镜头。开合面板保留状态，切换商品进入新商品默认状态。三个词的区别是操作契约，不可为了缩短文案合并。

## 场景、资产与范围

当前 typewriter-study 是 572 部件的真实 GLB，保留来源模型的装配、分层、平铺姿态与独立部件身份；暖纸舞台采用配置背景与地面、专属环境、漆面与金属 shader。源页面的 DOM、滚动导演、相机和 renderer 未迁入。reventon 仍是程序化流程样板；form-01 已下架但兼容资源保留。正式展品标记不表示工厂 CAD、照片级画质或整项目已经完成。

配置来自真实 Spring Boot/MySQL API，通过既有管理接口保存，当前展示仍只有一个 TresCanvas/renderer。打字机通过受控注册 typewriter-v1 适配器和 v3 结构程序接入；界面、状态意图与 Three 所有权边界见 [架构](../../.ai/architecture.md)。未来正式汽车继续复用共同工作台与适配接口，不复制独立页面。

旧影片、旧完整控制台、独立 Reventón 固定流程与摄影棚规则均为 **legacy-only**。旧版由 legacy=1 或已保留的旧商品 ID 路由进入；精细汽车为 ?legacy=1&product=reventon，当前 ?product=reventon 为汽车流程样板。历史 surface 中的旧默认路由和待验收项只在旧版范围解释，当前规范见根 DESIGN.md。旧设计及旧侧车完整保存在 [设计历史](../../.ai/history/2026-09-design.md)。

## 验证证据与交付边界

本轮文档依据完成修正后的 [visual-final/report.json](../../artifacts/typewriter-migration/visual-final/report.json)，passed: true、errors: []。截图包括 whole-1280、whole-1440、whole-1920、whole-390、whole-320、key-closeup、layers-panel、flat-panel、catalog、guide-return。本次文档核对抽查整机 1440 与分层面板，与源码吻合；未重新捕获或运行浏览器、detector。底部输入提示采用舞台辅助字色，本轮实机对比度抽样约（4.73:1）；具体检查与持久化证据由 [.ai/typewriter-migration-validation.md](../../.ai/typewriter-migration-validation.md) 维护。

[visual-final/detector.json](../../artifacts/typewriter-migration/visual-final/detector.json) 仅有既存封面（8px）圆角 advisory，位置为 workbench.css 第 563 行。本轮未修复，也未为消除提示把它加入规范圆角刻度。此次只是现有视觉世界内的打字机扩展，不批准无关漂移。

### 2026-10-09 统一拆解引线标签

用户明确要求全商品拆开时渐显细引线标签、平滑避让并保持清晰。本次普通扩展覆盖当前打字机、钢琴与汽车流程样板，沿用原工作台的暖纸或深蓝灰舞台、12px 中文、已有 3px 标签角与 0.85px 细引线；全局 palette、布局、frontmatter 和 design.json 保持。标签选中采用加粗与下划线，点击继续使用原部件聚焦与描述。

拆开与合拢显隐从实际结构姿态读取；自由观察时锚点跟随当前节点世界变换。标签在安全路径上平滑移动，在可能穿过其它标签或障碍时短暂淡出，合法重定位后渐显。空间不足抑制低优先项，选中部件优先；细节列表继续容纳全部部件。闭合面板保留结构与标签状态，瞬时打字动作不触发整组标签，减弱动态直接到静态合法位置。

最终 [report.json](../../artifacts/callouts/final/report.json) 记录 `passed: true`、`errors: []` 与 27 项截图，覆盖三件商品的 1280/1440/1920/390/320、各自选中状态、钢琴八章及打字机平铺。独立 [finish-review.md](../review/callouts/finish-review.md) 逐张检查最终图并裁定 `ship`，仅覆盖本次标签扩展；[detector.json](../review/callouts/detector.json) 为 `[]`，不能解释为全项目历史漂移清零。本次 documenter 抽查最终八张图并核对源码，没有启动浏览器、重新截图或运行 detector。

组件、投影与释放边界、完整抽查清单及兼容限制见 [标签文档交接](../../.ai/callout-design-documentation.md)，执行与生命周期证据见 [标签验收](../../.ai/callout-validation.md)。这次局部合并替代旧的“分层/平铺无标记”和“移动隐藏热点”描述，未扩展到 legacy 独立页面、正式汽车迁移、性能成绩或机械精度。

### 2026-10-02 共同流程的历史证据

- [finish-review.md](../review/workbench/finish-review.md) 为 disposition: ship，仅确认用户批准的流程样板界面与所供截图，没有额外的模型画质或性能验收。
- [results.json](../review/workbench/results.json) 记录真实 Spring Boot/MySQL 请求、场景身份、动作/导览/接手、两种复位、面板滚轮隔离、单 Canvas/renderer、错误恢复、路由、移动兼容与减弱动态；passed: true，errors: []。这是已有测试记录，本次文档工作没有重复执行浏览器流程。
- 桌面概览覆盖三件样板在 1280×720、1440×1000、1920×1080 的截图；另有目录、细节、三件动作状态，以及 390px / 320px 的默认和下面板截图。finish review 已逐张核查所需截图；本次文档另抽查音箱 1440、汽车动作 1440、320px 下面板，与源码吻合。
- [detector.json](../review/workbench/detector.json) 的 31 项均是相对旧系统的颜色、字号或圆角文档差异。本轮已按实际实现写入 wb-* token，并保存旧规范。没有再次运行 detector，也不把文档化描述为新一轮测试或性能通过。

上述 ship 仅对应当时的共同流程。基础管理与管理易用性已有后续独立阶段记录；本轮完成打字机迁移的视觉记录，正式汽车与联合验收仍待进行。手势、在线上传与高级版本管理为扩展；照片级外观、量化性能或工厂机械精度不由这些截图推断。
