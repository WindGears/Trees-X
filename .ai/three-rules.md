2026-10-02 当前正式资产阶段优先遵循 [完整路线](implementation-roadmap.md)，下面历史演出说明仅适用于 legacy。

# Three 规则

- **2026-10-01 当前工作台使用真实 Three 程序化流程样板，这是本轮对下方「交付 GLB」要求的明确例外。** 正式模型之后按音箱→打字机→汽车接入；共用统一 adapter 和 Canvas，不预加载旧汽车资源。旧高精 Reventón 仅在 legacy 入口保留，下面关于其固定流程与画质预算的规则不适用于新汽车样板。

- **2026-09-28 用户强制要求：Reventón 的核心实现原理必须是 Three.js。** Blender 只制作/烘焙资产；浏览器用真实 Three 场景、几何、PBR 材质、相机和 WebGLRenderer 实时执行展示。Vue/TresJS 仅作为装配层，GSAP 管理导演流程。不得用影片、预渲染图片序列或外部查看器冒充实机演示。
- Reventón 按用户质量优先要求，允许保留超过以下通用模型预算的原几何与高分辨率贴图；必须记录实际预算与释放路径，不得据通用 10 万面限制擅自降低该展品品质。静态照明可以烘焙，运动导致的变化阴影不可烘死。细则见 `reventon-realtime.md`。

- 交付 GLB，Y 向上。legacy loader 归一化；新资源包通过配置整体 transform 指定单位/落地位置，不改局部节点轴心；运行时不能在逐帧回调重复求 Box3。
- 旧通用 loader 保留 100,000 面限制；新正式资产通过版本化资源包声明独立预算，运行时核验实际值。不得套用旧上限自动减面。
- 正式资产贴图尺寸由近景质量决定，记录字节数、通道语义、显存估算与实机表现，保留制作母版。旧资源预算只用于 legacy。
- GLB 对象用 shallowRef，切换模型先清理旧请求与旧场景。
- 自制样品没有外部资源；六个导入样品为自包含 Draco GLB。Draco 在 useModelLoader 集中接入，解码器使用已安装 Three 版本的 glTF WASM 构建并自托管。每次解析拥有一个 decoder，在解析成功/失败/迟到返回后释放；请求代次阻止旧模型覆盖新模型。新工作台 GLB 通道另支持 Meshopt / KTX2；其转码器同源，实例每次解析独立释放。
- 模型 geometry、material、texture 分别去重释放，关闭 ImageBitmap；迟到的异步结果也必须释放。
- renderer 只由 TresCanvas 创建与释放。反射环境不向全局缓存无限追加。
- HDR 必须同源、自托管；新正式资产使用独立预算，旧基础 HDR 的 2 MB 限制仅对旧通道生效。先显示 RoomEnvironment；请求可中止，源纹理、PMREM 与旧环境均由创建方唯一释放。
- 扫描覆盖层可以复用 loader geometry，但不得拥有或释放它；覆盖 Mesh 与共享 ShaderMaterial 由覆盖层自己释放。
- 静态场景按需渲染，GSAP 或 controls 改变相机必须 invalidate。
- 相机、模型移动与 DOM UI 分层；Three 坐标变化不得触发逐帧 Pinia 更新。
- 鼠标拖动旋转以外，提供命名视角按钮供键盘用户观察模型。
