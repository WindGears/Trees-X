---
name: Trees X 三维商品工作台
description: 以模型为主、工具按需出现的深蓝灰框架与商品专属舞台。
colors:
  wb-accent: '#bed4ef'
  wb-accent-hover: '#d1e2f5'
  wb-accent-ink: '#101923'
  wb-focus: '#d1e5ff'
  wb-bg: '#101720'
  wb-stage: '#151c25'
  wb-stage-warm: '#f7f5ef'
  wb-stage-warm-ink: '#31392f'
  wb-stage-warm-muted: '#626b5e'
  wb-panel: '#131d29'
  wb-foreground: '#f0f4fa'
  wb-muted: '#abbacb'
  wb-line: '#304052'
  wb-button: '#1d2b3c'
  wb-button-hover: '#2b3d51'
  wb-field: '#172330'
  wb-label: '#bccce0'
  wb-tool-line: '#405369'
  wb-toolbar: '#111d2bea'
  wb-search-line: '#52708f'
  wb-placeholder: '#aebed0'
  wb-scrollbar: '#526a85'
  wb-swatch-line: '#7890ac'
  wb-status: '#151c25f5'
  wb-hotspot: '#111b28d9'
  wb-hotspot-line: '#7990ac'
  ad-error-text: '#ffd0c5'
  ad-error-bg: '#302421'
  ad-error-line: '#82635b'
  ad-listed: '#bfdcce'
typography:
  ad-heading:
    fontFamily: 'Manrope, Noto Sans SC Display, sans-serif'
    fontSize: '28px'
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: '-0.02em'
  ad-heading-mobile:
    fontSize: '24px'
    fontWeight: 500
    lineHeight: 1.3
  ad-code:
    fontFamily: 'Consolas, Courier New, monospace'
    fontSize: '13px'
    lineHeight: 1.7
  wb-display:
    fontFamily: 'Manrope, Noto Sans SC Display, sans-serif'
    fontSize: '36px'
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: '-0.025em'
  wb-display-mobile:
    fontSize: '27px'
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: '-0.025em'
  wb-brand:
    fontSize: '23px'
    fontWeight: 600
    letterSpacing: '-0.03em'
  wb-brand-mobile:
    fontSize: '20px'
    fontWeight: 600
    letterSpacing: '-0.03em'
  wb-panel-heading:
    fontSize: '22px'
    fontWeight: 500
  wb-panel-heading-mobile:
    fontSize: '19px'
    fontWeight: 500
  wb-status-heading:
    fontSize: '25px'
    fontWeight: 500
  wb-section-heading:
    fontSize: '16px'
    fontWeight: 500
    lineHeight: 1.7
  wb-catalog-title:
    fontSize: '17px'
    fontWeight: 500
  wb-body:
    fontFamily: 'Manrope, Noto Sans SC Display, sans-serif'
    fontSize: '14px'
    lineHeight: 1.85
  wb-content-body:
    fontSize: '15px'
    lineHeight: 1.7
  wb-catalog-body:
    fontSize: '13px'
    lineHeight: 1.75
  wb-label:
    fontSize: '12px'
rounded:
  wb-flat: '0px'
  wb-label: '3px'
  wb-hotspot: '4px'
  wb-field: '6px'
  wb-control: '7px'
  wb-toolbar: '10px'
  wb-circle: '50%'
spacing:
  wb-icon-gap: '8px'
  wb-list-gap: '10px'
  wb-copy-gap: '12px'
  wb-section: '24px'
  wb-panel-header-gap: '30px'
  wb-header-edge: '32px'
