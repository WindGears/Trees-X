# 打字机 v2：独立 UV、微表面与 WindGear 铭牌

2026-10-14 制作，2026-10-15 完成候选工程检查。当前为候选资源制作与工程验收记录；完整实时渲染画质、呈现预算和本人走查仍待验收。用户明确要求“我们直接进 v2”，覆盖节点一未通过不得开始资产制作的旧顺序。原 SSR 剩余点噪和其他缺口继续保留，不改写为通过；DDGI、FidelityFX、BVH、钢琴、汽车均不在本次范围。

## 入口与变更边界

- 普通工作台继续 v1＋增强 WebGL，不修改数据库配置或自定义商品包。
- v2 资产入口：`http://127.0.0.1:5181/?product=typewriter-study&typewriterAsset=v2`。
- 同资产 WebGPU 实验：上面地址增加 `&renderPipeline=realtime`。
- `typewriterCandidate` 只替换 `typewriter-v1`、`kimi-typewriter`、包版本 1 与冻结摘要完全匹配的源引用，返回局部配置副本；HTTP、ProductPresentation v1/v2/v3 和 MySQL 均不变。
- 不创建第二 Canvas、renderer 或绘制循环，不把 Blender 场景／图片／影片作为浏览器展示。

## 来源与保留约束

制作源为用户确认本人创建的 `https://k3-typewriter.ok.kimi.link/`。原 v1 保留在 `public/models/bundles/kimi-typewriter/v1/`；候选位于相邻 `v2/`。用户已授权项目复用与 GitHub 同步；这不等于将源模型改为 CC0，也不推断额外的下游再分发许可。第三方参考照片不进入运行包。

冻结源 model SHA-256：`b61293acf1eb49f2d7cbcba0ae59214346130b8df0c32685cf954502f37ff0f4`；源 rig SHA-256：`047cddb65994640a25f4fad191131423b1ceafce6b4ab474aa906ac1d4576154`。制作脚本拒绝与已核验源不一致的输入，并拒绝覆盖已存在的候选输出。

必须保留 572 个语义部件、2257 个表面映射、节点名称／层级／初始姿态、298 个 mesh primitive 及原动作字节。实际实例总计 1,257,132 个三角形；primitive 直接求和不含实例复用，二者不能混称。UV 或切线接缝允许拆顶点，不能合并机构、减面、改轴心或改变三角形空间形状／源法线。

## 制作与运行输入

1. 十个原缺 UV 表面为 mesh 61、66、67、68、74、75、89、90、273、274。六个复杂 enamel 使用现有 xatlas；其余四个 ribbon／red／steel 使用确定性局部主面投影。已有 UV0 不改，新增微表面使用面积标定的 UV1，单位是场景单位，不宣称商品真实尺寸。
2. 需要微法线与各向异性的几何使用当前 Three 0.185.1 所带 MikkTSpace。按实际 UV1 生成切线、转换 glTF 手性并按接缝重新索引；退化 fallback 只修正切线 XYZ 的单位与正交性，保留原法线及 W。独立验证重新生成规范手性，退化 UV 单独报告，不用逐面叉乘结果误判源平滑／反向法线。
3. Blender Python／NumPy 生成固定种子的周期微高度：漆面、拉丝金属、铸铁三种 normal 与 ORM，加一张拉丝方向图，共七张 2048² RGB8 PNG。周期域与居中环绕导数用于重复采样；图像数据不带 sRGB／ICC 等色彩解释。ORM 的 R／B 为 1，G 为粗糙度调制，因此没有稳定 AO 或部件互遮挡烘焙。没有下载或编辑第三方纹理图像。
4. 候选保持标准 Physical 清漆、各向异性和源金属颜色／金属度；参数、纹理尺度、图像 SHA-256 及字节数写入 `production-record.json`。首轮不压缩贴图、不变更输出分辨率，也不增加专属运行 shader 噪纹。
5. `typewriterFinishes` 在 v2 材质集合整体校验后保持制作时的输入，不注入 v1 的 128²运行 DataTexture；新增 geometry、材料与贴图仍由既有 loader 唯一释放。运行渲染支路只借用，不给制作贴图增加第二释放方。

