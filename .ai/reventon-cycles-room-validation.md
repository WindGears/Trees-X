# Cycles摄影棚反射源（2026-10-25）

## 实施

用户要求继续提升静态地面与空间呈现。本轮将r10摄影棚的28个真实几何网格、世界变换、法线、UV和材质参数从Three代码导出，独立后台Blender制作，不打开或修改用户场景。

Cycles/OptiX、固定256样本、12次总反弹、8次漫反射/光泽反弹、OIDN、无能量截断。12张1024²线性EXR六面图，反射源4096×2048，间接源1024×512。灯板发光网格单独负责离线照明，不另加重复面积灯；间接源只对相机隐藏灯板，仍保留其光照。不是直接光逐项分解，也不称Three Physical与Principled完全等效。

运行资源RGBA16F，gzip共38,343,042字节，解压71,303,168字节。对32F制作源的相对误差（数值>0.001）最大0.000976；原始EXR/.blend保留。四个灯板中心方向和辐射值自动核对；明确从Cycles组装的top-down转换为原WebGPU数据的bottom-up，不能随意猜测flipY。

显式 `carShowroom=cold-studio&carFloor=cycles` 使用新数据，仍沿用唯一renderer、盒投影及已有PMREM。地板SSR停用、汽车SSR/机构/实时接触阴影/主灯遮挡保持。数据库和公开配置不变。`carFloor=baked`仍指向上一版光栅捕获，普通入口不变。

## 验收

- 93项摄影棚、信号、材质及环境SH测试通过，包括真实半浮点资产、四灯方向、候选路由及地板原生面积光支路。
- 构建、TypeScript及ESLint通过。完整 `npm run check` 在已有未跟踪 `PERFORMANCE_OPTIMIZATION.md` 的Prettier格式检查处停止，保留该用户文件；不将完整检查标为通过。
- 生产预览的后台Edge/WebGPU检查通过：1440×1000，baked/cycles同输入对照，以及独立cycles-local候选。全景、侧面、背面、开门、0.6分离与复原通过；单Canvas/renderer，DDGI与主灯阴影就绪，无GPU错误；加载两份实际RGBA16F数据，现场六面绘制为0。
- 证据：`artifacts/car-showroom/cycles-browser/report.json`、`artifacts/car-showroom/cycles-local-browser/report.json`及各自五张截图。后台执行，没有操作用户浏览器或抢焦点。这是画面/功能检查，不是帧率测量。

## 独立地板受光修正

`carFloor=cycles&carFloorLight=local` 恢复地板原生RectAreaLight镜面项，环境改用相机不可见灯板的间接辐射，避免再完整叠加灯板图像；与墙体复用同一接收器判定。地板仍不发SSR射线，不增加绘制循环、追踪射线或汽车材质改动。此项与纯Cycles捕获对照分开留证，不将受光分流收益算作离线渲染收益。

截图审查：纯Cycles替换带来的改善有限；local候选收敛了左侧大块泛白地板高光，但仍存在较硬的车身明暗、粗糙地板分布和缺少汽车倒影等问题。未达到概念图，不晋级默认，不进入车身光追第二节点。只保留本次集中修正作为可操作候选。

## 限制

此批没有地面surface lightmap或动态汽车倒影。离线房间反射能改善反弹辐射，但不能消除中央探针空间误差，不能宣称已经达到概念图。灯板调试滑条仍只调可见灯板/Bloom，离线灯光固定。本人观感和实际呈现帧率仍待验收。

制作母版：`artifacts/car-showroom/cycles-r10/cold-studio.blend`，输入与EXR同目录；运行记录与公开条件见运行包README和manifest。
