# 统一工作台契约（2026-10-01）

本轮仅制作音箱、打字机、汽车三件程序化流程样板。商品事实与展示配置唯一种子位于 server/src/main/resources/samples/products.json，经 Flyway 写入独立 MySQL 数据库。浏览器必须从真实 API 读取，禁止静默数据回退。

## 统一流程

目录选择 → 自由观察 → 细节/外观/结构与动作 → 可选导览 → 返回全景或下一件。
旋转为左键拖动，滚轮缩放；面板内滚轮不控制相机。复位视角仅改变相机；还原商品恢复配色、动作、结构与镜头。关闭目录/面板保持状态，换商品重置状态。导览只按用户下一步推进；手动相机输入立即取消导览镜头控制。

## 配置与所有权

ProductPresentation version=1：procedural source、camera、views、hotspots、finishes、actions、structure、guide。动作仅支持 toggle/pulse 意图，由已注册适配器解释，不执行服务端脚本。热点 node 与动作 node 必须存在于样板节点表；所有引用 ID 必须存在。三维对象不进入 Pinia。

展示宿主唯一拥有 Canvas；场景拥有 controls、环境、模型适配器及 GSAP 动画。样板适配器唯一释放几何/材质，动画从基准姿态计算。API 客户端按选择代次和 AbortController 丢弃迟到结果，首帧后才允许操作。新工作台不请求原 GLB、HDR 或手势模型。

## 样板脚本

- 音箱：全景 → 单元聚焦 → 旋钮动作与外观分层 → 合拢全景。
- 打字机：全景 → 字杆聚焦 → 简化按键/字杆/滑架联动 → 复原全景。
- 汽车：全景 → 车门开启与聚焦 → 座舱聚焦与部件分离 → 关门合拢全景。

旧版仅由 legacy=1 或六件旧商品 ID 导入，旧资产不在新目录混排。

## 2026-10-03：版本 2

v1 保持兼容。v2 必须携带 stage（背景、地面、曝光、环境强度、主/轮廓/环境灯；GLB 可引用包内 EXR/HDR）。source 可以保持 procedural，或 glb + 已注册 pbr-v1 adapter。GLB source 含 bundle 的 id/version/manifest/sha256、整体 transform、finishMaterials、explode 节点/局部偏移。actions 在 GLB 中必须绑定 rotate/translate + 单位轴 + 有限幅度。

摘要增加可空同源 cover 与 displayStatus（prototype/formal）；V3 迁移仅增加字段，不改旧配置。当前所有商品还是 prototype。示例在 server/src/test/resources/fixtures/speaker-glb-v2.json，仅用于校验和浏览器注入测试，不在 API 失败时回退。

phase（config/manifest/download/parse/materials/first-frame）为实际过程提示，不伪造百分比。阶段更新、失败与首帧同样核验 slug+revision；界面可操作需要首帧成功。配置高频部分不持有 Three 对象。