## WindGear 铭牌

只有原 image 50、材质 `decal-62` 的机身 Kimi 铭牌被授权替换。原图片摘要为 `2e2dc7fa4351476914290efa587dfb93586d75734ee120771fa0f436679ca400`。新图为代码生成的 Georgia 斜体 WindGear 字形，透明背景、金色 `#d8b368`、1024×416；尺寸、原 UV0、节点位置、材质及 alpha 规则保留，按原导出方向存储。字体文件不随包再分发。

其余 50 张字符图逐张核对字节摘要。独立保留校验默认拒绝所有图片变化；本候选需显式 `--windgear` 才接受有制作声明、原摘要与新摘要一致的 image 50 单项例外。来源记录仍注明用户自有 Kimi 项目，不能因铭牌换字而删除来源归因。

## 母版与重建

本机 Blender 为 `I:/WindGear/blander/blender.exe`，核验版本 5.2.2 LTS。独立材质母版目标为忽略目录 `artifacts/typewriter-v2/typewriter-material-master-v2.blend`；它仅用于材质检查，不重新导出或覆盖运行几何。Blender 导入兼容副本只移除空的零 dispersion 扩展，并核对运行 GLB 摘要未变，兼容副本同样留在 artifacts。

首次制作的顺序如下；运行包输出已存在时不能直接重跑覆盖，应先指定新的制作和输出目录。

```powershell
& 'I:/WindGear/blander/blender.exe' --background --factory-startup --threads 8 --python-exit-code 1 --python scripts/blender/typewriter_materials_v2.py -- --textures artifacts/typewriter-v2/materials-linear-v2
node scripts/typewriter-v2/build.mjs artifacts/typewriter-v2/materials-linear-v2
node scripts/typewriter-v2-verify.mjs public/models/bundles/kimi-typewriter/v1 public/models/bundles/kimi-typewriter/v2 artifacts/typewriter-v2/preservation.json --windgear
npm run test:typewriter-v2-tools
npm run check
npm run build
```

母版制作另用同脚本的 `--master public/models/bundles/kimi-typewriter/v2/model.glb --output artifacts/typewriter-v2/typewriter-material-master-v2.blend` 参数，并保留 `--python-exit-code 1`；进程退出、文件存在与内容核对共同确认结果，不能只凭 Blender 默认退出码判断成功。

## 资源预算与运行影响

当前清单预算约 85.7 MB，由约 73.1 MB GLB、原 rig 与七张共享 PNG 构成；准确字节数与 SHA-256 以已生成 manifest 为准。GLB 保留源二进制并追加 UV、切线及接缝顶点，本轮没有移除制作前冗余数据，也没有承诺资源体积优化。浏览器实际上传已引用属性，不应把文件体积直接等同显存。

按七张 2048²纹理均以 RGBA8、完整 mipmap 展开估算，额外纹理存储约 149.3 MiB；这是格式假设下的预算估计，不是 GPU 测量。实际分配、纹理别名／克隆、解码临时内存、几何和不同后端目标应由实机单独记录。不套用历史 5 MB／10 万面限额，不自动缩贴图或画质。v2 只在显式入口请求，普通入口没有额外资源下载。

## 验证状态与待补证据

以下是本轮最终候选的独立报告与真实生产浏览器结果，不沿用上一版成绩：

