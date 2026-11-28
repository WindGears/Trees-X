# 机械探索馆候选：阶段 1/2 记录

## 范围与入口

本批实现全幅单展位、独立展品库和打字机交互接入。`?gallery=next` 为真实候选，`?galleryPrototype=1` 为静态原型；无参数默认入口未切换。模型、纹理、房间和既有渲染质量没有随 UI 再次验收。钢琴和汽车已补真实操作回归；管理端与最终生命周期仍待完成，不宣称整套计划完成。

## 阶段 1：界面与目录

- `artifacts/museum/prototype/report.json` 为 passed=true，errors=[]，覆盖 1280×720、1440×1000，resources=[]；它只证明静态原型，不能代替真实场景。
- `artifacts/museum/catalog/report.json` 为 passed=true，errors=[]，modelRequests=[]。隔离目录夹具在 1280、1440、1920 宽分别覆盖 1/3/12/30 件；前两尺寸三列，1920 四列。夹具不写数据库，也不代表已有 30 件真实展品。
- `artifacts/museum/catalog/library-30-{1280,1440,1920}.png` 保存目录扩展截图。

## 阶段 2：真实打字机

`artifacts/museum/typewriter/report.json` 最后确认为 passed=true，errors=[]；运行身份为 WebGPU，1440×1000，root 为 typewriter-study。末次首帧 8301.8137ms 仅是该次运行观测，不是多轮启动基准或显示帧率。补查部件关闭后焦点返回、视角面板 Esc 关闭与焦点恢复均通过。

已有整机、分层、平铺、部件与展品库截图，桌面整机为 1280×720、1440×1000、1920×1080；`desktop-capture.json` 记录三个宽度动作条可见、空闲播放按钮隐藏。`video/` 保留本地流程录屏。报告与截图是当前阶段运行证据，局部后续修复需按实际复测追加，不追溯修改旧结果。

## 工程检查

主执行记录：1021 项单测通过，另新增 2 项 galleryRoute 测试；末轮生产构建通过。完整 `npm run check` 停在用户既有 PERFORMANCE_OPTIMIZATION.md 的格式问题，不能写为完整检查通过；其余分项工具测试 49+23+36+14 通过，架构检查 127 个 Vue 文件均未超过 300 行。以上为主执行传入的检查记录，本次文档任务未重复运行完整套件。

## 当前修复与待确认

直接候选深链接曾缺少全局 renderPipeline，使历史 lounge colorNode 覆盖产生白色地台。galleryRoute 当前源码仅在参数缺失时补 showcase，显式 webgl 保留；生产构建后重新捕获 whole-1280/1440/1920，已确认回到石材台面；显式 webgl 保留由两项路由单测验证。辅助状态和操作提示已加入暗色承托，三个桌面尺寸的新截图已确认可读。此次没有改动渲染或材质源码，仍不代表整体画质重新通过。

已实现 CSS 短反馈、GSAP 封面/展品库/面板补间及 reduced-motion 分支；尚不能据此宣称所有计划动效和全部生命周期场景通过。模型表面、墙面及房间质量不在本轮重新认可范围。

## 后续与同步

2026-11-28 核对 `artifacts/museum/exhibits/report.json` passed=true、errors=[]：
实际模型分别为 kimi-typewriter@2、kimi-piano@1、reventon-workbench@2。钢琴八个结构
进度、汽车先开双门再分离/仅关门保留分离、浏览器前进后退均通过；五次就绪核对
同一个 Canvas 与 renderer，均为真实 WebGPU，返回封面后 Canvas 数量为零。
此为操作回归，不代替新增画质、设备恢复、性能或全部动效验收。

打字机候选封面现由同一默认机位的无 UI 实机截图生成，1440×1000，WebP 213728 bytes；
摘要与来源见 public/covers/museum/sources.json。无 AI 生成商品图或模型变更。

独立界面审查的两项修复（辅助文字承托、当前设计文档）均评分 resolved；此结论仅
覆盖这两项，不能称为完整计划或渲染质量通过。

先完成当前阶段剩余检查，再进入钢琴/汽车/管理与最终生命周期阶段。候选移动端未验收。当前记录不宣称 Git 已提交或推送；验收节点同步后由主执行记录真实分支、提交和链接。本地截图、视频、运行报告为临时验收材料，不纳入功能提交。
