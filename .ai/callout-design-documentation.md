# 统一拆解引线标签：视觉与界面文档交接

2026-10-09。按 Impeccable `impeccable_documenter` 工作流核对完成后的源码、最终报告与所供截图。用户明确要求全商品拆开时渐显细引线标签、平滑避让并保持画面清晰；本轮是既有 Operate 工作台的普通扩展，当前范围为打字机、钢琴和汽车流程样板。

本轮局部合并 [DESIGN.md](../DESIGN.md) 的热点说明与[工作台 surface](../.impeccable/surfaces/src-components-workbench-workbenchroot-vue.md)的标签行为，保留其已有视觉世界、palette、布局及 frontmatter 值。[design.json](../.impeccable/design.json) 没有新全局 token，保持原样；本文件记录组件事实和证据，不建立另一套 token 真值。商品事实与工程验收分别由 [PRODUCT.md](../PRODUCT.md)、[标签验收](callout-validation.md)维护。

## Overview

继续遵循“模型先被看清，工具在需要时展开”：默认整机不覆盖标签，结构拆开后以稀疏中文名称和细引线说明重点部件，访客仍可自由旋转、缩放、选择部件。闭合面板保留当前结构；合拢后整组标签淡出，细节或已选部件继续按观察上下文提供入口。

THESIS、OWN-WORLD、STORY、FIRST VIEWPORT 与 FORM 均继承既有工作台：模型主导、暖纸或深蓝灰商品舞台、同一中文字体、主动观察、唯一 Canvas 与互斥单面板。没有新 approved comp，也没有新增世界或概念方向轮。

## Colors

标签底色直接跟随商品配置的舞台背景。暖纸舞台沿用既有深色主字与辅助字；深蓝灰舞台沿用霜白主字与灰蓝辅助字。引线取辅助字色，部件端点取主字色；选中后引线取主字色。深色顶栏、工具与面板继续使用原工作台颜色。

标签悬停使用下划线，选中使用加粗和下划线，保留 `aria-pressed`；键盘焦点用舞台主字色的清楚轮廓。此局部状态不改变其它按钮的冷银蓝选中规则。根规范保留的原 `wb-hotspot` 组件 token 与 sidecar 示例没有被重写；当前引线标签由局部组件明确设置舞台色与已有标签角。

## Typography

沿用 Manrope / Noto Sans SC Display 字体栈与辅助字级（12px），标签行高（1.5）、最小高度（32px）。长中文名称可换行，桌面最大宽度（190px）并受舞台宽度约束；既有（760px）移动断点下最大宽度（112px）。选中名称使用（600）字重和下划线，名称仍来自原商品热点数据。

## Layout

共同顶栏、左右单面板、移动下面板与两行底部工具保持。标签在舞台内侧（16px）边界内布局，目标标签间保留（8px）间隔，避开可见商品介绍、工具、输入与键盘提示。紧凑锚点群额外预留中心观察区域；较大锚点群不强行占用这个中央区域。

舞台最多接收（12）个候选：选中部件优先进入，余位用于配置重点标记。未选中时只取重点标记；完整（572 / 823）部件不会变成同量常驻标签。移动端使用相同避让与抑制规则，并继续提供完整细节列表。视锥外、锚点越界、名称放不下或无合法位置时抑制标签，选中优先也遵守这些可见条件。

## Shapes

中文标签使用已有标签角色的小圆角（3px）与舞台实底，局部内边距桌面为（5px 9px）、移动为（5px 7px）。SVG 细引线宽（0.85px），非缩放描边，折点采用圆形连接，部件端点是小圆点。标签与引线没有新增阴影、模糊、渐变或装饰光效。

## Components