| 检查                                               | 当前记录状态                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 独立位置／法线／旧 UV／节点／rig／图片保留检查     | 通过；三项误差均为 0，原 rig 字节相同，仅 image50 授权替换                                               |
| Mikk 手性、fallback、退化 UV 与异常夹具测试        | 21/21；237 个必需 primitive 有切线，有效 UV 手性错误 0；54 个原有退化 UV 三角形另列为未验证              |
| 七张纹理维度、通道、线性元数据与摘要               | 9/9；另有 6/6 几何／切线工具测试                                                                         |
| glTF 结构与独立资源清单校验                        | 0 错误、15 警告；与 v1 相同的零 dispersion/no volume 警告，无新增                                        |
| check／build／生产准备                             | 通过；414 前端单测、48 交付工具、23 probe、36 v2 工具；生产 build／JAR 准备和真实 API 启动通过           |
| 六个冻结取景 v1／v2 同后端对照与 WindGear 正向显示 | WebGL 与真实 WebGPU 分别完成 12 图；各自六组相机误差 0；铭牌实机正向、清晰                               |
| 敲键、热点、导览、分层／平铺及进度复原             | 实际 v2 工作台回归通过；两后端各采样 101 个正反点和 50 轮复原，姿态误差均为 0；外观切换专项检查待补      |
| 管理未保存预览、右键平移、取景回填与退出清理       | 真实 WebGPU 完成两轮；相机位置与目标同步回填，退出注销桥接且 Canvas 归零；源引用／动作保持，数据库未修改 |
| 桌面尺寸与 390／320px 基础兼容                     | 1280×720、1440×1000、1920×1080、390×844、320×760 截图与布局检查通过                                      |
| 首帧／唯一 renderer／重复加载与资源释放            | 两后端各 3 次真实重新加载，Canvas／renderer 保持；旧根移除且登记资源各释放一次；取消与设备恢复本轮未重跑 |
| 新资产同输入的 128 降噪／1024 原图路径参考         | 未完成，后续重新制作                                                                                     |
| 30 次重载、20 分钟联合验收、实际呈现预算与本人走查 | 未完成，不据此切换默认                                                                                   |

工程通过与画质通过分别记录。`qualityApproved=false` 保留至六取景、动态操作与本人走查共同证明收益；新材质不能让原实时反射点噪、拖影或地台缺陷自动获得通过。截图／日志／母版／GPU 临时材料保存在忽略的 artifacts，来源、运行清单、维护说明与必要运行资源随验收功能节点提交。

最终 model SHA-256 为 `59006664cde2f0beae5ac9508391e3bfbfe9c4cf389eaec6ae67783fc40cded4`，manifest 为 `dcffa2dd699d269f1c16631343cf96e6b925c00153119363589b0693243f8b26`，运行文件总计 85,650,539 字节。Blender 母版已生成并重新打开核对：2830 objects、60 images（58 packed）、制作版本 2；场景记录的源摘要与最终运行 GLB 一致，15 个空 dispersion 仅在导入副本移除，运行资产未变。

本次人工截图检查：v2 外壳近景增加可见微表面，WindGear 正向显示，字符和细部未出现新缺失，分层与平铺保持布局。WebGPU 仍有原实时反射点带、偏暗区域和地台近似差异，不能据此宣称整体达到路径参考或切换默认。固定的 `part-000` 取景同时包含外壳与金属，不把它当作纯拉丝材质测量。

场景遍历计数（非 GPU 字节测量）：v1 为 278 geometry／57 texture 对象，v2 为 286／83；两后端本轮三次加载保持 v2 计数不增长。glTF 通道与材料使用会生成 texture 别名，不能把七张源图等同于七个运行 Texture。149.3 MiB 只是假设单份 RGBA8+mip 的估算，不覆盖别名或目标分配。

v2 保留 steel=0.34 等各向异性；当前 SSR 支路排除这些材质。按资产映射统计，1421/2257 表面、768048/1257132 三角形（约 61.1%）继续走原生 Physical／环境反射；不将其质感归因为动态 SSR 全覆盖。UV 是总面积密度标定，不保证逐面等距或全部拉丝方向正确。最终 WindGear PNG 可追溯，跨平台 Georgia 字体重建尚未验证字节一致。

管理检查只允许读取、会话与未保存预览请求，拒绝持久化写入。第一次 WebGL 批次的两个功能检查通过，但整体报告因未登录会话探测的预期 401 被计入错误而失败，该原始报告保留。修正后的检查只识别登录前同源 `GET /api/v1/admin/session` 的请求、实际 401 响应及对应资源错误；其他认证失败仍报错。最终真实 WebGPU 批次整体通过，不将首次失败报告改写为成功。

证据位于 `artifacts/typewriter-v2/`：`preservation-final.json`、`material-data-validation-final.json`、`asset-validation-v2-final.json`、`browser/report.json`、`realtime-browser/report.json`、`interactions/report.json`、`layout/report.json`、`admin-realtime/report.json`；截图及制作母版同样不提交。