components:
  wb-button:
    backgroundColor: '{colors.wb-button}'
    textColor: '{colors.wb-foreground}'
    rounded: '{rounded.wb-control}'
    padding: '9px 13px'
  wb-button-hover:
    backgroundColor: '{colors.wb-button-hover}'
  wb-button-selected:
    backgroundColor: '{colors.wb-accent}'
    textColor: '{colors.wb-accent-ink}'
    rounded: '{rounded.wb-control}'
    padding: '9px 13px'
  wb-button-selected-hover:
    backgroundColor: '{colors.wb-accent-hover}'
    textColor: '{colors.wb-accent-ink}'
  wb-button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.wb-foreground}'
    rounded: '{rounded.wb-control}'
    padding: '9px 17px'
  wb-field:
    backgroundColor: '{colors.wb-field}'
    textColor: '{colors.wb-foreground}'
    rounded: '{rounded.wb-field}'
    padding: '9px 10px'
  wb-search:
    backgroundColor: 'transparent'
    textColor: '{colors.wb-foreground}'
    padding: '9px 10px 9px 0'
  wb-toolbar:
    backgroundColor: '{colors.wb-toolbar}'
    rounded: '{rounded.wb-toolbar}'
    padding: '5px'
  wb-panel:
    backgroundColor: '{colors.wb-panel}'
    textColor: '{colors.wb-foreground}'
    padding: '26px 23px'
  wb-catalog-row:
    backgroundColor: 'transparent'
    textColor: '{colors.wb-foreground}'
    rounded: '{rounded.wb-flat}'
    padding: '21px 10px'
  wb-sample-label:
    backgroundColor: 'transparent'
    textColor: '{colors.wb-label}'
    rounded: '{rounded.wb-label}'
    padding: '4px 8px'
  wb-hotspot:
    backgroundColor: '{colors.wb-hotspot}'
    textColor: '{colors.wb-foreground}'
    rounded: '{rounded.wb-hotspot}'
    padding: '5px 10px'
---

# Design System: Trees X 三维商品工作台

## Overview

**Creative North Star: "先欣赏商品，再自然探索细节"**

Trees X 延续深蓝灰框架、中文身份与冷银状态重点。顶栏、工具和面板安静地承托三维对象，信息用清楚的字号、间距与细线组织；工具的亮色状态帮助访客确认自己正在观察和操作什么。机械打字机采用暖纸色舞台，承托黑色漆面与金属部件，保留同一套深色工作台工具。

当前系统以一致的操作和可读性服务商品观察。模型通过真实 Three 场景呈现，资产身份按配置明确显示“正式展品”或“流程样板”。默认机械打字机已接入用户自有 Kimi 模型导出的真实 GLB，汽车仍是流程样板；音箱已从访客目录下架，历史资源与 legacy 入口保留。颜色、标题和控件不作真实商品规格、工厂机械精度或可购款式承诺。

**Key Characteristics:**

- 模型主导，工具按需出现。
- 深蓝灰层次、冷银选中态与清晰焦点。
- 中文信息优先，图标始终服务操作。
- 正式资产与流程样板共享组件与状态语言。

本文件保留 2026-10-02 共同工作台与管理端已确认规范，并于 2026-10-09 合并打字机迁移后的舞台与交互记录。视觉真值为 src/assets/styles/workbench.css、workbench-parts.css、src/components/workbench/、typewriter-kimi-v1.json 与现有实机截图；默认首页为 typewriter-study。布局策略、模式和验收范围见 [workbench surface](.impeccable/surfaces/src-components-workbench-workbenchroot-vue.md)。旧 Reventón 摄影棚与固定导演流程、音箱影片、各商品独立舞台和旧完整控制台全部属于 **legacy-only**，已连同原侧车保存到 [2026-09 设计历史](.ai/history/2026-09-design.md)。旧汽车入口为 ?legacy=1&product=reventon；历史中的旧默认路由不再代表当前首页。

## Colors

以带蓝倾向的石板灰建立背景、工具和正文之间的层次。规范值以 frontmatter 为准；wb-* 是当前工作台命名空间，商品配色由展示配置提供，不扩充为界面主题色。

### Primary

- **冷银蓝**（wb-accent / wb-accent-hover）：表示已选配色、部件、动作或当前工具；配合深墨选中文字。文本选区和输入光标延续同一重点色。
- **冰蓝焦点**（wb-focus）：可聚焦控件采用实线焦点环，宽度（2px）、外偏移（4px），不只以背景色变化传达键盘位置。

### Neutral

