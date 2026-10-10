# 本机生产演示操作

适用于当前 Windows 电脑。正式目录是打字机、钢琴、Reventón；默认打字机。前端 127.0.0.1:5181，Spring Boot 127.0.0.1:8089，MySQL 使用独立 trees_x。生产预览与开发服务器不能同时占用相同端口。

## 安装与准备

首次安装需要联网：安装项目支持的 Node、Java 17、MySQL 8，执行 npm ci，拉取 Git LFS 运行资产，并由 Maven Wrapper 下载构建依赖。开发者导入当前三件商品配置后再准备演示；Git 拉取不包含已维护的 MySQL 数据，首次空库需要按 README 的配置接入步骤初始化三件正式展品。

server/.env.local 已被忽略。填写 TREES_DB_USERNAME、TREES_DB_PASSWORD；可设置 TREES_JAVA_HOME 和 TREES_MYSQL_BIN（MySQL bin 目录）。Java 默认使用当前用户 .jdks/ms-17.0.18，不能以系统 Java 8 替代。管理员沿用本地配置及已持久化账号；演示启动关闭账号重置开关。

在仓库根目录执行：

```powershell
npm run demo:doctor
npm run demo:prepare
npm run demo:doctor
npm run demo:start
```

第一次 doctor 尚未准备产物时会返回失败，同时列出具体缺项，这是正常提示。doctor 检查 Node、指定 Java、MySQL TCP/配置、端口、三件源及 dist 资源、LFS 指针、字节摘要与 JAR，也完整核对源与 dist 的 draco 解码器和 covers 封面目录摘要。MySQL 认证和实际商品配置在启动后的真实 API 就绪核验中确认，TCP 可达不等于业务就绪。

prepare 构建前端与后端可执行 JAR，核对源资源与 dist 清单、解码器及封面，并记录产物与源码摘要。构建前后输入指纹必须一致；准备期间修改源码或这些静态输入会拒绝写入新的准备记录，须停止编辑后重新准备。它允许构建阶段使用本地 Maven 缓存，依赖未安装时可能需要联网。源码、配置静态文件或产物变动后应重新 prepare；已登记演示运行中不允许 prepare。

start 直接运行指定 Java 的 JAR 和本地 Node/Vite 生产预览，不运行 Maven、npm install 或下载依赖。真实 API 必须提供三件正式 GLB，清单摘要与运行资源必须匹配，才报告就绪。打开 http://127.0.0.1:5181 和 /admin；五分钟演示步骤见 demo-walkthrough.md。

## 停止与异常

```powershell
npm run demo:stop
npm run demo:start
```

start/stop/prepare 共用本地控制锁。已就绪时重复 start 核验并复用已登记服务。stop 核验 PID、启动时间、可执行文件、完整启动命令和本次运行标识，只停止本工具登记的两个项目进程，不停止 MySQL。端口被开发服务器或其他程序占用时，请在对应终端正常关闭；工具不会自动结束它。

控制锁 artifacts/demo/control.lock 不自动回收。若控制命令异常退出后遗留锁，先核对锁中登记的 CLI PID 和启动时间，并确认没有 start、stop 或 prepare 正在运行，再手动移走该锁文件。只看到端口仍运行不能据此删除控制锁；state.json 是服务登记，control.lock 是正在执行的控制命令，两者职责不同。

PID 已退出时清理失效登记；PID 身份改变则拒绝停止并保留状态供检查。启动失败或中断时清理本次已创建的进程。不要把别的进程登记到状态文件，也不要手动修改 prepared.json 以跳过摘要检查。

启动记录位于 artifacts/demo/state.json，准备记录为 prepared.json，每次运行日志位于 artifacts/demo/<运行标识>/。这些内容已被 Git 忽略；日志和运行记录不应包含凭据。启动失败先看控制台明确缺项，再查看对应 server.log/preview.log。MySQL 仍需由 Windows 服务提供。

## 整库备份与独立恢复演练

```powershell
npm run demo:backup
npm run demo:restore-check -- artifacts/demo/backups/<备份目录>
npm run demo:verify-restored -- artifacts/demo/backups/<备份目录>
```

backup 只读正式 trees_x，使用一致性转储并核对转储前后的表与数据，覆盖全部业务表及 Flyway 记录。输出 database.sql、metadata.json、resources.json，保存 SQL 摘要及逐列/数据摘要。SQL 含管理员密码散列及业务数据，保持本地，不提交 Git。认证通过短期本地配置文件传入 MySQL CLI，不在命令行列出密码。

restore-check 只接受本工具在 artifacts/demo/backups 下生成且摘要匹配的备份，拒绝数据库切换指令、越界目标和非空恢复库。固定导入独立 trees_x_restore_test，核对全部表、列、数据摘要及迁移记录，同时确认正式库未变化；不会覆盖、清空或恢复到 trees_x。恢复库已有数据时不能再次导入，使用 verify-restored 只读复验；隔离库经过管理端编辑后如不再与备份一致会明确失败。不要删除正式库来让测试通过。

resources.json 是同源运行文件的大小与摘要清单，不是模型备份副本。须另存清单对应的 public 文件及制作母版；尤其汽车依赖完整模型、贴图、运动数据及环境。源文件、运行资产、数据库备份和已安装依赖共同组成可恢复的本机交付。恢复验证不表示已获资源再分发许可。

## 离线与验收

完成安装和 prepare 后，断开外网、保留本机连接，MySQL 服务运行时可执行 start。浏览器检查采用禁止外网请求、允许 loopback 的隔离方式；不使用浏览器全离线选项，因为它也会阻止本机 API。该检查与本人实际断网走查分别记录。

```powershell
npm run check
npm run server:test
```

联合与性能检查需要开发版的实际 Three 场景桥接。先 `npm run demo:stop` 停止已登记的生产服务，再在两个终端分别执行 `npm run server:dev` 和 `npm run dev -- --strictPort`。然后串行执行（避免多个高精场景争用同一GPU）：

```powershell
npm run test:demo-joint
npm run test:demo-performance
```

结束后在原终端正常关闭这两个开发服务，再回到已准备的生产版：

```powershell
npm run demo:start
npm run test:demo-production
```

联合与测量脚本默认通过本机开发工作台检查实际 Three 节点及资源；生产构建另跑生产浏览器回归。正式联合默认每件十次切换及至少1200秒持续操作。正式测量每件五次浏览器缓存清除的加载与三轮各30秒鼠标交互；帧间隔描述浏览器调度/渲染命令提交间隔，不是 GPU 耗时。缩短脚本参数只能作为 smoke 检查，不得计作正式验收。

验收状态和证据索引见 demo-validation.md。本人走查和后续6—8人形成性测试不能由自动化代签。
