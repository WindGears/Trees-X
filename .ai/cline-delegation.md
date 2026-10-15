# Cline 监督式子代理：使用与验收

2026-10-15 WebGPU 反射过滤的小范围只读审查通过 `cline_delegate` 单次完成：仅提供 `signedSpatial.ts`、`signedHistory.ts`，角色 reviewer、请求 `max`、简短回答，不设置隐式输出 token 限额。实际模型 `deepseek/deepseek-v4.1-flash`，`finish_reason=stop`、`complete=true`；有效强度仍为 unknown，验证为 not_run。用量为输入 4,894、输出 39,765（含推理 38,751），总计 44,659 token，网关返回 cost=0.0245931。没有工具执行、文件应用、GPU 检查或重试。

Codex 核对给定源码和已安装 Three r185，接受“固定八点空间核缺少像素／帧旋转”作为优先实验依据；拒绝 Cline 首推的“miss 不参与分母与夹取”建议：miss 的零修正保留原生环境，排除它会按命中重新归一化；邻域加入零也不会自动夹掉已有负值。平面距离与 `n.z` 视角项来自官方同类实现，不据此直接删改；镜面命中点重投影留待独立运动对照。子代理返回成功不等于建议正确，实际实现与画质判断继续由 Codex 和用户负责。审查回答、元数据及可信／拒绝结论保存在忽略的 `artifacts/webgpu-rollin/cline-review.json`；该文件是从已返回工具输出转录的监督记录，不冒充原始传输响应。

2026-10-14 打字机 v2 的只读 Blender 脚本审查任务 `2309050b4ceb4347a557f1ae0611b40c` 请求 `max`；实际模型 `deepseek/deepseek-v4.1-flash`，上游仍未确认有效强度。两次 API 调用后以 `finish_reason: length` 失败，仅完成列表和读取，没有审查结论、暂存文件或合入。Codex 完成实现、独立审查与实机验证，不将本轮代码归为 Cline 产出；本任务未自动重试。

2026-10-14。监督工具升级记录见下文；源码与安装说明位于 [tools/cline-delegate](../tools/cline-delegate/README.md)。本机 v2.0.0 已在当前会话加载，并用于打字机 HDR 诊断编码；工具升级本身不改变商品或数据库。

## 打字机诊断的实际派发

任务 d8374b16ee314ec1b76d9bae2a7e32fc 只允许读取指定快照及暂存 scripts/realtime-probe/metrics.mjs、metrics.test.mjs。Cline 编写完整纯 Float32 统计及 9 项固定输入测试，覆盖 hit／miss／unsupported、有限负 HDR、NaN／Infinity、空分类和快照差；没有 GPU、shell、数据库或 Git 权限。

本次请求 max，实际返回模型 deepseek/deepseek-v4.1-flash，上游未确认实际推理强度。8 轮预算耗尽后任务为 failed，验证为 not_run，没有成功回执；MCP 正确拒绝 apply。Codex 单独审查公开完整提案、手动写入主仓库并运行测试，不描述为 MCP 成功合入。审查摘要 b25770fd955acfe0191c1dfec8cdf45cff4125c1e1e5bea2b3dd5afe665a0dc8。

Cline 的 9 项测试实际通过，Codex 补充二进制解码及捕获生命周期 7 项，共 16 项通过。生产 HDR 修复及 GPU／浏览器检查由 Codex 完成，见 [HDR 修复记录](typewriter-hdr-rtt-validation.md)。下次进一步缩小输入、明确先结束可审查提案再扩展；不通过 recover 绕过失败任务的合入资格。

## 分工

Codex 负责架构、任务拆分、实际检查、资源所有权与最终 Git 提交。Cline 负责范围明确的代码、测试、清单和文档提案。适合先派发纯函数、测试补充、重复配置检查和独立适配模块；一次任务指定准确文件及验收条件。

不要直接让模型承担主项目命令执行、GPU 并行测试、数据库操作、Git 操作或个人配置读写。模型只有快照读取、字面搜索、文件授权清单和完整文件暂存四项内部工具。真实测试由 Codex 执行；模型摘要不能证明执行成功。渲染方案是否晋级仍取决于既有画质、互动与稳定性门槛，不由子代理完成状态决定。

## 一次编码任务

1. 检查相关现有代码，明确精确读取／写入路径、文件职责、接口和验收条件。必要规则加入快照，不给整个仓库无限授权。
2. 调用 `cline_start_task`；保存 ID，使用 `cline_task_status` 跟进有限轮次与时间预算。
3. `needs_review` 后调用 `cline_task_result`，审查真实 diff。长 diff 用 `path` 读取完整暂存文件；模型不能直接修改主项目。
4. 以该次 `review_digest` 调用 `cline_apply_task`。输入或提案已变化时拒绝合入，应重新派发，不能强行覆盖。
5. Codex 运行受影响测试、`npm run check`、`npm run build`，检查结果再决定提交与推送。测试失败时保留证据并修正，不把模型文字改写成通过。

