# Trees X

面向商品观察与理解的三维工作台。当前先统一商品流程与前后端框架，使用真实 Three.js 程序化音箱、打字机和汽车验证操作，再逐件替换正式模型。

## 启动

Node/npm 版本遵循 package.json。另需 Java 17 和 MySQL 8.0。

1. `npm ci`
2. 复制 `server/.env.example` 为 `server/.env.local`，填写 Java 路径、MySQL 账号/密码。此文件已被 Git 忽略；环境变量优先。
3. 在两个终端分别启动：

```sh
npm run server:dev
npm run dev -- --strictPort
```

打开 [工作台](http://127.0.0.1:5181/)。后端默认 8089，前端 5181，通过 `/api` 同源代理访问。Java 启动脚本优先使用 TREES_JAVA_HOME，再检查当前用户 `.jdks/ms-17.0.18`，不改变系统默认 Java。数据库为独立 `trees_x`，首次通过 Flyway 建表与插入三件样板；重启不会覆盖已有记录。数据库账号需拥有该独立库建库/迁移权限。

本地端口可分别用 TREES_PORT 和 Vite 参数调整；若后端端口变动，同步调整 vite.config.ts 的代理。完整配置/API 说明见 [server/README.md](server/README.md)。

## 当前工作台

- 首页为音箱；目录支持名称搜索、分类过滤；`?product=form-01`、`?product=typewriter-study`、`?product=reventon` 深链接及返回/前进均可用。
- 左键拖动、滚轮缩放、命名视角、相机复位；目录左开、操作右开，同时只显示一个面板。关闭面板保留观察状态。
- 音箱：试色、单元/旋钮/外壳热点、旋钮转动和外观分层。
- 打字机：试色、键盘/字杆/滚筒热点、按键联动和机构分层。
- 汽车：试色、车身/车门/座舱热点、开门和部件分离。
- 四步导览主动开始，允许随时自由观察。相机复位只影响镜头；还原商品恢复默认配色、动作、结构和镜头。
- 单 TresCanvas/renderer 切换；加载/服务失败明确重试；迟到响应隔离；WebGL 上下文恢复。
- 商品和展示配置来自真实 Spring Boot 4.1.1 + JPA + Flyway + MySQL；无运行时静态假数据回退，无匿名写端点。

所有新模型都标明“流程样板”，不表示真实商品品牌、内部构造、性能或维修顺序。新工作台首屏不自动演出，不加载旧高精汽车、手势或后处理资源。

## 保留旧版

旧版入口：`?legacy=1&product=form-01`、`?legacy=1&product=typewriter-study`、`?legacy=1&product=reventon`。六件非样板旧 ID（如 `?product=potted-plant`）仍自动打开旧体验。

旧精细汽车是 Three.js + Blender 烘焙 PBR/AO 的固定实机流程，仍有播放、暂停、章节定位；现在与新汽车样板分开。其他旧展品、手势、后处理和资源许可记录保留。

旧汽车 LFS 运行资源约 1.75 GB，仅使用旧高精 Demo 时需要拉取：

```sh
git lfs install --local
git lfs pull
```

新工作台无需这批模型即可验证完整流程。构建仍保留 public 中的旧资源，以便旧入口继续可用；不要把新工作台零高精模型请求等同于整个发布目录很小。

## 验证

```sh
npm run check
npm run build
npm run server:test
npm run server:build
npm run test:workbench
```

`server:test` 使用本机独立 `trees_x_test`，执行真实 API、迁移、数据库修改和 Spring 重启持久化验证，结束恢复测试记录。原生 Maven 未设 TREES_MYSQL_TEST=true 时只运行纯契约测试，不能替代实际 MySQL 验收。

浏览器测试需先启动前后端；使用本机 Edge。默认 5181，可用 CHECK_URL 覆盖。工作台测试核对真实场景节点、动作姿态、同一 renderer、错误重试、桌面三个尺寸及移动基础操作。截图与报告位于 `.impeccable/review/workbench/`。

另启动 `npm run preview -- --port 5182` 后，可运行 `npm run test:workbench-production` 核对生产构建的真实像素、操作与错误恢复。

保留的旧版回归脚本均使用 `legacy=1`：

```sh
npm run test:render-handoff
npm run test:collection
npm run test:experience
npm run test:browser
npm run test:gesture
npm run test:gesture-interaction
npm run test:gesture-motion
npm run test:gesture-dwell
npm run test:visual
npm run test:reventon
npm run test:reventon-lifecycle
npm run test:reventon-playback
```

手势测试使用合成输入，不能替代真人识别率验收。生产构建可用 `npm run preview -- --port 5182` 预览，后端保持 8089；实际部署须为 `/api` 配置同源反向代理。

## 扩展入口

- `server/src/main/resources/samples/products.json`：初始三件脚本；只由 Flyway 首次导入，不是前端备用数据。
- `src/lib/workbench/types.ts` / `api.ts`：配置契约与响应校验。
- `src/stores/workbench.ts`：可序列化状态与意图。
- `src/lib/workbench/adapter.ts` / `samples.ts` / `controller.ts`：模型构建、局部资源、统一相机/动作操作。
- `src/components/workbench`：统一界面与唯一 Canvas。
- `public/models/collection/manifest.json` / `public/models/reventon/provenance.json`：原资产事实与许可。

后续按音箱 → 打字机 → 汽车接入正式模型，保持布局、接口和基本操作不变。手势适配、管理后台、鉴权与上传另设阶段。本轮不扩展这些内容。

开发前阅读 [.ai/project.md](.ai/project.md)、[.ai/architecture.md](.ai/architecture.md)；产品事实见 [PRODUCT.md](PRODUCT.md)，视觉规范见 [DESIGN.md](DESIGN.md)，证据见 [工作台验收](.ai/workbench-validation.md)。

## 正式资产通道（2026-10-03）

阶段 1 增加 v2 配置与 GLB 异步接入，兼容 v1 样板。正式目录仍保留三件流程样板；工程夹具不会替代画质验收。后端 V3 只追加封面/展示状态字段，已有配置不被覆盖。

- `npm run asset:fixture`：生成旧音箱 GLB 工程夹具和测试配置。
- `npm run asset:check -- public/models/bundles/speaker-engineering/v1/manifest.json`：资源完整性及 glTF 规范校验。
- `npm run test:asset-ingestion`：真实 GLB/相机/动作/释放/错误恢复测试，使用受控 v2 API 响应，不改写正式库。
- `npm run test:asset-production`：先构建并在 5182 启动 preview，核对 GLB 的生产操作与实际像素。
- `npm run test:asset-performance`：1440×1000 下记录工程音箱连续 10 秒鼠标拖动的渲染完成间隔与资源数量，不外推整车成绩。
- `npm run test:asset-textures`：ORM 逐像素检查及汽车局部 KTX2 实机对照；对照准备步骤见制作说明。
- Blender 导出、资源打包、ORM 和 KTX2 说明见 [.ai/asset-production.md](.ai/asset-production.md)。

阶段 1 结论、截图与明确未完成项见 [.ai/stage-1-acceptance.md](.ai/stage-1-acceptance.md)。

完整后续阶段与边界见 [.ai/implementation-roadmap.md](.ai/implementation-roadmap.md)。当前恢复基线见 [.ai/stage-0-baseline.md](.ai/stage-0-baseline.md)。
