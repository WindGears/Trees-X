# 音箱主动演绎样板验收

日期：2026-09-23。范围为原创桌面音箱 FORM / 01，延伸现有深色桌面展厅。代码与自动化验证完成；[最终视觉复核](../.impeccable/review/speaker-finish-review.md) 结论为 `ship`，九张必需截图有效，无需修复的视觉问题。此结论仅覆盖已批准的音箱样板，不表示全站视觉验收或发布、部署完成，也不替代用户对最终观感的确认。

## 已实现的体验

- 三盏矩形面光、方向性细纹金属、深色前板与旋钮滚花/顶面，强化可见外观的反射层次。音箱使用 Bloom 0.32、环境强度 0.42；不显示环、粒子或扫描覆盖层，其他商品保持原舞台。
- 默认展示完整音箱，仅播放 2.1 秒灯光揭示，不自动移动相机。「观看演绎」按钮主动触发 7.8 秒短片，界面显示「8 秒」。
- 章节顺序为旋钮特写 → 完整轮廓 → 外观分层 → 合拢；正常结束保留配色并交回自由探索。章节文案仅描述可见形态，不推断内部构造、制造方法或声学性能。
- 拖动、滚轮、Esc、接手按钮、面板、目录、手势入口及商品切换可以中断。中断保留当前镜头与分层进度；减弱动态的「静态欣赏」直接到完整外观。

实现入口为 `src/data/productFilms.ts`、`src/composables/useProductFilm.ts`、`SpeakerLighting.vue`、`speakerMaterials.ts`、`ProductFilm.vue` 与 `speaker.css`。相机、输入桥、材质和 loader 的所有权及清理顺序集中在 [音箱主动演绎架构](architecture.md#音箱主动演绎)，本文不另立生命周期规则。扩展其他商品时补配置与专属材料表达，复用同一 Canvas 和交接路径。

## 工程与浏览器证据

| 证据                                                                                                                                                                            | 已记录结果                                                                                                 | 解释边界                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [工程状态](../.impeccable/review/speaker-build-status.json)、[check 日志](../.impeccable/review/speaker-final-check.log)、[build 日志](../.impeccable/review/speaker-build.log) | `npm run check`、`npm run build` 均退出 0；19 个测试文件、66 项单元测试通过；59 个 Vue 文件均不超过 300 行 | 验证类型、lint、格式、架构、模型预算、单元测试及打包，不等于真人可用性验收 |
| 模型预算（同一 check 日志）                                                                                                                                                     | `form-01.glb` 为 15,924 三角形、104 primitives、891,500 bytes，预算通过                                    | 这是资产规模记录，不是帧率或所有设备性能承诺                               |
| [短片浏览器报告](../.impeccable/review/speaker-film/report.json)                                                                                                                | 三个配置镜头完成并合拢；特写接手、Esc/指针中断、配色保留、目录/手势入口/切换商品中断通过；复用原 Canvas    | 自动化合成输入与图像验证，不是摄像头前真人手势测试                         |
| 同一短片报告的交接像素比较                                                                                                                                                      | `changedPixels: 0`、`maxChannelDifference: 0`                                                              | 该次特写停止前后没有像素跳变；不外推到所有时序或设备                       |
| [11 项浏览器回归汇总](../.impeccable/review/speaker-regression/summary.json)                                                                                                    | 商品身份、渲染交接、基础浏览器、目录、体验、手势及视觉/展厅回归最终均退出 0                                | `visual-effects` 初次失败与复测均保留，见下文                              |

[浏览器总状态](../.impeccable/review/speaker-browser-status.json) 记录短片与完整回归均为 0。

`visual-effects` 初次同源断言使用字符串前缀，误判了同源 `blob:` Draco Worker。断言改为比较解析后的 `URL.origin`；[确认状态](../.impeccable/review/speaker-regression/visual-effects-confirmation.json) 退出 0，[确认日志](../.impeccable/review/speaker-regression/visual-effects-confirmation.log) 记录两个本地 Blob Worker、`externalRequests: []` 与 `sameOrigin: true`。汇总保留原始失败，未把首次运行改写为成功。该日志中的 1600 粒子属于保留原效果的回归场景，不是音箱配置。运行耗时与日志帧时间只描述当次环境，不作为音箱通用性能成绩。

## 视觉证据与状态

截图位于 [speaker-film](../.impeccable/review/speaker-film)。已核对以下实际渲染：

- 桌面完整外观：[1440×1000](../.impeccable/review/speaker-film/hero-1440.png)、[1280×720](../.impeccable/review/speaker-film/layout-1280.png)、[1920×1080](../.impeccable/review/speaker-film/layout-1920.png)。
- 演绎章节：[旋钮特写](../.impeccable/review/speaker-film/detail.png)、[完整轮廓](../.impeccable/review/speaker-film/reveal.png)、[外观分层](../.impeccable/review/speaker-film/layers.png)。特写有意裁切机身，重点是旋钮。
- 兼容：[390px](../.impeccable/review/speaker-film/layout-390.png)、[320px](../.impeccable/review/speaker-film/layout-320.png)，截图使用减弱动态静态路径。
- [外观面板与合拢后石墨配色](../.impeccable/review/speaker-film/appearance.png)：最初截图处于面板 240ms 入场中，已重拍为文字、选中状态及模型全部稳定后的画面；最终复核已确认替换后的截图与其余八张均有效。

## 后续边界

当前音箱样板已通过最终视觉复核，待用户验收后再实施赛车与绿植的专属短片。当前已有的三步导览、目录、配色和结构探索不等于另外两件商品的短片已完成。后台、上传、AI 讲解、多人空间和截图分享仍不在本轮。

真人手势稳定性、成功率和舒适度仍须真实设备验收。既有自动化结果和本轮交接验证不能代替真人结论。

## 工作区收尾

独立的 EnhancedDemo 演示页修正了坐标绑定类型，并将样式与动画逻辑拆出，满足组件行数限制。该页面不接入商品展厅路由；动画使用局部 GSAP 清理，避免影响其他场景。[最终冒烟记录](../.impeccable/review/speaker-final-smoke.json) 覆盖演示页切换、重播、试色和生产预览中的音箱短片。