逻辑文件授权不是 OS 沙箱。生成代码在审查前不执行。Python 进程具有本机权限，不能据此交给不可信代码随意运行。

## 中止与恢复

取消撤销合入资格，丢弃迟到模型结果；网络连接关闭为尽力处理，仍受 socket 超时约束。MCP 退出取消活跃任务；重启不自动重放收费请求。

应用为逐文件原子替换＋多文件补偿回滚，不是多文件原子事务。准备前持久化 journal，中断后进入 `recovery_required`；监督者检查 diff 后调用 `cline_recover_task`，只回滚，不继续应用。外部修改保留并报告冲突。已持久化应用、任务记录尚未更新时，重启按 stage 对账为 `applied`，不会重新写入或允许取消已应用结果。

路径变成链接、目录等或日志无法安全加载时，保留可见 `blocked` 任务及原始 journal；解决本机冲突再重载。API 错误、截断流、异常结束、缺失 DONE、非法工具参数、限额耗尽均不能成为可应用结果。没有自动模型降级或 API 重试。

## 推理强度与密钥

本机保留 `cline-pass/deepseek-v4.1-flash`，实际返回模型为 `deepseek/deepseek-v4.1-flash`。已通过 `cline_select_model` 保存默认请求 `reasoning_effort=max`。两次连接检查及真实编码任务被网关接受；上游未回报 effective effort，状态明确为 `unknown`，不据此宣称已证明实际最高推理强度。

不注入默认输出 token 限额，仍执行文件、输入、响应、轮次与时间预算。密钥保持本机环境配置，不提交配置、日志、任务原始记录、备份或验收临时文件；不返回私有推理内容。HTTP 不跟随重定向；错误正文不公开，stdio 固定 UTF-8。

## 本轮实际证据

- 桥接器单测 132 项：131 通过，1 项 POSIX 专属跳过；真实 Windows junction 检查通过。涵盖快照／摘要冲突、越界路径、取消迟到结果、持久化恢复、安装故障回滚与 CRLF、真实本机 SSE 保持连接、UTF-8 分块和 Windows GBK 环境输出。
- Cline 实际产出通信模块及其测试，由 Codex 审查修正。随后另派发隔离编码任务，三轮请求完成读取约定及两个完整文件的暂存。目标文件在审查前不存在。
- 新 stdio MCP 完成握手、11 工具发现、结果读取、显式合入及重复合入检查；后者返回 `already_applied`。桥接记录仍是 `validation=not_run`；监督者另外运行生成代码的 38 项单测，全部通过。
- 新安装目录独立进程握手、状态、模型选择与真实 API 检查通过，版本 2.0.0，默认请求 max，实际强度 unknown。
- `npm run check`：389 前端单测和 48 交付工具测试通过，架构、模型、类型及格式检查通过；原有两条 Vue 属性命名警告保留。`npm run build` 通过，原有 BVH 重导出与体积提示保留。

临时证据位于忽略目录 `artifacts/cline-mcp/`，安装备份位于本机 `.codex/mcp/cline_delegate/backups/`。这些检查验证当前监督流程的边界与功能，不证明任意模型输出可靠。大型渲染任务仍需逐项代码审查与真实画面对照。

## 2026-10-14 有符号反射诊断派发

任务 `81345ad835c9408ab0e803965843a96e` 仅授权有符号诊断助手及测试的独立提案，没有 GPU、命令、数据库或 Git 权限。请求 `max`，实际模型仍为 `deepseek/deepseek-v4.1-flash`，有效推理强度未由上游确认。600 秒任务截止后为 failed；本批只有两次列表／读取请求，没有文件暂存、合入或认证失败，不描述为模型完成编码。

Codex 随后自行编写有符号助手及其七项测试并执行验证；这些新增代码不能归为 Cline 产出。此前已经审查接受的九项 Cline 统计测试继续有效，新助手另检查实际 raw／spatial／history GPU 目标，明确旧助手的 `native + delta` 是 CPU 重建而非实际 replacement 目标。当前诊断工具共 23 项测试通过；生产 GPU 和画质验证仍由 Codex 负责，见 [有符号反射记录](typewriter-signed-reflection-validation.md)。

失败任务没有自动重试、改模型或绕过 MCP apply；下一次继续采用小范围、少输入、明确结束条件的独立提案。任务状态或纯函数测试通过均不能替代生产场景及人工画质验收。
