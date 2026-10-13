# 打字机 v1 资产核验与制作口径

2026-10-13。WorkBuddy 只读清单经 Codex 独立核验：解析实际 GLB JSON/BIN，计算文件与内嵌图像摘要，检查源节点、材质和运行源码。原输出保留在忽略目录 `artifacts/workbuddy-handoff/asset-audit-output/`；纠正说明见同目录上级 `codex-review.md`。本记录是资产事实，不是画质通过，也不表示 v2 已制作。

## 输入身份与公开边界

运行包为 `public/models/bundles/kimi-typewriter/v1/`，来源为用户自有 `https://k3-typewriter.ok.kimi.link/` 项目。沿用 manifest.provenance 记录的本人复用与 GitHub 同步授权；第三方参考照片排除，不推导额外下游许可或将整个包称为 CC0。Three.js 自身 MIT 与模型/参考资料授权分别记录。

| 文件          |     字节数 | SHA-256                                                            |
| ------------- | ---------: | ------------------------------------------------------------------ |
| model.glb     | 25,983,744 | `b61293acf1eb49f2d7cbcba0ae59214346130b8df0c32685cf954502f37ff0f4` |
| rig.json      |    517,962 | `047cddb65994640a25f4fad191131423b1ceafce6b4ab474aa906ac1d4576154` |
| manifest.json |          — | `c216ad6101fabe469f7effa061a237fd3f1ad440550cafb10ff5c5f345a770bd` |

六个包内文件的字节数与摘要，以及 51 张内嵌 PNG 的摘要均与 WorkBuddy 清单吻合。model＋rig 为 26,501,706 字节，正好用满旧清单 maxBytes；候选 v2 新增属性/贴图后须按真实资源建立新预算，不能套用旧预算或改写 v1。

## 计数：定义、实例与三角面分别记录

| 口径                      |      实测 | 含义                                                                             |
| ------------------------- | --------: | -------------------------------------------------------------------------------- |
| 语义部件                  |       572 | rig 部件与 GLB `part-NNN` 节点                                                   |
| 表面实例                  |      2257 | `part-NNN-surface-K` 节点，不是 GLB mesh 定义数                                  |
| GLB mesh / primitive 条目 | 298 / 298 | 每条 mesh 含一个 primitive                                                       |
| accessor 几何签名         |       278 | POSITION、NORMAL、UV0、TANGENT、indices 的 accessor 标识组合；材质不属于几何签名 |
| mesh 条目三角面合计       |   400,384 | 对 298 条 primitive 累加，未消除同几何换材质的重复条目                           |
| accessor 签名去重三角面   |   394,388 | 对上述 278 签名去重后累加，不宣称空间坐标焊接去重                                |
| 装配实例三角面            | 1,257,132 | 根据 2257 表面实例使用的 primitive 累加；manifest.maxTriangles 采用此口径        |
| 材质 / 内嵌图像           |   66 / 51 | 51 PNG 合计 312,056 字节；没有独立运行贴图文件                                   |

WorkBuddy 的 `uniqueGeometryTriangles: 400384` 应读作 mesh 条目合计，不能作为 278 几何签名的去重面数。几何条目复用和运行批处理都不改变语义部件身份。

## UV 与切线制作范围

| mesh ID | 源材质 | 对应部件 | 三角面 | 表面引用数 |
| ------: | ------ | -------- | -----: | ---------: |
|      61 | enamel | 095      | 10,652 |          1 |
|      66 | enamel | 096      |  5,756 |          1 |
|      67 | enamel | 097      | 40,140 |          1 |
|      68 | enamel | 097      | 10,892 |          1 |
|      74 | enamel | 098      | 53,156 |          1 |
|      75 | enamel | 098      |  5,488 |          1 |
|      89 | ribbon | 112      |    180 |          1 |
|      90 | red    | 112      |    180 |          1 |
|     273 | steel  | 493      |  3,840 |          1 |
|     274 | steel  | 494      |  3,840 |          1 |

十个 primitive 共 135,164 面，没有 TEXCOORD_0；每项仅被一个表面引用。“共享材质含无 UV primitive”不等于“十个 primitive 都被多次实例复用”。已有 UV 与字符图不重写。

全部 298 primitive 有 NORMAL、没有显式 TANGENT。Three GLTFLoader 在缺 TANGENT 时允许使用 derivative tangents；有 UV 的法线贴图不因此完全不可用。导数 TBN 在着色阶段从位置/UV 导数构建局部基，显式 MikkTSpace 则将 UV/法线对应的切线及手性存入几何，用于烘焙基的一致性和各向异性方向。二者不等同；缺 UV 表面仍须先补 UV。新切线、接缝拆分和手性必须经空间形状/法线误差与近景检查，不能由计数推断质量。

## 材质静态事实与运行状态

- 源 GLB 51 个 BLEND 材质均是字符/铭牌贴片。BLEND 在 GLTFLoader 中设置 transparent/depthWrite，不使用 MASK 的默认 alphaTest=0.5；原生贴片 alphaTest=0。WorkBuddy materials.csv 的 0.5 推断错误，不能用作文字裁剪依据。
- 原 keys 材质具有 clearcoatFactor=0.28、clearcoatRoughnessFactor=0.25；清单将其写成未声明，是 extension 检查条件错误。enamel/shellGloss/shellRim 另有源清漆参数与运行覆盖，需分别记录。
- GLB 没有 normal/roughness/anisotropy 贴图；运行 `typewriterFinishes` 的 128² DataTexture 与各向异性标量属于适配器覆盖，不是源资产纹理。enamel/steel 因包含无 UV 几何没有安装这些微图。
- `materials.csv.runtimeClass` 只依据源扩展推测，未执行运行各向异性及完整支路检查，不能作为 RealtimePhysicalMaterial 实测分类。
- 历史 `nativeTransparent: 54` 是整个 scene 的运行统计：51 源贴片＋远地面、平面反射、接触阴影三种舞台材质。`coordinator.prepare` 安装整个 scene；统计范围不应写作“54 个源 BLEND 贴片”。
- glTF 校验实际为 0 error、15 KHR_MATERIALS_DISPERSION_NO_VOLUME warning、85 UNUSED_OBJECT info。UNUSED_OBJECT 不一定是未挂入场景的 mesh，未逐项确认前不自动清理；原清单“100 条 UNUSED_OBJECT”应纠正为 85。

## 证据与后续边界

WorkBuddy 证据索引的 215 路径和对照页 55 图片引用均存在，工程 PASS 与画质未通过分开。索引中的历史三份报告未记录 fullJointAcceptance，其余实时相关九份为 false；准确结论是没有报告证明本轮完整联合验收。原提交号缺失，不据当前 HEAD 推断。

本核验不验证渲染收益、碰撞、切线手性、UV 接缝空间误差或帧间隔。旧运行测试不能替代新素材或新管线检查。阶段二按 [实时画质路线](typewriter-realtime-quality-roadmap.md) 在节点一通过后进行；保留 v1 和动作摘要，运行副本制作后再验收文字、漆面、拉丝与完整互动。
