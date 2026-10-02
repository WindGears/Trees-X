---
name: Trees X 三维商品工作台
description: 以模型为主、工具按需出现的深蓝灰商品观察界面。
colors:
  wb-accent: '#bed4ef'
  wb-accent-hover: '#d1e2f5'
  wb-accent-ink: '#101923'
  wb-focus: '#d1e5ff'
  wb-bg: '#101720'
  wb-stage: '#151c25'
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
typography:
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

Trees X 延续深色、中文身份、银灰模型与冷色重点。深蓝灰界面安静地承托三维对象，信息用清楚的字号、间距与细线组织；工具的亮色状态帮助访客确认自己正在观察和操作什么。

当前系统以一致的操作和可读性服务商品观察。模型通过真实 Three 场景呈现，当前的简化几何明确标为“流程样板”。界面不借助摄影封面、装饰光效或自动演出来掩盖样板范围；颜色、标题和控件不作真实商品规格或可购款式承诺。

**Key Characteristics:**

- 模型主导，工具按需出现。
- 深蓝灰层次、冷银选中态与清晰焦点。
- 中文信息优先，图标始终服务操作。
- 三件流程样板共享组件与状态语言。

本文件记录 2026-10-02 核对的已实现系统，视觉真值为 src/assets/styles/workbench.css、src/components/workbench/ 与现有实机截图。布局策略、模式和验收范围见 [workbench surface](.impeccable/surfaces/src-components-workbench-workbenchroot-vue.md)。旧 Reventón 摄影棚与固定导演流程、音箱影片、各商品独立舞台和旧完整控制台全部属于 **legacy-only**，已连同原侧车保存到 [2026-09 设计历史](.ai/history/2026-09-design.md)。旧汽车入口为 ?legacy=1&product=reventon；历史中的旧默认路由不再代表当前首页。

## Colors

以带蓝倾向的石板灰建立背景、工具和正文之间的层次。规范值以 frontmatter 为准；wb-* 是当前工作台命名空间，商品配色由展示配置提供，不扩充为界面主题色。

### Primary

- **冷银蓝**（wb-accent / wb-accent-hover）：表示已选配色、部件、动作或当前工具；配合深墨选中文字。文本选区和输入光标延续同一重点色。
- **冰蓝焦点**（wb-focus）：可聚焦控件采用实线焦点环，宽度（2px）、外偏移（4px），不只以背景色变化传达键盘位置。

### Neutral

- **深海底色与石板舞台**（wb-bg / wb-stage）：分别承托框架与三维视野。舞台明暗来自场景、地面与照明，不把 CSS 色值当作整张实机图的像素目标。
- **蓝灰面板与工具表面**（wb-panel / wb-toolbar）：面板为实底，覆盖舞台的工具条保留轻微透明度；两者以细边线分界。
- **霜白正文与灰蓝辅助字**（wb-foreground / wb-muted）：主操作与商品名清楚，说明、分类与提示退后一级。样板标记与搜索占位字分别使用 wb-label 和 wb-placeholder。
- **控制与边界**（wb-button / wb-button-hover / wb-field / wb-line）：按钮、悬停、输入与分隔线各有固定层次。工具边线、搜索下划线、滚动条及色样边线使用各自已记录的细部色。
- **状态覆盖与部件标签**（wb-status / wb-hotspot / wb-hotspot-line）：状态覆盖层保护错误说明的可读性；热点深色底与细描边使名称在模型上可辨。

**The 重点即状态 Rule.** 冷银蓝服务选中状态，焦点另有清晰描边；动作开关同时显示文字状态，配色选中同时显示勾选。

## Typography

**Display Font:** Manrope，中文回落到现有 Noto Sans SC Display，随后为 sans-serif。
**Body Font:** 同一字体栈；不为工具引入另一套工程等宽字体。现有中文字体由本地文件加载。

商品标题、面板标题、正文和辅助信息分别使用 frontmatter 的 wb-display、wb-panel-heading、wb-body 与 wb-label。中文名称是主标题；品牌稍紧的字距、面板标题和目录名的中等字重区分层级。桌面与移动的标题、品牌及面板标题均有独立 token。

介绍行高为（1.8），面板正文沿用正文 token，状态说明最大宽度为（38ch）。目录说明使用紧凑正文层级，样板标记、输入提示与动作状态使用辅助字级。导览步数使用等宽数字与字距（0.08em），仍属普通界面文字。

**The 中文身份 Rule.** 商品名称和功能名称直接说明内容；英文品牌不替代中文身份，流程样板标记是事实说明。

## Layout

工作台占据（100svh），最小高度（640px）。桌面顶栏高（76px），两侧内边距来自 wb-header-edge；下方为剩余高度的网格。无面板时场景使用整行；目录打开时左栏宽（310px），工具面板打开时右栏宽（340px）。宽度不超过（1100px）时分别收至（280px）和（300px）。面板独立纵向滚动，保持场景可观察。

商品身份位于场景左上，桌面偏移为上（32px）、左（38px），介绍宽度最多（330px）；较窄桌面的左偏移为（26px）。底部工具分两行、水平居中，上行为视角与缩放，下行为探索入口；整体距场景底部（66px）。独立输入提示距左（38px）、距底（28px）。

不超过（760px）时顶栏改为（66px），品牌副说明与当前商品缩略名隐藏。场景在上，已打开的目录或面板在下；网格行分别为 minmax(310px, 1fr) 与 minmax(220px, 38%)。下面板内边距（16px 20px），场景保留商品名与两行工具；介绍和样板标记在面板打开时隐藏，完整样板身份仍可从目录获取。工具距底（37px），输入提示距底（13px）。DOM 热点在该断点隐藏，部件仍可由“细节”列表选择。

