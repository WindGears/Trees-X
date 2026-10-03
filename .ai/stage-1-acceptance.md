# 阶段 1：正式资产接入验收

2026-10-03。本阶段工程门槛通过；正式目录仍是三件流程样板。音箱 GLB 为工程夹具，不能以本记录代替阶段 2 的画质与真实结构审核。阶段 0 恢复位置见 [基线](stage-0-baseline.md)。

## 已实现

- ProductPresentation v2 兼容 v1，支持版本化 GLB 资源包、已注册适配器、节点/材质引用及独立舞台。Spring Boot 校验同一契约；Flyway 只新增 V3 封面/展示状态迁移，没有修改 V1/V2。
- 程序化模型和 GLB 共用异步适配器、控制器与唯一 Canvas/renderer。资源清单与所有文件核对字节数和 SHA-256；三路读取、取消/超时、迟到结果释放。下载、解析、材质准备、首帧状态明确，首帧之前不开交互。
- 统一热点、试色、本地轴旋转/平移、分层与复原，从基准姿态组合，不执行配置中的代码。所有权覆盖部分解析结果、迟到纹理、共享 geometry/material/texture、ImageBitmap、解码器与 PMREM。
- GLB/Draco/Meshopt/KTX2 按需加载；KTX2 与普通纹理共用已核验资源包的 LoadingManager，转码器只允许固定同源文件。商品切换更新实际灯光/地面位置，背景与雾保持一致。
- Blender 独立后台导出、源/运行版本记录、无损依赖整理、ORM 打包、KTX2 局部对照工具可用。原始模型、母版、汽车运行资源没有覆盖。
- 受摘要保护的 `public/models/bundles/**` 与 `public/basis/**` 禁止 Git 换行转换，防止 Windows 检出后校验失效。

## 工程与浏览器证据

详细输出保存在本机 `.impeccable/review/asset-ingestion/`，该目录被 Git 忽略；本文保留结论和重跑入口。

| 验证                                                  | 结果与范围                                                                                                                    | 证据                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `npm run check`                                       | 29 个文件、107 项单元测试通过；Vue ≤300 行。原 TypewriterStudy 两条属性命名警告保留                                           | check.log                                                        |
| `npm run build`                                       | 类型检查和生产构建通过；保留既有包体提醒                                                                                      | build.log                                                        |
| `npm run server:test`                                 | 实际 MySQL `trees_x_test`；v2 契约、数据库修改、Spring 重启保持 v2、恢复测试数据、重复迁移                                    | server-test.log、mysql-surefire/                                 |
| `npm run server:build`                                | 后端可执行包构建通过；打包本身不替代带环境开关的真实 MySQL 测试                                                               | server-build.log                                                 |
| `npm run test:asset-ingestion`                        | 真实 104 网格/15,924 三角形音箱；热点、动作/分层/复原、三轮 v1/v2 切换、同 renderer、独立舞台更新、取消、失败重试、上下文恢复 | browser.json、failures.json                                      |
| `npm run test:asset-production`                       | 生产构建中的真实 GLB 试色/分层像素变化、旋钮操作、四步导览及 v1/v2 切换；无页面异常和外源请求                                 | production.json                                                  |
| `npm run test:workbench`、`test:workbench-production` | 原三件真实后端流程回归通过；动作、导览、错误恢复、目录、旧版返回                                                              | workbench-regression.log、production.log；另见 review/workbench/ |
| `npm run test:asset-textures`                         | ORM 各像素通道保持原值，尺寸不一致及覆盖输出被拒绝；实际 KTX2 材质浏览器对照通过                                              | orm.json、texture-probe.json                                     |
| `node scripts/asset-preservation-check.mjs`           | 汽车整理副本的二进制几何、节点/材质/UV 元数据一致；77 个非模型文件内容摘要不变                                                | preservation.json                                                |

资产浏览器测试使用受控 v2 API 响应加载真实 GLB；不改 `trees_x` 业务记录，不是运行时静态回退。真实持久化在独立 `trees_x_test` 验证，结束恢复原记录。

截图覆盖 1440×1000、1280×720、1920×1080、390/320；检查了全景、近景、动作与面板。一轮集中修正把音箱前面板、单元与固定件作为一致移动组，避免展开时前板遮住原位单元。桌面和移动基础布局通过；该模型仍不达到正式展品质量门槛。

## 资源与运行记录

- 音箱包：891,500 字节，15,924 三角形；三轮切换的 renderer 记录始终为 105 geometries / 4 textures。最新自动化冷加载约 1,048 ms，限定本机、工程夹具及该次运行。
- 10 秒持续鼠标拖动：Edge 无头、1440×1000、RTX 5060 Laptop GPU，记录 1,801 个相邻渲染完成间隔，中位 5.5 ms、P95 6 ms；末帧 209 draw calls。计时为 Tres onRender 间隔，包含浏览器/自动化调度，不是 GPU 查询耗时，也不能外推到精细整车或真人答辩帧率。完整方法在 `frame-times.json` 与 `test:asset-performance`。
- 汽车整理副本：78 文件、1,745,258,853 字节、1,500,363 三角形；glTF Validator 无错误/警告。存于 `artifacts/asset-pipeline/reventon-organized-v1/`；二进制与贴图未变，不会产生纹理或几何降质，但尚未作为整车迁移后的运行版本。
- Blender 5.2.2 LTS 音箱往返导出已执行，105 对象、输入摘要不变。该工具链验证不表示往返后的画面已经验收。

## KTX2 对照的具体边界

仅选择汽车原材质 32 的座椅网格，复用其原 UV、normal/AO 与同一 EXR 环境，替换一张 baseColor 纹理。4096×4096 保持不变，源 PNG 69,765,044 字节，UASTC KTX2 10,641,847 字节，运行时为真实 GPU 压缩纹理及 13 级 mipmap。两组环境均实际加载，同源请求、页面异常为 0。

1440×1000 整屏 RGB 对照：平均通道绝对差 0.033437/255，最大差 6/255。包含大量背景，不能当作感知质量分数。人工查看两张同姿态截图，当前视角未见明显材质退步；没有覆盖全部汽车材质、观察角度或 GPU。

源图为 16 位，编码含 8 位转换及有损块压缩，因此没有“无损”的结论。`qualityApproved=false` 保留；工程通道通过，压缩资源未整体采用。原汽车资源保持原样。文件与报告在 `artifacts/asset-pipeline/car-surface.ktx2`、`car-surface.ktx2.json`，截图为 `car-material-original.png` / `car-material-ktx2.png`。

## 未完成项与下一阶段

- 阶段 2：最多三件免费音箱候选，核验实际文件、许可、贴图、近景及可操作部件，再制作第一件正式音箱。现有夹具没有被认定为候选质量通过。
- 打字机精修、精细整车自由工作台迁移、手势真人测试、管理员/上传/发布、离线联合交付仍分别属于阶段 3–7。
- 尚无整车在新适配器的显存/持续交互成绩，也没有完成 20 分钟最终联合回归。
- npm 审计仍有 6 项开发工具链 high 提示；本轮已把 sharp 更新为 0.35.5。其余报告见 npm-audit.json，未通过强制降级或跳过 peer 检查处理。
- 未推送 GitHub，原汽车再分发许可缺口不因本机可用而消失。制作母版目前仍需另做异机备份。

阶段 1 通过后可以进入音箱资产筛选；本记录只验收接入机制与制作工具，不宣称完整毕设已经完成。