- **深海底色与石板舞台**（wb-bg / wb-stage）：分别承托框架与三维视野。舞台明暗来自场景、地面与照明，不把 CSS 色值当作整张实机图的像素目标。
- **暖纸舞台与深色字**（wb-stage-warm / wb-stage-warm-ink / wb-stage-warm-muted）：打字机配置的背景与地面采用暖纸色；标题用深色主字，描述、资产身份与底部输入提示用低一级的深色辅助字。WorkbenchRoot 根据舞台背景为展示区域设置 --wb-stage-ink 与 --wb-stage-muted，深色舞台仍回到霜白与灰蓝；顶栏、工具、面板不切换为浅色主题。
- **蓝灰面板与工具表面**（wb-panel / wb-toolbar）：面板为实底，覆盖舞台的工具条保留轻微透明度；两者以细边线分界。
- **霜白正文与灰蓝辅助字**（wb-foreground / wb-muted）：主操作与商品名清楚，说明、分类与提示退后一级。样板标记与搜索占位字分别使用 wb-label 和 wb-placeholder。
- **控制与边界**（wb-button / wb-button-hover / wb-field / wb-line）：按钮、悬停、输入与分隔线各有固定层次。工具边线、搜索下划线、滚动条及色样边线使用各自已记录的细部色。
- **状态覆盖与部件标签**（wb-status / 舞台字色）：状态覆盖层保护错误说明的可读性；舞台引线标签沿用商品舞台底色、主字色与辅助字色，暖纸舞台使用深色字，深蓝灰舞台使用霜白字，细引线连接当前部件锚点。

**The 重点即状态 Rule.** 冷银蓝服务选中状态，焦点另有清晰描边；动作开关同时显示文字状态，配色选中同时显示勾选。

**The 舞台文字分域 Rule.** 舞台上的商品身份和输入提示跟随舞台明暗选择文字色；深色工具与面板继续使用工作台文字色，商品专属背景不扩展为全站主题。

## Typography

**Display Font:** Manrope，中文回落到现有 Noto Sans SC Display，随后为 sans-serif。
**Body Font:** 同一字体栈；不为工具引入另一套工程等宽字体。现有中文字体由本地文件加载。

商品标题、面板标题、正文和辅助信息分别使用 frontmatter 的 wb-display、wb-panel-heading、wb-body 与 wb-label。中文名称是主标题；品牌稍紧的字距、面板标题和目录名的中等字重区分层级。桌面与移动的标题、品牌及面板标题均有独立 token。

介绍行高为（1.8），面板正文沿用正文 token，状态说明最大宽度为（38ch）。目录说明使用紧凑正文层级，样板标记、输入提示与动作状态使用辅助字级。导览步数使用等宽数字与字距（0.08em），仍属普通界面文字。

**The 中文身份 Rule.** 商品名称和功能名称直接说明内容；英文品牌不替代中文身份，正式展品与流程样板标记是资产事实说明。

## Layout

工作台占据（100svh），最小高度（640px）。桌面顶栏高（76px），两侧内边距来自 wb-header-edge；下方为剩余高度的网格。无面板时场景使用整行；目录打开时左栏宽（310px），工具面板打开时右栏宽（340px）。宽度不超过（1100px）时分别收至（280px）和（300px）。面板独立纵向滚动，保持场景可观察。

商品身份位于场景左上，桌面偏移为上（32px）、左（38px），介绍宽度最多（330px）；较窄桌面的左偏移为（26px）。底部工具分两行、水平居中，上行为视角与缩放，下行为探索入口；整体距场景底部（66px）。独立输入提示距左（38px）、距底（28px）。

不超过（760px）时顶栏改为（66px），品牌副说明与当前商品缩略名隐藏。场景在上，已打开的目录或面板在下；网格行分别为 minmax(310px, 1fr) 与 minmax(220px, 38%)。下面板内边距（16px 20px），场景保留商品名与两行工具；介绍和样板标记在面板打开时隐藏，完整样板身份仍可从目录获取。工具距底（37px），输入提示距底（13px）。舞台引线标签在该断点继续显示，长名称可换行；空间不足时抑制次要标签，完整部件仍可由“细节”列表选择。

**The 单活动面板 Rule.** 目录与工具面板同一时间只出现一个；桌面通过网格分配空间，移动端移到场景下方。

## Elevation & Depth

当前工作台控件与面板不使用盒阴影或背景模糊。深度依靠轻微透明的工具底、实色面板、细分隔线与三维对象自身的照明建立，不把每组内容再包成卡片。

