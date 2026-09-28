# 手势稳定性调查与调整建议

日期：2026-09-14。依据：用户真人反馈、当前代码审查、开源项目源代码及官方交互指南。本文件是调查结果与待实施方案，不是修复完成记录。

2026-09-18 补充：整体动作控制与反馈的新提案见 [gesture-interaction-plan.md](./gesture-interaction-plan.md)。其中旋转的有限惯性取代本文“短暂失踪不输出旋转”的旧建议；选择期间不得推测点击仍然成立。新提案尚未实施。

## 当前结论

用户明确反馈：手能识别，但指针抖动、捏合时目标丢失。优先修复手势到界面的转换层；目前没有证据证明更换关键点模型能解决这些问题。

上一版自动化验证了 Worker、生命周期和合成关键点，却没有验证真实手指在捏合过程中移动的情况。甚至把“指针全过程不离开目标”写成了成功条件，属于需要改正的交互设计。

## 从代码确认的问题

- `src/lib/gesture/detector.ts` 的选择指针直接使用食指尖坐标，没有时间平滑；旋转只有固定系数 EMA。
- `src/composables/useGestureSession.ts` 用半径 32 CSS px 命中，捏合过程任何一帧离开就清空 pendingHit，松开时还要求命中。自然捏合会移动食指尖，与此规则冲突。
- 距离直接在分别按宽、高归一化的 x/y 上计算，没有校正视频长宽比；手掌转侧时，食指根到小指根的投影宽度也会缩小，固定比值阈值容易漂移。
- 现有 0.25/0.4 双阈值及 120 ms 持续条件已经提供基础迟滞；不能把“新增迟滞”当作本次修复。需要补目标捕获、平滑、校准和清晰反馈。
- 一帧关键点为空就清空状态，没有短暂遮挡容错。缺帧时应暂停动作，不能预测点击或把丢失当松开。

## 可借鉴的来源

1. [Map Gesture Controls 项目](https://github.com/sanderdesnaijer/map-gesture-controls)：浏览器 MediaPipe 手势控制，分离识别与状态机，并提供持续确认、释放宽限、死区和平滑。参考其结构，不直接照搬地图动作与全部依赖；README 与部分源码的手势映射存在差异，后续采用代码时应锁定提交并核验。
2. [其状态机源码](https://github.com/sanderdesnaijer/map-gesture-controls/blob/main/src/GestureStateMachine.ts)：通过时间条件切换状态，非稳定手势期间不输出移动量，支持释放宽限与 EMA。
3. [One Euro Filter 作者实现与调参说明](https://gery.casiez.net/1euro/)：低速压制抖动，高速减少滞后；提供作者验证的 TypeScript 版本。需要按坐标单位与真实时间戳调参，不能认为套上滤波器就没有延迟。
4. [Ultraleap UI 指南](https://docs.ultraleap.com/TouchFree/touchless-interfaces/ui-components.html)：建议小目标附近软吸附，并以悬停、按下和进度反馈表达交互状态。这里借鉴交互原则，不把专用硬件成绩当普通摄像头成绩。
5. [Ultraleap Pinch Detector](https://docs.ultraleap.com/xr-and-tabletop/xr/unity/plugin/features/pinch-detector.html)：捏合和松开采用不同阈值，支持明确的开始/持续/结束状态；本项目已具备基础双阈值。
6. [Ultraleap Hover & Hold](https://docs.ultraleap.com/TouchFree/touchless-interfaces/interactions.html)：可调整的悬停确认适用于按钮选择，可作为替代交互进行比较。
7. [Google Hand Landmarker Web](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)：x/y 分别按图像宽高归一化，提供 world landmarks；存在与跟踪阈值影响重新检测，阈值不是越高越稳定。

## 建议实施顺序

1. **先建立诊断视图。** 本地显示手部骨架、原始与过滤后指针、捏合比值、目标捕获状态、失踪时长和有效更新频率。默认不保存视频；诊断数据导出须由用户显式触发。
2. **稳定瞄准。** 使用按真实时间戳更新的 One Euro；给热点增加可见悬停反馈和更宽的吸附区，使用进入/退出不同边界。可先试 64 px 进入、96 px 退出，属于实验初值，不是已验证标准。
3. **重写目标捕获。** 稳定悬停后记住候选目标，捏合开始时捕获该目标。捏合期间指针锚在目标，允许手指自然收拢；有效松开后确认捕获目标，不再要求食指尖回到原 32 px 圆内。明显移开、超时、长时间丢手、切换模式或鼠标接管取消；短暂丢帧只能冻结，不得触发确认。
4. **校正几何与阈值。** 先按实际视频尺寸校正 2D 距离尺度，再比较多个掌部尺度归一化与 world landmarks 的稳定性。提供简短的张开/捏合校准，拒绝不充分样本，不盲目放大阈值。保留双阈值及防重复触发。
5. **单独改善旋转。** 以多个掌部点的中心驱动相对旋转，开掌状态加入时间容错；新入镜建立新基线，停手后不继续滑动。短暂失踪不输出旋转。
6. **用真人任务验收。** 同一人、同一距离与光照下比较旧版和新版，各进行 20 次明确选择；另做自然移动但不选择的试验，分别记录成功、取消、误触与完成耗时。至少比较两种光照及左右手。不能用合成坐标通过替代这个验收。

## 是否更换方案

| 方案                              | 判断                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MediaPipe + 修正后的交互层        | 优先；直接对应已定位的问题，保持现有 Vue/TresJS 和本地处理架构                                                                                                                                   |
| MediaPipe Gesture Recognizer      | 可用于以后更丰富的静态手势；官方预置类别没有 pinch，仍需要自定义或几何判定，不能直接解决目标丢失。见[官方类别](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer) |
| TensorFlow.js hand-pose-detection | 支持 MediaPipeHands 及不同运行时，更换包装层不等于换成更可靠的手部模型；暂无理由迁移。见[官方 README](https://github.com/tensorflow/tfjs-models/blob/master/hand-pose-detection/README.md)       |
| Ultraleap TouchFree               | 使用专用追踪摄像头与本地服务，适合以后固定展台实验，不满足当前普通摄像头直接访问网页的部署前提。见[产品架构](https://docs.ultraleap.com/TouchFree/touchfree-user-manual/index.html)              |
| 悬停确认                          | 可选备用：热点停留并显示进度后确认；应与优化后的捏合做真人比较，不直接替换用户希望保留的捏合体验                                                                                                 |

GPU Worker 是后续性能对照项。[Google 示例](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/hand-landmarker.worker.ts)支持 CPU/GPU delegate。应测手部实际存在时的稳定推理、主场景帧时间与有效输入频率，不能将前轮空白帧 93 ms 视为真人 FPS，更不能保证改 GPU 就一定改善。当前用户明确的主要问题是抖动与目标捕获，因此先修交互层。
