# Trees X — AI 协作入口

开始工作前读取 `.ai/project.md`、`.ai/architecture.md`；修改视觉、Three 或动效时分别读取对应规则。`PRODUCT.md` 保存产品事实，`DESIGN.md` 保存实现后的视觉规范，`.ai/` 保存工程约束。

## 实施前

用简短说明交代：架构位置、文件职责、性能影响、扩展方式。先完成当前阶段验收，再扩展下一阶段。不要把所有阶段一次写完。

## 强制约束

- Vue 3 Composition API + TypeScript strict；禁止 `any` 掩盖类型问题。
- `.vue` 文件最多 300 行。App 只组装，业务 UI 与 Three 场景分离。
- Three 对象用 `shallowRef` / `markRaw`；不得放入 Pinia 深响应状态。
- 一个展示区域只有一个 TresCanvas；禁止自行重复创建 renderer。
- loader、纹理、材质、geometry、controls、动画、监听器都有明确的唯一释放方。
- GSAP 管理复杂动效；Lenis 与 GSAP 共享时钟；遵循 `prefers-reduced-motion`。
- npm 作为包管理器，提交 `package-lock.json`。不使用 `--force` / `--legacy-peer-deps` 绕过兼容冲突。
- 默认不装全局工具。shadcn 组件源码保存在 `src/components/ui`。
- 不编造商品参数、后端接口、性能测试成绩、真实用户或商业背书。

## 验证

运行 `npm run check` 与 `npm run build`。涉及加载、生命周期、相机时运行对应测试；UI 变更检查桌面与移动端。完成时说明已实现、验证证据、待做阶段。

## GitHub 功能节点同步

用户已授权：每个功能更新节点完成验收后，提交并推送到 `https://github.com/WindGears/Trees-X`，无需重复请求同步许可。按完整功能或修复组织提交，不把每次文件修改当作节点；提交说明记录实际行为与相关验证。

- 当前协作分支为 `main`。同步前检查工作区、远端和差异，保留用户改动；远端有新提交时先处理，不使用强制推送覆盖历史。需要新分支时使用 `codex/` 前缀。
- 提交相关源码、资源清单、必要运行资产和文档；大模型按 `.gitattributes` 使用 Git LFS。核查新资源来源和公开条件，不把本机使用等同于可再分发。
- 不提交数据库密码、令牌、`.env.local`、运行日志、数据库备份、原始下载包或临时验收材料。运行数据通过已有初始化与管理流程维护，Git 推送不等于备份 MySQL。
- 检查或推送失败时保留本地成果并明确报告，不宣称已同步。成功后报告分支、提交编号和 GitHub 链接。
- 本规则随开发节点执行，不新增 CI 或定时自动化。