程序化样板舞台使用 RoomEnvironment 反射、主光与轮廓光、雾和接收阴影的地面。打字机采用配置中的暖纸背景与地面、专属环境反射、漆面及金属 shader，通过真实几何与照明呈现材质。单个 TresCanvas 使用按需渲染，当前 DPR 上限为（2），不能由此推断帧率或照片级画质。

**The 模型承载深度 Rule.** 界面保持平实，空间层次交给真实三维几何、光照与阴影；商品观察不追加装饰性光效。

## Shapes

形状以紧凑、轻微圆角的矩形控件为主。按钮、字段、工具条与样板标签分别采用 frontmatter 的独立圆角角色；舞台引线标签使用已有 wb-label 的小圆角。目录条目和面板保持平直。分组主要靠空白和（1px）细线。圆形只用于配色色样和引线端点的小圆点，不作额外的舞台装饰。

## Components

### 基础管理端（2026-10-08）

/admin继承深蓝灰、冷银选中态和同一中文字体。管理任务使用Operate布局：76px顶栏、220px左导航、40px内容内边距；760px以下导航变为横排，表单改单列，表格在自身容器滚动，不让页面横向溢出。1100px以下分类列表/编辑表单上下排列。桌面标题使用ad-heading，手机ad-heading-mobile；正文14px、说明13px、分区标题20px。配置JSON使用ad-code等宽字体，只用于可编辑代码。

字段与按钮42px起，间距24px；错误用ad-error语义色与文字说明，上架状态用ad-listed且明确显示“已上架”。未保存输入、请求中、校验错误、冲突和会话过期均有反馈。入口不播放演出，按钮颜色过渡150ms，减弱动态关闭。预览复用工作台组件，高680px，移动基础预览820px，退出卸载Canvas。

本轮截图审查采用桌面/移动同批检查及一次集中修正，结果见.ai/admin-validation.md。旧系统tokens与视觉方向保持；新增token仅记录管理端已经实现的标题、代码字段和语义状态。

阶段D2沿用该视觉世界，将常用配置改为七分区编辑。分区按钮使用aria-current与冷银选中态，选中悬停仍为浅底深字。保存/预览/上下架/重新读取位于分区导航下方，桌面保存条随页面滚动固定在顶部，移动改为普通文档流；校验摘要限高170px，可点击定位字段。多条配置用16px名称、12px稳定ID及底边线分组，不新增装饰卡片。坐标用details折叠，桌面三轴并排，移动单列。封面预览、颜色选择与十六进制输入共享已有字段样式。

导览引用使用原生下拉框，空结构状态明确显示“保持当前”；返回全景步骤禁用其他执行项并解释内容仍保留。整页预览顶部显示回填目标、采集按钮和鼠标操作说明，不增加Canvas覆盖控制台。桌面1280/1440/1920与390/320同批检查后集中修正选中悬停对比度、镜头字段间距及空结构状态，一次确认结束本轮视觉检查，见.ai/admin-usability-validation.md。

### Buttons

普通按钮是深蓝灰实底、细描边与霜白文字，最小高度（42px），图标间距采用 wb-icon-gap。悬停加亮，背景与文字过渡为（150ms）；禁用透明度（0.4），不可操作。选中采用冷银蓝底和深墨文字，aria-pressed 与可见状态保持一致。配色和动作列表行的最小高度为（50px）。

工具条内部按钮使用透明底，选中后沿用同一高亮语言；关闭按钮为透明无边框图标控件。当前没有独立的按下位移或弹跳规则。

### Chips

“流程样板”和“正式展品”为非交互事实标记，透明底与细描边，文字跟随所在舞台的辅助字色；桌面使用 frontmatter 对应内边距，手机收至（2px 6px）。它不是筛选按钮或装饰性的栏目标签。

### Cards / Containers

工作台没有独立商品卡片网格。目录采用纵向文本条目，商品名、描述、分类和样板身份形成一行组，以底边线分隔；当前商品沿用选中底色。其余分组由间距和线条组织。

面板标题与关闭按钮并排，正文和操作列表向下排列；统一“还原商品”区域通过上边线与更大间隔分开。它附有恢复范围说明，不与“复位视角”混称。

### Inputs / Fields

