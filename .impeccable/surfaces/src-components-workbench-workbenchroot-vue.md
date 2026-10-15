---
version: 1
slug: 'src-components-workbench-workbenchroot-vue'
primary_target: 'src/components/workbench/WorkbenchRoot.vue'
related_targets:
  - 'src/components/workbench/WorkbenchCatalog.vue'
  - 'src/components/workbench/WorkbenchRail.vue'
  - 'src/components/workbench/WorkbenchPanel.vue'
  - 'src/components/workbench/WorkbenchTools.vue'
  - 'src/components/workbench/WorkbenchStage.vue'
  - 'src/components/workbench/WorkbenchParts.vue'
  - 'src/components/workbench/WorkbenchLayoutMotion.vue'
  - 'src/components/workbench/WorkbenchScene.vue'
  - 'src/assets/styles/workbench.css'
  - 'src/assets/styles/workbench-floating.css'
  - 'src/assets/styles/workbench-parts.css'
  - 'server/src/main/resources/presentations/typewriter-kimi-v1.json'
  - 'src/lib/workbench/controller.ts'
  - 'src/lib/workbench/interfaceMotion.ts'
  - 'src/lib/workbench/viewportFraming.ts'
  - 'src/lib/workbench/calloutOverlay.ts'
  - 'src/lib/workbench/adapter.ts'
  - 'src/lib/workbench/samples.ts'
  - 'src/stores/workbench.ts'
mode: 'Operate'
---

# 统一三维工作台：方案 C 漂浮式访客界面

2026-10-15 局部试用：用户要求更暗的摄影棚，实时 WebGPU 打字机改为深灰绿天空盒／石墨地台，商品光照、材质、机构与浅色玻璃工具保持；`studioMood=light` 对照原亮场。暗场标题／说明／输入提示／引线采用浅色，按实际后端隔离，普通 WebGL、hybrid 和其他商品不变。整机更集中但平铺黑色细件对比偏弱，整体取舍交由用户本人，具体颜色与证据见根 DESIGN.md 与 `.ai/typewriter-dark-studio-validation.md`；下方 10 月 11 日浅舞台描述属于原基线。

2026-10-11 用户批准方案 C 重设计：浅银灰/淡灰绿的极简毛玻璃，浮动快速栏、单活动面板与底部工具。模式继续为 Operate，主任务是商品自由观察、部件与结构操作；环境氛围服务这项任务，不改成只观看的影片页。默认首页仍为打字机，钢琴与精细汽车同属三件真实 GLB。音箱下架且历史资源保留。管理端、管理预览和 legacy 保持原有主题与布局。

## 方向与视觉权威

视觉依据为用户明确选择的方案 C 生成概念、[PRODUCT.md](../../PRODUCT.md)、[工作台契约](../../.ai/workbench-contract.md) 与本轮真实组件/样式及截图。概念只确认 UI 方向，不充当模型精度或实机画质证据；完整展厅墙窗、天空和地台资产另列后续。

- **THESIS**：模型先被看清，工具在需要时展开，同一套界面服务正式资产与流程样板。
- **OWN-WORLD**：浅银灰舞台、深灰绿文字、淡绿选中态、克制毛玻璃与清楚中文，沿用 Manrope / Noto Sans SC 字体；玻璃集中在快速栏、面板和工具，不嵌套装饰卡片。完整 token 由根 DESIGN.md 的 visitorColors 等访客覆盖记录维护。
- **STORY**：目录选择 → 自由观察 → 外观/细节/结构与动作 → 可选手动导览 → 返回全景或下一件。
- **FIRST VIEWPORT**：轻量顶栏、中文商品身份与“正式展品”标记、真实打字机 GLB、左侧三件真实商品快速栏、底部两行工具及简短输入提示。首屏不打开目录或操作面板，不自动运镜，整机默认不覆盖热点标签。
- **FORM**：单一全幅 Canvas；目录浮于左或工具面板浮于右，互斥打开。相机投影平滑横移留空间，不重置观察姿态、不因面板缩小商品；手机使用横向快速栏与底部单面板。

## 实现后的布局与状态

桌面：全幅舞台，顶栏上 24px/左右 32px；左侧快速栏 108px，目录面板 300px，右操作面板 320px。标题上 112px/左 170px，底部两行工具距底 28px，面板正文独立滚动。短桌面与较窄桌面的调整、完整参数见根 [DESIGN.md](../../DESIGN.md)，不在此另建 token 真值。

760px 及以下：顶部横向快速栏、底部单面板，面板最大高 45%，完整核心工具仍在底部；介绍正文在面板打开时收起。舞台引线标签继续显示并允许长名称换行，容纳不足时抑制次要标签；细节列表提供完整部件选择。320px、390px 为基础兼容范围，桌面仍是主要使用环境。

