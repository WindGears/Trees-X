# 主软箱反射构图候选 r13（2026-10-29）

## 依据与范围

玻璃隔离记录见[有效输入诊断](reventon-glass-signal-diagnosis.md)。r12 默认取景的
固定屏幕 ROI 内，对真实玻璃三角形中心计算到 y=3.66 顶灯平面的镜面交点；
保持主灯 x/尺寸不变，z=1.2 时1297点落入矩形，z=-3 时37点。计数没有遮挡、
屏幕面积权重或粗糙度波瓣，不等于最终像素覆盖率，也不是玻璃物理验证成绩。

显式 `carStudioFinish=balanced` 选择 r13：只将主软箱及对应可见灯板沿 z 从1.2
移动至-3，观察目标同步平移。r12 的房间、墙地材质、其余三灯、所有灯的尺寸、
强度、辐射值、曝光、汽车材质及相机全部保持。未降低玻璃反射强度，未关闭
透射或替换汽车资源。r10/r11/r12与默认入口保留，不进入世界空间反射阶段。

## 资源与工程

生产几何导出28个网格，独立后台Blender工厂场景，Cycles OptiX固定256样本、
12反弹、OIDN、无能量截断，六面1024分别制作镜面/间接输入。原始母版位于
忽略的artifacts/car-showroom/cycles-r13，运行资源位于public/studio/cold-studio/cycles-r13。

源配置摘要：a87971703f6d01f6fa59fd520b3e6ddba5cdceaf5f5ded227734a55f466f998e。
两张运行HDR共40,386,887字节，解码共71,303,168字节；完整摘要、实际方向采样
及半浮点误差见manifest。新灯位不能加载旧房间烘焙，通过精确配置校验保护。
唯一renderer/Canvas/时钟、原环境资源所有权和动态汽车倒影保持。

951项单元测试通过，包含r13实际HDR四灯方向、取消/失败路径、动作包络、
灯具与建筑边界检查，以及只移动主灯的配置差异检查。生产构建、资源准备、
后端打包与本地启动通过；check类型/ESLint通过，格式仍仅被用户已有
PERFORMANCE_OPTIMIZATION.md阻断，未修改该文件。

## 视觉与运行验收

同输入八视角对照由`TREES_ROOM_PAIR=balanced node scripts/reventon-compact-room-check.mjs`
生成，输出为`TREES_COMPACT_OUTPUT`指定的忽略目录。脚本比较实际材质、资源摘要、
曝光和相机，并核对当前渲染器、输出尺寸和GPU错误；这些检查不替代目视验收。
`artifacts/car-showroom/balanced-room/report.json`实际通过，r12/r13各八视角，
材质（含玻璃specularIntensity/transmission/IOR）、资源摘要、曝光和相机相同，
1440×1000，唯一Canvas/renderer，无页面/GPU错误。

目视确认：默认全景、开门与分离状态的大面积白色玻璃覆盖消失，座椅/方向盘
透出，车头仍有高光。侧面、背面和座舱仍可观察。取舍是默认全景的车顶比r12
暗；顶部仍存在真实灯板反射，未通过参数关闭所有玻璃高光。墙面暗部和整体
摄影棚观感仍需用户确认，因此只将本次玻璃反射构图记作有效改善，整体
visualPassed保持false。不进入车身世界空间反射节点。

`balanced-room-performance/report.json`后台三段各30秒测试通过：完整材质可操作
31.797秒、增强就绪50.810秒；绕行/开门/分离提交吞吐分别48.44/36.66/38.24次每秒。
这是含诊断开销的单次观察，不作为冷加载分布或显示器实际FPS；GPU查询与JS
间隔保存在原始报告，presentedFrameBudgetValidated保持false。没有重载或长测。

本地对照页复制到忽略的dist/artifacts/car-showroom/balanced-room，HTTP 200及页面
内容已核对。它是本次预览的临时交付，重新build后需从artifacts原记录再次复制；
不将测试截图或运行日志提交为生产资源。
