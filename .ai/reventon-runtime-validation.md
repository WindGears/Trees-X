# Reventón Three.js 实机验收

日期：2026-09-30。入口：`http://127.0.0.1:5181/?product=reventon`。

状态：**按用户 2026-09-30 最新要求，以技术验证验收：真实模型与完整导演流程已经接入且功能检查通过。** 用户明确「差不多就行」，停止追求原参考图整体材质光影等效，该项不再是本次交付门槛。现有 `browserQualityApproved:false` 保留，技术验证完成不改写为照片级质量通过。

本轮收口保留现有效果，不把临时浏览器中的反射颜色、环境旋转和补光对照实验发布为正式改动。原参考图匹配与后续性能优化均不作为本阶段未完成工作。

## 已实现与证据

| 要求                            | 当前证据                                                                  | 结论                                                                               |
| ------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Three.js 原理                   | `ReventonScene.vue`、`assets.ts`、`motion.ts`；浏览器遍历实际 Scene       | 真实 GLTFLoader / Mesh / PBR / WebGLRenderer                                       |
| 原模型完整                      | `geometry-audit.json`、`duplicate-face-audit.json`、运行时 `runtime.json` | 2,998 源对象；135 网格、1,500,363 三角形；207 面为完全重复面，未减面               |
| 原材质烘焙                      | `bake-contract.json`、各材质 manifest、公开 provenance                    | sRGB/数据通道实测通过；75 张 PNG，55 张 16 位 / 20 张 8 位，非全链路逐像素无损     |
| 运动阴影正确边界                | `bake_realtime_ao.py`、`contactShadow.ts`、展开截图                       | 每组 AO 排除其他运动组；地面影子随当前姿态计算                                     |
| 开门 / 座舱 / 分离 / 合拢       | `runtime.json` + 四章截图                                                 | 实际 Object3D 与相机变动、最终归位；7 个刚体                                       |
| 播放 / 暂停 / 章节 / 无自由操纵 | `runtime.json`                                                            | 播放推进、暂停保持、目录不重置姿态，鼠标拖动不改变相机                             |
| 失败重试                        | `lifecycle.json`，实际拦截 motion 请求返回 503                            | 显示恢复入口，重试保留 Canvas                                                      |
| WebGL 丢失恢复                  | `lifecycle.json`，实际 `WEBGL_lose_context`                               | 恢复使用原 renderer/Canvas；旧 135 个几何与 135 个材质各释放一次                   |
| 离开展品与返回                  | `lifecycle.json`                                                          | 车辆→绿植→车辆，各时刻一个活动 Canvas；返回从头开始                                |
| 资源来源                        | `runtime.json`、`publication-verification.json`                           | 浏览器请求同源；79 项文件摘要通过；75 PNG 与 JPG 元数据插入保持压缩图像数据        |
| 桌面与窄屏                      | 1440×1000、390×844、320×844 实机截图与 `runtime.json`                     | 目录出口可见/可操作、无横向溢出；减弱动态隐藏播放、保留章节                        |
| 原目录回归                      | `collection-results.json`                                                 | 六个导入样品的模型/试色/聚焦/结构/导览、回退/深链/连续切换及 Composer 暂停恢复通过 |

以上短文件名：浏览器报告和截图在 `.impeccable/review/reventon/`；烘焙与资源审计在 `artifacts/reventon/realtime/`；目录报告在 `.impeccable/review/`。报告是对应测试覆盖面的证据，不自动扩大为全部需求通过。

## 视觉复核

最终收口重新执行 `npm run test:reventon-playback`，通过且无页面错误。`playback.json` 保存实际对象/相机采样，验证四章节按顺序出现、双门与后盖/四轮共 7 组均发生连续姿态变化，以及 Home / ArrowRight / End 键盘定位。采样间隔为 100ms，采样数量不是渲染帧数或帧率成绩。

`.impeccable/review/reventon/finish-review.md` 对照原 `6-beauty.jpg`、`9-beauty.jpg` 提出四项具体修正。两轮集中修正后的 `fix-verdict-2.md` 为 **ship，仅针对这四项**：

1. 接触阴影的重复条带移除，保留由当前几何产生的连续柔影和浅灰棚景层次。
2. 前挡/侧窗不再被大面积灰雾覆盖，座椅与方向盘可辨；玻璃仍有真实反射与透射。
3. 轮内金属从近白块恢复为有层次的暗金属与局部高光。
4. 390px 与 320px 均可进入商品目录并使用章节控制。

审查不证明整车达到原图摄影品质，不证明时间上的流畅性或指定帧率。当前保留 `browserQualityApproved:false`。运行时薄玻璃反射强度 0.22 是校准值，不伪称源 VRED 材质的等价公式。

## 验证命令

2026-09-30 最终执行结果：`npm run check` 通过（25 个测试文件、94 个测试；66 个 Vue 组件均不超过 300 行），`npm run build` 通过。保留两条已有打字机组件属性连字符警告与构建分包体积警告；没有错误。实机、生命周期、完整播放、目录和 render-handoff 脚本均通过各自所列检查。资源校验通过 79 项最终摘要与位深/压缩图像数据对照。

从项目根目录运行，旧脚本需要 `CHECK_URL=http://127.0.0.1:5181`：

```text
npm run check
npm run build
npm run test:reventon
npm run test:reventon-lifecycle
npm run test:reventon-playback
npm run test:collection
npm run test:render-handoff
python scripts/reventon/verify_publication.py
```

`test:reventon-playback` 单独记录完整播放过程中的真实刚体和相机采样，并验证键盘 Home/ArrowRight/End。它不渲染或交付影片。End 键将最后一个 0.01 秒刻度吸附到 383/24 秒的最终姿态。

## 未获证明的项目

- 原 beauty 图整体画质等效、全部特写材质的照片级匹配仍待验收；不以局部审查通过代替。
- 本轮没有形成指定答辩 GPU 的帧时间基准，不能宣称达到 60 fps 或其他成绩。高配桌面质量优先，没有动态降低画质。
- 当前主要桌面截图为 1440×1000；本轮没有新增 1280×720 / 1920×1080 的完整视觉矩阵。
- Reventón 为导演式独立展品，不接普通展品的自由旋转与手势控制；原手势真人验收状态不因本轮改变。
- 结构分离仅用于观察现有部件，不表示真实维修拆解次序或真实隐藏结构。
- 资源为用户提供，未补充再分发许可。详见 `public/models/reventon/README.md`。
