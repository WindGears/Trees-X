# 平面反射与面板重新构图修复（2026-10-18）

## 问题与边界

用户发现左右 UI 面板开关时，桌台上的商品倒影相对商品移动。工作台通过主相机的非对称透视投影调整构图，原有自由观察姿态和商品尺寸不应因此被重置；正确倒影应随同一投影保持世界空间对应关系。

Three r185 的 ReflectorNode 镜像虚拟相机的右轴，但直接复制主相机投影矩阵的水平主点。与既有 `screenUV.flipX()` 采样组合后，非零水平偏移的符号不匹配。中心投影下偏移为零，因此只检查无面板画面不能覆盖该问题。这与真实相机绕行时反射发生合理视差是两回事，修复不能将倒影固定在屏幕上。

## 本批实现

- 新增 `rendering/reflectionProjection.ts`，固定核查 Three r185 及 ReflectorNode 内部对象形状，不改 Three 源码或全局原型。
- 只在虚拟 PerspectiveCamera 的投影矩阵从当前主相机复制时，将水平主点 `elements[8]` 取反；在原生 oblique clip 计算之前完成，保留原生裁剪流程。
- 保留主相机矩阵、垂直主点、原生 flipX 和完整反射目标范围，不通过平移采样 UV 修补，避免边缘越界丢失倒影。
- `studioReflection` 的商品独立捕获与 `planarReflection=scene` 共用该桥接。构建失败回滚，卸载按唯一 owner 恢复原方法、释放反射目标及舞台自有几何／材质。

## 验证记录

本批 `npm run check` 通过：97 文件、572 项 Vitest，以及既有本地工具／实时 probe／v2 与黑漆工具检查；日志为忽略目录 `artifacts/reflection-framing/check.log`。`demo:prepare` 完成前端生产 build、后端 package 和资源摘要校验，随后 `demo:start` 启动成功；日志为同目录 `prepare.log`、`start.log`。构建准备时间为 `2026-10-18T00:42:52.144Z`（北京时间 08:42），源码指纹 `7b944726f97f6dbeea44aece25979b355986b303adee21d3f3312469163ec09d`。

新增 7 项专项直接调用真实 Three `ReflectorBaseNode.updateBefore`，无 GPU 假 renderer 仅记录实际提交的虚拟相机。3 个姿态、3 个 zoom、6 个水平偏移和2个垂直偏移共216组，每组比较2个商品点与其桌平面世界镜像，横纵投影误差均小于 `1e-8px`。未修复版本明确复现水平误差 `2 × offsetX`；原生斜裁剪后桌平面投影 z≈0。源相机投影／逆矩阵／世界矩阵／位置／view 均保持，垂直主点不反转；无关矩阵 copy 保持，重复绑定拒绝、幂等卸载和多相机恢复通过。实际舞台工厂的商品与 scene 两种捕获均检查桥接安装与卸载，未把单独 helper 通过当作工厂接入证明。

真实 Edge 生产入口为 `?product=typewriter-study&renderPipeline=realtime&typewriterAsset=paint-study&indirectLighting=ddgi&studioMood=dark&loungeSpatial=box&loungeLayers=1&loungeDof=1`。实际操作右侧结构面板→左侧目录→结构面板→关闭、敲键、放大与复位；倒影随商品重新构图，未观察到此前相对横移。UI 遵循单面板规则，目录打开会关闭右侧工具；两侧同时存在的偏移仅由数学组合测试覆盖，不宣称实机同时打开。核对1个 Canvas及零控制台error，未在浏览器读出renderer对象身份。截图为同目录 `closed.png`、`right.png`、`catalog.png`。source renderer工厂不变，单 renderer 所有权仍由既有宿主负责。

冷载仍曾出现已知浅灰背景，明亮→暖夜切换后底图显示正常；本批未修该独立问题。未重跑完整结构动作／生命周期矩阵、设备恢复、桌面多尺寸／移动端、实际呈现预算与长期稳定性；不能沿用此前相关成绩。现有 camera/viewport/motion 单测随本批 check 运行通过，实机截图只说明本次窗口与上述交互。

## 保持不变与未覆盖事项

本批只修复 WebGPU 舞台平面反射的投影匹配，不改 UI 布局、商品模型、黑漆样片、软箱、曝光、反射强度、过滤核、DDGI、SSGI、SSR 或 DOF。API、数据库与展示配置版本保持。

没有新增 renderer、Canvas、绘制时钟或逐帧 CPU 像素回读。所有复用 `createGpuStudioReflection` 的 WebGPU 舞台共享此投影修复，hybrid 的采样／降噪流程不迁移，WebGL 原平面反射不改；反射噪声、主软箱自阴影、桌台 GI 材质同步和动作历史问题仍按各自记录单独处理。本次修复不等于整体画质、实际呈现帧预算或长期稳定性验收通过。
