# Trees X 商品 API

Spring Boot 4.1.1、Java 17、Maven Wrapper 3.8.8、Spring Data JPA、Flyway、MySQL 8.0。监听地址默认 `127.0.0.1:8089`；前端通过 Vite 同源 `/api` 代理访问。

## 本地启动

复制 `.env.example` 为 `.env.local`，填写自己的 Java 路径、数据库用户名与密码。文件已被 Git 忽略，内容按 `KEY=value` 解析，不需要引号。也可以直接设置环境变量，环境变量优先。

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

概要包含 `slug/name/category/description`。详情增加 `presentation`，其中 version 为 1，source 为 `{kind: "procedural", key: "speaker" | "typewriter" | "car"}`，另有 camera/views/hotspots/finishes/actions/structure/guide。字段和样例见 `src/main/resources/samples/products.json`；前后端都校验版本、有限数值、唯一 ID 和导览引用。

未知商品 404；不支持的写请求 405；过长搜索参数 400；配置缺失/损坏或版本不一致 503。错误使用 Spring Problem Detail。首轮没有匿名写接口、鉴权管理端或文件上传。

## 数据所有权与迁移

- `products`：基础信息与排序。
- `presentations`：对应 slug、schema_version 与 MySQL JSON 配置；外键关联 products。
- V1 SQL 建表，V2 Java migration 校验样例并插入三件初始记录。Flyway 只运行一次，应用重启不进行覆盖式 seed。
- 后续修改已发布配置应增加新 migration 或通过将来的管理服务完成，不能修改已应用迁移来覆盖用户数据。
- 逐帧交互不访问服务器；程序化样板不需要模型文件。后续 GLB/贴图保存为文件，数据库仅存资源引用/元数据。

`npm run server:test` 启用真实 MySQL 集成测试，固定连接本机独立 `trees_x_test`（不会采用业务库 URL）；使用同一组用户名/密码。测试会修改、重启核验并还原该测试库的一条记录。原生 `./mvnw test` 运行纯契约测试，未显式设置 `TREES_MYSQL_TEST=true` 时会跳过集成测试；不要把这个结果写成 MySQL 已验收。

本仓库 Wrapper 从 Maven Central 获取 Maven/依赖。若本机需要网络代理，通过当前终端的 `MAVEN_OPTS` 配置 Java HTTP(S) 代理；仓库没有写死个人代理地址或数据库密码。