原生下拉框与输入框保持深色字段底、细描边与明确焦点。目录搜索使用透明输入和底部细线，保留可访问名称及搜索图标；分类为带文字标签的原生下拉框。目录有读取中、错误重试、空搜索结果三个文字状态。

打字机细节沿用原生搜索与部件组下拉，字段最小高度（44px），文字（14px），内边距（10px 12px），圆角（4px）；字段、正文、标签与占位字沿用 wb-field、wb-foreground、wb-label、wb-placeholder，焦点采用 wb-focus 的（2px）实线与（3px）外偏移。默认列表先展示八个重点部件；名称搜索、部件组或“查看全部”可以访问完整（572）个部件，按（40）条递增展示。单个字母按键按名称末尾字母精确匹配，输入 A 对应 A 键与 A 字杆；part- 开头的输入匹配稳定部件编号前缀，其他输入匹配名称。

### Navigation

顶栏保留品牌与“商品目录”，桌面右端显示当前商品名。底部相机工具包含命名视角、缩小、放大和“复位视角”；探索导航根据商品能力显示外观、细节、结构与动作、导览。经导航打开面板后关闭按钮获得焦点，关闭时恢复原入口焦点，Escape 可关闭当前面板。

面板进入由 GSAP 完成透明度过渡（240ms，power3.out）；当前没有离场滑动或持续浮动动画。窄屏工具缩小内边距，保留文字与图标，不改成仅图标导航。

### Hotspots and Stage States

舞台热点由部件端点、细引线（0.85px）与中文名称组成，标签沿用辅助字级（12px），最小高度（32px），局部圆角（3px）。标签使用当前舞台底色与主字色，引线使用舞台辅助字色；悬停增加下划线，选中增加字重与下划线并加深引线，键盘焦点保留明确描边。点击名称继续聚焦原部件，选中名称也可在细节列表及描述中确认。

整机默认隐藏舞台标签；分层、平铺、拆解或持续开门按实际结构姿态自动渐显，合拢时淡出，瞬时打字动作不展开整组标签。未展开时，细节面板未选中部件可显示配置重点标记，选中后显示当前部件；展开时选中标签优先，并可与其余重点标签共存。舞台最多保留（12）个候选标签，标记密度不随全部部件数量增加。

标签跟随当前世界锚点投影，避开可见介绍、工具、输入提示与其它标签；紧凑锚点群还预留中心观察区域。可容纳的名称平滑移动；可能穿过标签或障碍的路径先短暂淡出，再重定位并渐显。越界、视锥外或放不下的名称被抑制，完整部件继续在细节列表中可选；移动端沿用同一规则。减弱动态直接到合法位置，淡出的标签立即退出指针与键盘交互。本次三件商品与最终截图证据见 [.ai/callout-design-documentation.md](.ai/callout-design-documentation.md)。

加载和失败覆盖层保留同一舞台空间。加载显示“正在准备商品”，真实首帧完成才开放操作。失败显示“暂时无法展示”，提供重新加载和打开目录；错误与等待分别使用 alert / status 语义，不以静态样例假装加载完成。

### Observation and Guide

命名视角及部件聚焦使用（650ms，power3.out），状态切换和结构动作使用（550ms，power3.out），瞬时按键动作使用单程（180ms，power1.inOut）并返回。导览由开始、上一步、下一步、完成及退出组成，步骤文字主动更新，不自动推进。

### 打字机结构与主动导览（2026-10-09）

结构面板以“合拢整机”“分层展开”“平铺部件”三个具名按钮表达观察结果，选中态沿用冷银蓝；访客不常驻百分比滑条。统一进度程序的三个目标为（0 / 0.6 / 1），配置全程（4秒），仍支持暂停、继续和“复原动作”。结构变化保留当前观察视角；“展开全景”“平铺俯视”另列为镜头按钮，镜头和结构不互相代替。

当前打字机的五步手动导览为整机、一次按键的连接、分层、平铺、返回整机；A 键带动按键、键杠杆与字杆，是参考结构的联动演绎。返回全景合拢结构并保留已选外观；正式展品身份不表示工厂 CAD 或维修拆解顺序。实现与本轮证据见 [.ai/typewriter-migration-validation.md](.ai/typewriter-migration-validation.md)。

**The 主动观察 Rule.** 默认静止呈现商品；拖动或缩放立即接手镜头并退出导览，关闭面板保留观察状态。