**The 单活动面板 Rule.** 目录与工具面板同一时间只出现一个；桌面通过网格分配空间，移动端移到场景下方。

## Elevation & Depth

当前工作台控件与面板不使用盒阴影或背景模糊。深度依靠轻微透明的工具底、实色面板、细分隔线与三维对象自身的照明建立，不把每组内容再包成卡片。

舞台使用 RoomEnvironment 反射、主光与轮廓光、雾和接收阴影的地面，形成简洁摄影棚空间；模型仍是程序化流程样板。单个 TresCanvas 使用按需渲染，当前 DPR 上限为（2），不能由此推断帧率或照片级画质。

**The 模型承载深度 Rule.** 界面保持平实，空间层次交给真实三维几何、光照与阴影；当前样板不追加装饰性光效。

## Shapes

形状以紧凑、轻微圆角的矩形控件为主。按钮、字段、工具条、热点与样板标签分别采用 frontmatter 的独立圆角角色；目录条目和面板保持平直。分组主要靠空白和（1px）细线。圆形只用于配色色样和热点中的小圆点，不作额外的舞台装饰。

## Components

### Buttons

普通按钮是深蓝灰实底、细描边与霜白文字，最小高度（42px），图标间距采用 wb-icon-gap。悬停加亮，背景与文字过渡为（150ms）；禁用透明度（0.4），不可操作。选中采用冷银蓝底和深墨文字，aria-pressed 与可见状态保持一致。配色和动作列表行的最小高度为（50px）。

工具条内部按钮使用透明底，选中后沿用同一高亮语言；关闭按钮为透明无边框图标控件。当前没有独立的按下位移或弹跳规则。

### Chips

“流程样板”为非交互事实标记，透明底、灰蓝字与细描边；桌面使用 frontmatter 对应内边距，手机收至（2px 6px）。它不是筛选按钮或装饰性的栏目标签。

### Cards / Containers

工作台没有独立商品卡片网格。目录采用纵向文本条目，商品名、描述、分类和样板身份形成一行组，以底边线分隔；当前商品沿用选中底色。其余分组由间距和线条组织。

面板标题与关闭按钮并排，正文和操作列表向下排列；统一“还原商品”区域通过上边线与更大间隔分开。它附有恢复范围说明，不与“复位视角”混称。

### Inputs / Fields

原生下拉框与输入框保持深色字段底、细描边与明确焦点。目录搜索使用透明输入和底部细线，保留可访问名称及搜索图标；分类为带文字标签的原生下拉框。目录有读取中、错误重试、空搜索结果三个文字状态。

### Navigation

顶栏保留品牌与“商品目录”，桌面右端显示当前商品名。底部相机工具包含命名视角、缩小、放大和“复位视角”；探索导航根据商品能力显示外观、细节、结构与动作、导览。经导航打开面板后关闭按钮获得焦点，关闭时恢复原入口焦点，Escape 可关闭当前面板。

面板进入由 GSAP 完成透明度过渡（240ms，power3.out）；当前没有离场滑动或持续浮动动画。窄屏工具缩小内边距，保留文字与图标，不改成仅图标导航。

### Hotspots and Stage States

热点由小圆点和部件名称组成，最小高度（32px），默认深色表面，选中沿用冷银蓝底和深墨文字；悬停使用通用按钮高亮，键盘焦点保留明确描边。选中的部件也可在细节列表及描述中确认。手机通过细节列表承担该入口。

加载和失败覆盖层保留同一舞台空间。加载显示“正在准备商品”，真实首帧完成才开放操作。失败显示“暂时无法展示”，提供重新加载和打开目录；错误与等待分别使用 alert / status 语义，不以静态样例假装加载完成。

### Observation and Guide

命名视角及部件聚焦使用（650ms，power3.out），状态切换和结构动作使用（550ms，power3.out），瞬时按键动作使用单程（180ms，power1.inOut）并返回。导览由开始、上一步、下一步、完成及退出组成，步骤文字主动更新，不自动推进。

**The 主动观察 Rule.** 默认静止呈现商品；拖动或缩放立即接手镜头并退出导览，关闭面板保留观察状态。

减弱动态时 GSAP 面板、镜头和状态切换直接到达目标态，瞬时动作不循环；全局 CSS 将动画与过渡缩至（0.01ms）。页面隐藏暂停场景和补间。详细生命周期与状态契约由 [.ai/architecture.md](.ai/architecture.md) 和 [.ai/workbench-contract.md](.ai/workbench-contract.md) 维护。

## Do's and Don'ts

### Do:

- **Do** 让模型保持主要观察面积，沿用单活动面板与共享工具。
- **Do** 使用已记录的深蓝灰层次、冷银选中态和独立键盘焦点。
- **Do** 清楚标注流程样板，并为操作状态、错误与空结果提供文字。
- **Do** 区分复位视角、返回全景和还原商品，保留各自范围说明。
- **Do** 用真实场景和实机截图验证当前实现，扩展正式模型时复用现有界面。

### Don't:

- **Don't** 把 legacy 的影片、固定导演流程或常驻完整控制台规则带入当前工作台。
- **Don't** 用图片、影片或装饰光效代替真实三维操作与样板身份。
- **Don't** 让左目录和右面板同时占据工作台，或让手机面板盖住模型。
- **Don't** 把样板配色、分层关系或静态截图写成真实商品、维修顺序、帧率或照片级画质结论。
