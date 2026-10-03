# 正式资产制作与接入流程

2026-10-03。只生成新运行版本；当前正式商品目录仍使用 v1 程序化流程样板。`speaker-engineering@1` 为真实 GLB 工程夹具，没有通过正式展品画质验收。

## 制作目录与 Blender

制作母版、原图和许可保存在独立制作目录，运行资源放 `public/models/bundles/<id>/v<version>/`。临时对照放 Git 忽略的 `artifacts/asset-pipeline/`。源资产与运行资产不能同路径覆盖。

1. 收集许可、作者、来源和所需部件；缺失纹理、机械内部或动作轴心必须记录。
2. Blender 中用一个 Product collection 组织导出对象。唯一稳定节点名和材质名；部件轴心位于真实连接处，保留父子关系。阶段 1 注册行为只有本地轴旋转/平移，后续明确注册其他行为，不能把可执行脚本放配置中。
3. 区分 baseColor/emissive 的 sRGB 与 normal/roughness/metalness/AO 线性数据。检查 UV、法线、双面与透明。烘焙只写稳定的表面/遮蔽，不把随开门或结构分离变化的遮挡永久烘死。
4. 分层结构应给整个可移动组件配置偏移；不能只移一块面板导致它遮住留在原位的单元。运行姿态始终从基准局部 TRS 组合，不累加。
5. 用 `scripts/blender/export_asset.py` 从独立后台 Blender 导出 GLB。它不改写母版，不自动减面/合并部件/应用轴心变换；记录节点、父级、UV、材质、源/运行 SHA-256。默认忽略相机与灯光，让工作台管理。

本机已实际执行 Blender 5.2.2 LTS 的音箱 GLB 导入→导出：105 对象，源文件校验保持不变。证据 `artifacts/asset-pipeline/blender-roundtrip-v1/model.production.json`；这只验证工具链，不代表该次往返画面已通过。

```powershell
& 'I:/WindGear/blander/blender.exe' --background --factory-startup --python scripts/blender/export_asset.py -- --input-glb public/models/form-01.glb --output artifacts/NEW-version/model.glb
```

有 `.blend` 母版时，把其路径放在 `--background` 后，并使用 `--collection Product` 代替 `--input-glb`。不要在用户打开的场景里运行批处理；用独立后台进程。

## 资源整理与检查

`npm run asset:package -- input.glb NEW-directory settings.json` 生成版本清单。settings 必须提供 id、version、maxTriangles、provenance（author/source/license/redistribution）；可通过 extras 添加环境或动作文件。

工具只按内容摘要合并重复的外部图片/缓冲文件引用，不更改纹理像素、网格二进制、节点、轴心或 UV。不同内容不会被合并。生成 manifest.json 与 production-record.json，后者记录源摘要及材质通道。输出目录必须不存在，防止覆盖历史运行版本。

`npm run asset:check -- path/to/manifest.json` 核对每个资源的字节/SHA-256，并用 Khronos glTF Validator 检查规范和外部引用，记录节点、材质、三角形和问题到 validation.json。

同一个资源包的运行请求只使用清单登记的相对文件。浏览器先核对清单摘要与版本，再以最多三路请求读取并核对文件，解析后核对部件/材质绑定和专属几何预算。包外、跨源、重复路径与迟到结果均不能进入当前场景。

## GPU 纹理与 ORM

`npm run asset:pack-orm -- ao.png roughness.png metalness.png NEW-orm.png` 把三张已准备的 8 位线性遮罩装入 R/G/B。尺寸必须相同，制作者还必须确认 UV、采样与纹理变换相同。工具拒绝偷偷缩图或改变位深，不自动修改材质绑定。汽车使用多套 UV，不能盲目把它的 AO 与其他通道打包。

`npm run asset:texture -- input.png NEW-output.ktx2 color|normal|data` 使用本地 KTX-Software。UASTC quality 4、不缩图、不使用 RDO、最多 8 个编码线程、生成 mipmap；显式选择颜色/数据空间。**GPU 块压缩不是无损操作**，工具始终输出 qualityApproved=false，先对照关键材质再决定采用。

本机工具为官方 KTX-Software 4.4.2，解压到 `.tools/ktx-4.4.2/unpacked/bin/ktx.exe`；没有全局安装或修改 PATH。其他机器通过 `TREES_KTX` 指定程序路径。Windows 发布包 SHA-256：`1f323b0fec19794f5e6c0425a61d4b1da396872a10be862d105f4f4b2d2957fe`。来源 https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2 。

Three KTX2Loader 使用 `detectSupport(renderer)`，转码器来自当前锁定的 Three 包，保存在 `public/basis/`。Draco、Meshopt 和 KTX2 均在 GLB 通道使用，程序化首屏不下载转码 WASM。每次解析的 decoder/worker 都在任务落定后释放。

本机局部对照已生成并验收，结论见 [阶段 1 验收](stage-1-acceptance.md)。复现到新机器时，先拉取原汽车 LFS 文件，再执行以下命令；输出位置必须尚不存在。已有本机结果可直接运行最后一条，不重新生成。

```sh
npm run asset:texture -- public/models/reventon/texture-a1781e67454f2007078d.png artifacts/asset-pipeline/car-surface.ktx2 color
npm run asset:probe
npm run test:asset-textures
```

`asset:probe` 保留原网格数据和 normal/AO，只建立一张 baseColor 的原图/压缩图对照包。纹理测试需要 5181 开发服务，因为实验包在 Git 忽略的 artifacts 中；不会写入正式商品记录。

## 配置、预览与发布门槛

v2 配置完整示例：`server/src/test/resources/fixtures/speaker-glb-v2.json`。它是测试夹具，不是运行时 API 失败回退。`npm run test:asset-ingestion` 在独立浏览器内替换该次 API 响应、请求真实 GLB 验证；不会改写 `trees_x` 正式记录。

原三件 v1 样板继续可用。资源包、节点绑定、动作、外观、视角、舞台和导览同时通过后，下一阶段才替换对应商品配置。正式模型的管理预览与发布界面属于阶段 6，当前没有匿名写接口。

验收必须看真实浏览器全景/近景/动作/展开，不把 Blender 成图、源 PNG、规范校验或数据量当作品质合格证明。KTX2 局部试验仅证明所测材质，不代表全车或全部贴图已采用。
