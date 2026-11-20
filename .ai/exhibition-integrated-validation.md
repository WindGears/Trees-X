# 一体式暗色展厅验收

## 实机走查

- 后台 Edge 使用本机生产构建、真实目录接口和现有展品资源。封面区先后选择三件展品，无 Canvas、展品详情或三维资源请求。启动后在同一展位开放真实交互。
- 打字机一键分层到 0.6，完成击键、查看字杆、回到本段、平铺和复原。回到本段保持分层，复原只动机构。整机状态搜索字杆时先展示「展开后查看」，分层到位再聚焦。旧取景视线被上盖遮挡，新取景露出字杆阵列。实机排查还修复了详情卡被 Canvas 拦截点击的问题。
- 钢琴从剖切经键盘到击弦机构，汽车先开门观察座舱，再分离部件并保留开门状态。浏览器前进／后退和迟到加载的场景身份正确。汽车请求失败后可重试，三件切换复用同一 Canvas 和 renderer。
- 检查 1280×720、1440×1000、1920×1080 的界面，验证键盘开关观察工具和焦点恢复。减弱动态下模型在输入后的下一帧到达目标。视频采集时的首帧时间记录在报告第一项展品的 `firstFrameMs`。
- 管理端用独立恢复库完成预览、右键调整镜头、回填、保存、前台读取和查看部件。测试比较实际摄影机及保存前后配置，允许数据库 JSON 对镜头向量的末位浮点舍入。测试结束恢复了打字机原配置。

前后对照和录屏位于 `artifacts/integrated-gallery/comparison.html`。访客和后台实机报告分别位于 `artifacts/integrated-gallery/accepted/report.json`、`artifacts/integrated-gallery/admin/report.json`。

## 复测

- 本机生产预览和真实 API 就绪后，以 `CHECK_URL=http://127.0.0.1:5183` 运行 `node scripts/exhibition-integrated-check.mjs`。可加 `--typewriter` 做打字机切片，或用 `EXHIBITION_RECORD=1` 采集录屏。
- 独立恢复库后端用 8091。以 `DEMO_ADMIN_SHOWCASE=1`、`DEMO_ADMIN_PRODUCT=typewriter-study`、`DEMO_ADMIN_DESKTOP=1` 运行 `node scripts/demo-admin-flow-check.mjs`。
- 生产构建、架构、模型核验、1019 项单测及工具测试通过。全仓 `npm run check` 在已有本地文件 `PERFORMANCE_OPTIMIZATION.md` 的格式检查中停止，其他阶段独立执行。
