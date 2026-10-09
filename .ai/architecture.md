# 新版目标架构与当前实现

2026-10-08。目标以官方模板终稿及 workbench-contract.md 为准。本文明确区分已有候选与待实现设计；旧说明见 history/2026-10-08-before-restart/architecture.md。

## 分层

工作台UI管理目录、工具、单活动面板与反馈。展示配置描述资源、能力、镜头、热点、外观、动作与导览。场景适配器管理加载、节点/材质绑定、动作与释放。商品差异通过配置和注册行为表达，不按名称复制页面。

App仅组装页面，按pathname异步装配/admin管理端，原访客/legacy路由保留。访客工作台默认打字机（2026-10-09 用户调整）；管理预览复用WorkbenchStage/Panel/Tools，进入管理列表不挂场景，关闭预览卸载宿主。旧LegacyExperience仅为候选与历史入口，旧商品不能自动算入新项目正式目录。

## 当前前端候选

- WorkbenchRoot/Catalog/Panel/Tools：导航、目录、能力面板、镜头工具与URL历史。
- WorkbenchStage：唯一TresCanvas、DOM热点、状态覆盖层、局部键盘观察和上下文恢复。恢复Scene，不重复创建renderer。WebGL2探测使用离屏临时上下文并立即释放，不创建renderer；不支持或初始化失败时不挂载Canvas，WorkbenchFallback保留真实商品图文和目录，状态content区别于ready。
- WorkbenchScene：环境目标、首帧编译、可见性与监听器。
- stores/workbench：配置、UI状态与操作意图；Three与高频数据留在场景局部。
- controller：OrbitControls、拾取、相机/动作GSAP。手动观察立即接管，面板滚轮隔离；卸载先杀动画再释放。
- latest/ResourceSlot：API和适配器递增代次、取消、旧失败隔离、迟到释放。
- loadAdapter/glbLoader/glbAdapter：程序化与GLB统一接口；按需decoder，资源和部分解析结果去重释放，环境目标有唯一所有者。
- ProductPresentation v1/v2/v3：v3复用已有资源/舞台并增加进度动作、局部锚点与结构动作引用。源类型、舞台和manifest机制不要求建立后台资源平台。

阶段B已复核共同流程。v3进度动作由motionConfig执行契约/通道校验，motionPose加载时记录初始局部位置和四元数，按轨道区间从基准计算位移或旋转，旋转单段不超过180°。motionPlayback仅用GSAP补间进度，不让旧动作覆盖受控通道。程序化和GLB适配器共用此核心；节点组/任意动画片段仍未实现。

WorkbenchRoot提供局部motionSession，记录数字反馈和上下文恢复检查点，不放Three对象。播放反馈限15Hz；手动定位、暂停、完成即时反馈。Pinia仅保存motionCommand操作意图，不保存实时播放进度。控制器拥有补间，卸载前杀掉并发布暂停状态；商品代次不符的反馈被拒绝。切换商品清空检查点，上下文恢复重载当前商品并在同一进度暂停。

热点可配置anchor局部坐标；adapter.point在当前世界变换下转换，再用于投影与聚焦，父子节点分层后仍对应。旧配置缺anchor时沿用节点原点。音箱structureActionId将旧结构意图映射至explore-layers，不再叠加原布尔分离；旋钮仍独立旋转。汽车open-doors拥有双门旋转，旧分离拥有位移，组合互不覆盖。

## 状态与资源

### 统一拆解引线标签（2026-10-09）

WorkbenchStage 按配置选取最多12个重点热点并优先保留当前选中项，统一挂载 WorkbenchCallouts。controller.project 读取实际 adapter.pose 的结构/持续动作状态，按节点当前世界变换提供屏幕锚点和显隐依据；恢复后的非重点选中项由工作台业务选择传入，不依赖已清空的局部聚焦状态。

calloutOverlay 只管理DOM/SVG、ResizeObserver与GSAP：拆开渐显、合拢淡出，布局避开标题/工具和紧凑部件中心；calloutLayout确定性分配位置与容量，calloutTransition检查移动轨迹。安全路径平滑移动，相交路径冻结淡出、等旧标签释放占位后重定位并渐显。标签与引线始终采用当前屏幕锚点和实际标签位置，淡出立即取消指针/键盘入口。短暂过渡使用局部GSAP时钟，不额外请求WebGL渲染；静止收敛后注销ticker，页面隐藏及卸载清理监听、观察器和补间。

