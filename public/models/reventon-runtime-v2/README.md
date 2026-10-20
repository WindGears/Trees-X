# Reventón 本机4K运行候选

原母版位于`public/models/reventon`，本目录只保存独立派生版本。所有运行贴图最长边不超过4096，保持模型BIN、节点、轴心、UV与动作；原EXR保留。

Git只保存工具、本说明及`resources/asset-records/reventon-runtime-v2/`中的制作证据副本；运行目录和`src/lib/workbench/reventonRuntimeBundle.json`是本机生成内容。新检出目录先准备原始LFS资源与既有`.tools/ktx-4.4.2/unpacked/bin/ktx.exe`，按下面顺序完整制作、登记，再运行`npm run demo:prepare`。不要把审计副本直接拷入运行目录冒充可用包；普通入口在本机尚未登记时仍可构建。已登记机器应单独备份整个运行目录及本机登记文件，Git不备份派生二进制。

运行`npm run asset:reventon-runtime`逐张制作UASTC q4、无RDO、完整mip的KTX2；中断后按已校验记录继续。启动时只要候选登记文件已存在，编码工具便拒绝写入，即使本机生产记录缺失也不会重建覆盖。原始图像16→8位、尺寸缩减及块压缩均可能有损，需整车近景检查。

编码全部完成后依次运行`npm run asset:reventon-finalize`、`npm run asset:reventon-verify`、`npm run asset:reventon-register`。收束步骤生成供 Speedball 0.8 CPU 图集读取的独立256²辅助 PNG，在 GLB extras 中登记引用；可见材质仍使用4K KTX2，辅助图不上传为可见纹理。RGB 与 alpha 分开进行数值重采样，不额外执行 gamma 或法线通道转换。

完整验证通过才登记显式候选入口。缺少清单、资源、摘要、辅助图或颜色空间不匹配时拒绝登记，不加载半包，也不回退旧8K冒充新资源。登记后收束工具拒绝改写包。重建时必须使用独立未登记目录／版本，不能覆写已发布引用。

来源未提供再分发许可，新增派生二进制不上传GitHub。请保留原本机来源、运行文件及制作记录；源码仓库保存生成工具与清单，不等于模型备份或获得公开分发许可。
