# Trees X 商品 API

Spring Boot 4.1.1、Java 17、Maven Wrapper 3.8.8、Spring Data JPA、Spring Security、Flyway、MySQL 8.0。监听地址默认 `127.0.0.1:8089`；前端通过 Vite 同源 `/api` 代理访问。

## 本地启动

复制 `.env.example` 为 `.env.local`，填写自己的 Java 路径、数据库用户名与密码。文件已被 Git 忽略，内容按 `KEY=value` 解析，不需要引号。也可以直接设置环境变量，环境变量优先。

管理员初始化：默认演示账号为 `admin / 123456`。可用 `TREES_ADMIN_USERNAME`（3—80位字母/数字/下划线/连字符）和 `TREES_ADMIN_PASSWORD`（至少6位且UTF-8不超过72字节）覆盖。仅管理员表为空时插入BCrypt(12)散列，正常重启不重设账号；显式配置空账号或空密码时跳过初始化。

已有数据库需要换账号时，停止后端，在本次PowerShell终端设置 `$env:TREES_ADMIN_RESET='true'` 后运行 `npm run server:dev`，完成一次重置；停止后移除该变量（`Remove-Item Env:TREES_ADMIN_RESET`）并正常启动。重置仅替换单管理员记录，不修改商品、分类或展示配置。不要将重置开关写进 `.env.local`，避免以后启动时重复替换账号。

从仓库根目录运行：

```sh
npm run server:dev
npm run server:test
npm run server:build
```

脚本优先使用 `TREES_JAVA_HOME`，否则检查当前用户的 `.jdks/ms-17.0.18`；仅修改子进程的 JAVA_HOME/PATH。Java 低于 17 时拒绝启动，不改系统 Java。`TREES_DB_PASSWORD` 未配置时明确报错。

默认 JDBC URL 为独立的 `trees_x` 数据库，允许首次创建。账号需有该库建库/建表/读写及迁移权限；请勿把 URL 指向博物馆或其他业务数据库。开发脚本不清库、不重建表。

## 只读 API

| 请求                                        | 结果                                         |
| ------------------------------------------- | -------------------------------------------- |
| `GET /api/v1/products`                      | 按 sortOrder 排序的商品概要数组              |
| `GET /api/v1/products?q=音箱&category=数码` | 名称包含搜索、分类精确过滤；无结果返回空数组 |
| `GET /api/v1/products/{slug}`               | 商品基础信息与 `presentation` 配置           |
| `GET /api/v1/categories`                    | 有上架商品的分类id/name数组                  |

概要包含 `slug/name/category/description`。详情增加 `presentation`，其中 version 为 1，source 为 `{kind: "procedural", key: "speaker" | "typewriter" | "car"}`，另有 camera/views/hotspots/finishes/actions/structure/guide。字段和样例见 `src/main/resources/samples/products.json`；前后端都校验版本、有限数值、唯一 ID 和导览引用。

当前支持v1/v2/v3：v2/v3包含舞台并可引用已注册GLB资源包；v3增加progress动作、motion轨道、可选热点anchor、structureActionId及guide.progress。轨道区间在0—1，旋转单位轴且单段≤180°；前后端检查动作/结构/导览引用及与旧变换通道冲突。进度意图和实际播放不调用后端；完整样板见src/main/resources/samples/progress-products.json。

公开只返回listed=true商品，下架与未知详情404；公开写被Security/CSRF拒绝403；过长搜索400；配置损坏或版本不一致503。业务错误使用Spring Problem Detail，认证/CSRF错误返回JSON detail。没有匿名写接口或文件上传。

## 基础管理API

全部管理路径位于/api/v1/admin，除csrf/login之外需要ADMIN会话。前端入口/admin。Session cookie为TREESSESSION，HttpOnly、SameSite=Strict、/api路径，30分钟过期。前端每次写入前GET masked CSRF token，并使用返回的headerName发送；登录与退出后重新读取，不关闭CSRF保护。采用 [Spring Security默认Session CSRF与SPA指引](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html)。

