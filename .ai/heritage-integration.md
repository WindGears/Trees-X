# heritage-museum 商品版整合

日期：2026-09-19；渲染交接修复与最终验证更新于 2026-09-20。目标仓库：Trees X。来源：用户指定的 `I:/ssr/NIXUS/heritage-museum/`。

## 范围与依据

阅读来源 ProductHomeView、ProductsView、ProductDetailView、ProductCard、商品类型/目录 store、路由与资产清单；检查历史与较新截图、实际 GLB 头部节点/材质/扩展。来源文档的技术选型、原地迁移和“唯一规范”等语句视为参考背景，不覆盖用户当前要求或本项目 AGENTS 约束。

采用来源的多商品组织、分类搜索、模型封面与六个 CC0 资产，重写接入现有 Vue/TresJS 舞台。没有复制其第二套 renderer、Element Plus 前台、演示价格、购物车、后台账号或数据库。参考目录未修改。

用户现在可以从目录选择商品，进入相同的桌面电影舞台，继续使用鼠标/键盘/惯性手势、试色、聚焦、分层、导览与演出。原始材质是默认值；两个额外试色是局部颜色调制，不宣称为真实可购配色。

| 商品           | 主要接入能力                     | 模型边界                     |
| -------------- | -------------------------------- | ---------------------------- |
| FORM / 01 音箱 | 三配色、三部件、分层、三步导览   | 原创外观概念模型             |
| 游戏手柄       | 材质、手柄位置聚焦、两步导览     | 含线缆的单体网格，不标为无线 |
| 游戏主机       | 外壳试色、独立盖板、分层         | 仅外观节点，不含真实电路     |
| 边桌           | 保留木纹试色、整体观察           | 单体网格，不伪造桌腿拆解     |
| 陶盆绿植       | 盆体试色、叶片/石子聚焦、分层    | 四个源节点，配置三处观察点   |
| 家具套件       | 边桌局部试色、家具聚焦、空间分离 | 使用源五件家具关系           |
| 迷你赛车       | 车身试色、车轮聚焦、分层         | 实际为五个平级节点，1952 面  |

资产字节/面数/完整 SHA-256 已写入 `public/models/collection/manifest.json`，单元测试比对实际文件；模型与封面来源/作者/许可分别见其 README。Draco 来自已安装 Three 版本并自托管，附官方 Apache-2.0 文本。

## 验证证据

- `npm run check`：TypeScript、ESLint、Prettier、49 个 Vue 组件行数、原样品预算、61 项单元测试通过。新增测试核对六个实际 GLB 的校验值/节点/面数、跨商品状态重置、单体能力限制、世界坐标结构位移、材质原样恢复，以及 Composer 释放后的渲染交接与迟到卸载隔离。
- `npm run build`：生产构建通过。
- `test:collection`：六个导入 GLB 均实际解码渲染；试色与结构操作产生像素变化；聚焦、导览、搜索/分类/空状态、URL 刷新、后退、快速切换通过。DOM Canvas identity 在商品切换前后相同。捕获网络请求全部同源，页面错误为空。报告 `collection-results.json`。
- `test:collection` 电影画质分支：自动演出/重播/输入中止、打开目录释放 Composer、关闭目录恢复但不重播，通过。
- `test:render-handoff`：先在旧生产构建上复现失败，再在修复后的开发及生产预览通过。截图时隐藏 DOM 文案、热点、操作盘与状态层；验证 cinematic → eco 后镜头转动、切换真实 GLB、试色都改变画布像素，连续三次往返画质仍正常且只有一个 Canvas。报告 `render-handoff-results.json`。
- `test:browser`：1440/390/320px、真实模型、视角缩放、失败重试、上下文恢复、WebGL 降级、减弱动态、键盘入口通过。
- `test:experience`：原音箱配色、三部件聚焦、结构、导览、视角与复位回归通过。复位像素允许最多四个背景合成像素有一个通道级差异，同时保留实际镜头角度断言；不将容差结果称为逐字节完全一致。
- `test:gesture-interaction`：合成轨迹下捏合指尖移动、掌心取消、两步校准、骨架、移动宽度通过。
- `test:gesture-motion`：实际相机角度验证有限滑行、重新入镜不跳转、静止制动、Worker 沉默后停止、鼠标接管及减弱动态无惯性通过。
- `test:gesture-dwell`：真实相机/store/renderer、仅替换手势 Worker 关键点，验证分组/配色/部件悬停、漏检不确认、确认后不重复、镜头后恢复手势、鼠标优先。原生 Draco Worker 保持真实，赛车上部件聚焦与结构展开通过。
- `test:gesture`：真实自托管 MediaPipe Worker 在模拟摄像头空白帧上工作、会话启停与同源请求通过；不代表实体手部识别率。
- `test:visual`：修复后的生产预览验证 HDR、1600 粒子、一次自动演出、重播/输入中止、画面差异与兼容降级通过；本机帧时间记录见 `phase-4-visual-report.json`，不据此推断其他机器表现。

截图均在 `.impeccable/review/`，主要文件：`collection-desktop.png`、`collection-cinematic.png`、`collection-plant-cinematic.png`、`collection-390.png`、`collection-320.png`、`gesture-collection.png`。已检查桌面与窄屏目录，集中修正了封面叠加页面文字及窄屏标题挤压；不以截图代替功能测试。

## 未完成项

真实摄像头不同光照/背景下的选择成功率、误触率和疲劳度仍需用户实测。惯性改善缺帧反馈，不提高识别器本身的准确率。新资产热点使用配置的节点锚点与视锥/朝向可见性，不包含精确深度遮挡判定；操作盘为部件提供始终可用的选择入口。

参考项目后端的商品 API、发布校验、鉴权、上传/编辑器、浏览记录尚未迁入 Trees X；下一阶段需要独立适配服务层和模型元数据，不能直接接入原始 Pinia/renderer。多商品同时出现在同一三维空间、AI 讲解、速度光弧/边缘引导也未在本轮交付。

## Composer 渲染交接修复 · 2026-09-20

截图验收发现早期手势流程中标题已经切换为 RACE，画布仍停留在音箱。已安装的 @tresjs/post-processing 3.7.4 在 EffectComposerPmndrs setup 中 replaceRenderFunction，但 unmounted 只 dispose Composer，没有恢复普通渲染入口。仅检查 DOM 商品 ID、可用状态和含热点的截图不足以发现冻结。

Effects.vue 现在通过 renderHandoff.ts 在子 Composer 卸载后交回同一 Tres renderer，清空 render target、恢复 autoClear、使用当前 scene/camera 直接渲染并 invalidate。WeakMap 所有权令牌防止旧组件迟到卸载覆盖新 Composer。没有创建新 renderer 或保留后台 Composer。

修复前的生产构建在 test:render-handoff 的“eco must draw new camera pixels after Composer unmount”断言失败；同一脚本在修复后的开发/生产构建通过。后续每次调整 Effects 生命周期都必须跑该脚本，不能只看 data-composer-count。
