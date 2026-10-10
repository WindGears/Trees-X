# 精细汽车迁入统一工作台

2026-10-10。本轮将已有真实 Three.js 汽车从固定导演入口迁入打字机、钢琴共用工作台，不重新制作模型或提高离线参考图等效标准。首页仍是打字机，汽车从目录或 `/?product=reventon` 进入；旧固定导演留在 `/?legacy=1&product=reventon`。

## 已实现的观察流程

整车 → 外观轮廓 → 打开双门 → 座舱 → 车轮关系 → 七组分离 → 返回整车。七步导览由用户主动推进，工具面板也允许自由跳转。

- 双门开合与部件分离为两个独立 v3 进度动作，旋转和位移从加载时的基准姿态计算，允许组合。
- 开/合、暂停/继续、复原动作使用具名按钮；访客没有常驻百分比滑条。
- 自由旋转、滚轮、键盘、视角和部件选择暂停播放并保留当前状态；关闭面板不复原。
- 复位视角只恢复相机，复原动作保留相机和配色，返回全景合拢动作并保留配色，还原商品恢复全部默认状态。
- 十个语义热点的局部锚点按实际节点世界变换更新；拆开渐显细引线，复用已有平滑避让层。
- 整车、座舱和结构视角独立于动作，默认静止。减弱动态操作直接到目标姿态。

## 运行资源与所有权

| 项目                  | 核验值                                                             |
| --------------------- | ------------------------------------------------------------------ |
| GLB                   | 101,099,092 字节                                                   |
| 原 PNG                | 75 张，共 1,618,267,931 字节                                       |
| 原 EXR                | 25,182,626 字节                                                    |
| 清单运行包            | 77 文件，共 1,744,549,649 字节                                     |
| 实际网格 / 三角形     | 135 / 1,500,363                                                    |
| 源对象记录 / 可运动组 | 2,998 / 7                                                          |
| 清单 SHA-256          | `28031a60c0e0ce12c6f9e6ba5fdb5ba5b9bf0f17ba0cd8890bba3a46d96f739d` |

七组为双门、四轮和后舱盖，不是 2,998 个对象均可独立拆卸。制作脚本从旧 motion.json 的 0/80/263 帧提取参数；访客不请求此采样文件，不执行旧导演相机。门轴旋转约 -0.67785311145 rad，沿现有局部 X 轴；分离是已有刚性组件观察，不宣称真实维修步骤。

`reventon-v1` 复用通用 GLB/轨道适配器。原始灰银方案恢复各材质原色；其他方案只改变配置中八组漆面材质。保留原 PBR/AO、薄玻璃处理、EXR/PMREM、两盏面光源与姿态变化接触阴影，不新增后处理。

loader 唯一释放源几何、材质、纹理和共享 ImageBitmap；汽车适配器先释放两张接触阴影目标、辅助几何及局部灯光；loadAdapter 释放环境目标。共同工作台拥有 controls、相机、Canvas 和 renderer。资源不复制，不减面，不缩贴图。

首次接入发现大量临时 Blob URL 请求失败，真实上下文恢复也复现此问题。现改为三任务队列，直接从已校验的 PNG/JPEG/WebP 字节创建 ImageBitmap；方向、透明预乘和色彩转换参数与 Three 原管线一致。解码完成后释放压缩字节与临时 URL，嵌入图像/压缩纹理仍走原 loader。失败、取消和迟到资源沿用唯一所有者清理。

## 验证证据

开发浏览器证据：`artifacts/reventon-workbench/runtime/report.json`，真实 API 与 Edge，`passed: true`、`lifecycle: true`、`errors: []`，14 条检查包括：

