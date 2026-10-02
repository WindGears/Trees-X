---
version: 1
slug: 'src-components-workbench-workbenchroot-vue'
primary_target: 'src/components/workbench/WorkbenchRoot.vue'
related_targets:
  - 'src/components/workbench/WorkbenchCatalog.vue'
  - 'src/components/workbench/WorkbenchPanel.vue'
  - 'src/components/workbench/WorkbenchTools.vue'
  - 'src/components/workbench/WorkbenchStage.vue'
  - 'src/components/workbench/WorkbenchScene.vue'
  - 'src/assets/styles/workbench.css'
  - 'src/lib/workbench/controller.ts'
  - 'src/lib/workbench/adapter.ts'
  - 'src/lib/workbench/samples.ts'
  - 'src/stores/workbench.ts'
mode: 'Operate'
---

# 统一三维工作台：流程样板阶段

2026-10-02 文档收尾。用户已确定先验证共同工作台和商品流程，再按音箱、打字机、汽车逐件接入正式模型。当前默认入口为 WorkbenchRoot，首页音箱；此表面以完成自由观察、细节聚焦、配色、动作与手动导览为目标，模式为 Operate，表达沿用 Trees X 模型优先的品牌。

## 方向与视觉权威

这次是用户固定布局下的代码实现，没有已批准图像合成稿或照片级视觉目标。视觉依据是 [PRODUCT.md](../../PRODUCT.md) 的品牌承诺、[工作台契约](../../.ai/workbench-contract.md)、当前组件/样式和实机截图。以下记录已实现选择，不追认一张不存在的设计图。

- **THESIS**：模型先被看清，工具在需要时展开，同一套界面服务三件样板。
- **OWN-WORLD**：深蓝灰底、银灰简化三维形体、冷银选中态、细线和清楚中文；沿用 Manrope / Noto Sans SC 字体。
- **STORY**：目录选择 → 自由观察 → 外观/细节/结构与动作 → 可选手动导览 → 返回全景或下一件。
- **FIRST VIEWPORT**：顶栏、中文商品身份与流程样板标记、真实 Three 对象、两行共享工具和简短输入提示。首屏不打开目录或检查面板，不自动运镜。
- **FORM**：单一 Canvas；目录在左或工具面板在右，互斥打开并收窄场景；手机统一转到模型下方。

## 实现后的布局与状态

桌面：76px 顶栏；目录 310px，右工具面板 340px。1100px 及以下分别变为 280px / 300px。标题位于场景上 32px、左 38px，场景底部 66px 处是两行工具。完整 token 已记录于根 [DESIGN.md](../../DESIGN.md)，不在此另建视觉真值。

760px 及以下：66px 顶栏；场景在上、面板在下，行高使用 minmax(310px, 1fr) minmax(220px, 38%)；下面板滚动，保持相机与探索工具可用。DOM 热点隐藏，细节列表继续提供部件选择。320px、390px 为基础兼容范围，桌面仍是主要使用环境。

- **目录**：搜索、分类、当前商品、读取中、错误重试与空结果；条目明确标识“流程样板”。
- **外观**：色样、名称和选中勾；说明样板颜色不代表真实可购款式。
- **细节**：部件列表、焦点、说明和返回全景；同一节点承载真实模型聚焦。
- **结构与动作**：toggle 有开启文字，pulse 为一次动作；分层/合拢说明不声称真实维修顺序。
- **导览**：四步手动推进；开始、上一步、下一步、完成和退出，手动输入立即接手。
- **加载/错误**：同一舞台空间中的状态覆盖层；配置读取后仍等待首帧。失败显示可恢复操作，不使用静态样例兜底。
- **焦点/动态**：焦点环、Escape 关闭、导航入口打开后的焦点管理；能力缺失不显示入口，减弱动态直接到达静态结果。

“复位视角”只改相机，“返回全景”恢复动作和结构并保留配色，“还原商品”恢复配色、动作、结构与镜头。开合面板保留状态，切换商品进入新商品默认状态。三个词的区别是操作契约，不可为了缩短文案合并。

## 场景、资产与范围

当前 form-01、typewriter-study、reventon 都是程序化流程样板，包含可见形体、可命名部件、动作和结构关系。场景使用 RoomEnvironment、方向光、地面阴影及雾；未生成或借用图像合成稿作为当前场景。截图与捕获结果保存在本地 .impeccable/review/workbench/。

配置来自真实 Spring Boot/MySQL API，共用一个 TresCanvas/renderer。界面、状态意图与 Three 所有权边界见 [架构](../../.ai/architecture.md)。未来正式模型实现相同 adapter 接口，保留共同工作台，不复制独立页面。

旧影片、旧完整控制台、独立 Reventón 固定流程与摄影棚规则均为 **legacy-only**。旧版由 legacy=1 或已保留的旧商品 ID 路由进入；精细汽车为 ?legacy=1&product=reventon，当前 ?product=reventon 为汽车流程样板。历史 surface 中的旧默认路由和待验收项只在旧版范围解释，当前规范见根 DESIGN.md。旧设计及旧侧车完整保存在 [设计历史](../../.ai/history/2026-09-design.md)。

## 验证证据与交付边界

- [finish-review.md](../review/workbench/finish-review.md) 为 disposition: ship，仅确认用户批准的流程样板界面与所供截图，没有额外的模型画质或性能验收。
- [results.json](../review/workbench/results.json) 记录真实 Spring Boot/MySQL 请求、场景身份、动作/导览/接手、两种复位、面板滚轮隔离、单 Canvas/renderer、错误恢复、路由、移动兼容与减弱动态；passed: true，errors: []。这是已有测试记录，本次文档工作没有重复执行浏览器流程。
- 桌面概览覆盖三件样板在 1280×720、1440×1000、1920×1080 的截图；另有目录、细节、三件动作状态，以及 390px / 320px 的默认和下面板截图。finish review 已逐张核查所需截图；本次文档另抽查音箱 1440、汽车动作 1440、320px 下面板，与源码吻合。
- [detector.json](../review/workbench/detector.json) 的 31 项均是相对旧系统的颜色、字号或圆角文档差异。本轮已按实际实现写入 wb-* token，并保存旧规范。没有再次运行 detector，也不把文档化描述为新一轮测试或性能通过。

当前阶段到共同流程和框架验收为止。下一阶段逐件替换正式模型并复核节点、热点、镜头、动作和材质；照片级外观、连续动作视觉质量与量化性能成绩不在本次 ship 结论内。手势和管理端属于后续排期。
