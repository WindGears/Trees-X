# Trees X 展厅实机封面

展厅静帧来自展品实际使用的 WebGPU 工作台。制作时在无头 Edge 中打开答辩入口，隐藏界面控件，保留原 Canvas 和当时的灯光、材质与阴影。截图仅裁切和编码 WebP。

打字机的整机与分层均使用配置内的「展开全景」机位。制作脚本读取实际进度，确认同一模型实例、相机投影、照明和曝光一致后再输出。并排比较时，两张图采用相同裁切。每个展品的旁注 JSON 记录来源包摘要、拍摄机位、画幅和文件校验值。

启动本机演示服务后，在仓库根目录执行。默认输出到忽略目录 `artifacts/showcase/covers`。若预览端口不同，设置 `CHECK_URL` 为该本机地址。

```powershell
node scripts/create-showcase-covers.mjs typewriter-study
node scripts/create-showcase-covers.mjs piano-cfx reventon
```

确认构图后，将允许随项目分发的静帧和记录放在本目录。汽车 R18 使用本机派生资源，默认保留原公开目录封面作为回退。该来源的新增派生文件保存在本机，来源与发布限制见[汽车运行包制作说明](../../models/reventon-runtime-v2/README.md)。