- **目录**：搜索、分类、当前商品、真实资源封面、读取中、错误重试与空结果；按配置区分“正式展品”与“流程样板”，音箱下架后不出现在访客目录。
- **外观**：色样、名称和选中勾；打字机有缎黑、象牙白、墨绿三种展示漆面，说明不代表真实可购款式。
- **细节**：完整 572 个稳定部件均可搜索、分组、拾取与聚焦，列表每次递增 40 条；默认列八个重点部件。“A”精确查找 A 键和 A 字杆，part- 前缀查找稳定编号。整机默认无舞台标签；未展开时细节面板未选中部件显示配置重点标记，选中后只显示当前部件。分层和平铺自动渐显重点引线标签，选中标签优先并可与其余重点标签共存。舞台最多保留 12 个候选，名称不越界并避开介绍与工具；移动保留标签和完整列表。
- **结构与动作**：A 键演绎按键、键杠杆与字杆联动；“合拢整机”“分层展开”“平铺部件”为具名结构按钮，保留暂停、继续和复原动作。访客不常驻百分比滑条；结构变化保留镜头，“展开全景”“平铺俯视”为独立相机预设。分层关系不声称真实维修顺序。
- **导览**：五步手动推进：整机、一次按键的连接、分层、平铺、返回整机。开始、上一步、下一步、完成和退出沿用共同控件，手动输入立即接手。
- **加载/错误**：同一舞台空间中的状态覆盖层；配置读取后仍等待首帧。失败显示可恢复操作，不使用静态样例兜底。
- **焦点/动态**：2px 深绿焦点环、Escape 关闭、关闭后恢复入口；面板进入 0.32 秒/退出 0.18 秒、导航指示块 0.3 秒，GSAP 唯一拥有且可取消旧补间，退出立即 inert。能力缺失不显示入口，减弱动态直接到达静态结果。

“复位视角”只改相机，“返回全景”恢复动作和结构并保留配色，“还原商品”恢复配色、动作、结构与镜头。开合面板保留状态，切换商品进入新商品默认状态。三个词的区别是操作契约，不可为了缩短文案合并。

## 场景、资产与范围

当前 typewriter-study 是 572 部件的真实 GLB，piano-cfx 与 reventon 也均接入真实 GLB。打字机保留装配/分层/平铺及击发联动，钢琴保留八段结构与平铺，汽车保留双门/分离、座舱与原材质反射。访客本轮只统一浅灰背景与地面色，曝光、光照、环境及材质保持原通道。源页面 DOM、滚动导演、相机和 renderer 未迁入；form-01 已下架但兼容资源保留。正式展品标记不表示工厂 CAD、照片级画质或整项目已经完成。

配置来自真实 Spring Boot/MySQL API，通过既有管理接口保存，当前展示仍只有一个 TresCanvas/renderer。三件分别由受控注册适配器接入，界面、状态意图与 Three 所有权边界见 [架构](../../.ai/architecture.md)。快速栏独立读取完整目录，不借用目录检索/分类的临时结果；当前 API、配置版本和数据库保持。

旧影片、旧完整控制台、独立 Reventón 固定流程与摄影棚规则均为 **legacy-only**。旧版由 legacy=1 或已保留旧商品 ID 进入；?legacy=1&product=reventon 为旧固定演示，?product=reventon 为统一工作台的精细汽车。此前深蓝灰访客布局与旧默认路由归入历史，当前规范见根 DESIGN.md；管理端与管理预览仍使用其原有基础主题。旧设计及旧侧车完整保存在 [设计历史](../../.ai/history/2026-09-design.md)。

## 验证证据与交付边界

本轮实际执行与最终补充项见 [.ai/ui-c-validation.md](../../.ai/ui-c-validation.md)。集中修正前 check 为 221 项 Vitest、48 项 Node，99 个 Vue ≤300 行；UI flow 在 5183 使用真实 API 与 572 部件打字机，覆盖五个尺寸、12 张截图、快速面板、焦点、状态保持、导览/鼠标接管、滚轮隔离、筛选独立、无 WebGL/迟到选择及减弱动态。最终构图测试、三件标签与生产浏览器结果由执行者补充，未用历史 ship 代替本轮验收。

## 历史记录（不作为方案 C 完成证据）

以下保留原打字机迁移、标签与共同流程证据。当时“汽车为样板”“深蓝灰操作层”和旧布局的描述只适用于记录日期，不覆盖当前三件真实 GLB 与浅色访客 UI。

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

上述 ship 仅对应当时的共同流程。基础管理、管理易用性、正式汽车迁入及 E1 已有后续独立阶段记录；E1 本人走查仍待反馈，方案 C 另有本轮记录。手势、在线上传与高级版本管理为扩展；照片级外观、量化性能或工厂机械精度不由这些截图推断。
