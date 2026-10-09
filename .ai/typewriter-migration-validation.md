# 打字机迁移验收

2026-10-09，阶段 C2。用户确认 Kimi 页面为本人创建，并要求优先迁移打字机、撤下音箱。本轮接入既有工作台，没有引入 iframe、独立 renderer 或影片播放，也没有启动汽车正式迁移。

## 已交付

- 首页默认 `typewriter-study`，公开目录为打字机和汽车流程样板。`form-01` 音箱已下架，历史配置、资源、工程夹具和 legacy 入口保留。
- 实际 GLB 包含 572 个稳定语义部件，可通过部件列表、分组、搜索或真实实例射线拾取选择；当前部件高亮、说明和世界坐标锚点随姿态更新。
- 整机、分层、平铺共用连续进度核心，支持暂停、继续、反向切换及动作复原。访客使用具名按钮，不常驻百分比滑块。视角独立，鼠标、滚轮、键盘、命名视角或部件聚焦暂停播放并保留状态。
- A 键、杠杆和字杆的击发联动，三种外壳配色，五步主动导览，以及真实模型封面。
- 原漆面颗粒、金属表面 shader 和摄影棚反射由注册代码适配到当前 Three.js。舞台使用暖白底，与原工作台导航和面板共存。
- 管理端可读取、编辑和预览这一配置，并从真实相机回填默认取景；预览和回填不写数据库，手动保存仍走现有接口。

这是自有程序化模型的机构演绎，不是厂方服务 CAD。说明只引用可观察部件，不能由本轮迁移推导真实机械尺寸、维修顺序或商品性能。

## 来源与不可变运行包

源页面：<https://k3-typewriter.ok.kimi.link/>。原页面、依赖和导出中间文件备份在被 Git 忽略的 `artifacts/kimi-imports/` 与 `artifacts/typewriter-migration/export-v1/`。运行包与来源记录位于 `public/models/bundles/kimi-typewriter/v1/`。

| 项目                   | 实测值           |
| ---------------------- | ---------------- |
| 语义部件 / 导出表面    | 572 / 2257       |
| 唯一 geometry / 材质   | 278 / 66         |
| 三角形                 | 1,257,132        |
| GLB                    | 25,983,744 bytes |
| 动作数据 rig.json      | 517,962 bytes    |
| 清单引用的运行文件合计 | 26,501,706 bytes |

- 源 HTML SHA-256：`c9c31847225005785c3384a1b002e9593dd9d06c545cc3657684fc4d6e38df5a`。
- GLB SHA-256：`b61293acf1eb49f2d7cbcba0ae59214346130b8df0c32685cf954502f37ff0f4`；导出源与运行入口相同。
- manifest.json SHA-256：`c216ad6101fabe469f7effa061a237fd3f1ad440550cafb10ff5c5f345a770bd`。2026-10-09 按用户的 GitHub 同步要求补记所有者授权，GLB 与动作文件未变；不因此推定第三方参考资料或后续使用者获得额外许可。
- 真实封面为 960×720，来自现有 Tres renderer；来源和校验值见 `public/covers/workbench/typewriter-study-real.json`。

直接导出源 Three.js 几何、材质和贴图，没有减面、重建拓扑或缩放贴图。本轮不需要 Blender MCP，也没有建立或修改 Blender 母版。运行加载均同源，入口为 `/models/bundles/kimi-typewriter/v1/manifest.json`；`public/` 是磁盘目录，不属于浏览器 URL。

`asset:check` 结果：0 errors、15 warnings、85 infos。15 条警告为 `KHR_MATERIALS_DISPERSION_NO_VOLUME`；原 Physical 材质的 dispersion 元数据没有 volume。其余信息为未使用的 UV 属性。没有把通过校验表述为零警告，报告保存在包内 `validation.json`。

## 架构与释放

沿用 ProductPresentation v3、公开 API 和现有数据库结构，无新增迁移。新增可选热点 group/marker、注册的 `typewriter-v1` 适配器、`typewriter-layout-v1` 动作程序，以及受范围检查的击发索引。v1/v2 和原 v3 tracks 保持兼容；注册程序与 tracks 互斥，不执行数据库提供的脚本。

`typewriterRig` 从记录的初始、分层和平铺姿态确定性计算部件位置和四元数，GSAP 仅修改进度或击发变量。`typewriterInstances` 恢复实例批处理，同时保留逻辑节点、拾取映射和部件世界锚点；逐帧不创建 Vector、数组或响应式部件对象。

loader 唯一拥有解码 geometry、material、texture；实例层只释放自身实例缓冲；loadAdapter 拥有环境 PMREM；控制器负责相机、GSAP、输入与监听器。切换、取消、迟到结果、失败和上下文恢复仍使用商品 ID 与选择代次，首次可用帧后开放操作。关闭面板保留相机和结构；页面隐藏暂停，回来不自动继续。

## 测试证据

本轮浏览器测试默认使用本机 Edge、真实 Spring Boot/MySQL 和当前公开目录，未启用 `TYPEWRITER_FIXTURE`。接口失败没有静默假数据回退。

