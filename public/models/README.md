# FORM / 01

`form-01.glb` 为本项目程序化制作的原创桌面音箱概念模型，用于演示加载、材质、灯光与相机交互，不对应真实在售商品。无第三方模型或纹理。

- 重建：`npm run model:generate`
- 检查：`npm run model:check`
- 结构分析：`npm run model:inspect`
- 源码：`scripts/create-demo-model.mjs`
- 命名：Chassis、Front_Baffle、Woofer__、Tweeter__、Volume_Dial、Rear_*。后续部件交互应引用这些稳定名称。
- Y-up，无外部资源，无压缩扩展；loader 会统一中心与大小。

2026-09-22 音箱样板更新：完整 UV、72 条旋钮滚花、顶面指示槽和紧固件槽口。滚花与顶面是 Volume_Dial 子节点，结构展开沿用原父子关系。15,924 三角形、104 primitives、891,500 bytes。SHA-256：`e6dfc2bfefadaf4ea2813f224c9a40d314f1cb574ff6b0dd3d43945c0ccd8ad7`。运行时拉丝粗糙度图由本站固定种子生成，无新增第三方素材。

替换时修改 `src/data/products.ts` 并补充资产来源、授权、三角形、大小和压缩说明。模型使用者可随本项目使用、修改和再分发该原创样品。
