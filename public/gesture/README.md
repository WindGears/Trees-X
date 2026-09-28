# 本地手势识别资源

- `vision_bundle.js`、`wasm/*` 原样复制自锁定依赖 `@mediapipe/tasks-vision@1.0.1`。上游软件为 MediaPipe，Apache-2.0；许可证见 `LICENSE.txt`。
- `hand_landmarker.task`：Google 官方 Hand Landmarker float16 第 1 版，7,819,105 bytes。下载地址：https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task 。模型来源说明：https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/index 。模型的具体许可应以其发布页及模型卡为准，软件许可证不自动替代模型条款。
- `worker.js` 为本项目代码，不是上游文件。运行前限制 fetch 为同源 GET，阻止 SDK 默认遥测；不修改压缩后的第三方包。升级 SDK 后必须重新运行网络回归。
- 不通过 CDN 运行。加载时由 FilesetResolver 选择 SIMD 或非 SIMD WASM，并非两个都下载。

`asset-hashes.json` 记录本次复制的 SHA-256；更换版本时同步依赖、复制文件并重新验证 Worker。首次开启需要下载模型和所选 WASM，因此界面有准备状态及超时重试。