标签位置、透明度与避让状态不进入Pinia，不持有Three对象，不改变公共API或配置版本。商品代次、ready状态与上下文恢复沿用原场景生命周期；当前统一工作台商品及管理预览共用此层，legacy独立页面保持历史实现。证据见 callout-validation.md。

### 打字机注册适配器（2026-10-09）

typewriter-v1 继续通过 loadBundle/decodeGlb 下载和验证清单；572 个稳定 part-* 节点留在已解码 GLB。motion.program 只允许注册的 typewriter-layout-v1 + 同包 motion 文件，不能与 tracks 同时存在；typewriter-strike 只接受有效按键索引。前后端同步校验，v1/v2 和原 v3 tracks 不自动升级，公开 API 与数据库结构不变。

typewriterRig 从每个部件记录的初始/展开/平铺姿态确定性计算位置与四元数；GSAP 仍只补间统一 progress 或 strike 变量，相机独立。typewriterInstances 把共享几何/材质重新批处理为 InstancedMesh，但保留逻辑节点、instanceId 到部件的拾取映射及世界锚点；每帧只更新已分配矩阵，不重建几何。适配器拥有实例缓冲，loader 唯一拥有 geometry/material/texture，PMREM 由 loadAdapter 释放。选择使用实例颜色，不破坏用户外壳配色。漆面、金属 shader 只由受版本管理的代码注册。

WorkbenchParts 维护局部检索/分组/分页；完整 572 标识仍可选，舞台仅展示当前选中或细节面板的八个重点标记。WorkbenchLayoutMotion 采用整机/分层/平铺按钮，访客不常驻百分比滑块；同一控制核心仍支持连续定位、暂停、回退、复原及上下文恢复。源页面的滚动导演、renderer、相机与 DOM 未迁入。

配置读取、资源下载、解析、材质准备、首帧、ready/error均绑定商品和选择代次。首帧后开放操作，失败重试、不回退假模型。相机与动作分开；复位视角、全景与还原商品语义见契约。动作/分层由基准TRS组合，多个行为不累积覆盖。减弱动态直接完成；页面隐藏暂停非必要活动。

几何、材质、纹理、skeleton、ImageBitmap、decoder、控制器、GSAP、PMREM和监听器均明确释放。稳定AO/表面烘焙可以保留，不能把开门后变化的阴影永久烘死。源/运行资产分开，质量对照后决定压缩，不称KTX2无损。

## 目标后端

Spring Boot单体：Controller处理DTO/校验，Service处理上下架、配置/分类约束与事务，Repository持久化。单管理员Session认证、密码散列、CSRF，同源/api。Java17、Boot4.1.1、JPA、Flyway、MySQL继续锁定现有版本；端口5181/8089。

四类数据：管理员、分类、商品、展示配置。商品关联分类，配置商品一对一。结构版本与基本并发版本分开；配置保存校验、版本冲突返回明确错误。公开只读上架内容，管理员可编辑/预览下架商品。无独立草稿、发布快照或回滚平台。

模型/贴图/封面由开发者管理静态文件，业务记录保存同源资源引用和来源说明。开发工具manifest/来源/摘要可继续使用。正式三件统一GLB，程序化模型为原型/回归。当前会话使用该次配置，更新后重新加载读取新值。

## 阶段D实际实现

SecurityConfig使用Spring Security表单认证端点、Session及默认XOR CSRF。SPA每次写入前GET masked token，登录后的token重新获取；认证401和CSRF403展示重新登录并保留编辑器。演示默认admin/123456，可通过本地环境覆盖；管理员表持久化BCrypt(12)散列，正常重启不修改账号。仅显式设置TREES_ADMIN_RESET=true时事务替换单管理员，配置或散列失败不得先删除旧账号；不持久化重置开关。默认本机HTTP、HttpOnly/SameSite=Strict会话cookie，路径/api，30分钟过期。

AdminProductService事务保存基本信息和受校验的配置；产品revision为JPA乐观锁，配置变动同时更新商品updatedAt，因此配置与上下架共享冲突边界。类别更名同步商品旧category字符串并提升受影响产品版本；category_id外键为关系真值。公开只读过滤listed，下架详情404。保留公开数组列表契约，当前三件目录不引入分页；无运行时数据库代码、上传或快照执行。

