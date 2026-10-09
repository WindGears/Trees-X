# Kimi 自有项目资源复用检查

2026-10-09。用户确认两个页面均为本人创建的 Kimi 项目。本轮完成公开运行资源备份、独立本地重放和迁移评估；尚未替换正式目录、修改数据库或接入工作台。

后续状态（同日）：按用户指令已迁移打字机，导出 GLB 并接入统一工作台和真实 MySQL，音箱从当前访客目录下架。下文“尚未接入”是原资源审查时的状态；当前结果以 [打字机迁移验收](typewriter-migration-validation.md) 为准。Open Heart 本轮未迁移。

来源：[机械打字机](https://k3-typewriter.ok.kimi.link/)、[Open Heart 手表](https://k3-open-heart.ok.kimi.link/)。本检查只覆盖默认发布页面，不包含未发布的制作工程或全部可选 query 模式。

## 实际取得的资源

| 项目   | 取得内容                                                                               | 实际验证                                                                                 | 默认运行文件总字节数    |
| ------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------- |
| 打字机 | 网页源码、轮廓几何数据、装配/展开/平铺布局、Three r160 与相关模块                      | 572 个可选择零件；整机、0.55 展开、1.0 平铺；零件聚焦与击发入口可执行                    | 2,628,116（6 个文件）   |
| 手表   | 3 个 GLB、部件清单、材质恢复参数、当前使用的 WebP 贴图、2 个 EXR、运行脚本和同源 Draco | 默认整机与 Disassembly 章节可运行；407 个注册单元，其中当前重装配检查覆盖 359 个展示单元 | 42,948,790（28 个文件） |

上述字节数按本地解码后文件大小求和，包括运行脚本和 Three 依赖，排除截图、原始入口备份及可选脚本；不是网络压缩传输量，也不是显存占用。打字机额外取得布局求解器；手表额外取得 studio-refinement/editorial-lod 脚本，但没有把它们的所有可选模型算作已备份。

打字机通过程序化 Three 几何构建，网页没有现成 GLB。`__TYPEWRITER.getParts()` 与 `getManifest()` 提供几何、稳定编号、分组、说明及装配/展开/平铺姿态。可以迁移几何与部件数据；符合当前正式 GLB 交付约定还需要制作导出版本并验证节点、材质及动作。

手表 GLB 的动画片段数量均为 0；章节、拆解、重装配和相机演出在 JavaScript 中计算。外壳有 124 个节点，机芯有 283 个节点，另外还有独立的概念陀飞轮资源。注册单元数、当前展示数与 GLB 节点数口径不同，不应相加后称为“可完全独立拆装的真实机械部件数”。

| GLB                            | 字节数     | 节点 / 材质 | SHA-256                                                            |
| ------------------------------ | ---------- | ----------- | ------------------------------------------------------------------ |
| omega_321_r46f.glb             | 19,879,792 | 283 / 60    | `4fd53749b9c66390cfc44c49de37349c44080b2a23629878b3cd068b5811749f` |
| kimi_openheart_exterior_v2.glb | 10,715,276 | 124 / 12    | `fb2f74e2d7b9cfc60918c397ca8c04d3b83291e36d960e6155ab913a1c22793d` |
| kimi_tourbillon_v1.glb         | 968,432    | 64 / 6      | `c23be875ee5c01eccffc771f9080527373a482ec85e31d650530c17c8e8f20bf` |

三个 GLB 的 JSON 元数据无外部缓冲/图片路径，无重复节点名；均有 Blender glTF 导出器标记。机芯按 accessor 元数据累计约 1188 万三角形，应单独测量解析与 GPU 资源占用，不能套用旧样板预算或预填性能成绩。此次没有执行全网格规范、机械真实性或正式画质验收。

## 画质、来源与缺口

手表依赖 `finish-manifest.json`、`material-defaults.json`、运行时 `onBeforeCompile` 和 EXR 反射环境恢复雕刻、拉丝、粗糙度等效果。仅复制 GLB 不能保留网页的完整外观。源码使用 Three r160，Trees X 锁定 r185.1；自定义 shader、透明/透射和各向异性必须做新版对照，不能同时把旧 renderer 嵌入工作台。

手表默认网页实际使用的贴图已经本地取得，独立重放没有失败请求。清单列出的以下原尺寸版本返回 404，尚未取得：

- r46-silver-engraving-baseColor.webp
- r46-silver-engraving-roughness.webp
- r43-sedna-perlage-normal.webp
- r43-sedna-perlage-roughness.webp
- r43-sedna-cutgrain-normal.webp
- r43-sedna-cutgrain-roughness.webp

网页使用的 2K 对应贴图及全尺寸银色 normal 已取得。当前发布页面效果可以重放；更高分辨率母版、Blender 文件和所有可选版本不能称为已恢复。缺失清单见 `artifacts/kimi-imports/open-heart/optional-full-resolution.json`。

手表清单声明模型为 k3-3d-atlas 自建，本轮保留该声明，不把它当作独立来源核验结论。源运行代码有固定核心组，自己的检查报告记为 117 个固定单元；不能将展示顺序解释为工厂维修程序，概念陀飞轮也不能描述为原机芯事实。

打字机源码保留了参考照片轮廓、推测尺寸及参数化重建说明，列出 TM 37-305、AMES、Smith-Corona 和 Things Come Apart 等参考，明确不是工厂 CAD。这些信息应跟随资源记录保留。用户对自有项目的确认允许本轮迁移工作，但不应据此改写参考素材说明；本轮没有公开同步资源。Three MIT 许可已保存为 `artifacts/kimi-imports/THREE-r160-LICENSE.txt`。

## 独立本地重放与证据

本地副本位于 `artifacts/kimi-imports/typewriter/` 与 `artifacts/kimi-imports/open-heart/`，原入口保留为 `index.source.html`。`index.html` 仅省略不参与模型展示的外部 Kimi 平台 SDK；模型、动作代码、标记和来源注释保留。

浏览器使用 Edge / Playwright，1440×1000。对非 `http://127.0.0.1:5183` 的 HTTP(S) 请求设置阻断：两页 ready 成功、页面异常 0、失败请求 0、外网请求 0。这里只验证所执行流程，不等于每个配色及全部演出章节通过。

- 打字机：整机进度 0、展开 0.55、平铺 1.0 与零件 0 聚焦核对；调用返回全景及击发。截图 `local-assembled.png`、`local-exploded.png`、`local-knoll.png`。
- 手表：Intro 与 Disassembly 章节，加载完成后截图 `local-assembled.png`、`local-exploded.png`。源网页的 `audit.ok` 为自身重装配检查结果，不是本轮独立的全机械验收。
- 手表页面有一个 WebGL `watch-canvas` 和一个 2D `reference-backdrop`。两张 DOM Canvas 不代表两套 WebGL renderer；这次独立页面不是 Trees X 工作台场景，也没有修改现有唯一 TresCanvas。

原始捕获曾遇到 Chromium 大响应缓存淘汰，机芯文件已由直接流式下载补齐并记录摘要；GLB 内部图片生成的 blob URL 不需单独下载。保留原始捕获错误记录，以最终全本地重放结果判断运行依赖是否齐备。

证据文件：`inventory.json` 为全文件字节/摘要/来源与 GLB 元数据；`local-validation.json` 为两页本地运行记录；`settled-heart-validation.json` 核对加载层退出及唯一 WebGL 画布；机芯补取记录为 `open-heart/movement-download.json`。

启动本机候选查看器：

```powershell
node .tools/serve-kimi-imports.mjs
```

访问 [本地打字机](http://127.0.0.1:5183/typewriter/) 与 [本地手表](http://127.0.0.1:5183/open-heart/)。该工具和下载资源在 Git 忽略目录中，仅为本机检查候选；未形成跨机器交付包。

## 工作台迁移建议

优先迁移打字机，因为它直接补强既定三件商品中的机构案例。手表先保留为独立候选/材质流程参考，不自动添加到音箱、打字机、汽车的正式目录，也不据此改变开题范围。

1. 从源项目提取几何、部件编号、语义分组、基准姿态和多阶段目标，先制作装配态 GLB；保留原始代码及数据作为对照。不能仅导出整机后丢掉 572 个零件的映射和击发关系。
2. 在 `src/lib/workbench/` 的异步适配器通道加载，映射到现有 `SceneAdapter.root/nodes/pose/apply/point/dispose`。TresCanvas、相机和 OrbitControls 继续由工作台拥有；不复制源项目的 renderer、全局监听或无限 requestAnimationFrame。
3. 源打字机是装配→展开→平铺，手表还含模块/紧固件的中间路径。当前 v3 的单段位移/旋转轨道不能完整表达两套演出；先确定注册行为或多阶段扩展方式，并做确定性/复原测试，再更新配置契约。不能把数据库脚本当动作执行。
4. 原页面滚轮/拖动推进演出与工作台滚轮缩放冲突。保留模型姿态函数，将展示进度与导演相机分开：鼠标自由观察、面板按钮触发动作、手动导览触发命名步骤。技术进度接口可保留，正式 UI 不必常驻百分比滑条。
5. 击发、分层、选择、高亮和热点跟随统一绑定业务部件；动作从基准计算。接管/隐藏暂停，切换取消，迟到释放，所有共享几何、纹理和动画保留唯一释放方。
6. 在工作台重新验收全景/近景/动作、连续复原、快速切换、真实 API 和管理预览。只有通过后才替换商品配置；本轮重放不能算作 C2 或手表正式质量通过。

本轮前端运行时、后端 API、数据库和正式目录均未改动；仅新增候选备份、检查证据与本文。

工程检查：`npm run check` 通过，35 个测试文件 / 133 项测试通过，93 个 Vue 组件符合行数限制；保留旧 TypewriterStudy.vue 的 2 条属性大小写 lint 警告，无错误。`npm run build` 通过。候选资源在忽略目录，不包含于本次生产构建；正式接入后仍需工作台浏览器回归。
