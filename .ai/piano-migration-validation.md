# 钢琴源恢复与工作台迁移验收

2026-10-09。用户确认该网页为本人创建的项目，原文件丢失；要求迁入现有工作台，保留打字机首页、钢琴加入目录。

## 已实现范围

- 入口 `?product=piano-cfx`，目录顺序为打字机、钢琴、汽车流程样板。打字机数据与默认首页未改。
- 真实 Three.js GLB、PBR 材质、剖切封口、透明层次及形变，沿用唯一 TresCanvas / renderer，不使用 iframe、影片或第二个渲染器。
- 八段：整机 → 剖切 → 键盘 → 击弦机构 → 弦列与铁板 → 音板与弦桥 → 制音器与踏板 → 全部平铺。可直接选择章节、暂停、继续、反向返回或复原；结构按钮不移动相机，章节取景由用户独立触发。
- 完整 823 个建模单元可检索、分组、分页、拾取、聚焦，热点关联当前可见 section / flat 表面。八个重点标记按需显示，聚焦时收起舞台介绍，顶栏仍保留商品名。
- 原始黑色与象牙白两种展示配色、真实模型封面、九步主动导览（八章加返回整机），保留鼠标、滚轮、键盘及已有复位语义。
- 配置通过现有管理员会话 / CSRF API 保存到真实 MySQL，创建“乐器”分类，无新迁移、无匿名写接口。修改前配置保存在 `artifacts/piano-migration/backups/`。

## 原文件恢复与实际资源