AdminRoot/Login/Products/ProductEditor/ConfigEditor/Categories/Preview职责分开；预览POST只验证并返回规范ProductDto，随后调用store.preview安装局部配置；取消公开读取，重试仍使用该预览配置，首帧和释放沿用原代次协议。节点/材质是否实际存在在加载预览时核验，服务端契约通过不能替代资产验收。

写入前无静默自动重试。未保存导航有丢弃提示，会话过期后重新登录保留当前编辑内容。当前不含可视化节点选取、独立草稿/发布快照或上传。

V6追加管理员/分类实体及listed/revision/updatedAt/category_id，沿用原utf8mb4_unicode_ci。现有商品保持上架，slug/封面/展示配置不修改，V1—V5不改。公开过滤与管理读取分开，真实MySQL重启、安全与迁移验收见admin-validation.md。

## 阶段D2编辑草稿与取景

src/lib/admin/productDraft是编辑器局部真值，通过provide/inject传给各表单，不借用Pinia场景状态。item/presentation与JSON缓冲分别管理；JSON显式应用经过完整parseProduct，未应用文本阻止保存/预览。数字字段保留原始空字符串，不写零；分区用v-show保留输入，删除字段销毁自身缓冲。保存成功用服务端返回的配置与revision建立新基线；失败/冲突/重新登录不替换草稿。editor负责标识、引用保护、字段错误定位及镜头回填，Common表单只写自身可编辑字段，不升级结构版本。

AdminPreview提供局部cameraCaptureSession。WorkbenchScene注册按需数字快照读取器，controller读取实际camera.position/OrbitControls.target前退出导览并暂停镜头、动作和进度补间。右键平移只由此局部会话启用，访客默认关闭。快照仅含slug、选择代次和两个Vec3；当前商品、代次、首帧就绪与页面可见全部匹配才接受。恢复场景替换读取器，旧注销不清除新读取器；退出或失效时清空桥接再卸载场景。没有逐帧相机响应式同步，没有新增renderer。

默认回填同步camera和perspective视角，其他回填只改命名视角，缩放范围/外观/运动不改。回填仅更新编辑草稿，手动保存才持久化。API及v1/v2/v3契约不变，本阶段无Flyway迁移；详细检查见admin-usability-validation.md。

## 验证

### 钢琴注册适配器（2026-10-09）

`piano-v1` 沿用 loadBundle/decodeGlb 的清单、摘要、取消与首帧协议，decodeGlb 同时返回动画片段。仅允许 v3 配置绑定一个 `piano-sound-path-v1` 程序，结构 ID 必须一致；不能混入任意轨道、旧动作或 explosion。前后端同时验证，API 与数据库结构不变。

`pianoRig` 验证823语义节点、表面映射与透明度曲线；原生 AnimationMixer 定位 `piano-sound-path`，覆盖位移、四元数、缩放与34个形变网格。透明度和可见性独立采样，同一进度可正反向重复定位。热点按可见 section/flat 表面的预计算局部边界转换，拾取回到稳定语义节点；高亮保存并恢复材质状态。loader 唯一释放原 geometry/material/texture，适配器解绑 mixer，loadAdapter 拥有专属 PMREM，控制器拥有 GSAP/相机/监听。环境临时场景只释放一次。

`WorkbenchPianoMotion` 提供八个具名章节、暂停/继续/复原和独立章节取景；不复制 Canvas、相机或源页面 DOM。关闭面板保留状态、观察接管暂停动作，隐藏与恢复保持暂停检查点。暖白舞台与深色工具继承已有体系；部件聚焦时收起舞台介绍，顶栏保留商品身份。Tailwind 扫描限制为 src，避免导入大 GLB 时开发工具误扫资产。

本地check/build、契约/生命周期和真实API浏览器测试；正式模型单独测量。后台阶段另加授权、CSRF、冲突、分类约束、上下架和配置更新。主桌面三个尺寸，移动基础兼容。拟6—8人形成性任务测试，手势不进入核心完成条件。

新路线见 implementation-roadmap.md。历史旧测试只说明过去特定构建，不直接证明新版质量或安全。
