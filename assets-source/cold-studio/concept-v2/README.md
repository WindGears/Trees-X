# 冷白摄影棚 concept-v2 制作记录

工具：OpenAI 内置 image_gen，2026-10-22。参考：用户本轮提供的冷白汽车摄影棚概念图，仅提取地面与墙面的美术方向，不将整张概念图贴到场景。

## 输出与用途

- `floor-albedo.png`：原生 1254×1254，石墨灰细纹石材底色。
- `wall-albedo.png`：原生 1254×1254，低对比炭灰细喷涂墙面底色。
- 两张原件保存在本目录；运行副本位于 `public/studio/cold-studio/concept-v2/`，字节保持一致，未声称原生 4K。
- normal / roughness：由 `scripts/create-cold-studio-maps.mjs` 确定性制作的 1024×1024 周期微表面；不是实测材质，也不是将生图明暗直接解释成高度。OpenGL 切线空间，线性数据。底色为 sRGB。
- SHA256、字节数和真实尺寸见运行目录 manifest.json。生成内容记录为 AI 生成资产，不冒用 Poly Haven 的 CC0 声明；旧扫描材质不作为本候选的运行依赖。
- 地板为单一合并网格，砖宽 1.8 场景米、缝宽 0.002 米、缝底低 0.003 米。每砖转向变化并由真实接缝截断，不能把提示词中的 seamless 当作经过检测的无缝保证。

## Floor prompt

Use case: photorealistic-natural. Asset type: production game-environment BASE COLOR texture master, square highest available native resolution. Input image is STYLE REFERENCE ONLY, specifically the dark grey stone floor beneath the car. Generate one full-bleed perfectly orthographic top-down flat material swatch of honed charcoal limestone / fine architectural porcelain stone, covering about 1.2 metres of surface. Match the reference's subtle cloudy mineral mottling and delicate stone microstructure. Neutral graphite-grey with restrained light grey wisps, NO brown/rust, NO speckled asphalt/gravel, no strong white marble veins. Flat diffuse cross-polarized appearance; absolutely no directional lighting, no highlights or specular reflections, no shadows, no baked ambient occlusion, no vignette or gradient. Consistent even exposure across whole image. Seamless opposite edges, organic pattern without obvious repeated motifs. NO grout, NO tile border: those are separately modelled. NO car, room, lamps, perspective, text or watermark. This is albedo only, not a rendered floor and not a multi-map contact sheet. Fine clean detailed surface, photography-level texture, subtle variation suitable for a premium automotive studio. Output a single square texture.

## Wall prompt

Use case: photorealistic-natural. Asset type: square production BASE COLOR texture of premium automotive photography-studio cyclorama wall. Reference image only guides the nearly smooth charcoal black walls; do not generate the room or car. Highest native resolution. One full-bleed orthographic flat swatch covering 1.5 metres of very fine sprayed mineral paint, uniform cool-neutral graphite charcoal, average sRGB near #44464a. Extremely understated microscale paint grain, subtle almost invisible low-frequency tonal variation (about +/-3%); elegant restrained surface, not coarse plaster. Cross-polarized diffuse-albedo photography with totally uniform flat illumination, no highlights, no shadows, no AO, no reflections, no gradient, no vignette. Seamless opposite edges. No seams, joints, edges, architectural objects, lamps, car, text, watermark. No large mottled patches, no dirty concrete, scratches, cracks, veins, streaks, pores, rustic patina or brown color. Entire image is the wall's material only, not a scene or multi-map grid. Fine photographic texture that will remain quiet behind the car.

## 重新生成技术贴图

保留本目录两张image_gen原件，将它们原样复制到运行目录，再执行：

```powershell
node scripts/create-cold-studio-maps.mjs
npx prettier --write src/lib/workbench/rendering/carShowroom/assetRecords.ts public/studio/cold-studio/concept-v2/manifest.json
```

固定种子的周期多尺度颗粒只生成技术贴图，不重画底色。颜色、OpenGL法线方向和粗糙度范围明确分开；法线不代表扫描测量值。实机近景和资源摘要均需重新核对。