| 检查                | 结果与证据                                                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 前端检查与构建      | `npm run check`、`npm run build` 通过；36 个测试文件、137 个测试。两条旧 `TypewriterStudy.vue` 属性连字符 lint 警告保留。                                                                                        |
| 真实 MySQL / 服务端 | `npm run server:test`：11 个测试，0 失败、0 错误、0 跳过；含配置契约、管理、安全初始化、迁移与持久化。详见 `server/target/surefire-reports/`。                                                                   |
| 源姿态一致性        | 原页面 1440×1000 下的 101 个进度点、8 个代表部件对照；位置及四元数比较误差小于 1e-11。源采样在 `src/lib/workbench/__fixtures__/typewriter-source-poses.json`。                                                   |
| 确定性与复原        | 全部 572 个部件正反 101 点姿态一致；50 轮展开/复原无累积漂移；击发与结构组合从基准重算。                                                                                                                         |
| 拾取及资源所有权    | 共享 geometry、instanceId 对应部件、选中反馈与重复销毁检查通过；实际浏览器射线选中 `part-070`，测试期间禁用 DOM 热点指针层。                                                                                     |
| 工作台操作          | 整机/分层/平铺、暂停继续、配色、A 键联动、检索聚焦、导览与相机接管通过。报告 `artifacts/typewriter-migration/runtime/report.json`。                                                                              |
| 生命周期            | 三次汽车样板↔打字机循环、快速/迟到选择、浏览器返回、GLB 下载失败重试、真实 WebGL 丢失恢复通过。保持同一 Canvas/renderer，恢复当前结构并停在暂停态。报告 `artifacts/typewriter-migration/lifecycle/report.json`。 |
| 基础兼容            | 390/320px 面板、检索、键盘与减弱动态；无 WebGL 和 renderer 初始化失败时，真实封面及八个观察点回退，无 GLB 请求。报告 `artifacts/typewriter-migration/compatibility/report.json`。                                |
| 管理预览            | 真实 572 部件加载、右键平移、分层后采集实际取景，默认镜头与 perspective 同步；资源、轨道、热点和舞台保持，公开 DTO 未修改，退出卸载 Canvas。报告 `artifacts/typewriter-migration/admin/report.json`。            |
| 生产构建            | 当前两件目录、外观/结构真实像素差异、五步/四步导览、接口错误重试、目录与 legacy 往返通过。报告 `.impeccable/review/workbench/production.json`。                                                                  |
| 实际后端重启        | 停止并重新启动本机 8089，配置完全一致，打字机 572 部件、目录仍两件，Flyway 版本仍 6。报告 `artifacts/typewriter-migration/persistence-after.json`。                                                              |

循环暖机后的三个记录均为 279 geometries、56 textures、9 programs。这是 renderer 资源计数，不是显存 MB、帧率或 20 分钟稳定性证明。页面隐藏测试采用可见性事件注入；WebGL 丢失恢复采用浏览器扩展真实执行，不能混同真人体验。

## 视觉验收范围

最终截图在 `artifacts/typewriter-migration/visual-final/`：1280×720、1440×1000、1920×1080 全景，390/320px 基础布局，关键近景、分层面板、平铺面板、目录和导览返回，共 10 张。初轮发现标签拥挤、单字母搜索命中错误、底部说明对比及远景取景问题；一轮集中修正后复核为 ship，范围只覆盖本次打字机扩展，不是整个系统或照片级精度认证。

封面写入导致 Vite 自动重载时曾捕获到加载帧；等待首帧和字体后重新采集同一版本，`visual-final` 是有效证据，没有追加第二轮视觉改版。Impeccable detector 只运行一次，保留一条历史 8px 圆角的 advisory，本轮未把它写成新规范。DESIGN.md 与对应 surface/design sidecar 已更新。

## 安装、测试与恢复

当前本机库已完成配置保存，不需要重复安装。新建数据库先按 README 启动前后端，确认基础管理可用，再执行：

```powershell
node scripts/apply-typewriter.mjs
# 上一步只验证，不写库。确认输出接受配置后，在新终端显式应用：
$env:TREES_APPLY='1'
node scripts/apply-typewriter.mjs
Remove-Item Env:TREES_APPLY
```

安装通过现有管理员会话/CSRF/API，不直接改业务表。每次实际应用前备份当前打字机和音箱 DTO；最早恢复点为 `artifacts/typewriter-migration/backups/2026-10-08T19-04-53-541Z/before.json`。恢复时在管理端以当前 revision 保存所需旧配置和基础信息，再恢复上下架；不要直接恢复历史 revision，也不要改写 Flyway 迁移。

```sh
npm run check
npm run build
npm run server:test
npm run test:typewriter
npm run test:typewriter-lifecycle
npm run test:workbench-accessibility
node scripts/typewriter-admin-check.mjs
# 生产预览 5182 运行后：
npm run test:workbench-production
```

`asset:typewriter-import` 依赖本机备份的源页面及 5183 候选服务；这些制作中间文件被 Git 忽略，不宣称重新导出跨机器自动可用。仓库目录中的运行包和配置可以直接被项目加载。更改 rig 内容或资源时必须创建新包版本，不能格式化不可变 rig 后沿用旧 checksum。

## 未完成及下一阶段

音箱正式制作取消。精细汽车仍在旧实机入口，新工作台的汽车仍是流程样板；Open Heart 手表为候选，未接入，也不擅自补作第三件承诺。下一阶段迁移精细汽车到相同适配机制。

本轮没有完成 30 次切换、20 分钟持续操作、正式帧时间/冷加载测量或 6—8 人形成性测试，没有重新验收旧手势全套。阶段 E 的这些项目仍待做，不能用本轮单资产通过替代联合验收。