| 实现位置                                           | 本次职责与边界                                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkbenchStage.vue`                               | 保留唯一 TresCanvas，限制候选数量并优先选中部件；首帧可用后装配标签层，商品代次与上下文恢复替换旧标签层。                                     |
| `WorkbenchCallouts.vue` / `workbench-callouts.css` | 仅装配 DOM 名称按钮、SVG 引线与端点、舞台字色与局部样式；点击继续发出原聚焦意图。                                                             |
| `controller.project` / `calloutProjection.ts`      | 从当前节点世界变换投影锚点；按实际 `adapter.pose` 的持续结构进度或开关决定展开，瞬时按键动作不触发整组标签。                                  |
| `calloutLayout.ts` / `calloutTransition.ts`        | 确定性容量与优先级布局、边界和障碍检查、帧率独立平滑、移动矩形交叉检查。                                                                      |
| `calloutOverlay.ts`                                | 独占局部数字位置、GSAP 渐显/淡出、临时 ticker、ResizeObserver 与减弱动态监听；稳定后停止 ticker，隐藏与卸载取消活动，卸载断开 observer/监听。 |

结构展开后重点名称与引线自动渐显（320ms），合拢后淡出（220ms）；未展开时细节面板无选中可显示重点标记，选中时仅显示当前部件。展开时已选部件优先并可与其它重点标记共存。安全路径使用约（120ms）指数平滑，可能穿过其它标签或障碍时先淡出并冻结原位置，低透明度后合法重定位，再渐显。淡出开始立即停止指针和键盘交互，越界旧矩形不显示；减弱动态直接到合法结果。

高频投影与标签位置留在局部数字对象，直接写 DOM/SVG，不逐帧写 Pinia，不增加 Three 资源或标签专用 WebGL 循环。隐藏页与卸载释放方明确；实际恢复、迟到加载及单 renderer 检查由[验收](callout-validation.md)和[架构](architecture.md)维护。新商品继续使用既有热点锚点、marker 与结构动作配置接入，不新增后端字段或复制工作台。

## 已检查证据与限制

本次实读上述组件、三个布局/投影/过渡测试、根设计规范、sidecar、既有 surface 和工程约束。先读第一轮 [report.json](../artifacts/callouts/report.json)（`passed: true`、`errors: []`、27 项截图），再以冻结的 [final/report.json](../artifacts/callouts/final/report.json)为最终证据（`passed: true`、`errors: []`、27 项截图、9 项检查）。后者补充动画中间态可见碰撞检查与真实 WebGL 丢失恢复；有限取样不外推为任意路径保证或性能成绩。

documenter 实开两轮各同样八张现有图；最终抽查路径均在 `artifacts/callouts/final/visual/`：三件商品各自的 `*-1440.png`、`typewriter-study-320.png`、`piano-cfx-390.png`、`piano-chapter-7.png`、`typewriter-flat.png`、`typewriter-study-selected.png`。最终图中的明暗适配、稀疏名称、移动换行与选中反馈和源码吻合。没有启动浏览器、创建新截图或重新运行 detector。

独立 [finish-review.md](../.impeccable/review/callouts/finish-review.md) 逐张核查最终 27 张图，`disposition: ship`、`material_fixes: none`，范围仅本次标签扩展。[detector.json](../.impeccable/review/callouts/detector.json) 为 `[]`，只代表此次检测目标，不能解释为全项目历史漂移已清零。check/build、20 项新增算法测试和运行检查见[验收证据](callout-validation.md)，本次文档没有重跑这些测试。

布局依据屏幕锚点与 DOM 矩形，不进行完整模型遮挡分析；目标标签避让和路径检查不构成引线之间永不相交的承诺。关闭三维显示的内容回退继续沿用原图文与列表。此扩展不改变资产、材质、后台或 legacy 独立页面，也不证明 CAD 关系、维修顺序、机械精度或照片级画质。

## 未纳入规范的漂移与后续

既存目录封面（8px）圆角 advisory 与历史颜色记录未修复、未新增为规范 token；本次只更新用户授权的标签段落。此前钢琴交接文档中的“移动隐藏热点”和“展开无标签”属于该阶段记录，当前局部行为以本文件和更新后的根规范为准，不追改历史证据。

本轮没有新全局 palette、字体、布局或圆角刻度，sidecar 保持。正式汽车迁移、联合用户验收与实际性能评价继续按后续阶段处理；本次 `ship` 不替代那些阶段。
