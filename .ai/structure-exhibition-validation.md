# 机械结构展厅验收

## 范围与复现

默认首页 `/` 显示总览。公开目录提供上架状态和名称，打字机实机静帧承载整机与分层对照。展品链接由 `renderPipeline=showcase` 与 `product`（`typewriter-study`、`piano-cfx`、`reventon`）组成。工作台内切换只替换当前资源。返回总览释放三维场景。显式兼容入口为 `/?renderPipeline=webgl`。

三件展品及管理预览共用 WebGPU 宿主。打字机使用 WindGear v2 与实时反射，钢琴使用支持形变的 PBR 光栅，汽车沿用 R18、4K BC7、双射线 SSR、DDGI、自阴影和动态倒影。管理预览继续使用现有配置与取景回填。

## 本机证据

- 三件模型身份、WebGPU、同 Canvas 与 renderer、命名取景、分层暂停、部件聚焦、钢琴击弦、车门和分离组合、前进后退及接口失败重试由生产构建核对。首页无 Canvas、模型、纹理、解码器或房间资源请求。图片及报告位于 `artifacts/showcase/exhibition-final/`。
- 真实打字机同机位截图验证了两帧的选择摘要、相机、投影、曝光和灯光一致。整机为进度 0，分层为 0.6。三件封面使用实际场景，制作摘要位于 [covers/showcase](../public/covers/showcase/README.md)。
- 桌面范围为 1280×720、1440×1000 和 1920×1080。键盘操作了首页静帧切换和工作台暂停／继续。减弱动态与 WebGL2 回退联合测试使用单 Canvas 并成功打开分层。
- 普通 `/admin` 从真实 API 打开 R18 配置预览。销毁 GPUDevice 后恢复了原车型、暂停姿态、镜头和软箱自阴影。右键平移后回填默认机位，重新预览使用回填数据。配置及版本的前后摘要一致。报告在 `artifacts/showcase/exhibition-admin-final/report.json`。
- R18 新封面作为本机派生文件保留。未准备该封面的构建使用已登记的旧版真实汽车封面。构建地址、封面生成和许可的范围见制作说明。

## 后台性能复测

生产构建在本机 Edge 无头、真实 NVIDIA WebGPU 和 1440×1000 实际输出下，每件进行了三次浏览器冷加载。交互为约七秒的连续绕行。

| 展品   | 可操作中位 | 绕行 JS 提交中位 | 绕行 JS 提交 P95 |
| ------ | ---------: | ---------------: | ---------------: |
| 打字机 |    6.27 秒 |          19.2 ms |          21.5 ms |
| 钢琴   |    2.52 秒 |          34.5 ms |          60.9 ms |
| 汽车   |   10.56 秒 |          13.4 ms |          16.4 ms |

汽车完整首帧的 GPU 队列分别于 10.72、10.68、10.46 秒结算。钢琴仍有长帧。三个展品的 Chromium 追踪均未取得可归属到页面的显示呈现证据。以上测量不用于宣称显示器实际帧率或将差异归因为单个美术参数。原始记录在 `artifacts/showcase/exhibition-performance/report.json`。

运行 `node scripts/exhibition-flow-check.mjs` 可复现桌面主流程。通过 `CHECK_URL` 指向本机生产预览和真实 API。
