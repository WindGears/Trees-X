# 黑漆材质与 WindGear 艺术字样片（2026-10-16）

## 范围与可操作入口

只修改三种黑漆材质和 `image 50 / decal-62` 铭牌。金属、铸铁、其他字符、几何、UV、动作及现有实时渲染算法保持。普通入口不切换：

- 样片：`http://127.0.0.1:5181/?product=typewriter-study&renderPipeline=realtime&typewriterAsset=paint-study&studioMood=light&indirectLighting=ssgi`
- 原 v2：同一地址将 `typewriterAsset` 改为 `v2`。
- 同输入对照：`http://127.0.0.1:5181/artifacts/typewriter-paint/browser/index.html`，由本批浏览器脚本生成，不使用 `file://`。

仅已核验的原 v1／v2 引用可以切入样片，自定义资源不替换。资源包版本 3 与 ProductPresentation v3 不是同一个版本概念；HTTP、数据库和展示配置均不变。

## 制作、来源与保留内容

两张 GPT 原生母版均 1254×1254，分别为细腻橘皮与克制擦拭分布参考。完整提交提示词、原图和字节摘要在 `assets-source/typewriter-paint/`。生图不是扫描 PBR，不将亮度直接解释为真实微高度。独立 Blender 5.2.2 LTS／NumPy 2.3.4 制作固定种子周期高度，以去趋势的图像遮罩作弱分布调制。运行输出为三张 2048² RGB8 线性技术图，不标 sRGB／ICC／gamma：

| 图                       | 约定                                              |
| ------------------------ | ------------------------------------------------- |
| paint-normal.png         | OpenGL 切线空间 +Y，UV1，原 0.04 场景单位纹理周期 |
| paint-orm.png            | R=1、B=1，G 均值 0.93000055，沿用材质标量         |
| paint-coat-roughness.png | G 均值 0.94000506，沿用清漆粗糙度标量             |

微高度量级仍为 0.000004 场景单位；量化法线坡度 RMS 0.0142661，原 v2 0.0171619。不是商品的实测微米或粗糙度。周期边界差与相邻内部差同量级，不将边界像素必须完全相同当作无缝标准。不烘焙固定装配遮挡或灯光。

WindGear 是原创、可编辑的八字母路径 SVG，无系统／网络字体依赖。金色 `#d8b368`、1024×416，W／G 短回钩；正向 PNG 单独保留。嵌入 GLB 时按原约定翻转一次，保留 UV0、贴片、透明行为和位置。

独立运行包：`public/models/bundles/kimi-typewriter/paint-study/`。总资源字节 83,370,561；入口 GLB 73,091,684 字节，SHA-256 `fe3785c38247622baad6ed7288323ac076f91a331f1b2ea5e0748ed7d7167943`；清单 SHA-256 `5aff4cc6a255dbd48ef603c7cfc1069b19fe8366720265ffc7e9e362ccae91a3`。几何仍有 1,257,132 个实例展开三角形，不作减面或合并优化。

原 v2 整个 binary 前缀、accessor、UV／切线、节点与层级、572 语义部件、2257 表面映射、rig.json 和五张非黑漆技术图逐字节保持。新图共用原 loader 的唯一释放路径，不增加 renderer、绘制循环或访客面板。新增清漆图完整 RGBA8 mip 链估算约 22.37 MB；这是估算，不是实测显存。

## 复现

从仓库根目录执行，制作输出必须是新目录：

```powershell
& 'I:/WindGear/blander/blender.exe' --background --factory-startup --threads 8 --python-exit-code 1 --python scripts/blender/typewriter_paint_study.py -- assets-source/typewriter-paint/orange-peel.png assets-source/typewriter-paint/polish.png artifacts/typewriter-paint/materials-new
node scripts/typewriter-paint/build.mjs artifacts/typewriter-paint/materials-new artifacts/typewriter-paint/bundle-new
npm run test:typewriter-paint-tools
npm run test:typewriter-paint
$env:TYPEWRITER_ADMIN_ASSET='paint-study'
$env:TYPEWRITER_V2_ADMIN_BACKEND='realtime'
node scripts/typewriter-v2-admin-check.mjs
```

本次数值母版、三张 GRAY16 与独立材质检查场景保存于忽略目录 `artifacts/typewriter-paint/materials/`，没有导入或修改打字机源场景。它们可由上述源图和脚本重新制作，原始制作文件另行保留，不充当浏览器依赖。

## 当前工程证据