源页面：[用户自有 Kimi 钢琴](https://k3-piano-cfx.ok.kimi.link/sound-path.html)。原网页是程序化 Three.js 建模和参考轮廓重建，不提供原始 Blender 或 GLB。已备份 HTML、源模块、轮廓、命名、说明、样式、原 Three/controls/environment 及参考图至 `artifacts/kimi-imports/piano-cfx/`；这是本机恢复资料，Git 忽略，不是正式运行依赖。原参考照片没有放入运行包。

离线重放源流程后导出 section 与 flat 两套可见表现、原生动画及透明度曲线。运行资源在 `public/models/bundles/kimi-piano/v1/`：

| 项目                         |            实测值 |
| ---------------------------- | ----------------: |
| 语义建模单元                 |               823 |
| 渲染网格 / 线对象            |        5,527 / 21 |
| 三角面（包含剖切与平铺表现） |         1,198,962 |
| 材质                         |             5,548 |
| 原生动画通道                 |             2,461 |
| 透明度曲线                   |                93 |
| 形变网格                     |                34 |
| GLB                          | 122,625,304 bytes |
| rig.json                     |   1,869,428 bytes |
| 清单引用运行文件合计         | 124,494,732 bytes |

GLB SHA-256：`13c191f8144433c90a60899435c07e6a6cdfce52ee5f673337bf5189b8908e1f`。manifest SHA-256：`fdb2cc50cbee9b677c23aa677553742292f087db19a1d7172b3daab04268df06`。2026-10-09 按用户的 GitHub 同步要求补记所有者授权，GLB 与动作文件未变；参考照片仍不在运行包中，不推定额外的下游许可。

没有减面、缩纹理或改变源部件形态。修复旧 Three r160 材质经 r185 导出时生成的空 dispersion 扩展，GLB 二进制几何/纹理/动画字节保持一致；未发布的修复前副本保存在 `artifacts/piano-migration/pre-publication-metadata/`。`asset:check` 为 0 errors、0 warnings，包内 `validation.json` 是完整记录。独立预算不套历史 10 万面上限。

封面 `public/covers/workbench/piano-cfx-real.png` 来自现有真实 renderer，960×720；来源、字节数与摘要见同名 JSON。原始网页没有音频播放资产，本次不增加弹奏声音，也未建立或修改 Blender 场景；本轮不需要 Blender MCP。

## 配置、控制与释放

兼容 v1/v2 与既有 v3 tracks，新增注册适配器 `piano-v1` 与 `piano-sound-path-v1` 程序。钢琴配置须为 v3，单一进度程序与结构 ID 匹配，不能混入未验证动作/轨道/explosion；不执行数据库中的代码。API 和数据库结构沿用。

模型动作以 0.01 源时间间隔采样（0—7），原生 AnimationMixer 依据归一化进度定位 TRS 和 morph；GSAP 只补间统一进度，完整自动行程配置为 21 秒，不自动播放。透明度与可见性按同一进度计算。观察接管暂停结构，关闭面板保留状态，页面隐藏暂停，WebGL 恢复后保持当前检查点且不自动继续。

loader 唯一释放 geometry/material/texture；适配器恢复高亮、解绑 mixer；loadAdapter 释放 PMREM；控制器释放 GSAP、相机和输入监听。热点局部边界在初始化时求值，只转换当前可见表面的预计算边界。Tailwind 扫描限定为 src，避免开发工具扫描大 GLB 导致启动等待；不降低运行画质。

## 验证证据

| 检查       | 结果 / 证据                                                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 前端       | `npm run check`：39 文件 / 186 测试；`npm run build` 通过。两条历史 TypewriterStudy.vue 属性连字符 warning 保留。                                                                                                                                                                                            |
| 后端       | `npm run server:test`：真实 MySQL，30 测试，0 failure/error/skipped；包括新增19个钢琴契约测试与已有管理、安全、迁移和持久化。                                                                                                                                                                                |
| 单元       | 实际 rig 的823单元验证；真实 Three 小夹具101点正反一致、50轮复原、终点回退、热点/anchor/拾取、高亮与唯一释放。小夹具不冒充整台钢琴。                                                                                                                                                                         |
| 源模型对照 | `scripts/piano-source-check.mjs` 实际 GLB 对照原网页101点，2427 TRS通道、34 morph轨道、5548表面透明度曲线；33个可见形变网格272顶点探针、3752次顶点比较。最大位置误差3.272×10⁻⁶、旋转1.529×10⁻⁶ rad、形变顶点1.107×10⁻⁶，符合声明Float32容差。见 `artifacts/piano-migration/source-consistency/report.json`。 |
| 工作台     | 真实API、非夹具：823语义节点、八章、无滑条、暂停继续/反向复原、形变、相机独立、检索/分组/分页/热点、九步导览与键盘接管、隐藏暂停及真实WebGL恢复、同源请求，无页面/控制台错误。见 `artifacts/piano-migration/runtime/report.json`。                                                                           |
| 生命周期   | 三轮钢琴↔打字机↔汽车、返回/前进、快速选择、迟到响应隔离、GLB失败明确重试；同一Canvas/renderer，无refresh。见 `artifacts/piano-migration/lifecycle/report.json`。                                                                                                                                             |
| 生产构建   | 三件目录的实际配色/结构像素变化、导览、错误重试及legacy往返通过。见 `.impeccable/review/workbench/production.json`。                                                                                                                                                                                         |
| 首页兼容   | 真实API `npm run test:typewriter` 通过：572部件、联动、分层/平铺、检索聚焦与唯一Canvas，无错误。                                                                                                                                                                                                             |
| 视觉       | 1280×720、1440×1000、1920×1080、390/320px及近景、六个结构状态、目录、导览/手机面板，共16张。证据 `artifacts/piano-migration/visual-final/` 与 `.impeccable/review/piano/`。一批检查、一批修正、一轮确认；独立 finish review 为 ship，仅本次钢琴扩展。                                                        |

第二/三轮暖机 renderer 计数稳定：钢琴 2131 geometries / 6 textures / 12 programs，打字机 279 / 56 / 10，汽车样板 31 / 4 / 4。它们不是显存MB、帧率或20分钟稳定性成绩。

设计检测运行一次；stdout 经工具截断，不能宣称完整零发现。已显示 advisory 为 main.css 历史颜色，本轮该文件仅修改扫描目录。详情 `.impeccable/review/piano/detector-note.md`，独立审查核对实际diff与16截图。普通扩展继承已有视觉世界，未改 DESIGN.md / design sidecar；文档交接见 `piano-design-documentation.md`。

## 复现与限制

实际停止并重启本机8089后，钢琴823部件和完整DTO、打字机DTO与目录排序完全一致，Flyway版本仍为6。证据 `artifacts/piano-migration/persistence/report.json`。钢琴GLB超过常规Git单文件大小，已添加独立Git LFS规则；本轮未提交或推送，后续拉取这件运行资产需要Git LFS。

启动真实前后端后：

```text
npm run test:piano
npm run test:piano-lifecycle
npm run test:piano-visual
npm run asset:check -- public/models/bundles/kimi-piano/v1/manifest.json
```

源对照另需本机备份文件与 `npm run source:kimi`（5183），然后 `npm run test:piano-source`。`asset:piano-import` 是离线制作工具，不是页面运行依赖；生成目录不得覆盖旧版本。新库通过 `scripts/apply-piano.mjs` 先校验、再显式 `TREES_APPLY=1` 安装，正常本机启动无需重复安装。

源动画的101点检查落在0.01采样网格上，不表示所有任意时间与原解析函数数学等价；采样间使用连续插值。原网页隐藏 flat 缓冲的历史状态不影响当前可见流程，报告明确初始化顺序。一个始终隐藏的形变网格没有可见顶点探针。原源数据的7个开放剖切轮廓仍记录，不能称完整水密工业模型。

本轮未恢复不存在的 Blender 母版、工厂装配关系、真实声学或音频；823是建模单元数。精细汽车迁入统一工作台、联合20分钟稳定性和形成性真人任务测试仍是后续阶段，不以本次单件验收替代。
