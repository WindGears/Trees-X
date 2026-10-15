# 暖琥珀环境素材：生产提示词 v1

2026-10-15。用户批准按 A 方向生成素材。本文件记录内置 image_gen 的完整提示词，生成成功仅表示得到候选母版；投影、接缝、PBR 通道、实机效果分别验收。

## 共同约定

- 风格参考：A「暖琥珀」概念图，由本项目此前使用内置 image_gen 生成。来源文件：exec-1c9e3bf3-e7bc-4965-876a-6b9edfce76dc.png。
- 全景为 LDR 可见背景候选，不称作 HDR 照明环境；不把转换文件格式当成恢复动态范围。
- 岩板只交付 baseColor 候选，不把颜色亮度直接等同于物理高度、法线或粗糙度。
- UI 图用于视觉参考，生产控件由 Vue/CSS/SVG 实现。
- 保留原生文件，不做静默放大或裁切；任何修订另存并记录。
- 本节点不接入生产舞台、不改数据库和既有资产。统一相机、背景球面与石纹平铺检查后，再决定运行版。

## 暖琥珀酒吧：360°清晰背景母版

```text
Use case: photorealistic-natural / production environment texture.
DELIVERABLE: ONE full-spherical equirectangular 360-degree interior panorama, strictly 2:1 width:height, largest native 2:1 landscape output available. The ENTIRE raster is the spherical texture; no frame, contact sheet, captions or layout. This is an LDR COLOR BACKGROUND MASTER, not an HDR file, not a UI mockup, and not a perspective photograph.
REFERENCE ROLE: The attached Trees X image is a mood reference ONLY for its restrained amber lighting, espresso/charcoal interior and cozy distant shaded lamp. Completely remove the typewriter, display plinth, foreground table, interface, words, logos and icons from the new asset. Do not reproduce the screenshot composition or any baked foreground object.
SPHERICAL CAMERA CONTRACT: one level omnidirectional camera in the empty center of a small upscale lounge; camera height approximately 1.2m; 360 degrees longitude across the horizontal axis, north pole/ceiling at the top, south pole/floor at the bottom, horizon exactly half image height. Use true latitude-longitude/equirectangular projection, not a 180-degree ultrawide photo, not a duplicated mirrored room, not a cubemap cross. Continuous architecture around all 360 degrees. Vertical distortion approaching the poles follows spherical mapping. LEFT and RIGHT edges represent the SAME direction and must join continuously in both structure and brightness; reserve both seam edges for the same broad plain dark espresso wall, with no doorway, lamps or fine seams straddling the join. Zenith and nadir must be smooth, unbroken low-frequency ceiling and floor without starbursts.
ENVIRONMENT ART DIRECTION: an intimate high-end amber lounge after hours, calm and empty. Warm neutral near-black plaster and subtle dark espresso wall panels, a soft low amber concealed wall cove roughly at seated eye level, restrained warm stone/timber floor, one small fabric-shaded lamp on a distant side table at about +55 degrees from the forward direction. Only a few quiet distant low seating silhouettes, never in the central foreground. Room enclosure and all furnishings approximately 6–10m away from capture point, so it reads as a quiet distant environment behind a future centrally rendered product. Forward 90-degree sector should be visually spacious with a broad dark wall and gentle amber horizontal glow; no busy central focal point, stairs, stage, hero table or pedestal.
LIGHTING: plausible 2700–3000K practical lights, soft amber local pools rather than an orange color wash; preserve neutral warm charcoal shadows, dark brown midtones and soft creamy lampshade highlights. Ceiling remains subdued. No daylight/windows, green/teal cast, saturated neon, nightclub lasers, fog, vignette, lens flare, chromatic aberration or exaggerated bloom. Lamp must retain shape and local detail, not be a giant clipped white spot.
MASTER QUALITY: render the room optically sharp enough to inspect geometry and seams, with clean natural texture and subtle detail; NO baked depth of field or directional motion blur. Defocus will be controlled separately in the Three.js product scene. No photographic grain or over-sharpening. Consistent room scale, coherent reflections and plausible architectural continuity. No people, alcohol bottles or drinks, signage, lettering, products, model, plinth, UI, border or watermark.
```

## 深色岩板：可平铺底色母版

```text
Use case: product-mockup / material texture authoring.
DELIVERABLE: ONE square high-detail SEAMLESS TILEABLE BASE-COLOR TEXTURE of dark warm charcoal sintered stone / fine-veined porcelain slab. Largest native square output available, full-bleed texture only. It will cover a real 3D beveled display slab approximately 3.8m wide by 3m deep, with the texture pattern authored to represent approximately a 1m by 1m patch; this is a proposed art scale, not a product dimension claim. Output a single color map, NOT a material preview ball, rendered tabletop or multi-map sheet.
REFERENCE ROLE: Use the attached A concept ONLY for the type of subtle warm dark stone visible on the display plinth. REMOVE ALL illumination, warm lamp reflections, bright edge bevels, typewriter reflection, cast shadow, metallic edging, geometry, interface, text and objects. Preserve only the intrinsic stone color and vein language. No UI or product content anywhere.
PROJECTION / LIGHT CONTRACT: exact orthographic perpendicular top-down scan, no perspective, no visible slab thickness or edge. Flat even diffuse neutral D65 illumination, cross-polarized scan appearance. No baked specular highlights, reflection shapes, contact shadows, AO, vignette, gradients, embossed shading, side lighting or warm orange light spill. Overall material albedo is warm neutral charcoal/espresso grey, not green, blue, orange or pure black; stone matrix should retain visible subtle variations.
PATTERN: a sophisticated quiet large-format dark porcelain/stone surface; organic sparse hairline mineral veins in muted grey-beige and restrained tobacco, occasional slightly broader soft mineral clouds, subtle fine stone granularity. Veins must feel geologically irregular and subordinate to the product; avoid loud gold lightning, bright white marble rivers, diagonal stripes, repetitive cracked mud, grids, tile grout or painted scratches. Mineral veins are color changes, not deep canyons.
TILING CONTRACT: toroidal pattern continuity. Exact opposite edges must match in color, vein trajectory, scale and first-order visual flow so the same image repeats naturally in both U and V, including the four-corner intersection. No border, no picture frame, no edge fading, no central emblem or obvious repeating landmark. Balanced pattern density and average brightness across all quadrants.
DATA CONTRACT: this image is BASE COLOR ONLY. Do not encode a purple normal map, grayscale roughness map or baked lighting into the RGB output. Fine roughness, shallow relief, clearcoat and actual reflections will be authored separately. No text, swatches, labels, logos or watermarks.
```

