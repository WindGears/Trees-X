# 亮银细边来源隔离（2026-11-01）

## 范围与结论

亮银选择已经在外观面板接入。本批只扩展可重复的后台诊断，不修改生产
材质、模型、灯光或渲染管线。目标是避免把原生高光细边误判为 SSR 噪声。

同一冷白棚 r14、silver、MSAA、Cycles 环境、DDGI、主软箱阴影，完成：

| 记录目录（artifacts/car-showroom 下） | 对照                                   | 结果                     |
| ------------------------------------- | -------------------------------------- | ------------------------ |
| silver-signal-isolation               | 关闭 SSR、GI、两者、AO，以及恢复       | 12 张图；工程通过，错误0 |
| silver-surface-isolation              | 原生画面、仅正面、无车漆镜面，以及恢复 | 10 张图；工程通过，错误0 |
| silver-finish-comparison              | 粗糙度0.19/0.26/0.32/0.38，以及恢复    | 10 张图；工程通过，错误0 |
| silver-sampling-isolation             | DPR1.5：完整/原生/恢复                 | 6 张图；工程通过，错误0  |

前三组实际输出1440×1000。最后一组保持1440×1000 CSS视口，实际输出
2160×1500，单独记录pixelRatio；这是采样诊断，不是正式分辨率或性能验收。
所有组检查相机、灯光、环境身份、实际材质输入、唯一Canvas/renderer及恢复。
所有报告仍为visualPassed=false；这些静帧不能证明运动中无闪烁或实际呈现FPS。

审阅结果：

- 关闭SSR/GI仍保留车门、车头与车顶接缝附近的亮细边，不能用SSR降噪单独解决。
- 仅绘制正面没有明显消除这些边，未获得关闭双面的修复依据。
- 去除车漆镜面后细边明显减弱，但同时失去目标金属质感；这只是定位，不是候选。
- 提高粗糙度扩大高光，亮细边和侧板偏黑仍在，因此保留原silver参数，不晋级粗糙度变化。
- 增加像素密度使部分细边更细，但没有消除亮边本身；不能据此认定提高分辨率或TAA即可修复。

原生镜面、模型边界及采样共同作用仍需进一步定位。以上结果没有证明全部
亮边都是错误，也没有证明SSR完全没有颗粒；禁止将某一关闭项的截图当作独立
可相加的光照分量。无镜面模式同时改变metalness/clearcoat及对应材质分支。

## 源几何检查

新增只读工具 `scripts/reventon-showroom/paint-normal-audit.mjs`，先校验清单
SHA-256与GLB头/访问器边界，再统计四处20159车漆三角形。原包不写入、不改法线。
运行GLB摘要：89f4595315f3c4c7cf46a09b162559e9ac21cdfa1410c3978826f3517dcaa919。

四组共57761个三角形；非有限法线、明显非单位法线、退化三角形以及组内按
1e-6量化的重复位置三角形均未发现。检测到少量法线与几何面方向不一致及
大角度顶点法线变化；统计包含不可见内侧，没有屏幕可见性权重，不能据此
删除面、全局重算法线，也不构成全车无穿插证明。完整数值在normal-audit.json。

## 重跑

已有生产服务启动后，以PowerShell执行（GPU任务串行）：

```powershell
$env:TREES_PAINT_STUDY='silver'
$env:TREES_PAINT_AUDIT='surface' # silver / sampling；不设时检查SSR/GI/AO
$env:TREES_PAINT_PIXEL_RATIO='1' # sampling对照明确设置1.5
$env:TREES_PAINT_OUTPUT='artifacts/car-showroom/silver-surface-isolation'
node scripts/reventon-paint-lighting-check.mjs
node scripts/reventon-showroom/paint-normal-audit.mjs
```

浏览器使用headless Edge，不打开或抬升用户窗口。报告与图片仅在忽略的
artifacts目录；无新增生产pass/资源/时钟。正式默认与整体摄影棚验收状态不变。

本批 `npm run build` 通过。`npm run check` 的类型检查和ESLint通过，
格式阶段仍被用户已有 `PERFORMANCE_OPTIMIZATION.md` 阻断，未修改该文件；
该命令后续单测步骤没有运行，不将上一批974项成绩记作本批重跑。
改动的工具和文档独立Prettier检查通过，几何审计及四组真实浏览器检查完成。
