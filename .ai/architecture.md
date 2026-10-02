# 架构 — 统一工作台

2026-10-01。新工作台与旧版分开装配，不改变旧资源或将高精模型预加载进新场景。

## 路由与界面

- App.vue 仅选择异步 WorkbenchRoot / LegacyExperience。legacy=1 强制旧版；六个非样板旧 ID 自动进入旧版；其余 slug 由真实 API 解析，未知返回错误。
- WorkbenchRoot：导航、URL history/popstate、单活动面板、焦点恢复、商品标题，不持有 Three 对象。
- WorkbenchCatalog 负责目录搜索/分类/状态；WorkbenchPanel 负责能力驱动的外观/细节/动作/导览；WorkbenchTools 负责命名视角/缩放/镜头复位。左目录与右工具同一时间只开一个。
- WorkbenchStage：唯一 TresCanvas、DOM 热点、加载/失败覆盖层、上下文恢复入口。恢复只重挂 Scene，不能重建 Canvas。

## 配置与意图

lib/workbench/types.ts 定义独立 ProductPresentation。api.ts 是工作台唯一 HTTP 入口，校验数据形状、版本、有限相机值、唯一 ID 与导览引用，禁止假数据兜底。latest.ts 负责 AbortController 与递增代次，旧完成/失败不得写回。

stores/workbench.ts 仅保存配置、目录、面板、观察选择及操作意图。选商品立即清空旧状态，API 完成后仍为 loading，直到 Scene 完成首帧携带 slug+revision 才进入 ready。ready/error 都核验当前身份。切换商品重新开始默认状态；开合面板不重置。

view 只控制镜头；overview 复原动作/结构、保留配色并回默认镜头；restore 另恢复配色。manualRequest 立即停止镜头 tween 并退出导览；resetMotionRequest 取消瞬时动作，防止还原后旧按键动画继续写入。高频坐标与 Three 实例不放 Pinia。

## 场景与唯一释放方

- WorkbenchScene 拥有 RoomEnvironment 生成的 PMREM 目标、背景/雾、首帧回调、可见性与上下文监听。RoomEnvironment/PMREMGenerator 转换后立即释放；目标在卸载释放。compileAsync/首帧通知核验局部 generation，卸载/丢失递增代次。
- controller.ts 统一加载/卸载、镜头/聚焦/缩放、试色、toggle/pulse、结构及复原。拥有一套 OrbitControls、raycaster、缓存向量、GSAP 镜头与动作 tween；卸载先杀动画再释放 adapter。只监听展示 Canvas，面板滚轮不影响镜头。
- adapter.ts 创建程序化样板并校验节点；samples.ts 是按 source.key 分派的构建表，不按名称拼页面。modelKit.ts 拥有 geometry/material 去重集合，幂等 dispose；非响应 Group 直接加入局部 scene。
- 动作从节点基准位置 + 分离偏移计算，不累积漂移。形体、热点与动作共享节点；raycast 沿父级寻找配置热点。
- 拖动/滚轮停止镜头 tween，GSAP 只驱动主动操作。页面隐藏暂停时钟和补间。Tres 5.8.3 start 非幂等：先核验初始化和 isActive，避免 Three Timer 重复连接 visibilitychange。
- viewport 变化仅调整投影 zoom/view offset 为工具留白，不重置观察 pose。减弱动态直接到结束态。第一屏无自动镜头、聚合或长期连续动画。

后续 GLB adapter 应实现相同 root/point/setFinish/pose/apply/dispose 接口；loader 唯一管理 GLB 原始 geometry/material/texture，其他层不得二次释放。扩展展示源时同步前后端校验与 migration，不改变基本操作。

## 后端与持久化

server/ 是独立 Spring Boot 4.1.1 Maven 应用。Controller 返回概要或详情 DTO；JPA products/presentations 分表，配置为 MySQL JSON，schemaVersion/version 双重核验。Flyway V1 建表、V2 校验并插入三件样板，重启不重 seed。业务库 trees_x，测试库 trees_x_test。

GET /api/v1/products?q=&category=；GET /api/v1/products/{slug}。未知 slug 404、无效搜索 400、损坏配置 503；首轮无写接口。模型/贴图存文件，未来库里仅存引用/元数据；逐帧交互不请求后端。

scripts/server.mjs 读取 Git 忽略的本地环境文件，在子进程中指定 Java 17，避免系统 Java 8；不打印密码。前端 5181 代理 /api 至 8089，部署时也需同源反向代理。

## 验证与旧版

lib/workbench/*.test.ts 验证契约、晚到请求、状态和样板动作/资源；server/src/test 验证真实 MySQL 迁移/重启/API；scripts/workbench-check.mjs 核对实际 Scene 节点、renderer 引用、动作姿态与恢复。见 [验收](workbench-validation.md)。

LegacyExperience 保留 SiteHeader/ProductShowcase，老模型、烘焙、手势、后处理与独立 Demo 所有权不变。旧脚本加 legacy=1，避免把流程样板当作旧 GLB 检测。详见 [2026-09 架构](history/2026-09-architecture.md)；其中独立 Canvas、固定汽车流程、旧演出规则只对 legacy 生效。
