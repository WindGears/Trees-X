# Trees X

本科毕业设计《基于 Three.js 的 Web 端三维商品展示与交互系统的设计与实现》。当前为桌面优先的多商品交互舞台。

## 运行

使用项目 package.json 声明的 Node 版本与 npm。

```sh
npm ci
npm run dev -- --port 5180 --strictPort
```

打开 `http://127.0.0.1:5180/`。顶部“商品目录”支持分类、搜索与选择；舞台左侧可前后切换。`?product=toy-racer` 等链接可直接进入指定商品，支持刷新与浏览器后退。

```sh
npm run check
npm run build
npm run preview -- --port 5181
```

## 已实现

- Vue 3 + TypeScript + Vite + TresJS + Three.js + GSAP + Lenis + Pinia，Tailwind/shadcn-vue。
- 七件样品：原创 FORM / 01 音箱，以及从用户 heritage-museum 商品版复用的手柄、主机、边桌、绿植、家具套件、赛车。
- 同一个 TresCanvas 切换模型；加载/失败重试、请求取消、迟到结果隔离、资源释放与 WebGL 上下文恢复。
- 拖动、命名视角、缩放、局部试色、部件聚焦、外观分层和二/三步导览，按实际模型能力显示。
- 桌面 HDR 反射、能量环、1600 粒子、全息扫描、Bloom/暗角与 2.4 秒演出；每件商品每次页面会话自动播放一次。重播不重置产品状态，用户输入立即中止。
- 手势观察采用独立运动时钟与有限惯性；可见停手快速制动，离镜缓慢停止，重新入镜建立新基线。
- 手势选择默认试用悬停确认，也可切换捏合确认；共享部件热点与配色/结构/视角操作盘。漏检不累计确认时间，鼠标可随时接管。
- 摄像头须手动开启，原始画面留在本机，MediaPipe Worker/模型/WASM 自托管。关闭或页面进入后台即停止摄像头。

所有商品都是三维展示样品；试色不代表真实产品配色，不含价格、购买或性能承诺。参考项目的 Spring Boot 后台、管理员/上传/数据库尚未接入 Trees X；多商品同时陈列、AI 讲解与滚动叙事仍是后续工作。

## 验证

先启动本地服务，再执行：

```sh
npm run test:browser
npm run test:experience
npm run test:collection
npm run test:render-handoff
npm run test:gesture
npm run test:gesture-interaction
npm run test:gesture-motion
npm run test:gesture-dwell
npm run test:visual
```

浏览器脚本使用本机 Microsoft Edge；默认检查 5180，可用 `CHECK_URL` 指定其他地址。截图/报告写入 `.impeccable/review/`。手势自动化使用合成视频或关键点，不能代替真人识别率与疲劳度验收。

## 配置与资源

- `src/data/products.ts`：基础类型与原创音箱配置。
- `src/data/collection.ts`：导入商品、实际节点、相机视角、材质与世界坐标展开配置。
- `public/models/collection/manifest.json`：来源、作者、许可记录、SHA-256、体积、面数、节点。
- `public/draco/`：当前 Three 版本的自托管 glTF Draco 解码器与 Apache-2.0 许可。
- `public/covers/`：参考项目封面与原创模型渲染截图；目录不额外创建 Canvas。
- `public/textures/`、`public/fonts/`、`public/gesture/`：环境、字体、识别资源来源记录。

GLB 交付格式为自包含原始/Draco GLB，单模型上限 5 MiB / 10 万三角形。Meshopt/KTX2 尚未接入。Pinia 只存可序列化数据，Three 对象由局部生命周期拥有。

后续开发先读取 `.ai/project.md`、`.ai/architecture.md`；本次整合及验证见 `.ai/heritage-integration.md`，视觉规范见 `DESIGN.md`。
