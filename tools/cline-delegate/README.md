# Cline 监督式子代理 MCP v2

这里保存本地 Python 标准库桥接器。`cline_mcp.py` 提供 stdio MCP，`transport.py` 处理完整响应与超时，`tasks.py` 管理有预算的异步任务，`workspace.py` 管理文本快照、暂存提案及显式应用；`install.py` 更新已经安装的桥接目录。它不进入 Trees X 的前端、Three 场景或 GPU 运行路径。

子代理获得的是精确文件授权：读取创建任务时的快照、在快照内搜索，以及暂存完整 UTF-8 文件。它没有 shell、Git、测试执行或实时项目写入工具。监督者审核后调用 `cline_apply_task` 才会写入项目。这是逻辑能力边界，**不是操作系统沙箱**；Python 进程与其他本机进程仍具有各自的操作系统权限，不应据此执行不可信程序。

## 安装与重新加载

需要 Python 3.11 或更新版本。安装器要求 Codex 已有 `[mcp_servers.cline_delegate]` 配置，其 `args[0]` 指向已经存在的 `%USERPROFILE%\.codex\mcp\cline_delegate\cline_mcp.py`；使用其他 Codex 目录时传 `--codex-home`。安装器不会创建新 MCP 条目，也不接受任意安装目标。

在仓库根目录执行：

```powershell
python tools/cline-delegate/install.py --workspace "I:\ssr\NIXUS\Trees X"
```

安装仅部署四个桥接模块，并在选中条目的 `env` 中设置 `CLINE_WORKSPACE_ROOT` 与 `CLINE_REASONING_EFFORT=max`。既有 API key、认证文件、其他环境变量、模型设置和其他 TOML 条目保留。已保存的 `reasoning_effort` 优先于环境默认值；重载后用 `cline_status` 检查实际请求设置，需要最高档时用 `cline_select_model` 保存 `reasoning_effort=max`。当前支持无 `env` 或单行内联 `env`；嵌套环境表等无法安全合并的布局会明确拒绝。

成功输出包含模块 SHA-256、当前备份目录与 `reload_required=true`。**重启 Codex 或重新加载 MCP，确保启动新的 stdio 进程**，然后调用 `cline_status` 核对版本 `2.0.0`、工作区与工具能力。已经运行的旧进程不会因磁盘文件更新而自动升级。

安装前的模块和完整 `config.toml` 保存在本机桥接目录的 `backups/<时间戳>/`；这些备份可能含既有配置凭据，应留在本机。安装替换失败会尝试恢复原模块与原配置。需要手动回退时先停止 MCP 进程，将该次备份中的模块与 `config.toml` 恢复到原位置，再重新加载；对该次安装新加入且备份里不存在的模块按备份情况移除。回退配置前核对安装后新增的本地设置，避免覆盖后续修改。任务状态目录独立保留。

## 工具与任务流程

| 工具                 | 用途                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| `cline_status`       | 查看版本、工作区、选中模型和真实能力边界；不返回 API key。                  |
| `cline_list_models`  | 查看上游目录，可用 `query` / `group` 筛选；目录不证明调用权限。             |
| `cline_select_model` | 本地保存 `model_id` 和可选 `reasoning_effort`，不调用模型。                 |
| `cline_test_model`   | 显式发起一次可能计费的短连接测试。                                          |
| `cline_delegate`     | 一次性文字／代码建议，可附精确 `files`；不执行。                            |
| `cline_start_task`   | 创建异步任务，声明 `read_files`、`write_files` 和验收标准。                 |
| `cline_task_status`  | 按 `task_id` 看状态、调用次数、usage 与文件工具审计；省略 ID 列出近期任务。 |
| `cline_task_result`  | 读取摘要、提案 diff 和 `review_digest`；传 `path` 读取完整暂存文件。        |
| `cline_cancel_task`  | 取消排队、运行或待审任务，并撤销应用资格。                                  |
| `cline_apply_task`   | 监督者使用已审核的 `task_id`、`review_digest` 显式应用。                    |
| `cline_recover_task` | 对 `recovery_required` 任务显式回滚中断应用，需当前 `review_digest`。       |

