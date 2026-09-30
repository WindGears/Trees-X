---
version: 1
slug: 'src-components-reventon-reventonexperience-vue'
primary_target: 'src/components/reventon/ReventonExperience.vue'
related_targets:
  - 'src/components/reventon/ReventonScene.vue'
  - 'src/components/reventon/ReventonStudio.vue'
  - 'src/assets/styles/reventon.css'
  - 'src/lib/reventon/assets.ts'
  - 'src/lib/reventon/motion.ts'
  - 'src/lib/reventon/director.ts'
  - 'src/lib/reventon/materials.ts'
  - 'src/lib/reventon/contactShadow.ts'
  - 'src/data/reventon.ts'
mode: 'Experience'
---

# Reventón 实机演示：用户纠正后的唯一方向

2026-09-30 当前状态：真实三维资产与固定导演流程已在 `/?product=reventon` 实现。此记录锁定 Reventón 的局部 Experience 方向，其他展品的视觉与交互规范维持现状。

2026-09-28 用户明确纠正：需要烘焙阴影与材质后的实时三维 Demo，不接受预渲染影片作为替代。此前「视频章节播放器」「影片解码即可交付」均为错误理解，本文件覆盖所有旧文档中的冲突要求。

## 方向合同

- 主体：真实恢复的完整汽车主导第一屏，几何与材质细节是观察对象。
- 视觉依据：用户原 beauty 图的浅灰摄影棚，沿用 Trees X 的 Manrope 与现有中文字体体系；不是全站视觉替换。
- 叙事：闭合轮廓 → 剪刀门开启 → 座舱 → 现有部件分离 → 复原，由真实对象与相机完成。
- 控件：第一屏保留完整汽车与克制标题，四章节、播放/暂停、进度和回到开始集中在底部；手机必须保留商品目录出口。
- 场景：全幅唯一 TresCanvas，无自由轨道操作；源 JPG 只用于目录封面与视觉对照，不构成场景背景或实机截图。

## 最终交付

**用户再次强调：实现原理必须是 Three.js。** 浏览器中必须存在真实 Three Scene / Camera / Mesh / Material，并通过 Three WebGLRenderer 实时绘制。TresJS 只承担 Vue 声明式装配，不替代 Three 引擎。Blender 仅为离线资产制作与烘焙工具。禁止视频播放器、逐帧图片、iframe 外部模型查看器或其他引擎代替此核心。

`GLTFLoader` 载入模型；Three PBR 材质接收烘焙后的底色、粗糙度、法线、AO 与适用的静态光照贴图；Three 处理 HDR/PMREM 和变化阴影；GSAP 时间线驱动真实 Object3D/相机，或驱动 Three AnimationMixer 中经过验证的动作。运行时与源码验收都要能证明这条链路。

- 页面加载真实 GLB 几何、PBR 材质贴图及烘焙的静态光照/遮蔽数据，由一个 TresCanvas / Three renderer 绘制。
- 车门开合、进入座舱的相机运动、车轮/车门/后舱盖分离与复原在运行时发生。保留固定导演流程与章节控制，取消自由轨道操作。
- 材质纹理与光影以源文件夹 beauty JPG 为视觉依据。实际浏览器帧必须对照，离线渲染不能作为运行时质量验收。
- 高配桌面质量优先；本展品允许原几何超过通用 10 万面预算。没有用户批准不得减面、把模型换成图片、视频或预渲染帧序列。

## 烘焙边界

Blender 负责唯一制作管线。原几何、UV、源图像和已验证的刚性动作可继续使用。复杂材质节点烘焙为标准 PBR 贴图；新建无重叠 bake UV，保留原 UV 用于采样。几何按「同一运动组 + 材质」分批合并，不能把门和车身合成不可独立运动的整体。

固定部件可烘焙间接光照、自遮蔽和稳定阴影；门、轮和后舱盖不得携带由其他可移动部件产生的固定遮蔽。地面投影、开门后的接触阴影需实时更新或采用经过验证的随姿态方案。镜面反射保留真实 HDR/探针/PBR 计算，不能把某个观察角度的高光印在底色中。

## 已实现与证据范围

源数据已恢复：2,998 个 VPB 可见对象、1,500,570 个三角形；653 个对象有门/轮/后舱盖运动绑定。旧文件 `reventon-vpb-film.blend` 虽命名 film，其内部保存可复用的真实模型、纹理和关键帧，不应删除。

运行时资产包含 135 个网格、1,500,363 个三角形、2,998 个源对象和 7 个真实运动组；导出器去除 207 个重复面。75 张同源 PNG 与 GLB、HDR 由本地资源目录加载。标准 PBR 烘焙、独立刚体组 AO、实时 HDR 反射和随姿态更新的接触投影已接入，原片入口已由真实 Three.js 展品取代。资源身份见 [provenance.json](../../public/models/reventon/provenance.json)；`browserQualityApproved: false` 保留整体画质尚未获批的状态。

GSAP 时间线长 `383 / 24` 秒，约 16 秒；默认停在闭合外观，四个章节分别为「开启」「座舱」「展开」「合拢」。实际点击章节点定位到 3.2 秒、6 秒、11.75 秒与结束姿态。目录、页面隐藏与离开展区暂停；首帧就绪前控件禁用；减弱动态隐藏连续播放，保留静态章节与进度定位。加载失败可重试或返回目录，重试与上下文恢复保留原 Canvas/renderer。

实现位置：`ReventonExperience.vue` 负责唯一 Canvas 和控件；`ReventonScene.vue` 负责局部 Three 对象、加载与释放；`ReventonStudio.vue` 负责摄影棚与灯光；`assets.ts`、`motion.ts`、`director.ts`、`materials.ts`、`contactShadow.ts` 各自负责资源、采样、播放、材质校正与动态接触投影。视觉 token 和局部组件规范已合并到根 [DESIGN.md](../../DESIGN.md) 与 [design.json](../design.json)，没有提升为其他展品的全局规则。

当前验证依据：

- [runtime.json](../review/reventon/runtime.json)：真实几何、七运动组、AO/法线、复原、播放/暂停、目录保留姿态、无自由轨道、手机与减弱动态控件；错误列表为空。
- [lifecycle.json](../review/reventon/lifecycle.json)：失败重试、真实上下文丢失/恢复、目录暂停与切换；恢复后 Canvas/renderer 保留，旧 135 份 geometry 与 135 份 material 各释放一次。
- [playback.json](../review/reventon/playback.json)：连续播放覆盖四章，178 次采样中七组分别呈现 49–74 个不同姿态；Home / ArrowRight / End 实际驱动进度定位，错误列表为空。这验证播放与输入功能，不代表视觉节奏或帧率验收。
- [finish-review.md](../review/reventon/finish-review.md)：原始四项局部问题与保留项。
- [fix-verdict-2.md](../review/reventon/fix-verdict-2.md)：连续接触阴影、玻璃灰雾、轮内金属、手机目录出口四项均 resolved。`ship` 仅覆盖这四项修正。
- 实机静帧：`desktop.png`、`开启.png`、`座舱.png`、`展开.png`、`合拢.png` 为 1440×1000；`mobile.png` 为 390×844，另有 `mobile-320.png` 验证 320px 基线，均在 `../review/reventon/`。最新复核打开了全部七张。

## 下一验收

整体源参考图的摄影品质、连续播放时的视觉节奏与过渡流畅度、帧率与性能仍待验收。静态截图、功能采样和四项修正结论不能替代这些检查；原 beauty 封面、离线 Blender 图和已归档影片也不能作为实机验收证据。先完成这一本阶段的整体质量验收，再扩展其他专属演绎或新交互。
