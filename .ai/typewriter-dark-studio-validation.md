# 打字机暗色摄影棚试用

2026-10-15，基于 `ef2e6d6`。用户要求尝试更暗环境；本节点提供可直接体验的实时舞台候选与原亮色对照，不把配色试用等同于整套画质验收。

## 入口与范围

- `?product=typewriter-study&renderPipeline=realtime`：v2 材质、旋转反射核、深灰绿天空盒与石墨地台。
- 增加 `studioMood=light`：原亮色可见舞台。
- 普通 WebGL、hybrid、移动兼容后端及钢琴／汽车维持既有舞台。

唯一变化是可见背景／雾、地面和地台颜色，以及暗场上直接叠放的文字／引线颜色。曝光 1、Studio Small 05 HDR／强度 0.35、ambient 0.16、三块软箱、Physical 商品材质、反射 0.5 和接触阴影 0.68 保持。舞台几何形状、取景和动作保持；没有新纹理、离屏目标、renderer 或绘制循环，没有数据库或接口修改。

`studio/palette.ts` 是小型配色配置；live WebGPU studio 根据 renderer 的实时注册身份选择，capture 强制原 light。`studioPreset` 同步背景雾色。Stage DOM mood 同时检查实际后端、实时请求和已注册商品能力，CSS 只作用于访客暗场文字，原浅色玻璃工具／管理主题不改变。

## 实际验证

| 项目                   | 本批结果                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`        | 429 项前端单测、48 项交付工具、23 项 probe、36 项 v2 工具通过；类型、lint、格式及 102 个 Vue 行数检查通过                                                                   |
| `npm run demo:prepare` | 前端生产 build、Java 可执行产物与资源回执通过；从登记运行状态先执行 demo:stop，再准备并 demo:start，真实 API 就绪                                                           |
| 配色隔离与所有权       | 覆盖 realtime／light 对照、非实时隔离、源配置不变、真实地台／地面材质、几何边界一致、capture 不受 dark 影响、重复释放一次                                                   |
| 实机明暗对照           | 真实生产 WebGPU，自动 v2、572 部件；整机、漆面、金属、键帽、0.6 分层和平铺共 12 图，六组商品姿态／材质／灯光／曝光／环境输入摘要相同，相机最大误差 0                        |
| 界面                   | 1280×720、1440×1000、1920×1080 的全景及动作面板共六图；面板开关保留商品姿态和同一 Canvas／renderer                                                                          |
| 移动回退               | 390×844、320×740 真实重载到 WebGL，清除 dark DOM mood，恢复原深色文字，唯一 Canvas；两图                                                                                    |
| 敲键与结构             | `TYPEWRITER_ASSET=v2 TYPEWRITER_PIPELINE=realtime npm run test:typewriter` 五项真实 WebGPU 操作通过：实例身份、暂停／继续、平铺／复原、击发回位、语义搜索／聚焦／锚点／全景 |
| 管理取景               | v2 实时预览与取景回填两轮通过，持久化内容不变，退出预览清理相机桥接／Canvas                                                                                                 |

GPU 检查串行；对照脚本调用方式为 PowerShell 先设置 `$env:REALTIME_COMPARISON='studio'`，再运行 `node scripts/realtime-kernel-check.mjs`。不设置时仍执行原 static／rotating 反射核对照。本次环境名称与模型摘要可核验，环境像素与 GPU 实例缓冲未独立回读，不能宣称逐像素或完整物理等效。

临时证据保存在忽略目录 `artifacts/typewriter-dark-studio/`：`comparison/report.json`、20 张同批截图、`interactions/report.json`、`admin/report.json`。脚本帧计数只用于等待已提交完整帧，未测量 GPU／实际呈现帧时间。

## 视觉观察与边界

本批抽查整机、漆面、金属、键帽、分层、平铺、短桌面与宽桌面动作面板、320px 回退：暗背景使整机与金色高光更集中，文字和引线可读；平铺中的黑色细零件对比弱于亮色。保留可点击的亮色入口供用户选择，不把这一取舍记为全面视觉通过。前罩与金属上的既有 SSR 点噪仍可见，暗色并未解决它；不扩大模糊、修改商品材质或压低整图曝光来隐藏。

机械检测只有配色未登记 advisory，已按实际值记录于 DESIGN.md，未为消除提示修改既有设计。既存两条 legacy Vue 命名警告、BVH 重导出及大分块提示保持。没有为本次纯配色重跑 30 次重载、20 分钟、设备恢复、101 点／50 轮，也不借用旧成绩宣称本批完成；真人画质取舍与呈现预算待验收。

## Cline 监督审查

只读审查请求 `max`，实际模型 `deepseek/deepseek-v4.1-flash`，完整 stop，上游实际强度仍未确认，无文件写入／测试执行。其唯一 P2 建议认为 `realtimeRequest` 是 ref；Codex 核对 `useWorkbenchRenderHost` 的真实定义和返回，确认它是普通 boolean，该建议不成立，未应用。实际测试与整合由 Codex 执行，完整 MCP 返回与监督判断保存在忽略目录的 `cline-review.json`。
