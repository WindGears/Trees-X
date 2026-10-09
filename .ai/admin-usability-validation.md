# 阶段D2：管理端易用性验收

2026-10-08开始实施，2026-10-09完成验收，承接阶段D。范围：常用配置表单、统一本地编辑草稿、高级JSON往返、引用保护、整页预览与真实取景回填。无新HTTP接口、数据库结构或Flyway迁移；保留v1/v2/v3、认证及上下架。模型、材质、上传、手势和发布历史不改。

## 实现

七分区由AdminProductEditor协调，BasicFields/Hotspots/Finishes/Camera/Actions/Guide/ConfigEditor分别维护常用字段。Field/Number/Vector/Reference/RowTools共用校验反馈与操作。新建必须明确选择配置起点，默认下架，不生成假模型。

productDraft是工作台局部真值，通过provide/inject提供；表单与高级JSON分离缓冲，显式应用后合入。未应用/无效JSON阻止预览和保存，离开要求明确放弃。数字原始文本保留空输入，不写零；分区切换不卸载字段。保存成功用服务端结果与revision更新基线，失败/冲突/重新登录不覆盖输入。完整配置仍由parseProduct及原后端验证器校验，不升级版本。

条目ID稳定，复制获得不重复ID；热点/视角被导览引用时列出步骤并禁止直接删除，至少保留一个外观及perspective。导览下拉引用保持组合配置，返回全景时禁用其他执行项并解释不参与该步。动作绑定、轨道、资源、材质及舞台仍使用完整JSON。

预览提供局部cameraCaptureSession，场景控制器仅按需返回位置、目标、slug和选择代次。采集前退出导览/暂停补间；只接受当前商品、当前代次、首帧ready且页面可见的结果。恢复更换读取器，旧注销不影响新读取器；退出/会话失效清空桥接并卸载Canvas。右键平移仅管理预览开放；访客规则不变。默认回填同步camera与perspective，命名回填仅改该项，缩放范围与动作/配色不改，也不落库。

没有逐帧相机响应式同步，Three对象仍由场景生命周期所有；进入普通管理列表不创建Canvas。预览继续复用既有TresCanvas/renderer，变化只增加按需数字采集。

## 验证证据

| 检查                | 实际结果与证据                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run check       | 35文件、133测试通过，93个Vue组件≤300行；仅旧TypewriterStudy两条属性命名warning。artifacts/admin-usability-check.log                                                         |
| npm run build       | 生产构建通过，管理预览继续按需拆分。artifacts/admin-usability-build.log                                                                                                     |
| npm run server:test | 真实trees_x_test，10测试通过，0失败/错误/跳过；镜头与perspective保存、Spring重启后保持、动作数据不变。artifacts/admin-usability/backend-tests.json                          |
| npm run test:admin  | 开发通过；生产5182在真实隔离8090后端通过，错误数组为空。初轮功能/截图报告artifacts/admin-usability/browser.json；修正后功能报告artifacts/admin-usability-final/browser.json |
| 工作台              | test:workbench、test:workbench-production、test:workbench-accessibility通过；对应artifacts/admin-usability-workbench*.log及admin-usability-accessibility.log                |
| 可逆探索            | test:workbench-progress、test:workbench-progress-production通过，双案例中间姿态、接管、组合动作及真实上下文恢复。artifacts/admin-usability-progress*.log                    |

新增9项单元测试：v1/v3表单与JSON往返、GLB v2的源/舞台/材质/行为保留、无效JSON不覆盖、空数字不写零、稳定ID/排序/引用保护、默认/命名回填、显式放弃与服务端基线、选择/可见性门禁、旧读取器注销与迟到结果。数字组件测试实际挂载Vue输入框验证清空、阻止提交和销毁缓冲，并非仅调用纯函数。

管理浏览器检查覆盖热点/外观新增、复制、移动、删除，必需项和引用保护，无效颜色、空数字跨分区保留，JSON应用失败/拒绝隐式丢弃/明确放弃，缺节点加载失败与重试，v3时长和导览35.5%→0.355。单元及既有契约回归另外检查重复ID、失效引用、v1/v2/v3和真实GLB。

取景用实际右键平移改变真实相机，核对回填值、默认/perspective一致，数据库在保存前仍为原配置；命名回填保持默认镜头。真实WEBGL_lose_context使采集禁用，恢复后复用原Canvas再采集。保存后公开API及实际访客场景使用该镜头，转动后Home复位恢复相同位置。测试不只检查DOM标题。

生产Vue不暴露开发组件对象，浏览器测试在测试上下文观察真正的WebGL viewMatrix uniform并反解相机位置，与回填值按Float32精度（四位小数比较）核对；应用未增加调试接口。镜头目标另验证实际平移后的非默认目标、保存数据及默认/全景同步。

后端真实MySQL测试在Spring应用重启后核对camera.position/target及perspective，两者保持并且actions未覆盖。浏览器结束恢复自己编辑的打字机与上下架状态，删除临时分类；均在trees_x_test，不改trees_x正式商品。

并发409保持输入、明确重新读取、真实退出导致401、重新登录后继续保存均通过。页面隐藏通过visibility事件注入；预览会话失效通过真实后端退出/401后发送客户端失效通知，核对Canvas卸载及草稿保留。未等待30分钟计时过期，不将注入行为记作真人测试或后台自动轮询能力。

## 截图与集中修正

首批桌面1280×720、1440×1000、1920×1080及移动390/320检查基本信息、镜头、导览；1440另查全部七分区及登录/目录/分类/预览。页面无横向溢出，移动使用单列长表单，保留原生输入字号与操作尺寸。初批23张截图中4张登录/列表/分类/预览来自同轮未改变界面的先前生产执行，其余为该轮新图；报告明确标记reusedCaptures。

当前会话使用Impeccable degraded reviewer，没有另派审查agent。首轮disposition: fix，三项实际缺陷为选中分区hover背景覆盖造成对比度不足、镜头字段margin被旧规则覆盖、服务端可选null结构状态在select中空白。集中修正选中hover、24px字段间距、null默认“保持当前”，并防止网格标签拉伸输入。截图前移开鼠标并等待150ms过渡结束，避免把过渡帧当作稳定选中状态。

一次确认截图覆盖相同五尺寸的镜头/导览，保存为artifacts/admin-usability/confirm-camera-_与confirm-guide-_。实际图像查看确认选中状态可读、空结构有文字、间距恢复；disposition: ship仅覆盖本轮界面。随后生产功能回归禁用截图，避免继续视觉调优。没有改变模型质量、字体世界或追加新效果。

## 交付与边界

操作说明见admin-operations.md，产品/设计/架构/路线已同步。可演示表单编辑→三维预览→实际取景回填→手动保存→前台重载。会话失败与冲突保留页面内存输入；刷新或主动确认离开后不提供持久化草稿恢复。

本阶段结束，下一阶段按音箱→打字机→汽车审核并接入正式GLB。精度、许可及资产动作检查仍未完成；不因管理端通过而把工程夹具/流程样板认定为正式高质量展品。没有增加在线上传、节点拾取、运动轨道可视化编辑、手势或发布版本管理。
