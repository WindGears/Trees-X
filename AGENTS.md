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