- `npm run check`：560 个 Vitest 测试、49 个交付工具测试以及实时探针、v2、14 个新增样片工具测试通过。新增源 manifest 摘要锁定，避免外部贴图和清单一起变化后仍冒充已核验 v2。现有旧组件有两条属性命名警告，非新增错误。
- `npm run build`、`demo:prepare`、真实 API 生产启动通过。构建保留依赖命名冲突与体积提示，无构建错误。
- `asset:check`：0 错误、15 警告；源资源的未使用 UV 等提示保留，不通过重排几何消除警告。
- `scripts/blender/check_typewriter_paint.py`：Blender CPU 独立从 GRAY16 高度重算法线，最大通道误差 0.0019624，小于量化容差 0.0039288；+Y 正向相关约 0.9746，翻转 Y 的误差明显更大。六张 PNG 的 CRC／摘要／色彩元数据与源图摘要通过。边界差只作为数值记录，不能替代可见接缝检查；证据 `artifacts/typewriter-paint/map-audit.json`。
- 管理预览 WebGPU 两轮通过：真实样片身份、右键平移、默认取景与 perspective 同步、退出桥接注销、Canvas 卸载与数据库未变。证据：`artifacts/typewriter-paint/admin-realtime/report.json`。

## 本批浏览器与截图审查

真实生产服务、真实 API、Edge 原生 WebGPU、1440×1000，固定 SSGI、明亮舞台、灯光、曝光与实际相机／实例姿态。三组分别为原 v2、新粗糙度／清漆＋原 v2 法线、完整样片；中间组的替换仅发生在测试页，独立拥有临时纹理及 ImageBitmap，恢复后再登记 loader 资源释放。它也包含新铭牌，因此不将它与原 v2 的全画面差异称为纯粗糙度差异。

- 三组全部通过，共 24 张图；每组包括全景、漆面、铭牌／前罩、键帽、0.6 分层、平铺、暖夜与暂停中间态。12 对实际相机／灯光／姿态输入检查通过，资源 HTTP 字节摘要及 image 50 摘要匹配，运行请求全部同源。
- 三组各完成 101 点正反定位、50 轮复原；实际进度、逆向姿态与复原误差均为 0。测试另外强制端点真实运动，避免不执行动作却假通过。真实击发、播放暂停和明暗切换状态保持通过。
- 每组另记录一次预热重载，再测三次重载；旧源资源逐一核对 detach／dispose，保持原 Canvas／renderer。几何、纹理、目标、属性及 uniform 数量未持续增长。程序文本字节存在约 8 KB 波动，所以 `exactPlateau=false`；没有将整个资源账本说成逐字节恒定。
- 完整样片三轮账面均为 316 geometry、135 texture、22 render target、1465 program，纹理字节估算均为 1,196,652,610；原 v2 为 132 texture、1,129,560,523。这是 Three 的全场景资源账面，不能用单张外部图的 22.37 MB 理论值替代，也不等于物理显存。
- 完整样片连续拖动＋定期击发约 30.017 秒，记录 1475 个 RAF 间隔及 1475 次成功提交；RAF 中位 22.1 ms、P95 27.8 ms。**只作为浏览器调度证据**，`frameBudgetValidated=false`，没有据此宣称实际屏幕已达 30 帧。
- WebGL 兼容脚本另完成默认 v1 保持、显式样片真实身份和 1280×720、1440×1000、1920×1080、390×844、320×760 五尺寸检查；单 Canvas、同 renderer、无横向溢出与控制台错误。减弱动态仅为同页 smoke，不冒充完整动效回归。

证据：`artifacts/typewriter-paint/browser-r2/summary.json`、`compat/report.json`。首次 `browser/` 批次误用了未暴露的测试桥接方法，在读取场景时失败；已改为现有 `snapshot / setSignals`，未给生产代码增加调试接口，原失败保留，不计入通过批次。对照 HTML 由通过的 r2 复制到上方 HTTP 路径，生产重新 prepare 后需重跑或恢复该忽略目录。

已逐图检查完整样片六取景、暖夜、1280 桌面与 320 手机：字形正向、拼写准确、与黑金机身协调；没有看到新增明显脏块或突出重复图案。漆面改变克制，整体跃升有限；前罩高光边缘的既有 SSR 点噪、远景反射与源键帽文字精度仍有缺口。本轮不据此宣称路径参考等效，用户整体画质验收仍保留。

## 画质与运行边界

整体画质和默认替换需要用户实机审阅。保留继承的 SSR 噪声与暖夜图片空间限制，不宣称增加贴图已解决反射或房间几何问题。完整输出、原源贴图和现有 SSGI 参数保持；不自动缩分辨率或降低画质。

本机 1440×1000 的 30 帧目标仍待实际呈现证据确认。测试 RAF 回调间隔只能说明浏览器调度，不能当作 GPU 耗时或屏幕呈现帧率。本批不重复 30 次重载及 20 分钟联合验收，不继承这些项目的历史通过成绩。
