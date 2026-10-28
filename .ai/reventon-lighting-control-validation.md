# 摄影棚联动照明与玻璃尺寸修复（2026-10-28）

## 实现

汽车冷白棚调试卡新增“摄影棚照明”，范围25%—200%，默认100%。松开滑条后
统一缩放四盏实际面光、可见灯板与 scene.environmentIntensity。曝光、灯位、
材质、源纹理不变；原“仅调整灯板外观”折叠保留，作为独立外观倍率叠乘。

固定场景下统一光源倍率可复用已有线性HDR，无须重拍六面或重算PMREM。
这不支持单灯移动、改变光比或材质后的自动重烘焙。通过既有all变更通知
同时唤醒DDGI灯光/环境更新并拒绝旧SSR与阴影历史；DDGI仍有原有的收敛延迟。
不新增renderer、时钟、GPU纹理或渲染目标；面板关闭/重建的状态按既有宿主生命周期。

bridge与灯光基线由摄影棚局部owner持有，未就绪/失效/取消时不接受输入；
基于初始值计算，不累计乘法，卸载先恢复局部值，再由stage恢复原场景环境。
普通入口、数据库、自定义资源、打字机和钢琴保持原通道。

## 检查中发现的真实故障

1440×1000 → 1280×720 → 1920×1080，且此前完成开门/复原时，汽车平面倒影
内的玻璃透射拷贝触发GPU越界。失败证据保留在lighting-control、
lighting-resize-diagnosis、lighting-resize-native目录，不改写为通过。

实际原生拷贝记录：主beauty目标已1920×1080；反射上下文17的透射目标503/504
仍为1440×1000。Three r185 ViewportTextureNode克隆共享Source/image，主上下文
修改共享尺寸后，其他目标跳过needsUpdate，CPU尺寸与GPU分配不一致。

先在已有ownReventonViewport子类分配独立二维尺寸Source：实机确认自定义车窗
目标504恢复正确分配，但rear_cover_assembly / 19300原生透射目标503仍失败。
该中间失败保存在lighting-resize-source-isolated，不能把局部修复当整体通过。

最终另在productReflectionCapture的同步捕获范围内临时包装当前renderer实例
的copyFramebufferToTexture，为首次遇到的借用透射目标分离尺寸Source并标记更新。
方法在finally恢复，不修改全局原型或材质BRDF；目标继续由原所有者释放。
原生dispose通知移除记录；捕获owner退出恢复仍属于自己的Source，不释放借用纹理。
后续逐帧不重复创建Source或强制更新版本。保留采样、透明、粗糙度及完整输出。

## 验收状态

2026-10-28后台生产浏览器通过：scripts/reventon-lighting-control-check.mjs，
artifacts/car-showroom/lighting-control-isolated/report.json。验证100%/65%/150%、
开门、复原、独立灯板倍率，以及1280×720、1920×1080、390×844、320×740连续
尺寸切换；真实四灯、灯板、环境倍率相符，曝光/探针资源身份保持，单Canvas和
同renderer，无页面及GPU错误。没有重拍探针，也没有以截小拷贝掩盖故障。

截图检查：桌面联动正常、倒影存在；座舱仍暗，墙面空间表现仍需收束。
320px主体取景不理想，不能将尺寸/无错误回归当作移动视觉通过。整体画质及实际
呈现30帧仍未通过，报告保留visualPassed:false。本次不追加性能/重载长测。

149文件944项单元测试通过；生产构建、demo:prepare及demo:start通过，真实本地API
就绪。npm run check类型和ESLint通过，仅在用户已有PERFORMANCE_OPTIMIZATION.md
格式处停止。其后架构检查、模型检查、全套单测、demo-tools、realtime-probe、
typewriter-v2-tools及typewriter-paint-tools已分别通过，未修改用户文件。

取景研究framing-r11保留五组关门/开门截图：更低更紧凑可改善主体占比，
但未解决座舱和房间光比，未写入商品默认相机。没有用构图替代灯光问题。