## 暖玻璃UI：实施视觉参考

```text
Use case: ui-mockup.
DELIVERABLE: ONE high-fidelity 16:9 desktop application design reference for Trees X, full-viewport screenshot, not a moodboard, not a UI sprite sheet, no device or browser frame.
REFERENCE ROLE: The attached A image is the approved amber-lounge direction and existing workbench layout. Preserve the same black-and-gold antique mechanical typewriter silhouette, ivory round key faces, small WindGear nameplate, front three-quarter assembled view, dark fine-veined stone plinth and warm defocused bar background. Keep the product geometry and scale as close to the reference as possible; do not add machinery, extra legs or surreal decorative parts. This generated screenshot is a VISUAL REFERENCE for implementing real Vue/CSS/SVG controls, not a bitmap to place over the running app.
VISUAL SYSTEM: extremely restrained warm smoked glass with readable ivory text and soft bronze selected states. Warm charcoal/espresso neutrals; no green/teal. Glass is concentrated on the existing brand chip, left catalog rail, bottom toolbars and a single right action inspector. No nested glass cards, exaggerated glossy bevels, neon, fake dashboards or decorative statistics. Subtle shadows, quiet thin warm borders, consistent small line icons, precise spacing.
LAYOUT: desktop 1440x1000 composition shown in a widescreen image; upper-left brand 'Trees X' and subtitle '三维商品工作台'; title beneath it '机械打字机' with concise description '从一次按键，看到内部连接。'. Left slim rail with three real small product thumbnails labeled '机械打字机', '三角钢琴', 'Reventón 汽车'. Top-right compact segmented environment toggle with a drawn sun icon and '明亮', a drawn moon icon and '暗光'; 暗光 selected. Beside it a compact '商品目录' button.
BOTTOM CONTROLS: first slim glass toolbar with '外观', '细节', '结构与动作', '导览', with 结构与动作 selected. Second smaller toolbar with '整机全景', minus, plus, '复位视角'. Keep controls genuinely legible at desktop scale.
RIGHT INSPECTOR: one narrow smoked-glass panel titled '结构与动作', close icon; short section '探索部件关系'; three clear action buttons '合拢整机', '分层展开', '平铺部件'; a small pause/continue row and '复原动作'. Use spacing and hairlines to group, no repeated cards. Keep the machine fully visible in the remaining stage width, camera composition shifted left without shrinking it to a thumbnail. A right panel is visible in this reference to show the full warm-glass treatment.
SCENE: background softly defocused, black body readable, controlled broad white-warm softbox reflections, restrained amber edge light, key faces remain ivory, gold not fluorescent yellow. No orange wash over everything, no green haze, no noise or bloom covering the keys. Empty uncluttered lounge; no people.
CONTENT INVARIANTS: clean Chinese text, no invented specs, performance numbers, prices, fake users, chart widgets, percentage sliders, model node diagnostics or credit overlays. No captions claiming this is an actual rendered screenshot. All text and icons stay in the intended UI areas.
```

## 一轮修订记录

初稿原文已完整保存。修订时工具执行被中断，以下仅记录本次修改意图摘要，不冒充逐字提示词；成品、父文件摘要及原生尺寸见 generation.json 与 source-manifest.json。

### lounge-panorama-color-r2.png

```text
Edit the existing 2:1 amber panorama. Preserve an empty central lounge, no product, plinth or UI. Use a softly curved charcoal/espresso enclosure. Move furniture away from the leftmost/rightmost 12% seam zones and keep a broad plain wall at the join. Request one lamp near center-right, low-detail ceiling/floor poles and restrained floor reflections. Keep the master sharp; no baked depth of field.
```

### stone-basecolor-r2.png

```text
Edit the existing stone base color. Remove long distinctive diagonal veins; request quiet short sparse wisps smaller than about one tenth of the image width with no dominant direction, X patterns or grids. Request U/V and corner continuity, orthographic top-down neutral diffuse D65 cross-polarized appearance. No reflections, cast shadows, AO, roughness or normals encoded into base color.
```

修订后的全景接缝构图改善，但球面/极点和接缝连续性仍待整理；岩板长斜纹减少但短纹较密，平铺未通过。素材仍为候选，不作为完整 PBR、HDR 或实机效果交付。详见 [验收记录](amber-lounge-generation-validation.md)。