任务示例（MCP 工具参数）：

```json
{
  "prompt": "修复指定文件中的错误，并暂存完整文件供审核。",
  "acceptance": "解释修改原因，列出需由监督者运行的验证。",
  "model": "deepseek/deepseek-v4.1-flash",
  "role": "coder",
  "read_files": ["src/lib/example.ts", "src/lib/example.test.ts"],
  "write_files": ["src/lib/example.ts"],
  "reasoning_effort": "max",
  "max_rounds": 6,
  "max_wall_seconds": 900
}
```

文件授权是相对于已配置工作区的**精确路径**，不支持目录或通配符。已有写入目标也在启动时捕获原内容；新文件可以声明为写入目标。项目存在的 `AGENTS.md`、`.ai/project.md`、`.ai/architecture.md` 会加入读取快照。路径穿越、符号／硬链接、Windows 重解析点、凭据路径、构建与运行数据目录、二进制以及超限文件会拒绝。单文件最多 512 KiB，读取总量最多 2 MiB，暂存总量最多 4 MiB；读取和写入授权上限分别为 50 和 20 个文件。

启动后保留返回的 `task_id`，用状态工具跟进。任务通常经过 `queued → running → needs_review`。查看 result 的实际 diff；`diff_truncated=true` 时使用带 `path` 的 result 读取完整文件。摘要中的“测试通过”属于模型文字，验证始终报告 `not_run`。

审核通过后，将该次 result 的 `review_digest` 原样传给 `cline_apply_task`。摘要绑定任务、授权和提案；摘要变化或原始读取／写入文件发生变化会阻止应用，应重新核对并创建新任务。取消后不能再应用。监督者在应用后运行项目所需检查，再决定 Git 提交与推送；这些动作由监督者承担。

## 请求强度、限额与恢复

`reasoning_effort` 支持 `low`、`high`、`max` 或 `null`。`max` 是发送给上游的请求值；`effective_reasoning_effort` 在上游未明确返回时为 `null`，验证状态为 unknown。成功的连接调用或目录中的推理选项不能证明上游实际使用了最高强度。

省略 `max_output_tokens` 时桥接器不注入输出 token 上限；上游模型限制仍生效。任务默认最多 6 轮、900 秒，可显式设置为 1–12 轮、30–1800 秒。每个进程最多同时运行两个任务。完整响应、读取／暂存字节预算与传输大小上限仍受检查；截断或不完整响应不会成为可应用任务。网络请求不自动重试，主动取消连接为尽力处理，完成时间受 socket 超时约束。

任务快照、暂存内容、审计和应用 journal 默认位于 `%USERPROFILE%\.codex\mcp\cline_delegate\state`；可用 `CLINE_STATE_ROOT` 指定本地状态目录。进程重启不会重放 API 调用，也不会自动应用提案；停止时仍在运行的任务标记为 `interrupted`，需要重新派发。

应用使用逐文件原子替换与多文件补偿回滚，**不是多文件原子事务**。失败后若无法安全恢复全部文件，状态为 `recovery_required`。监督者先检查当前项目与 `cline_task_result`，再使用当前 `review_digest` 调用 `cline_recover_task`；它只尝试回滚，不继续写入提案，也不会覆盖与已知原始／提案字节不匹配的外部修改。成功回滚后任务标记为 `interrupted`，须重新创建任务；仍无法恢复时保留 journal 和本地成果供人工检查。实时路径变为链接或目录、暂存日志无法安全加载时，任务仍显示为 `blocked`，禁止写入；先处理本机冲突再重载，不能把记录丢失当作恢复成功。

## 离线验证

在仓库根目录执行：

```powershell
python -m unittest discover -s tools/cline-delegate/tests -v
npm run check
npm run build
```

桥接器单测使用临时工作区、临时 Codex 目录和假 transport，不调用付费模型、不读取个人认证设置，也不操作 GPU 或 Git。安装测试覆盖完整配置和认证保留、目标目录约束、备份与模块摘要，以及模块／配置替换故障后的回滚。真实连接测试须单独通过 `cline_test_model` 显式发起；离线通过不能证明上游可用性或实际推理强度。