| 请求                                | 行为                                                 |
| ----------------------------------- | ---------------------------------------------------- |
| GET session/csrf                    | {headerName,token}                                   |
| POST session/login                  | application/x-www-form-urlencoded：username/password |
| GET session / POST session/logout   | 当前账号 / 失效会话                                  |
| GET products / GET products/{slug}  | 全部商品概要 / {item,presentation}，含下架           |
| POST products / PUT products/{slug} | 创建（默认下架）/更新基本信息与配置                  |
| POST products/preview               | 验证输入返回ProductDto，不落库                       |
| PUT products/{slug}/visibility      | {revision,listed}上下架                              |
| GET/POST categories                 | 全部分类及使用数 / 创建                              |
| PUT categories/{id}                 | 改名、排序及revision；同步关联商品                   |
| DELETE categories/{id}?revision=…   | 只删除无商品引用的分类                               |

商品写DTO：slug、name、categoryId、description、cover、displayStatus、sortOrder、revision、presentation。分类写DTO：name、sortOrder、revision。配置v1/v2/v3均使用已有验证器，封面及资源路径只能同源。商品基本信息和配置事务保存；并发版本不匹配409，校验失败400，未登录读取401，无效/缺失CSRF403。程序化/GLB实际节点与材质绑定由预览loader检查，契约合法不代表模型文件完整或画质达标。

本阶段直接保存配置，不提供独立草稿、不可变发布快照、历史回滚、上传、商品删除或归档。上架商品修改后，已开启的工作台仍使用该次配置，重新加载读取更新。公开数组列表契约保持不变。

管理易用性D2不增加接口或迁移。前端常用表单与高级JSON共用局部草稿，JSON显式应用后仍通过已有完整验证器；POST预览和实际相机取景回填不保存数据。默认回填同步camera与perspective，保存仍走已有PUT products/{slug}事务与revision检查。真实MySQL测试额外检查镜头/全景视角保存和Spring重启保持、动作轨道不变。管理操作见 [操作说明](../.ai/admin-operations.md)，本轮证据见 [D2验收](../.ai/admin-usability-validation.md)。

## 数据所有权与迁移

- `products`：基础信息与排序。
- `presentations`：对应 slug、schema_version 与 MySQL JSON 配置；外键关联 products。
- `administrators`：用户名与密码散列；`categories`：名称、排序与乐观锁。products新增category_id、listed、revision、updated_at。
- V1 SQL 建表，V2 Java migration 校验样例并插入三件初始记录。Flyway 只运行一次，应用重启不进行覆盖式 seed。
- V3增加可选封面和资产完成度；V4仅给三件prototype样板的空封面字段填入同源真实Canvas截图，不覆盖已有封面或正式资产。V1—V3保持原样，V4已通过真实MySQL重复执行和自定义封面保留检查。
- V5 Java迁移只对schema_version=1且配置与V2默认种子语义一致的音箱/汽车升级v3。基础信息、封面和打字机不变；自定义/已升级/不存在的记录跳过并写INFO日志。真实MySQL测试验证默认升级、自定义保留、重复执行及Spring重启。V1—V4文件不改。
- V6追加基础管理数据，沿用旧表utf8mb4_unicode_ci，迁移旧分类并保留上架状态、商品内容和配置；V1—V5不修改。产品revision同时保护信息、配置和上下架；分类改名也提升关联商品revision。
- 后续修改已发布配置应增加新 migration 或通过将来的管理服务完成，不能修改已应用迁移来覆盖用户数据。
- 逐帧交互不访问服务器；程序化样板不需要模型文件。后续 GLB/贴图保存为文件，数据库仅存资源引用/元数据。

`npm run server:test` 启用真实MySQL测试，固定trees_x_test；使用同一组数据库及管理员初始化配置。覆盖认证、会话ID更新、CSRF轮换、预览不落库、创建、上下架、冲突、分类引用和Spring重启。测试恢复自己的记录并清理自己的新增项，不清库。原生Maven未设置TREES_MYSQL_TEST=true时跳过集成测试，不能算MySQL验收。

本仓库 Wrapper 从 Maven Central 获取 Maven/依赖。若本机需要网络代理，通过当前终端的 `MAVEN_OPTS` 配置 Java HTTP(S) 代理；仓库没有写死个人代理地址或数据库密码。
