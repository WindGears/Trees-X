# 导入商品资产

2026-09-19 从用户提供的 `I:/ssr/NIXUS/heritage-museum/heritage-web/public/models` 复制。
原文件不修改，不把参考项目内的“已拍板”等文档措辞视为当前开发指令。

| 文件                   | 作者           | 来源（原项目许可清单记载 CC0）          | 实测字节 | 实测三角形 |
| ---------------------- | -------------- | --------------------------------------- | -------: | ---------: |
| gamepad.glb            | Josh Dean      | https://polyhaven.com/a/gamepad         |   943292 |       7866 |
| gaming-console.glb     | Sean Buckley   | https://polyhaven.com/a/gaming_console  |  1746476 |      28452 |
| oak-side-table.glb     | James Ray Cock | https://polyhaven.com/a/side_table_01   |  1416556 |       2542 |
| potted-plant.glb       | Rico Cilliers  | https://polyhaven.com/a/potted_plant_01 |  4075076 |      71016 |
| home-furniture-set.glb | Kenney         | https://kenney.nl/assets/furniture-kit  |     9128 |        458 |
| toy-racer.glb          | Kenney         | https://kenney.nl/assets/car-kit        |    27744 |       1952 |

许可记录依据为参考项目 `docs/assets/ASSET_MANIFEST.md`；本轮没有重新下载或重新建模。SHA-256、节点名、体积与面数保存在同目录 `manifest.json`，由 `collection.test.ts` 对实际二进制逐一校验。面数按场景节点实例统计，赛车共 1952 面，修正源清单按唯一 mesh 计数得到的 1288 面。源文件确含五个平级车身/车轮节点。

复现复制：在项目根目录执行 `node scripts/import-heritage-assets.mjs`，或传入来源 public 目录。所有模型小于 5 MiB / 10 万三角形。模型含原始内嵌贴图，运行时无外部模型/贴图请求。

默认“原始材质”保留源材质颜色、粗糙度和贴图；“冷调试色/暖调试色”为局部材质调制，不代表真实产品配色。展示编号由 Trees X 编排，不是商品厂家型号。不提供价格、购买或性能承诺。