- 真实 GLB 身份、三角形、源对象与七运动节点，单 Canvas/renderer。
- 开/合、暂停/继续、反向及组合后的实际局部/世界姿态；镜头独立。
- 同一中间进度正反定位一致；运动标签投影误差小于 1 px。
- 鼠标滚轮、拖动、键盘、视角与部件聚焦接管；关闭面板保留。
- 七步导览、减弱动态、页面隐藏暂停且返回不自动继续。
- 真实 WebGL 上下文丢失/恢复保留两个暂停检查点，继续复用 renderer。
- 汽车 → 打字机 → 钢琴切换、迟到汽车响应隔离、实际清单请求失败及重试。
- 所有运行请求同源；无未预期页面或控制台错误。

`reventonAdapter.test.ts` 使用真实轨道参数和小几何夹具，包含非恒等父变换：101 点正反采样、50 轮复原、旋转与位移组合、局部锚点、原色恢复和二次释放。该测试证明控制机制，不替代全车视觉检查。`decodeQueue.test.ts` 检查并发上限、失败后排队和取消；`motion.test.ts` 检查反馈只包含三个可序列化字段，GSAP 缓存不会进入检查点；store 检查动作复原不发相机指令。

截图：`artifacts/reventon-workbench/visual/report.json`，12 张，覆盖 1280×720、1440×1000、1920×1080、390×844、320×760，以及动作面板、开门、座舱、分离和目录。完成一次集中取景修正；整体放大、座舱从门后侧观察。真实 renderer 封面位于 `public/covers/workbench/reventon-real.png`，摘要和来源写在同名 JSON。小屏仅为基础兼容，近景不以整车完整入画为目标。

前端：`npm run check`（44 文件 / 214 测试）、`npm run build` 通过；保留旧 TypewriterStudy.vue 两条既有属性命名 warning，没有 lint error。后端：`npm run server:test`，真实 MySQL，共 42 测试，0 失败/错误。打字机与钢琴真实 API 浏览器回归均通过；v1/v2 GLB 工程夹具的切换、取消、失败重试、上下文恢复通过。

生产构建由 `npm run test:workbench-production` 检查，三件真实 API 商品均通过外观/结构的实际 Canvas 像素变化、专属动作和完整导览；汽车另外核对双门与座舱取景产生真实像素变化。记录位于 `.impeccable/review/workbench/production.json`，`passed: true`、`errors: []`。这项检查不依赖开发版 Vue 调试入口，也不以 DOM 标题变化替代真实画面；深层节点与姿态另由开发版实机检查验证。

Spring Boot 停止并重新启动后，三件实际 MySQL 商品配置与重启前深比较完全一致，Flyway 保持六次迁移，没有新增或重放业务初始化。证据在 `artifacts/reventon-workbench/persistence/report.json`；该检查是应用重启，不声称重启了 MySQL 服务。Impeccable 检测器对本轮两个 UI 文件返回 `[]`；不代表全项目历史视觉问题清零。

回归发现此前打字机/钢琴清单被格式重写后，配置仍引用旧摘要。已核验所有包内原文件，管理 API 只修复现有清单摘要并备份，保留管理员的商品与配置编辑；源配置和封面记录同步正确引用。清单现排除全局格式重写，制作工具在摘要生成前使用项目格式。未放松摘要检查，未静默换为样板。

## 2026-10-10 门板与座舱材质修正

用户指出贴图错位、脏块及接缝后，以真实场景射线定位与原 VPB 材质记录核对：最明显的灰斑来自三个 `18581`（绒布黄）材质，源底色确为 `AI33_008_dirt_001_color_01.png` 污渍图；黑色皮革与碳纹不是这片灰斑的来源。当前工作台将这三处底色改为线性炭灰 `(0.025, 0.026, 0.028)`，保留原法线、粗糙度、金属度与 AO 通道。`18110/18821/18981/19061/19141` 的十三个实际 BLEND 双面装饰材质保留原透明贴图，使用单次双面绘制、轻微深度偏移及 `0.02` alphaTest；玻璃、车漆、皮革和碳纹不接受此专属修正。

