# 展厅封面资源

本目录七张 PNG 均由 `npm run covers:generate` 在 Trees X 的真实 GLB、灯光、材质和当前镜头下渲染，不使用生成式产品图片。原图 960×600，目录按统一比例裁切。

- `form-01.png`：Trees X 自制概念音箱模型。
- `gamepad.png`：Josh Dean / Poly Haven，CC0。
- `gaming-console.png`：Sean Buckley / Poly Haven，CC0。
- `oak-side-table.png`：James Ray Cock / Poly Haven，CC0。
- `potted-plant.png`：Rico Cilliers / Poly Haven，CC0。
- `home-furniture-set.png`、`toy-racer.png`：Kenney，CC0。

源地址、模型转换过程与模型哈希见 `public/models/collection/` 的许可说明及清单。反射环境为 Greg Zaal / Poly Haven 的 Studio Small 05，CC0；HDR 文件大小与校验值见 `public/textures/` 的说明。

`manifest.json` 记录渲染模型的真实网格名、各封面文件大小与 SHA-256。生成脚本不会改变原始 GLB 或原始材质。
