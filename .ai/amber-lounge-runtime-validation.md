# 暖夜舞台与明暗切换验收

2026-10-16。用户批准将 A 暖琥珀方向落实到打字机实时入口。本批接入生成素材，不扩展 DDGI、FidelityFX、BVH 或其他商品。

## 可体验内容

入口：`http://127.0.0.1:5181/?product=typewriter-study&renderPipeline=realtime`。左下角“明亮／暖夜”原位切换；`&studioMood=light` 指定明亮初始状态。默认 WebGL、hybrid、钢琴与汽车保持原通道。

- 暖夜：原生 1774×887 全景作为可见背景，固定 LOD 3.5 角向虚化；接缝带与极点渐变仅是运行采样保护。它不是 HDR、真实镜头景深或已经修复的无缝母版。
- 地台：原生 1254² 单块石材底色，独立 512² 周期数学粗糙度和 OpenGL +Y 微法线，数据纹理 repeat 8、normalScale 0.28；不从底色亮度推断几何，不烘死商品投影。
- 照明：既有 Studio Small 05 HDR、曝光与环境强度保持；三块软箱向暖色过渡，强度倍数分别为 0.6／0.92／0.85。明亮恢复原软箱色与强度、原地台／地面／天空。
- 约 0.42 秒 GSAP 过渡由既有舞台 beforeRaster 推进；减弱动态直接抵达目标。切换不重载模型、不改镜头、配色、动作或结构状态。
- 首次暖夜读取四张同源图，核验字节、摘要和尺寸；失败显示重试，模型继续可操作。素材包、纹理／bitmap 与舞台材质分别具有明确释放方。

运行资源与来源见 `public/studio/amber-lounge/v1/manifest.json`，母版见 `assets-source/amber-lounge/v1/`；两张生成图逐字节复制，数值图单独制作。首次四图传输共 5,338,062 字节，不含 HTTP 开销；不把 PNG 字节数当作显存占用。

## 架构与首轮修正

`WorkbenchStudioMood` 只发出局部环境意图，`useWorkbenchScene` 经 controller／adapter 转交 `rendering/studio`。`loungeLook` 拥有节点材质、采样图和过渡；`loungeAssets` 管理下载、取消、迟到解码及资源释放。Pinia 不保存 Three 对象，不增加 renderer、绘制循环、HTTP API、配置版本或数据库迁移。

首轮截图发现背景方块。r185 WGSL 会根据初始 Texture 的过滤设置选择 `textureLoad` 或 `textureSampleLevel`；默认 DataTexture 的 Nearest／Nearest 使节点保留不带线性过滤的代码。现为四张占位图显式设置线性三线性过滤及 mipmap，与最终纹理保持相同采样类别，补充回归后重新构建、复测。另修复快速切换到当前数值目标时已 kill 的旧补间仍被手动 totalTime 推进的问题。

## 本批工程与浏览器证据

验收材料写入忽略目录，不进入 Git。当前已完成：

- `npm run check`：79 文件、442 Vitest 用例通过；既有工具测试通过。lint 仅两项既有 legacy 属性命名警告。
- `npm run build` 与 `demo:prepare`：生产构建和后端打包通过；保留既有 BVH 重导出／大 chunk 提示。
- `node --test scripts/demo/*.test.mjs scripts/amber-lounge/*.test.mjs`：50 项通过，覆盖固定种子、数据通道、清单及母版字节；四图与清单缺失、LFS 指针、等长度摘要损坏均被交付检查拒绝。`demo:doctor／prepare／start` 共用支持收据已包含暖夜素材。
- `scripts/amber-lounge-check.mjs`：真实 Edge WebGPU、真实 API／模型，8 项操作／状态检查通过，572 部件身份、唯一 Canvas／renderer／root、四张实际纹理、全景和 0.6 结构切换、10 次快速切换、实际击键、环境 503 与重试均覆盖。正常请求全部同源，无非预期 JS／控制台错误或请求失败。故障注入只豁免同一个实际 Request 的 `net::ERR_ABORTED`，不按整个 URL 或全局忽略取消。
- 管理预览回归：`TYPEWRITER_V2_ADMIN_BACKEND=realtime node scripts/typewriter-v2-admin-check.mjs` 两项通过；实际相机采集与返回完成，前后商品摘要一致，未保存或写正式商品。

对应记录：`artifacts/amber-lounge-generation/runtime-check.log`、`runtime-prepare.log`、`runtime-tools.log`，`artifacts/amber-lounge/runtime/report.json` 与 `artifacts/amber-lounge/admin-realtime/report.json`。

最后重新完成生产准备与实际 API 就绪启动；`demo:doctor` 返回 `ok: true`，包括 public／dist 暖夜资源。入口保持 5181／8089 且仅监听本机，当前进程由 demo 工具登记。doctor 的端口占用来自已启动的本项目，不代表它结束了其他进程。检查见 `artifacts/amber-lounge-generation/runtime-doctor.log`。

`TYPEWRITER_V2_BACKEND=realtime node scripts/typewriter-v2-check.mjs` 本批通过：v1／v2 六取景输入对应，101 个正反进度点与 50 次展开复原的最大姿态差均为 0；三次实际重载复用同一 Canvas／renderer，旧商品释放计数与所持资源相符，新商品几何／纹理数量保持。记录见 `artifacts/amber-lounge/typewriter-v2-realtime/report.json`。这不是 30 次重载或整个舞台 GPU 显存无增长的证明。

## 截图审查与限制

同批检查全景明暗、0.6 分层明暗、击键，以及 1280×720、1440×1000、1920×1080、390×844 和 320×740。修正后确认背景方块消失，操作入口与商品可见，无水平页面溢出；结构标签仍跟随。移动尺寸是同一桌面 WebGPU 宿主缩放检查，不声称手机已启用新后端。

截图位于 `artifacts/amber-lounge/runtime/`。首轮集中修正后完成一轮确认；没有为追求概念图逐像素一致继续无界调色。纹理微表面与整个打字机 SSR 细噪的既有质量限制仍存在，暖夜不等于完整渲染研究已通过。

本批未测 GPU timestamp、实际呈现帧预算、20 分钟或 30 次重载；不引用历史成绩替代。本人画质走查、原生减弱动态及设备丢失的本批完整联合检查仍待进行，不能把工程通过称为概念图一比一还原或完整系统最终验收。
