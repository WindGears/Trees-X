# 暖琥珀舞台运行候选

此目录是同源运行素材包，不覆盖 `assets-source/amber-lounge/v1/` 中的生成母版。执行 `node scripts/amber-lounge/build.mjs` 可重新制作，执行 `node --test scripts/amber-lounge/*.test.mjs` 可核对源图摘要、确定性、数值通道及清单。

| 文件                | 用途                          | Three 设置                                                          |
| ------------------- | ----------------------------- | ------------------------------------------------------------------- |
| lounge-panorama.png | 原生 1774×887 的 LDR 可见背景 | sRGB；不用于恢复 HDR 照明；接缝、极点和虚化由舞台处理               |
| stone-basecolor.png | 原生 1254² 单块岩板底色       | sRGB，repeat 1，不声称平铺无缝                                      |
| stone-roughness.png | 512² 独立程序化粗糙度         | NoColorSpace，RGB 同值，G 通道，RepeatWrapping，repeat 8            |
| stone-normal.png    | 512² 独立程序化微法线         | NoColorSpace，OpenGL +Y，RepeatWrapping，repeat 8，normalScale 0.28 |

两张生成图逐字节复制自 r2 母版，没有调整像素、尺寸、色彩或投影。数值材质图来自固定种子的周期数学场，**不读取底色图，不推断物理石纹凹凸，也不包含 AO 或烘死的投影**。PNG 不带 sRGB、gAMA 或 ICC 转换标记。

清单中的 `threeMaterialDefaults` 是制作起点，非最终舞台参数。当前工作台保留既有地台 metalness 0.055、ior 1.5、clearcoat 0.2、clearcoatRoughness 0.3，暖夜粗糙度由数据图直接提供，明亮恢复原 roughness 0.32；此选择用于保留现有舞台的切换一致性，不称为实测石材。实机、接缝与生命周期检查见[运行验收](../../../../.ai/amber-lounge-runtime-validation.md)，不由清单或单元测试代替。母版仍未通过严格无缝全景或平铺材质认证。

`manifest.json` 记录实际字节、SHA-256、源路径、颜色语义及制作配方。原图为本项目生成的候选，不登记为第三方摄影或 CC0。技术图与制作脚本为本项目编写，没有引入新的外部素材或代码来源。
