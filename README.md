# Trees X

实时打字机暗色试用：[深灰绿摄影棚](http://127.0.0.1:5181/?product=typewriter-study&renderPipeline=realtime) ／ [原亮色对照](http://127.0.0.1:5181/?product=typewriter-study&renderPipeline=realtime&studioMood=light)。使用支持 WebGPU 的桌面浏览器；不支持时明确回退 WebGL。曝光、HDR、软箱和商品材质保持，实际效果由本人比较，见 [试用记录](.ai/typewriter-dark-studio-validation.md)。

最新节点（2026-10-15）：继续推进打字机 WebGPU，已核验的 **v2 材质／WindGear 铭牌默认接入显式实时入口**。本批为原八个反射滤波 tap 增加像素 IGN 与成功完整帧 golden-angle 旋转，保持采样数量、半径、Physical 参数、唯一 renderer 和时钟；失败或取消不推进 phase。check、生产构建与 API 启动、真实 WebGPU 两核六取景、v2 交互／生命周期及管理取景检查通过；整体画质由用户本人肉眼判断，实际呈现预算与 P95 仍待验证。

- [WebGPU 实时入口](http://127.0.0.1:5181/?product=typewriter-study&renderPipeline=realtime)：默认 v2 材质与旋转核。
- [旧材质对照](http://127.0.0.1:5181/?product=typewriter-study&renderPipeline=realtime&typewriterAsset=v1)：保留原 v1；与核开关可独立组合。
- [固定核对照](http://127.0.0.1:5181/?product=typewriter-study&renderPipeline=realtime&reflectionKernel=static)：同 v2 材质，仅恢复旧八 tap 固定方向。
- [原 WebGL](http://127.0.0.1:5181/?product=typewriter-study&renderPipeline=webgl)：普通首页保持原入口；显式 [v2 WebGL 候选](http://127.0.0.1:5181/?product=typewriter-study&typewriterAsset=v2) 仍可用。

用户授权每个工程成功节点及时接入可用版本，旧批次的画质未通过结论继续保留，但不再统一阻止下一项独立实现。钢琴／汽车、自定义后台资源、API 与数据库不变；DDGI／FidelityFX／BVH 尚未接入。旋转组织沿用 Three MIT 实现思路，不宣称原创算法。当前证据见 [WebGPU 接入记录](.ai/typewriter-webgpu-rollin-validation.md)，资源制作与上一节点检查见 [v2 记录](.ai/typewriter-v2-validation.md)。新 GLB／PNG 使用 Git LFS，下方拉取命令已覆盖；旧日期的测试数字仅属于原批次。

面向商品观察与理解的三维工作台，Vue/Three.js + Spring Boot/MySQL。当前正式目录为机械打字机、三角钢琴与精细 Reventón 汽车，三件均在同一真实 Three.js 工作台中运行。打字机保留首页；音箱退出正式计划，程序化样板和旧固定汽车流程保留作历史与测试资源。

新版范围和阶段见 [PRODUCT.md](PRODUCT.md)、[实施路线](.ai/implementation-roadmap.md)、[立项基线](.ai/restart-baseline.md)。阶段A/B/B2、D基础管理及D2常用配置表单/取景工具已验收。打字机本轮已迁入共同工作台，来源、资源、检查与边界见 [迁移验收](.ai/typewriter-migration-validation.md)。在线上传、发布快照、手势为可选扩展，暂不配置 CI。

新增B2可逆探索原型：音箱分层与汽车双门共用v3进度控制，支持播放、暂停、任意进度、反向和复原。验收与使用流程见 [.ai/progress-validation.md](.ai/progress-validation.md)。

## 启动

Node/npm 版本遵循 package.json。另需 Java 17 和 MySQL 8.0。

钢琴与精细汽车资源使用 Git LFS。若克隆时跳过下载，先拉取三件正式展品的运行文件；新的汽车工作台同样需要这批高质量资源。

```sh
git lfs install --local
git lfs pull --include="public/models/bundles/kimi-typewriter/**,public/models/bundles/kimi-piano/**,public/models/reventon/**" --exclude=""
```

1. `npm ci`
2. 复制 `server/.env.example` 为 `server/.env.local`，填写 Java 路径、MySQL 账号/密码。此文件已被 Git 忽略；环境变量优先。
3. 在两个终端分别启动：

```sh
npm run server:dev
npm run dev -- --strictPort
```

打开 [工作台](http://127.0.0.1:5181/)。后端默认 8089，前端 5181，通过 `/api` 同源代理访问。Java 启动脚本优先使用 TREES_JAVA_HOME，再检查当前用户 `.jdks/ms-17.0.18`，不改变系统默认 Java。数据库为独立 `trees_x`，首次通过 Flyway 建表与插入三件样板；重启不会覆盖已有记录。数据库账号需拥有该独立库建库/迁移权限。

本地端口可分别用 TREES_PORT 和 Vite 参数调整；若后端端口变动，同步调整 vite.config.ts 的代理。完整配置/API 说明见 [server/README.md](server/README.md)。

全新数据库首次仍是不可变历史样板种子。先在 PowerShell 清除应用开关，再一次性预校验三件资源：

```powershell
Remove-Item Env:TREES_APPLY -ErrorAction SilentlyContinue
node scripts/apply-typewriter.mjs
node scripts/apply-piano.mjs
node scripts/apply-reventon.mjs
```

确认预校验通过、要安装当前资产后，在同一终端显式应用，并确保结束时清除开关：

```powershell
try {
  $env:TREES_APPLY = '1'
  node scripts/apply-typewriter.mjs
  if ($LASTEXITCODE -ne 0) { throw '打字机安装失败' }
  node scripts/apply-piano.mjs
  if ($LASTEXITCODE -ne 0) { throw '钢琴安装失败' }
  node scripts/apply-reventon.mjs
  if ($LASTEXITCODE -ne 0) { throw '汽车安装失败' }
} finally {
  Remove-Item Env:TREES_APPLY -ErrorAction SilentlyContinue
}
```

打字机安装通过现有管理员 API 保存配置、下架音箱，并将修改前配置备份到忽略目录 artifacts/typewriter-migration/backups，不清库、不改旧迁移。当前本机已经安装，正常启动不用重复执行。资源包已在 public/models/bundles/kimi-typewriter/v1，不需要重导出或 Blender。

钢琴安装创建或复用“乐器”分类，将钢琴排在打字机后，保存已有配置备份，保持打字机内容和首页。当前本机已安装，正常启动不重复执行；源码备份位于 `artifacts/kimi-imports/piano-cfx/`，运行资源在 `public/models/bundles/kimi-piano/v1/`。详见 [钢琴迁移验收](.ai/piano-migration-validation.md)。

汽车安装使用已有管理员 API 更新当前工作台配置，不是新增数据库种子或清库。当前本机三件均已安装，正常启动无需重新应用。单独安装某件时也要在预校验前、应用结束后清除 `TREES_APPLY`；PowerShell 环境变量会持续存在，不能把再次执行脚本当作自动恢复为只读校验。

## 本机生产演示

统一环境检查、准备、启动、停止及数据库备份恢复见 [.ai/demo-operations.md](.ai/demo-operations.md)。五分钟核心演示和本人走查清单见 [.ai/demo-walkthrough.md](.ai/demo-walkthrough.md)。首次依赖和 LFS 准备需要网络；已准备的生产运行使用本地文件与本机 API。

## 当前工作台

管理入口：[内容管理](http://127.0.0.1:5181/admin)。默认演示账号为 `admin`，密码为 `123456`。可在已忽略的 `server/.env.local` 中用 `TREES_ADMIN_USERNAME`、`TREES_ADMIN_PASSWORD` 覆盖默认值。管理员表为空时初始化，正常重启保留已有账号；修改初始化配置不会自动覆盖数据库账号。访客无需登录。

管理流程：常用配置表单编辑 → 预览当前输入 → 可选取景回填 → 手动保存 → 前台重载查看。基本信息、热点、外观、镜头、动作与导览用表单维护；模型/材质/轨道/舞台保留完整高级JSON，编辑后先点“应用到表单”。未应用JSON或无效字段阻止保存/预览。新建先选择已有商品作为配置起点，默认下架；引用条目与必需默认项受删除保护。

预览复用工作台宿主，退出立即卸载；普通列表不创建Canvas。左键旋转、滚轮缩放，只有管理预览可右键平移。选择默认/已有预设并点“使用此取景并返回”，只改本地镜头；默认回填同时更新全景复位，不改缩放范围、配色或动作，也不自动保存。修改上架商品在访客重新加载后生效，没有独立发布快照。并发冲突与会话失效保留输入，失效通知卸载预览。完整说明见 [管理操作手册](.ai/admin-operations.md)与 [D2验收记录](.ai/admin-usability-validation.md)。本阶段不含可视化节点选取、运动轨道编辑器或在线上传。

- 首页为打字机；目录支持名称搜索、分类过滤；`?product=typewriter-study`、`?product=piano-cfx`、`?product=reventon` 深链接及返回/前进均可用。音箱的普通入口按下架规则返回明确错误，历史模型可用 legacy 入口访问。
- 左键拖动、滚轮缩放、命名视角、相机复位；目录左开、操作右开，同时只显示一个面板。关闭面板保留观察状态。
- Tab聚焦商品展示区后：方向键旋转、+/−缩放、Home复位视角；面板输入与原生工具按键不会误动镜头。键盘和鼠标观察都立即退出导览。
- 无WebGL2或渲染器启动失败时不创建活动Canvas，保留真实API封面、说明和目录；接口失败仍明确重试，不提供假数据。样板封面由真实Three.js场景生成，来源与摘要见public/covers/workbench/。
- 音箱：已下架，原模型、配置和测试留存，不继续正式制作。
- 打字机：试色、键盘/字杆/滚筒热点、按键联动和机构分层。
- 钢琴：两种展示配色、八段结构流程、823 单元检索与聚焦、暂停/继续/反向/复原、独立章节取景和九步主动导览。原网页没有音频播放，不提供真实钢琴弹奏或声学模拟。
- 汽车：试色、车身/车门/座舱热点、开门和部件分离。
- 打字机五步导览主动开始；可自由旋转、试色、搜索/点击 572 部件、击发 A 键以及分层/平铺/暂停/复原。结构由连续进度驱动，访客使用具名按钮，无常驻百分比条。相机复位只影响镜头；还原商品恢复默认配色、动作、结构和镜头。
- 单 TresCanvas/renderer 切换；加载/服务失败明确重试；迟到响应隔离；WebGL 上下文恢复。
- 商品和展示配置来自真实 Spring Boot 4.1.1 + JPA + Flyway + MySQL；无运行时静态假数据回退，无匿名写端点。

当前目录仅包含正式打字机、正式钢琴与精细汽车，旧样板不混入目录。打字机与钢琴为参考轮廓及资料重建的结构演绎，不表示工厂 CAD、真实性能或维修顺序。钢琴由真实 Three.js GLB、几何、PBR 材质及形变动画执行，不嵌入原页面或使用影片。首屏不自动演出；汽车资源仅在选择汽车后加载，手势与旧后处理不进入当前工作台。

## 打字机画质与独立比较

默认工作台继续采用增强 WebGL2：标准 PBR 微表面、摄影棚 PMREM、柔化平面反射及姿态接触阴影。打字机另有[混合管线验收入口](http://127.0.0.1:5181/?product=typewriter-study&renderPipeline=hybrid)：操作时真实 WebGPU 光栅，静止后路径追踪与完整 OIDN 降噪；主动继续精修展示 1024 样本累积原图。五取景、续算、输入接管、资源稳定及设备恢复工程检查通过，待本人验收。钢琴／汽车新管线另行规划，未补齐源资产缺失 UV。启动方法沿用 `npm run demo:start`，检查顺序见 [打字机验收清单](.ai/typewriter-hybrid-handoff.md)，证据见 [混合管线验收](.ai/hybrid-pipeline-validation.md)、[之前的材质精修](.ai/typewriter-quality-validation.md)。

[渲染实验页](http://127.0.0.1:5181/renderlab.html?mode=webgl&view=whole) 独立于生产工作台，需先启动本机前后端。`mode` 可为 `webgl`、`webgpu`、`pathtrace`，`view` 可为 `whole`、`paint`、`metal`、`layers`、`flat`。每页只有一个 renderer；光栅可观察，路径模式为固定取景累计样本，达到目标后停止。真实 WebGPU 不可用时明确报错，不标注 WebGL fallback 为 WebGPU。

混合接入前的独立比较完成五取景共 15 图及整机/金属 1024 样本补测。路径参考的互反射、暗部遮挡和软影有改善；当时尚未接入连续交互，随后打字机工作台已完成上方混合入口。该历史比较的两次高样本记录约 129.90/198.13 秒，包含设置、编译和累计，不是帧耗时。基础 WebGPU 光栅没有独立画质跃升，未测试 SSGI/SSR；共同实验统一移除生产专属特效，不能把实验光栅画面当作增强生产管线。历史输入、原图与结论见 [比较记录](.ai/render-pipeline-comparison.md)。

复现比较需本机 Edge；顺序运行，避免与其他 GPU 浏览器测试并行。示例输出保存在忽略目录，不覆盖 B0：

```powershell
$env:CHECK_URL = 'http://127.0.0.1:5181'
$env:RENDERLAB_OUTPUT = 'artifacts/renderlab/local-128'
$env:RENDERLAB_SAMPLES = '128'
$env:RENDERLAB_VIEWS = 'whole,paint,metal,layers,flat'
$env:RENDERLAB_MODES = 'webgl,webgpu,pathtrace'
npm run test:renderlab
node scripts/renderlab-report.mjs artifacts/renderlab/local-128
```

`renderlab-report.mjs` 仅接受已通过的完整 15 图报告，生成同目录 `comparison.html`，使用原图、不再运行 renderer。可传第二个已通过的同输入高样本目录，替换对应路径图并保留 128 样本原图链接；本机本轮用法为 `node scripts/renderlab-report.mjs artifacts/renderlab/production-final artifacts/renderlab/convergence`。报告、截图和 B0 冻结文件均为本地验收材料，克隆仓库后需重新采集。

## 保留旧版

旧版入口：`?legacy=1&product=form-01`、`?legacy=1&product=typewriter-study`、`?legacy=1&product=reventon`。六件非样板旧 ID（如 `?product=potted-plant`）仍自动打开旧体验。

旧汽车入口保留 Three.js + Blender 烘焙 PBR/AO 的固定导演流程与章节定位。当前汽车工作台复用同一高质量资产，提供自由观察、双门开合、七组分离与主动导览；两种入口操作模式分开。其他旧展品、手势、后处理和资源许可记录保留。

汽车 LFS 运行资源约 1.75 GB，当前正式汽车和旧 Demo 都需要：

```sh
git lfs install --local
git lfs pull
```

未拉取汽车文件时，打字机和钢琴仍可单独使用，但不能宣称三件完整演示可用。构建保留 public 运行资源及历史入口；不要把按需加载等同于发布目录很小。

## 验证

```sh
npm run check
npm run build
npm run server:test
npm run server:build
npm run test:workbench
npm run test:workbench-accessibility
npm run test:workbench-progress
npm run test:admin
npm run test:piano
npm run test:piano-lifecycle
npm run test:piano-visual
```

`npm run test:piano-source` 对照备份源模型与实际运行 GLB，需先启动 `npm run source:kimi`（仅本机 5183，已有该端口服务时不要重复启动）。该项需要本机保存的原网页源文件，不依赖线上 Kimi；正常展示及其他钢琴测试不需要源码备份服务。原文件丢失的恢复范围、采样精度与缺口见钢琴验收记录。

`server:test` 使用本机独立 `trees_x_test`，执行真实 API、迁移、数据库修改和 Spring 重启持久化验证，结束恢复测试记录。原生 Maven 未设 TREES_MYSQL_TEST=true 时只运行纯契约测试，不能替代实际 MySQL 验收。

浏览器测试需先启动前后端；使用本机 Edge。默认 5181，可用 CHECK_URL 覆盖。工作台测试核对真实场景节点、动作姿态、同一 renderer、错误重试、桌面三个尺寸及移动基础操作。截图与报告位于 `.impeccable/review/workbench/`。

已安装打字机时，test:workbench / test:workbench-progress 自动检查当前真实打字机及汽车切换；test:workbench-accessibility 检查当前目录、移动操作及图文回退。原三件样板的历史分支保留，需要未安装新资产的测试库。专用命令为 `npm run test:typewriter`、`npm run test:typewriter-lifecycle`、`npm run test:typewriter-visual`；新证据在 artifacts/typewriter-migration，不将旧样板截图作为新模型验收。

管理浏览器测试还需在第三个PowerShell终端启动隔离后端（不编辑正式库）：`$env:TREES_PORT='8090'; $env:TREES_DB_URL='jdbc:mysql://127.0.0.1:3306/trees_x_test?createDatabaseIfNotExist=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai'; npm run server:dev`。脚本将浏览器同源API代理至8090，操作结束恢复自己的测试改动；用 `CHECK_URL=http://127.0.0.1:5182` 可检查生产构建。可用ADMIN_CHECK_OUTPUT指定证据目录；ADMIN_SKIP_CAPTURES=1只跑功能回归，避免重复截图。证据与边界见 [.ai/admin-usability-validation.md](.ai/admin-usability-validation.md)。

另启动 `npm run preview -- --port 5182` 后，可运行 `npm run test:workbench-production` 核对生产构建的真实像素、操作与错误恢复。

`npm run test:workbench-progress-production` 使用5182生产包验证双案例进度、暂停、像素一致性和真实上下文恢复，不依赖Vue开发调试对象。进度报告/截图保存在artifacts/progress；101点/50轮确定性和反馈节流由单元测试核验。页面隐藏测试使用可见性事件注入，不冒充真人测试。

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

当前执行顺序以实施路线为准：共同流程 → 可逆探索 → 基础管理与表单/取景工具 → 打字机 → 钢琴 → 汽车 → 联合验收。音箱不再排期，手表只是候选。手势、在线上传与高级版本管理为可选扩展。

v3配置见server/src/main/resources/samples/progress-products.json；motionPose/motionPlayback是统一确定性与播放核心，原products.json作为不可变初始种子保留。V5仅升级未定制的默认音箱和汽车，不覆盖封面和基础信息。

开发前阅读 [.ai/project.md](.ai/project.md)、[.ai/architecture.md](.ai/architecture.md)；产品事实见 [PRODUCT.md](PRODUCT.md)，视觉规范见 [DESIGN.md](DESIGN.md)，证据见 [工作台验收](.ai/workbench-validation.md)。

每个功能节点验收后提交并同步到 [WindGears/Trees-X](https://github.com/WindGears/Trees-X)，规则见 [AGENTS.md](AGENTS.md)。本地凭据、运行日志、数据库备份和临时验收目录不纳入 Git；数据库内容仍按初始化及管理流程维护。

## 正式资产通道（2026-10-03 历史验收）

阶段 1 曾增加 v2 配置与 GLB 异步接入，兼容 v1 样板。当时目录保留三件流程样板；工程夹具不会替代画质验收。后端 Flyway V3 只追加封面/展示状态字段，已有配置不被覆盖。以下命令保留作工程通道回归；当前三件正式 GLB 目录以本文前述状态及各商品迁移验收为准。

- `npm run asset:fixture`：生成旧音箱 GLB 工程夹具和测试配置。
- `npm run asset:check -- public/models/bundles/speaker-engineering/v1/manifest.json`：资源完整性及 glTF 规范校验。
- `npm run test:asset-ingestion`：真实 GLB/相机/动作/释放/错误恢复测试，使用受控 v2 API 响应，不改写正式库。
- `npm run test:asset-production`：先构建并在 5182 启动 preview，核对 GLB 的生产操作与实际像素。
- `npm run test:asset-performance`：1440×1000 下记录工程音箱连续 10 秒鼠标拖动的渲染完成间隔与资源数量，不外推整车成绩。
- `npm run test:asset-textures`：ORM 逐像素检查及汽车局部 KTX2 实机对照；对照准备步骤见制作说明。
- Blender 导出、资源打包、ORM 和 KTX2 说明见 [.ai/asset-production.md](.ai/asset-production.md)。

阶段 1 结论、截图与明确未完成项见 [.ai/stage-1-acceptance.md](.ai/stage-1-acceptance.md)。

新版后续阶段与边界见 [.ai/implementation-roadmap.md](.ai/implementation-roadmap.md)，本次立项基线见 [.ai/restart-baseline.md](.ai/restart-baseline.md)。旧阶段记录只作为历史验收；旧恢复基线见 [.ai/stage-0-baseline.md](.ai/stage-0-baseline.md)。