同时修正通用外部图像解码的 `imageOrientation: flipY` 为 `none`。glTF 的 Texture.flipY=false 无法撤销 ImageBitmap 中已完成的翻转。独立非对称 PNG 浏览器夹具与本地 Three 原生 GLTFLoader 对照：颜色、法线、粗糙度/金属度、AO 的位图和 UV 通道一致，真实 GPU 输出 131,072 个 RGBA 通道差异为 0；多个采样器共享位图，重复清理只关闭一次。仅在浏览器路由中把选项改回 flipY 的负例会失败（71,138 通道不同），不修改仓库文件。

修正仅在注册汽车适配器初始化时执行，不新增材质、纹理、逐帧状态或 renderer。移除的底色纹理在解析时已被 ownedResources 收集，仍由 loader 在卸载时唯一释放；保留的纹理不转移所有权。原 GLB、75 张 PNG、EXR 和清单摘要不变，不重烘焙、不降分辨率、不改数据库。目录封面重新从实际 renderer 生成并更新摘要。

本轮通过的证据：

- `npm run check`：45 文件 / 219 测试；`npm run build` 通过。五项新增单测覆盖材质限定、保留通道、透明贴片、幂等及被移除纹理的共享/重复释放；没有新增 lint error，旧打字机两条属性命名 warning 保留。
- `npm run test:glb-image-orientation`：原生解码、实际 GPU 像素与共享位图清理通过；报告在 `artifacts/glb-image-orientation/report.json`。负例用 `TREES_PROVE_ORIENTATION_FAILURE=1` 执行，预期退出失败。
- `npm run test:reventon-material`：实际汽车 75 图解码及 UV 检查通过，座舱/门板原法线与 AO 位图匹配源 PNG；核对三处清洁绒面和十三处透明装饰。相同相机/灯光/renderer 下临时恢复原污渍色图，148,578 个 RGB 通道差异超过 4（总 3,049,200、最大差 56），证明修正产生真实画面差异。该临时恢复只用于测试，随后清理。
- `REVENTON_LIFECYCLE=1 npm run test:reventon-workbench`：14 项实际轨道、接管、导览、隐藏、上下文恢复、三件切换、迟到响应、失败重试与单 Canvas/renderer 检查通过；本轮报告位于 `artifacts/reventon-workbench/material-fix/lifecycle/report.json`。
- `npm run test:reventon-workbench-visual`：12 张桌面/小屏截图通过。人工检查开门、座舱与分离态，明显污渍移除，保留细纹、缝线和标识；实际截图位于 `artifacts/reventon-workbench/material-fix/cabin-verified.png` 和 `artifacts/reventon-workbench/visual/`。

`npm run test:workbench-production` 也通过：最新生产构建与真实 API 中三件 GLB 均可用，外观与结构产生真实 Canvas 像素变化，打字机五步、钢琴九步及汽车七步导览完成；汽车双门与座舱取景另有像素断言。生产错误列表为空。

这里的透明层修正有截图检查，未进行逐个透明边缘的定量视觉判定；不能保证原几何自相交、所有观察角度下的透明排序或原资产接缝全部消失。此结论不替代后续三件联合长期验收，也不等同于原离线参考图。

## 安装与边界

`npm run asset:reventon-presentation` 核对已有资源并生成配置；`node scripts/apply-reventon.mjs` 默认仅预校验。`TREES_APPLY=1` 才通过原管理 API 备份并更新汽车；`TREES_CAR_COVER=/covers/workbench/reventon-real.png` 可选择本轮封面。保留其他商品、分类、排序和上下架，不新增数据库迁移。`node scripts/repair-presentation-hashes.mjs` 只用于已核验的两件自有资源清单引用修复。

原母版来源仍为用户提供的 VPB，原 provenance 没有提供再分发许可，本轮不补造许可或作者。新增清单引用既有运行文件，不提交原下载包、Blender 母版或复制一份模型；来源状态不因“正式展品”标签改变。

这是单件迁移与兼容验证。尚未完成三件联合 20 分钟稳定性、规范设备上的多轮冷加载/帧时间、形成性真实用户任务测试或手势新工作台接入；没有照片级等效、维修真实性或性能达标结论。
