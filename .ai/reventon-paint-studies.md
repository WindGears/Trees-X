# 汽车漆面研究与样片（2026-10-30）

## 依据与定位

用户提出车漆选色影响质感，要求查阅兰博基尼配色及漆面特性。研究与当前冷白
摄影棚收束同时进行，不进入世界空间反射节点，不改默认入口或商品配置。

- [Reventón 原厂发布资料](https://preview.thenewsmarket.com/Previews/lamb/DocumentAssets/267670.pdf)
  说明 Coupé / Roadster 都采用含金属颗粒的哑光灰，但灰色不完全相同。
- [Huracán EVO 官方资料](https://preview.thenewsmarket.com/Previews/lamb/DocumentAssets/540356.pdf)
  将 Arancio Xanto 描述为四层颜色。不能据此推断具体每层配方。
- [历史涂装资料（2014）](https://pds.ppgaccess.com.au/docs/OEM%20APPROVALS/LAMBORGHINI-TEC_PAINTING%20MANUAL_OEM_LAMBORGHINI_05-11-2014.pdf)
  区分金属、珠光、Xirallic 及哑光清漆，不代表当前全系可订配置。
- [Three Physical](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) 支持底层与
  清漆分别控制粗糙度；其普通金属度参数并不等价汽车效应颜料浓度。

结论：原厂哑光复原与概念图的亮面展示漆是不同目标。深灰车身和深灰墙地
容易失去明度区分，但选色不能替代侧板反射覆盖及摄影棚空间修复。

## 实现

`carPaintStudies.ts` 集中保存艺术样片参数；只通过已核验汽车、WebGPU、
`carQuality=studio&carShowroom=cold-studio` 精确门控，使用原四个20159漆面。
`carStudioMaterials` 保存并恢复原颜色、金属度和清漆参数，借用纹理和几何。
适配器仅在舞台挂载成功后提交候选复原色，失败不污染旧状态。

| carStudioPaint | 定位               | sRGB底色 | 金属度                  | 底层粗糙度 | 清漆 | 清漆粗糙度 |
| -------------- | ------------------ | -------- | ----------------------- | ---------- | ---- | ---------- |
| graphite       | 原深灰对照         | #484b4f  | 保持原值（核验资产为0） | 0.30       | 0.65 | 0.13       |
| metallic       | 缎光金属灰演绎     | #7b7e83  | 0.65                    | 0.30       | 0.65 | 0.13       |
| matte          | 原厂风格哑光灰演绎 | #777b79  | 0.35                    | 0.44       | 1    | 0.42       |
| orange         | Xanto方向亮橙演绎  | #e96708  | 0.20                    | 0.32       | 1    | 0.09       |

这些数值不是原厂色卡、反射测量或完整多层颜料模型；颜色未作光谱匹配。
不增加随机闪点、微表面纹理、渲染目标、采样预算或新绘制循环。
不下载外部图片进入运行包，不改原模型、贴图、数据库或公开API。

## 验证记录

前序 `paint-lobes-r14` 与 `paint-metallic-r14` 隔离保留在忽略的 artifacts 中。
前者分别检查清漆与黑底色响应，后者区分提高金属度、浅化底色及其组合。
它们不属于可相加的光照分量分解；后处理与清漆透过率会改变最终画面。

本批使用 `TREES_ROOM_PAIR=paints` 运行 `reventon-compact-room-check.mjs`，
顺序加载四个显式候选，保持 r14 灯光、曝光、HDR 和八个镜头/动作状态。
程序核对实际材质参数、非车漆材质一致、相机一致、1440×1000、单Canvas和
同一页renderer身份。截图仅是静态状态证据，不证明持续运动或呈现帧率。

相关35项单测、全量968项单测、架构检查、模型校验及49/23/36/14项工具测试通过。
`npm run check` 的类型检查和ESLint通过，格式步骤被用户已有
`PERFORMANCE_OPTIMIZATION.md` 阻断，该文件未修改；后续检查已独立运行。
生产构建及 `demo:prepare` 通过（2026-10-31T07:13:14.052Z），真实API启动成功。

2026-10-30 的首次四组截图任务在 metallic 之后中断，句柄与进程已不存在，
没有最终报告，不能算通过。2026-10-31 使用独立 `paint-studies-complete` 目录
重新完整执行；脚本增加中间检查点，仅最终全组断言后才置 `passed=true`。

已审阅缎光灰与哑光灰全景/侧面：缎光灰增强车头和翼子板亮部，哑光灰高光更宽，
但更接近均匀涂层；下半门板、侧裙、轮胎仍偏黑，空间照明尚未达到概念图。
不能将提高金属度视为问题已解决，也不能将原厂风格演绎标为原厂复原通过。
完整32张截图与四组一致性断言通过（`paint-studies-complete/report.json`，
`passed=true`、`visualPassed=false`、错误0）。橙色提高车身/墙地区分与侧板可读性，
开门和分离保持；仍偏均匀有色涂层，缺少真实效应颜料层次，不能认定达到概念图。
局部近景仍有边缘噪点、玻璃遮挡和座舱暗部问题。
用户实机验收未完成，整体摄影棚未通过，不切默认。

亮橙短测 `paint-studies-performance/report.json` 通过，错误/失败请求均0；
1440×1000、全效果、后台Edge、GPU查询开启，三段各30秒。单次启动观测可互动
33.554秒，增强就绪54.293秒，不是冷缓存多次统计，也不是跨机器承诺。

| 操作 | 提交吞吐/秒 | JS提交间隔中位/P95（毫秒） |
| ---- | ----------- | -------------------------- |
| 绕行 | 46.36       | 21.3 / 25.8                |
| 双门 | 37.24       | 26.1 / 32.6                |
| 分离 | 36.93       | 26.2 / 33.8                |

GPU timestamp原始pass分组另存报告，不和上表混称：匿名compute组中位8.192毫秒、
P95 10.617毫秒，无法单凭匿名组名称判定全部属于哪种算法；canvas输出pass中位
0.0655毫秒也不代表整帧GPU耗时。实际屏幕呈现未测，30FPS目标仍待验收。
本批没有新增光追、纹理或pass，不能从一次短测宣称性能提升或所有运动无拖影。

对照页：`http://127.0.0.1:5181/artifacts/car-showroom/paint-studies-complete/index.html`。
该页包含四个完整实机链接；每组只改 `carStudioPaint`，其余使用冷白棚 r14、
Cycles静态环境、汽车动态平面倒影、DDGI、主软箱阴影、MSAA、satin轮组和local座舱。
截图及报告保留在忽略目录；构建会清除dist中的验收页，交付时从原目录复制。
