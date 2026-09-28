# Draco 解码器

`draco_wasm_wrapper.js` 与 `draco_decoder.wasm` 原样来自本项目安装的 `three@0.185.1/examples/jsm/libs/draco/gltf`，与当前 GLTFLoader 配套。目录内 README 为 Three 原始分发说明。Apache-2.0 许可证保存在 `LICENSE`（来自 Google Draco 官方仓库）。

加载路径 `/draco/`，强制 WASM 构建，单次解析最多一个 Worker。仅包含 Draco GLB 的解析会请求解码资源；FORM / 01 不需要解码。解码器由 useModelLoader 的该次解析拥有，在 finally 释放。源模型、纹理和 geometry 继续由 model loader 释放，presentation 仅拥有材质副本。

库构建文件不进入项目业务代码的 lint/格式修改范围。运行时不使用 CDN。
