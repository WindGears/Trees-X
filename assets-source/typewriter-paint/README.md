# 打字机黑漆样片：制作源素材

本目录保存 2026-10-16 为 Trees X 制作的两张 GPT 原生生成图片和原创 WindGear 字形。原始图片逐字节保留；运行材质由独立 Blender 数值流程制作，不把图片明暗直接当成真实表面高度。

## 来源与真实尺寸

| 文件              | 原生尺寸         |    字节数 | 用途                         |
| ----------------- | ---------------- | --------: | ---------------------------- |
| `orange-peel.png` | 1254×1254        | 3,191,534 | 细腻橘皮的美术分布参考       |
| `polish.png`      | 1254×1254        | 1,714,783 | 克制擦拭／抛光的美术分布参考 |
| `windgear.svg`    | 1024×416 viewBox |    51,198 | 可编辑的金色连笔艺术字       |

两张图片为本项目请求生成的 GPT 图片，未使用第三方扫描材质作为输入。它们不是原生 2K、实测 PBR、扫描高度、法线或粗糙度。2048²运行贴图是后续数值制作的输出，不能倒推或宣传为源图片原生精度。SHA-256、实际格式及提示词记录边界见 `generation-record.json`。

`prompts.json` 保存实际提交给生图工具的两条完整提示词；`generation-record.json` 另保留制作规格摘要。要求正交、均匀照明、无透视、无文字、无高光／投影；细腻橘皮和轻微擦拭，不生成锈蚀、厚污垢或夸张划痕。工具内部提示改写与模型内部信息不可核验；提示词中的期望分辨率和无缝要求不当作实测结果。

## 数值材质制作

`scripts/blender/typewriter_paint_study.py` 使用 Blender Python／NumPy 读取源图，进行周期边界分解及低频照明去趋势。生成图仅作为有界弱遮罩：真正微高度来自固定种子的周期频谱，不从图片亮度恢复真实高度。

- 固定种子 `10731`，纹理周期 `0.04` 场景单位，高度量级 `0.000004` 场景单位，不声称真实商品尺寸。
- 法线由周期中心差分产生，采用 OpenGL 切线空间 +Y；比较量化后的坡度 RMS，防止超过原 v2。
- `paint-orm.png` 的 R、B 固定 1，G 为均值约 0.93 的粗糙度乘数；`paint-coat-roughness.png` 的 G 均值约 0.94。原材质标量保持，由资源装配器组合。
- 三张 2048²运行图均为 RGB8 数值 PNG，仅含 IHDR／IDAT／IEND，不含 sRGB、ICC 或 gamma 元数据，运行时应按 `NoColorSpace` 解读。
- 另保存 16 位高度、粗糙度及清漆粗糙度母版，以及打包纹理的独立 `.blend` 材质检查场景。该场景只有检查样块，不导入、重导出或修改打字机、UV、轴心、机构或动作。
- 不烘焙部件互遮挡、装配阴影或摄影棚照明。画质是否改善仍需在浏览器实机对照，不由贴图数量或分辨率判定。

从仓库根目录执行；输出目录必须不存在，不能覆盖先前母版：

```powershell
& 'I:/WindGear/blander/blender.exe' --background --factory-startup --threads 8 --python-exit-code 1 --python scripts/blender/typewriter_paint_study.py -- assets-source/typewriter-paint/orange-peel.png assets-source/typewriter-paint/polish.png artifacts/typewriter-paint/materials-rerun
```

本批实际制作输出位于忽略目录 `artifacts/typewriter-paint/materials`。实测制作环境为 Blender 5.2.2 LTS、NumPy 2.3.4。数值与输出摘要以该目录 `textures.json` 为准；制作母版不混入浏览器运行资源。

## WindGear 字形与存储方向

`windgear.svg` 是为本项目绘制的原创封闭路径轮廓，八个字母分别分组，可编辑；不依赖系统字体、网络字体或外部字形文件。文字准确为 `WindGear`，金色 `#d8b368`，W、G 带短回钩，不加图标或长尾。保持 1024×416 透明画幅。

`windgear.png` 是对应的 1024×416 正向透明 PNG，供审稿与其他制作工具使用；它与嵌入 GLB 的存储方向不同。两者都由同一 SVG 生成，原始贴片映射保持。

SVG 源稿保持人眼正常朝向。`scripts/typewriter-paint/wordmark.mjs` 只在生成嵌入 GLB 的 PNG 时执行一次垂直行翻转，匹配源 GLTFExporter 的 CanvasTexture 存储约定；不改 SVG、不二次翻转 UV。替换范围限定 `image 50 / decal-62`，其余字贴、UV、位置、alpha 及节点不动。

## 公开文件边界

`generation-record.json` 仅记录仓库相对路径和已核验摘要。不将生图工具返回的私人用户目录、临时缓存路径、令牌、会话信息或机器环境写入公开运行清单。原始生成图与 SVG 属于制作资料；运行包只装配经过核验的数值 PNG 及授权的单张铭牌，不宣称 AI 输出具有第三方扫描许可或独占版权。