减弱动态时 GSAP 面板、镜头和状态切换直接到达目标态，瞬时动作不循环；全局 CSS 将动画与过渡缩至（0.01ms）。页面隐藏暂停场景和补间。详细生命周期与状态契约由 [.ai/architecture.md](.ai/architecture.md) 和 [.ai/workbench-contract.md](.ai/workbench-contract.md) 维护。

## Do's and Don'ts

### Do:

- **Do** 让模型保持主要观察面积，沿用单活动面板与共享工具。
- **Do** 使用已记录的深蓝灰层次、冷银选中态和独立键盘焦点。
- **Do** 按资产事实标注正式展品或流程样板，并为操作状态、错误与空结果提供文字。
- **Do** 让暖色舞台上的商品身份与底部提示保持深色可读文字，工具和面板沿用既有深色体系。
- **Do** 区分复位视角、返回全景和还原商品，保留各自范围说明。
- **Do** 用真实场景和实机截图验证当前实现，扩展正式模型时复用现有界面。

### Don't:

- **Don't** 把 legacy 的影片、固定导演流程或常驻完整控制台规则带入当前工作台。
- **Don't** 用图片、影片或装饰光效代替真实三维操作与样板身份。
- **Don't** 让左目录和右面板同时占据工作台，或让手机面板盖住模型。
- **Don't** 把样板配色、分层关系或静态截图写成真实商品、维修顺序、帧率或照片级画质结论。

## 2026-10-03：正式资产状态补充

以下为当时的阶段记录；“三件流程样板”与音箱默认状态属于历史，当前以 Overview 和打字机组件记录为准。

工作台布局与视觉体系保持。加载覆盖层显示真实阶段（读取商品、核对资源、读取模型纹理、准备模型、准备材质光照、即将进入）；不显示估算百分比。失败保留重新加载和目录入口。首帧之前禁用模型操作与热点。

目录封面字段存在时显示实际资源封面，4:3、object-fit cover；未提供时保留原文字行，不生成假图。商品标记按 displayStatus 区分“流程样板/正式展品”，当前三件仍为流程样板。v2 专属舞台可配置背景、地面、曝光与灯光，不增加自动演出。

### 2026-10-08 键盘观察与兼容回退

展示区为可聚焦group，Tab进入后显示方向键、+/−、Home和Tab操作说明，并在舞台内侧显示2px焦点边框。方向键只改变相机，退出导览但不重置部件或配色；原生面板按键不被截获。说明在桌面右上，移动端移至工具条上方；未聚焦时视觉隐藏，保留可访问说明。

不支持WebGL2或渲染器启动失败时改为可滚动图文区，保留产品名、说明、真实样板封面和部件内容。使用36px/27px标题、15px产品说明/部件名称、14px解释正文；15px为本次明确增加的阅读字号。没有三维工具或伪首帧状态。无封面与接口错误分别处理，仍可打开目录；桌面与390/320截图和真实浏览器检查通过。

三件样板封面为960×720的纯Three.js场景截图，不包含DOM工具与热点，按实际API引用展示。来源/摘要见public/covers/workbench/manifest.json。当前为流程样板，不能作为正式GLB画质证据。

### 2026-10-08 可逆结构进度

此处百分比滑条与 2 秒行程记录对应原有轨道样板；当前打字机使用上文的具名结构按钮与独立镜头，不套用这段面板表达。

视觉体系和单面板布局保持。结构与动作面板新增具名原生range、0.0—100.0%输出及两列按钮，步长0.1%；输出使用tabular-nums，范围控件沿用冷银蓝accent-color与键盘焦点。滑条高度42px，按钮42px，间隔8px；进度组以22px上内边距和单条边线分隔，不添加嵌套卡片。状态说明为12px，明确显示播放中/初始状态/已停留。

进度动作全程2秒、线性补间，部分行程按剩余距离计算；这替代音箱分层和双门原先的离散550ms动作。旋钮、打字机联动、汽车分离及相机时长保持。手动拖动/缩放/视角/选择部件暂停进度，关闭面板不重置，继续必须主动触发。减弱动态自动操作直接定位，原生滑条仍工作。动作复原只复原该动作，统一还原商品入口继续显示恢复范围。
