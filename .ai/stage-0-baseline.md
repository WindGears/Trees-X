# 阶段 0 基线 — 2026-10-02

本地恢复提交：`ddeccbc`（统一工作台与 Spring Boot 原有成果）。未推送远程。

本地独立副本：`artifacts/baselines/2026-10-02-stage0/source-ddeccbc.zip`；其中 Git LFS 文件为指针，恢复大资源仍需现有 LFS 对象或原资源目录。该目录另保存资产绝对路径、字节数、SHA-256 清单和本轮截图/报告。没有删除、搬移或覆盖制作母版。

| 类别             | 位置                                           | 恢复/备份说明                                |
| ---------------- | ---------------------------------------------- | -------------------------------------------- |
| 代码与配置       | Git 提交、source-ddeccbc.zip                   | 环境密码不入 Git 或归档                      |
| 原始输入         | lamborghini-reventon-re-made-1.snapshot.2/     | 用户 VPB/3dm/参考图，保留原样                |
| Blender 制作文件 | artifacts/reventon/_.blend_                    | Git 忽略，交接必须另备份；当前仅有本机副本   |
| 浏览器资产       | public/models/、public/gesture/、public/draco/ | 汽车 LFS，许可见各目录 provenance/manifest   |
| 实验与旧离线渲染 | artifacts/reventon/ 其他子目录                 | 仅历史实验，不是当前浏览器运行资产           |
| 验收证据         | artifacts/baselines/2026-10-02-stage0/         | 工作台、汽车外观/开启/座舱/展开/合拢实机截图 |

## 本轮验证

- `npm run check`：28 文件 / 102 测试通过，73 个 Vue 文件 ≤300 行。旧 TypewriterStudy 两条属性命名警告保留。
- `npm run build`：通过，现有包体提醒保留。
- `npm run test:workbench`：真实 Spring Boot/MySQL，三件循环、动作、导览、双复位、快速/迟到选择、失败重试、历史、单 renderer、上下文恢复、桌面三尺寸及 390/320 通过。
- `npm run test:reventon`：135 网格、1,500,363 三角形、7 运动组、105 AO 与 41 normal 材质；开启/座舱/展开/合拢以及移动基础回归通过，页面错误 0。
- 当前前端 5181、后端 8089、生产预览 5182 可访问；重复启动方式见 README。数据库秘密保存在忽略文件，未更改。

汽车截图定义当前质量参照，不表示原离线参考图等效。汽车仍为 legacy 固定演示，统一自由工作台迁移在阶段 4。

## 自动化分组

| 分组          | 命令/脚本                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| 工作台        | test:workbench、test:workbench-production；lib/workbench 单元测试                                       |
| 正式资产/接入 | model:check（旧音箱）、阶段 1 新增资源包与生命周期测试                                                  |
| legacy        | test:browser、collection、experience、render-handoff、identity、visual、reventon 系列、typewriter-check |
| 手势          | test:gesture、gesture-interaction、gesture-motion、gesture-dwell；合成输入不能代替真人                  |
| 后端          | server:test（真实 trees_x_test）、server:build                                                          |

阶段 0 完成；后续基于此进入阶段 1，不更改三件样板的质量标记。
