# Three 规则

- 交付 GLB，Y 向上，中心与单位由 loader 归一化；运行时不能在逐帧回调重复求 Box3。
- 单模型三角形硬上限 100,000；提交资产时运行模型检查。
- 图片纹理目标不超过 2048 × 2048；超出须说明视觉收益并更新预算。
- GLB 对象用 shallowRef，切换模型先清理旧请求与旧场景。
- 自制样品没有外部资源；六个导入样品为自包含 Draco GLB。Draco 在 useModelLoader 集中接入，解码器使用已安装 Three 版本的 glTF WASM 构建并自托管。每次解析拥有一个 decoder，在解析成功/失败/迟到返回后释放；请求代次阻止旧模型覆盖新模型。Meshopt / KTX2 尚未接入。
- 模型 geometry、material、texture 分别去重释放，关闭 ImageBitmap；迟到的异步结果也必须释放。
- renderer 只由 TresCanvas 创建与释放。反射环境不向全局缓存无限追加。
- HDR 必须同源、自托管且不超过 2 MB。先显示 RoomEnvironment；请求可中止，源纹理、PMREM 与旧环境均由创建方唯一释放。
- 扫描覆盖层可以复用 loader geometry，但不得拥有或释放它；覆盖 Mesh 与共享 ShaderMaterial 由覆盖层自己释放。
- 静态场景按需渲染，GSAP 或 controls 改变相机必须 invalidate。
- 相机、模型移动与 DOM UI 分层；Three 坐标变化不得触发逐帧 Pinia 更新。
- 鼠标拖动旋转以外，提供命名视角按钮供键盘用户观察模型。
