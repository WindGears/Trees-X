---
name: Trees X 三维商品工作台
description: 访客采用方案 C 毛玻璃漂浮工作台；实时 WebGPU 打字机增加明亮与暖夜原位切换、虚化酒吧背景与岩板地台，其他入口保留既有配色。
scope: 下列 colors/typography/rounded 是共享基础样式；visitorColors/visitorTypography/visitorRounded 仅覆盖 wb-floating。
visitorColors:
  wb-bg: '#e7e9e5'
  wb-foreground: '#29332e'
  wb-panel: 'rgb(248 250 246 / 88%)'
  wb-line: 'rgb(66 80 70 / 15%)'
  wb-muted: '#5d675f'
  wb-accent: '#3e5c4b'
  wb-label: '#4e5d52'
  wb-field: 'rgb(255 255 252 / 65%)'
  wb-placeholder: '#727c74'
  wb-focus: '#365a43'
  wb-glass: 'rgb(248 250 246 / 76%)'
  wb-glass-border: 'rgb(255 255 255 / 80%)'
  stage-ground: '#d8dcd5'
  selected-background: '#e1e9df'
  selected-border: '#aabbab'
studioColors:
  dark-background-middle-fog: '#241c17'
  dark-sky-top: '#33261e'
  dark-sky-bottom: '#191511'
  dark-floor: '#241d17'
  dark-pedestal: '#44392f'
  dark-title: '#f1f3ee'
  dark-description-label-line: '#c0c9c0'
  dark-input-hint: '#c7cec4'
  dark-anchor: '#d2dfcf'
  dark-selected-line: '#edf4e8'
historicalGreenStudioColors:
  dark-background-middle-fog: '#333f39'
  dark-sky-top: '#505c55'
  dark-sky-bottom: '#242e29'
  dark-floor: '#2e3832'
  dark-pedestal: '#3f4944'
  dark-title: '#f1f3ee'
  dark-description-label-line: '#c0c9c0'
  dark-input-hint: '#c7cec4'
  dark-anchor: '#d2dfcf'
  dark-selected-line: '#edf4e8'
visitorTypography:
  display-desktop: 'clamp(34px, 2.6vw, 44px) / 1.25 / 500'
  display-mobile: '29px / 1.25 / 500'
  brand-desktop: '22px'
  brand-mobile: '21px'
  panel-heading-desktop: '20px / 1.4 / 500'
  panel-heading-mobile: '18px'
  body: '14px / 1.8'
  auxiliary: '12px'
visitorRounded:
  rail-panel: '24px'
  primary-dock: '18px'
  camera-dock: '16px'
  control: '12px'
  field: '10px'
  hotspot: '8px'
colors:
  wb-accent: '#bed4ef'
  wb-accent-hover: '#d1e2f5'
  wb-accent-ink: '#101923'
  wb-focus: '#d1e5ff'
  wb-bg: '#101720'
  wb-stage: '#151c25'
  wb-stage-warm: '#f7f5ef'
  wb-stage-warm-ink: '#31392f'
  wb-stage-warm-muted: '#626b5e'
  wb-panel: '#131d29'
  wb-foreground: '#f0f4fa'
  wb-muted: '#abbacb'
  wb-line: '#304052'
  wb-button: '#1d2b3c'
  wb-button-hover: '#2b3d51'
  wb-field: '#172330'
  wb-label: '#bccce0'
  wb-tool-line: '#405369'
  wb-toolbar: '#111d2bea'
  wb-search-line: '#52708f'
  wb-placeholder: '#aebed0'
  wb-scrollbar: '#526a85'
  wb-swatch-line: '#7890ac'
  wb-status: '#151c25f5'
  wb-hotspot: '#111b28d9'
  wb-hotspot-line: '#7990ac'
  ad-error-text: '#ffd0c5'
  ad-error-bg: '#302421'
  ad-error-line: '#82635b'
  ad-listed: '#bfdcce'
typography:
  ad-heading:
    fontFamily: 'Manrope, Noto Sans SC Display, sans-serif'
    fontSize: '28px'
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: '-0.02em'
  ad-heading-mobile:
    fontSize: '24px'
    fontWeight: 500
    lineHeight: 1.3
  ad-code:
    fontFamily: 'Consolas, Courier New, monospace'
    fontSize: '13px'
    lineHeight: 1.7
  wb-display:
    fontFamily: 'Manrope, Noto Sans SC Display, sans-serif'
    fontSize: '36px'
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: '-0.025em'
  wb-display-mobile:
    fontSize: '27px'
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: '-0.025em'
  wb-brand:
    fontSize: '23px'
    fontWeight: 600
    letterSpacing: '-0.03em'
  wb-brand-mobile:
    fontSize: '20px'
    fontWeight: 600
    letterSpacing: '-0.03em'
  wb-panel-heading:
    fontSize: '22px'
    fontWeight: 500
  wb-panel-heading-mobile:
    fontSize: '19px'
    fontWeight: 500
  wb-status-heading:
    fontSize: '25px'
    fontWeight: 500
  wb-section-heading:
    fontSize: '16px'
    fontWeight: 500
    lineHeight: 1.7
  wb-catalog-title:
    fontSize: '17px'
    fontWeight: 500
  wb-body:
    fontFamily: 'Manrope, Noto Sans SC Display, sans-serif'
    fontSize: '14px'
    lineHeight: 1.85
  wb-content-body:
    fontSize: '15px'
    lineHeight: 1.7
  wb-catalog-body:
    fontSize: '13px'
    lineHeight: 1.75
  wb-label:
    fontSize: '12px'
rounded:
  wb-flat: '0px'
  wb-label: '3px'
  wb-hotspot: '4px'
  wb-field: '6px'
  wb-control: '7px'
  wb-toolbar: '10px'
  wb-circle: '50%'
spacing:
  wb-icon-gap: '8px'
  wb-list-gap: '10px'
  wb-copy-gap: '12px'
  wb-section: '24px'
  wb-panel-header-gap: '30px'
  wb-header-edge: '32px'
components:
  wb-button:
    backgroundColor: '{colors.wb-button}'
    textColor: '{colors.wb-foreground}'
    rounded: '{rounded.wb-control}'
    padding: '9px 13px'
  wb-button-hover:
    backgroundColor: '{colors.wb-button-hover}'
  wb-button-selected:
    backgroundColor: '{colors.wb-accent}'
    textColor: '{colors.wb-accent-ink}'
    rounded: '{rounded.wb-control}'
    padding: '9px 13px'
  wb-button-selected-hover:
    backgroundColor: '{colors.wb-accent-hover}'
    textColor: '{colors.wb-accent-ink}'
  wb-button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.wb-foreground}'
    rounded: '{rounded.wb-control}'
    padding: '9px 17px'
  wb-field:
    backgroundColor: '{colors.wb-field}'
    textColor: '{colors.wb-foreground}'
    rounded: '{rounded.wb-field}'
    padding: '9px 10px'
  wb-search:
    backgroundColor: 'transparent'
    textColor: '{colors.wb-foreground}'
    padding: '9px 10px 9px 0'
  wb-toolbar:
    backgroundColor: '{colors.wb-toolbar}'
    rounded: '{rounded.wb-toolbar}'
    padding: '5px'
  wb-panel:
    backgroundColor: '{colors.wb-panel}'
    textColor: '{colors.wb-foreground}'
    padding: '26px 23px'
  wb-catalog-row:
    backgroundColor: 'transparent'
    textColor: '{colors.wb-foreground}'
    rounded: '{rounded.wb-flat}'
    padding: '21px 10px'
  wb-sample-label:
    backgroundColor: 'transparent'
    textColor: '{colors.wb-label}'
    rounded: '{rounded.wb-label}'
    padding: '4px 8px'
  wb-hotspot:
    backgroundColor: '{colors.wb-hotspot}'
    textColor: '{colors.wb-foreground}'
    rounded: '{rounded.wb-hotspot}'
    padding: '5px 10px'
---

# Design System: Trees X 三维商品工作台

## 汽车冷白实体摄影棚候选（2026-10-22）

`carShowroom=cold-studio` 采用真实深灰墙顶、弧形墙脚与石材地面，中性白软箱共享可见灯板与实际照明参数。revision 2 的墙色 `#4b4f55`、顶棚 `#303339`、地面 `#3a3d42`；保持石墨车漆，靠连续宽高光区分折线与座舱。石材数值微表面保持克制、倒影宽柔，不做湿地镜面。

现有毛玻璃布局、工具尺寸和交互保持，直接叠在暗场上的名称、介绍和提示使用浅灰白。建筑阻挡主相机时采用240ms避让，减弱动态直接切换；完整建筑保留在局部反射与间接光。普通入口不切换；节点二的车身世界空间光追尚未实现。工程与实机证据见[冷白棚记录](.ai/reventon-cold-showroom-validation.md)。

## 汽车主软箱动态遮挡（2026-10-22）

`carQuality=studio&carKeyShadow=1` 候选沿用10月21日冻结的材质、灯光、曝光及相机，只增加主软箱直接光可见性。轮拱、门板与座舱应随真实姿态产生遮挡，不能通过全图压暗、削弱反射或模糊细节伪装。两条面积采样＋最多八帧独立历史仍是近似；透明、镂空和环境不套此阴影。准备／失败状态由现有底部状态提示表达，不新增访客面板。默认不切换，实机证据见[自阴影记录](.ai/reventon-key-shadow-validation.md)。

## 汽车写实摄影棚候选（2026-10-21）

`carQuality=studio` 只调整已核验汽车在 WebGPU 下的材质数值与两块摄影棚软箱，保持背景、EXR、曝光、UI 和原相机。车身采用独立清漆高光、金属与软质座舱保留材质区分；玻璃试调反射强度，不用不透明度伪造透射。双射线与单射线对照必须使用相同灯光／材质，画质由实机观察确认，不以像素变化或工程 PASS 代替。主软箱自阴影尚未实现，原入口继续保留。见[样片记录](.ai/reventon-studio-quality-validation.md)。

## 汽车实时候选（2026-10-19）

显式汽车WebGPU入口保持现有摄影棚、EXR、取景和方案C浮动界面，不使用打字机暖夜与桌台。保留原2048²接触阴影、65tap过滤和0.8透明度；RT坐标转换必须让开门／分离阴影落在真实部件下。线性HDR统一输出与原WebGL的后映射透明阴影并非逐像素等价，背景、阴影浓淡、SSR颗粒需同取景实机对照；不以技术接通宣称画质通过。普通入口保持WebGL，候选与限制见 [.ai/reventon-webgpu-validation.md](.ai/reventon-webgpu-validation.md)。

## 黑漆与 WindGear 连笔铭牌样片（2026-10-16）

显式 `typewriterAsset=paint-study` 保持黑金风格和当前摄影棚，不改变界面。黑漆沿用原 UV1、0.04 场景单位纹理周期及原 Physical 标量；新 2048² OpenGL 微法线以受控周期高度生成，ORM G 均值约 0.93、清漆粗糙度 G 均值约 0.94。无锈蚀、厚污垢、夸张划痕或烘死的装配阴影。

`WindGear` 使用原创连笔路径字形，W／G 短回钩，`#d8b368`，1024×416 透明画幅；保留原铭牌位置、UV0、贴片与 alpha。SVG 与正向 PNG 保存于 `assets-source/typewriter-paint`，GLB PNG 按原约定翻转一次。整机、漆面、铭牌、键帽、分层与平铺的同输入对照见 [.ai/typewriter-paint-validation.md](.ai/typewriter-paint-validation.md)。默认资源仍由用户实机审阅决定。

## 实时管线反馈（2026-10-16）

当前回归打字机渲染修补，暖夜图像空间保留实验入口并暂停扩展。界面布局与毛玻璃样式不变；底部原实时状态提示区分准备空间增强、实际 DDGI 以及增强失败后的基础光照，不新增访客技术参数面板。普通默认 WebGL 保留，显式实时入口仍可比较 SSGI／DDGI。

地台倒影改为商品独立捕获与透明覆盖率合成，同表面 signed SSR 过滤保持文字／材质支路。六取景已作真实 WebGPU 工程对照，漆面颗粒仍未完全解决，不能将 DDGI 模块就绪或像素变化写作整体画质通过。证据见 [.ai/realtime-ddgi-validation.md](.ai/realtime-ddgi-validation.md)。

## 暖夜空间实验（2026-10-16）

保留当前 UI，只在显式实时打字机空间入口改变舞台：桌面 8.4×4.8，厚度 0.26、桌体高度 2.2，顶面保持原商品落地高度 -0.0192，底面 -2.4792。桌面覆盖真实 GLB 的 101 个结构采样范围；原部件坐标、轴心和动作不变。独立侧面 UV／材质保留石材厚度，反射与接触阴影同步扩展；实验反射合成权重为 0.28，普通实时仍为 0.5，这属于舞台校准而非物理 BRDF 等效。

`loungeSpatial=box` 使用有限深度房间；`depth` 使用原图对应的相对径向距离代理，地面统一拟合桌体底面，跨深度面剔除后用远盒补底。两者取消固定 LOD 3.5 模糊，并对图像经度接缝作窄带混合。图像有自己的光照，不再次完整打光。2026-10-16 按用户反馈，`box&loungeLayers=1` 只使用生成的 clean-room 无家具底图，不加载或创建椅桌／台灯卡片；实体厚桌台和其他材质光影保留。原家具素材与卡片实验记录留作历史，不再代表当前舞台。

先关闭景深检查。`loungeDof=1` 可选实际场景深度景深，当前商品与所有展开部件的深度范围保持清楚，背景按距离逐渐虚化。标签与 DOM UI 不参与。原暖夜、WebGL、hybrid、钢琴／汽车保持原实现，未经本人走查不替换默认。素材、范围、失败图和实机结果见 [空间验证](.ai/lounge-spatial-validation.md)。

## 当前明亮／暖夜舞台（2026-10-15）

仅显式实时 WebGPU 打字机提供两态切换。暖夜以暖琥珀酒吧全景包围可见背景，原生 LDR 图使用固定 LOD 3.5 虚化、接缝带混合与极点淡出保护；这些是采样近似，不是相机散景、真实 DOF、HDR 照明或源图无缝认证。`studioColors` 是加载前及边界过渡配色；实际背景来自图像，不能用单一色值代表整张全景。

实体地台形态保留；暖夜使用生成的单块岩板底色，底色 repeat 1，不宣称可平铺。粗糙度与微法线为独立的固定种子数值图，512²、repeat 8、NoColorSpace，微法线初始强度 0.28；不从底色亮度反推几何或制作扫描材质。原 Studio Small 05 HDR 保持，三个软箱向暖色和各自目标强度过渡；明亮恢复原舞台与软箱设置。

“明亮／暖夜”使用约 0.42 秒 `power2.inOut` GSAP 补间，只由既有舞台时钟推进，快速切换取消旧补间；减弱动态时直接到目标。首个暖夜异步加载四图，失败展示明确重试，基础模型继续可操作。切换保留相机完整姿态与投影、配色、结构和部件状态，不重建 Canvas／renderer。浅色玻璃工作台与已有文字／引线可读规则保持，环境控件以深暖色底和琥珀选中态呈现。

本批实机证据与画质判断由主代理更新于 [暖夜运行验收](.ai/amber-lounge-runtime-validation.md)；此处不预填通过、帧率或概念图等效结论。

## 深灰绿摄影棚试用（2026-10-15，历史）

按用户要求试验压暗环境，实时 WebGPU 打字机默认使用深灰绿天空盒与石墨地台；加 `studioMood=light` 恢复原亮色舞台作同输入对照。三块软箱、Studio Small 05 HDR、曝光 1、环境强度 0.35、原反射／接触阴影权重保持，不以整张画面降曝光代替布光。浅色毛玻璃工具和面板保留，仅将直接叠在暗场的标题、说明、输入提示与细引线改为上述浅色。

`studio/palette.ts` 是可见舞台配色源，`studioPreset` 同步背景雾色；捕获环境与 hybrid 保留原亮色。DOM `data-studio-mood` 依据实际后端和已注册打字机源设置，硬件回退、移动端、钢琴和汽车不套用暗场文字。没有新纹理、绘制通道、时钟或 renderer。明暗取景证据与检查范围见 [.ai/typewriter-dark-studio-validation.md](.ai/typewriter-dark-studio-validation.md)，画质取舍由用户本人判断。

## 当前实时画面接入（2026-10-15）

用户要求每项工程成功后落实到 WebGPU 实时入口，画质由本人肉眼判断。显式 `?product=typewriter-study&renderPipeline=realtime` 默认使用 v2 微表面与 WindGear 铭牌；`typewriterAsset=v1` 用于旧材质对照。普通 WebGL、其他商品、自定义资源包保持各自内容；方案 C、天空盒、地台形态、灯光、曝光与完整观察操作不改。

反射滤波仍为八个几何引导 tap，默认加入像素 IGN 与成功完整帧 golden-angle 旋转；`reflectionKernel=static` 保留旧固定核。没有扩大半径、增加采样或修改 Physical 清漆／各向异性，失败或取消不推进 phase。采用 Three MIT 核旋转思路，不以此宣称原创算法、点噪已解决或路径参考等效。本批 check、生产构建与 API 启动、真实 WebGPU 两核六取景及 v2 交互／生命周期／管理取景检查通过，见 [.ai/typewriter-webgpu-rollin-validation.md](.ai/typewriter-webgpu-rollin-validation.md)。

普通首页仍为增强 WebGL；DDGI／FidelityFX／BVH 尚未接入。整体画质与实际呈现预算继续明确待验收，不把用户授权接入误写成已经通过画质评估。以下 dated 渲染记录只描述当时批次，旧的入口与阶段门槛由本节当前约定覆盖。

## 打字机 v2 初始材质候选（2026-10-14，历史入口约定）

用户要求直接制作 v2；整体 SSR 画质尚未通过，默认 v1＋增强 WebGL 保持。方案 C、天空盒、地台、灯光、曝光和观察规则不改。候选通过 `?product=typewriter-study&typewriterAsset=v2` 进入，叠加 `&renderPipeline=realtime` 比较同一资源的 WebGPU 实验效果；本轮不以换材质掩盖反射命中噪声，也不宣称达到旧路径追踪图的整体完成度。

漆面、拉丝金属与铸铁各自使用共享 2048²微法线／粗糙度输入，拉丝增加方向图。微纹理按部件面积标定尺度，保留标准 Physical 清漆和各向异性；原字符、键帽、配色与结构仍沿用既有操作。仅机身 `decal-62` 铭牌按用户要求改为 WindGear：1024×416 透明底、金色 `#d8b368` 斜体字形，原位置、UV 与透明材质规则保持；其他字符图片不改。v1 仍是原铭牌与旧材质，不能把候选 URL 的表现写成默认已经更新。

七张 PNG 为线性数据，无部件间遮蔽或照明烘焙。表面方向、纹理密度、文字软边、近景清漆、展开与平铺状态以实际截图检查，程序种子或测试通过不代替审美验收。生产记录的 `qualityApproved=false` 明确表示候选尚未完成整体视觉晋级；来源、制作与验收边界见 [.ai/typewriter-v2-validation.md](.ai/typewriter-v2-validation.md)。下方 128²微纹理说明属于 v1 的历史实现，不描述候选 v2。

## 打字机实时基线记录（2026-10-13，历史）

沿用方案 C 的浅银灰毛玻璃工作台、黑金打字机与银灰绿无缝摄影棚。`?product=typewriter-study&renderPipeline=realtime` 连续呈现自由观察、敲键与结构变化，不出现等待静止采样、128 样本或 OIDN 融入的访客流程。只提供轻量“WebGPU · 实时光影”实际状态，兼容／错误时显示真实提示；不因算法切换重做工具、镜头或模型流程。

**整体渲染质量优先于技术清单与性能成绩。** 先保留已有黑金材质、宽高光、柔化地台反射和接触关系，再用同资产、同取景、同曝光判断新增信号是否改善画面。WebGPU 地台平面反射已恢复，继续由唯一 renderer 离屏绘制；Basic 反射层不参与 SSR 基础镜面替换，避免屏幕外反射缺失使舞台退步。不能凭像素差、算法名称或单张静帧宣布更高质量。

一个展示区域只有一个 TresCanvas／renderer；源几何与贴图保持。当前统一 resolve 每条射线的命中反射与未命中原生环境单次贡献，再通过同一个时域／空间过滤信号替换对应基础贡献；原生多次散射、清漆与未支持支路保留，过滤后的 ray-length alpha 不用来判断命中。前版消除了黑地台／异常宽亮带，但独立颜色与 coverage 在 radius 5 校准后仍有明显点噪，画质未通过，该支路已移除。当前统一版四项生产核心与六组公平对照契约通过，不能视为完整画质超过 WebGL。

normal／原生导数调整后 roughness 为 HalfFloat，SSR quality 1、thickness 0.035，仍须通过画面验证。SSGI 是含官方亮度 7 限制的经验间接光估计，不能视为照片级或物理真值。透明字符／铭牌贴片软边、金属细边、漆面和拆解中间状态仍须批量近景审查；打字机键帽本体不透明。

当前统一替换信号的过滤半径为 5；独立 coverage 和其 flickerSuppression=0 参数仅属历史。实时地台反射／接触阴影权重保留 0.5／0.68。WebGPU 实时叠层先在 HDR 合成再经 ACES，原 WebGL 在显示空间混合；这些权重只是舞台视觉校准，不是 BRDF 等效。旧 hybrid／WebGL 0.28／0.46 保持，当前新 resolve 生产截图已采集，完整画质结论未通过，不因机制或数值变化推断更高质量。

2026-10-14 修复：所有自有中间 RTT 显式 HalfFloat，避免在最终 ACES 前把 HDR 亮度及反射距离截入 RGBA8。UI、天空盒、地台形态、灯光、曝光和源材质保持；六个相同输入取景已核对，漆面颗粒减少但近景仍需精修，不据此切换默认。见 [.ai/typewriter-hdr-rtt-validation.md](.ai/typewriter-hdr-rtt-validation.md)。

后续有符号候选只过滤反射修正，不再过滤／相减原生环境。六取景保留文字、键帽和地台轮廓；metal 高光过渡点带未解决，左上开口附近颗粒更易辨。整体质感不晋级，默认仍 WebGL，不增加模糊或改光掩盖问题。见 [.ai/typewriter-signed-reflection-validation.md](.ai/typewriter-signed-reflection-validation.md)。

只读核查还确认实时全幅 ACES 包含天空盒，而原 WebGL 天空盒按 `toneMapped: false` 只做输出颜色转换。两种地台叠层／色调映射顺序非线性不等效；这尚不是白点或倒影缺失的完整根因结论。后续质量定位先以固定取景分别检查原始反射纹理与最终合成，不用加模糊或盲调强度替代证据，本轮代码保持冻结。

六附件存储 40 字节／像素、WebGPU 对齐成本 44 字节／采样点，宿主明确请求 64 字节支持；不支持时完整卸载实验宿主并显示兼容状态。当前核心、六组对照契约、管理预览与故障恢复通过；三个桌面尺寸、小屏兼容及减弱动态批次通过，1280／320 截图无 UI 阻断，实际 20 分钟操作资源无增长。这些不是画质验收：前罩高光／刻度仍有噪点、A／S与远排字符偏浅颗粒、地台倒影偏浅模糊且有白点，分层／平铺虽可读但无明确质感提升，画质未通过，默认保持 WebGL。JS 提交计时不代表实际呈现帧预算；当前 30 次真实重载及默认 WebGL 五项操作回归已通过；真实隐藏因本机环境未暴露 hidden 仍待验收，本人走查待完成，旧 coverage 版重载不替代当前链。DDGI／FFX／BVH 不扩展，证据见 [.ai/realtime-rendering-validation.md](.ai/realtime-rendering-validation.md)。后面的静止精修状态为 hybrid 历史入口。

## 当前访客规范：方案 C（2026-10-11）

**方向：安静的漂浮式工作台，商品始终占据主要观察区域。**

用户已选择方案 C：浅银灰背景、淡灰绿选中态与克制毛玻璃。默认机械打字机，左侧快速栏呈现打字机、钢琴与精细汽车的真实封面，右側一次只打开一个操作面板，探索入口和镜头工具位于底部。自由观察、部件聚焦、动作、结构与手动导览继续使用同一工作台契约，访客不常驻完整控制台或进度滑条。

实现真值为 `src/assets/styles/workbench-floating.css`、WorkbenchRoot/Rail/Tools/Stage/Scene、`interfaceMotion.ts` 与 `viewportFraming.ts`。选择代次、首帧开放操作、图文回退、动作接管和资源释放沿用既有实现。HTTP API、数据库及 v1/v2/v3 配置不变；管理端、整页管理预览和 legacy 本轮不改布局或主题。

### 颜色与玻璃

访客颜色以 frontmatter 的 visitorColors 为准，仅作用于 `.workbench.wb-floating`。背景为浅银灰，文字为深灰绿，辅助字保持可辨识；选中用淡绿底/边线与 `aria-pressed`，键盘焦点使用 2px 深绿实线、4px 外偏移。按钮最小高度 42px，字段 44px，中文正文 14px，辅助文字不小于 12px。

玻璃集中用于快速商品栏、面板、工具条与少量热点名称：快速栏/底部工具 blur 20px、面板 blur 24px、目录入口 blur 16px、标签 blur 10px。白色细边线、轻微内高光和低强度阴影提供层次，面板正文不再嵌套装饰卡片。缺少 backdrop-filter 时回退为实色 `#f3f6ef`；不依赖模糊才看清操作。

三维舞台只覆盖背景 `#e7e9e5` 与地面 `#d8dcd5`。正式模型、材质、照明参数、曝光与反射环境沿用原配置；没有新增地台、窗墙、天空或展厅 HDR。概念图用于确认界面方向，不作为当前模型品质或实机光照等效结论。

### 桌面布局

访客为全幅 100dvh 舞台，桌面最小高 600px。顶栏浮于顶部 24px、左右 32px，品牌 22px。左侧快速栏宽 108px、左 28px、竖向居中；每件真实封面高 64px，商品名 12px，完整目录通过“商品目录”或“全部商品”打开。

商品身份位于上 112px、左 170px，标题 `clamp(34px, 2.6vw, 44px)`，说明最多 36ch；聚焦部件时收起该介绍，顶栏仍保留身份。右操作面板宽 320px、右 28px、上 112px、下 144px；目录面板宽 300px、左 150px。两者均浮于全幅舞台，标题固定、正文独立滚动，滚轮不传给舞台。

底部居中两行工具：上行外观/细节/结构与动作/导览，下行命名视角/缩放/复位；距底 28px，间隔 8px，不以仅图标代替核心中文操作。高度不超过 800px 的桌面将标题/面板上移至 98px、工具距底 20px；较窄桌面缩小左右边距与快速栏。面板关闭不恢复镜头、配色或结构。

### 操作与动画

- 面板和商品介绍进入为 0.32 秒、`power3.out`、透明度与 12px 垂直偏移；退出为 0.18 秒、`power2.out`、8px 偏移。快速重开/切换先杀旧补间，不堆积动画；退出立即 inert，避免不可见控件仍可点击或 Tab 进入。
- 同一操作面板内切换工具立即呈现新内容，使用 0.22 秒进入补间；不以嵌套退出动画延迟操作结果。
- 探索工具的选中指示块由 GSAP 用 0.3 秒 `power3.out` 移动，语义状态始终由 `aria-pressed`/`aria-expanded` 提供；关闭面板后回到触发入口焦点，Escape 沿用关闭当前面板规则。
- 打开面板时以 0.32 秒调整现有相机 viewOffset 来横向重新构图，**不修改 camera.position、观察目标或因面板开关缩小商品**；zoom 只随视口尺寸适配。画面给面板留空间，当前自由观察姿态保持；尺寸变化直接更新投影，热点继续使用当前真实相机投影。
- 相机聚焦、结构、按键及汽车动作继续由各自既有控制器管理，UI 动画不改写节点姿态。鼠标/键盘观察立即接管导览与播放；无自动环绕或默认长演出。
- `prefers-reduced-motion` 下过渡和投影补间直接到目标；卸载取消补间与监听，页面隐藏按既有生命周期停钟。UI 未增加逐帧响应式场景状态或额外 renderer。

### 移动基础兼容与标签

760px 以下最小高 640px：快速栏改为顶部横向三件商品，右面板和目录改为底部单面板，最大高 45%，仍保留底部两行工具。标题 29px，品牌副说明/当前商品缩略名隐藏，面板打开时收起介绍正文及辅助资产标记；320px 进一步压缩图标/边距，保留中文核心操作。实际桌面尺寸为主验收，移动端只承诺基础可用性。

拆解引线标签沿用实际节点锚点、渐显和平滑避让；视觉调整为浅色小玻璃名称与灰绿细线，不增加候选密度，最多 12 个且优先选中项。目录、面板、快速栏、标题与工具都是布局避让依据，面板/介绍动态挂载后重新收集障碍。完整部件仍可在细节列表选择，淡出标签立即退出交互。

加载与错误覆盖继续显示真实阶段/重试，不显示虚假百分比，也不将封面替代模型首帧。无 WebGL 时保留真实图文、目录和可访问说明。检查证据与未完成范围见 [.ai/ui-c-validation.md](.ai/ui-c-validation.md)。

## 基础样式与历史访客规范

**以下深蓝灰、网格分栏和旧动效尺寸为 2026-10-10 及以前的访客记录，不适用于 `wb-floating`。管理端及管理预览继续使用其原有基础主题与布局；其中独立商品、动作、资源与事实表达规范仍有效，只有访客颜色、布局与 UI 过渡由上文覆盖。**

### 原 Overview

**Creative North Star: "先欣赏商品，再自然探索细节"**

Trees X 延续深蓝灰框架、中文身份与冷银状态重点。顶栏、工具和面板安静地承托三维对象，信息用清楚的字号、间距与细线组织；工具的亮色状态帮助访客确认自己正在观察和操作什么。机械打字机采用暖纸色舞台，承托黑色漆面与金属部件，保留同一套深色工作台工具。

当前系统以一致的操作和可读性服务商品观察。模型通过真实 Three 场景呈现，资产身份按配置明确显示“正式展品”或“流程样板”。默认机械打字机、钢琴及精细汽车均已接入真实 GLB；音箱已从访客目录下架，历史资源与 legacy 入口保留。颜色、标题和控件不作真实商品规格、工厂机械精度或可购款式承诺。

**Key Characteristics:**

- 模型主导，工具按需出现。
- 深蓝灰层次、冷银选中态与清晰焦点。
- 中文信息优先，图标始终服务操作。
- 正式资产与流程样板共享组件与状态语言。

本文件保留 2026-10-02 共同工作台与管理端已确认规范，并于 2026-10-09 合并打字机迁移后的舞台与交互记录。视觉真值为 src/assets/styles/workbench.css、workbench-parts.css、src/components/workbench/、typewriter-kimi-v1.json 与现有实机截图；默认首页为 typewriter-study。布局策略、模式和验收范围见 [workbench surface](.impeccable/surfaces/src-components-workbench-workbenchroot-vue.md)。旧 Reventón 摄影棚与固定导演流程、音箱影片、各商品独立舞台和旧完整控制台全部属于 **legacy-only**，已连同原侧车保存到 [2026-09 设计历史](.ai/history/2026-09-design.md)。旧汽车入口为 ?legacy=1&product=reventon；历史中的旧默认路由不再代表当前首页。

## Colors

以带蓝倾向的石板灰建立背景、工具和正文之间的层次。规范值以 frontmatter 为准；wb-* 是当前工作台命名空间，商品配色由展示配置提供，不扩充为界面主题色。

### Primary

- **冷银蓝**（wb-accent / wb-accent-hover）：表示已选配色、部件、动作或当前工具；配合深墨选中文字。文本选区和输入光标延续同一重点色。
- **冰蓝焦点**（wb-focus）：可聚焦控件采用实线焦点环，宽度（2px）、外偏移（4px），不只以背景色变化传达键盘位置。

### Neutral

- **深海底色与石板舞台**（wb-bg / wb-stage）：分别承托框架与三维视野。舞台明暗来自场景、地面与照明，不把 CSS 色值当作整张实机图的像素目标。
- **暖纸舞台与深色字**（wb-stage-warm / wb-stage-warm-ink / wb-stage-warm-muted）：打字机配置的背景与地面采用暖纸色；标题用深色主字，描述、资产身份与底部输入提示用低一级的深色辅助字。WorkbenchRoot 根据舞台背景为展示区域设置 --wb-stage-ink 与 --wb-stage-muted，深色舞台仍回到霜白与灰蓝；顶栏、工具、面板不切换为浅色主题。
- **蓝灰面板与工具表面**（wb-panel / wb-toolbar）：面板为实底，覆盖舞台的工具条保留轻微透明度；两者以细边线分界。
- **霜白正文与灰蓝辅助字**（wb-foreground / wb-muted）：主操作与商品名清楚，说明、分类与提示退后一级。样板标记与搜索占位字分别使用 wb-label 和 wb-placeholder。
- **控制与边界**（wb-button / wb-button-hover / wb-field / wb-line）：按钮、悬停、输入与分隔线各有固定层次。工具边线、搜索下划线、滚动条及色样边线使用各自已记录的细部色。
- **状态覆盖与部件标签**（wb-status / 舞台字色）：状态覆盖层保护错误说明的可读性；舞台引线标签沿用商品舞台底色、主字色与辅助字色，暖纸舞台使用深色字，深蓝灰舞台使用霜白字，细引线连接当前部件锚点。

**The 重点即状态 Rule.** 冷银蓝服务选中状态，焦点另有清晰描边；动作开关同时显示文字状态，配色选中同时显示勾选。

**The 舞台文字分域 Rule.** 舞台上的商品身份和输入提示跟随舞台明暗选择文字色；深色工具与面板继续使用工作台文字色，商品专属背景不扩展为全站主题。

## Typography

**Display Font:** Manrope，中文回落到现有 Noto Sans SC Display，随后为 sans-serif。
**Body Font:** 同一字体栈；不为工具引入另一套工程等宽字体。现有中文字体由本地文件加载。

商品标题、面板标题、正文和辅助信息分别使用 frontmatter 的 wb-display、wb-panel-heading、wb-body 与 wb-label。中文名称是主标题；品牌稍紧的字距、面板标题和目录名的中等字重区分层级。桌面与移动的标题、品牌及面板标题均有独立 token。

介绍行高为（1.8），面板正文沿用正文 token，状态说明最大宽度为（38ch）。目录说明使用紧凑正文层级，样板标记、输入提示与动作状态使用辅助字级。导览步数使用等宽数字与字距（0.08em），仍属普通界面文字。

**The 中文身份 Rule.** 商品名称和功能名称直接说明内容；英文品牌不替代中文身份，正式展品与流程样板标记是资产事实说明。

## Layout

工作台占据（100svh），最小高度（640px）。桌面顶栏高（76px），两侧内边距来自 wb-header-edge；下方为剩余高度的网格。无面板时场景使用整行；目录打开时左栏宽（310px），工具面板打开时右栏宽（340px）。宽度不超过（1100px）时分别收至（280px）和（300px）。面板独立纵向滚动，保持场景可观察。

商品身份位于场景左上，桌面偏移为上（32px）、左（38px），介绍宽度最多（330px）；较窄桌面的左偏移为（26px）。底部工具分两行、水平居中，上行为视角与缩放，下行为探索入口；整体距场景底部（66px）。独立输入提示距左（38px）、距底（28px）。

不超过（760px）时顶栏改为（66px），品牌副说明与当前商品缩略名隐藏。场景在上，已打开的目录或面板在下；网格行分别为 minmax(310px, 1fr) 与 minmax(220px, 38%)。下面板内边距（16px 20px），场景保留商品名与两行工具；介绍和样板标记在面板打开时隐藏，完整样板身份仍可从目录获取。工具距底（37px），输入提示距底（13px）。舞台引线标签在该断点继续显示，长名称可换行；空间不足时抑制次要标签，完整部件仍可由“细节”列表选择。

**The 单活动面板 Rule.** 目录与工具面板同一时间只出现一个；桌面通过网格分配空间，移动端移到场景下方。

## Elevation & Depth

当前工作台控件与面板不使用盒阴影或背景模糊。深度依靠轻微透明的工具底、实色面板、细分隔线与三维对象自身的照明建立，不把每组内容再包成卡片。

程序化样板舞台使用 RoomEnvironment 反射、主光与轮廓光、雾和接收阴影的地面。打字机采用配置中的暖纸背景与地面、专属环境反射、漆面及金属 shader，通过真实几何与照明呈现材质。单个 TresCanvas 使用按需渲染，当前 DPR 上限为（2），不能由此推断帧率或照片级画质。

**The 模型承载深度 Rule.** 界面保持平实，空间层次交给真实三维几何、光照与阴影；商品观察不追加装饰性光效。

## Shapes

形状以紧凑、轻微圆角的矩形控件为主。按钮、字段、工具条与样板标签分别采用 frontmatter 的独立圆角角色；舞台引线标签使用已有 wb-label 的小圆角。目录条目和面板保持平直。分组主要靠空白和（1px）细线。圆形只用于配色色样和引线端点的小圆点，不作额外的舞台装饰。

## Components

### 基础管理端（2026-10-08）

/admin继承深蓝灰、冷银选中态和同一中文字体。管理任务使用Operate布局：76px顶栏、220px左导航、40px内容内边距；760px以下导航变为横排，表单改单列，表格在自身容器滚动，不让页面横向溢出。1100px以下分类列表/编辑表单上下排列。桌面标题使用ad-heading，手机ad-heading-mobile；正文14px、说明13px、分区标题20px。配置JSON使用ad-code等宽字体，只用于可编辑代码。

字段与按钮42px起，间距24px；错误用ad-error语义色与文字说明，上架状态用ad-listed且明确显示“已上架”。未保存输入、请求中、校验错误、冲突和会话过期均有反馈。入口不播放演出，按钮颜色过渡150ms，减弱动态关闭。预览复用工作台组件，高680px，移动基础预览820px，退出卸载Canvas。

本轮截图审查采用桌面/移动同批检查及一次集中修正，结果见.ai/admin-validation.md。旧系统tokens与视觉方向保持；新增token仅记录管理端已经实现的标题、代码字段和语义状态。

阶段D2沿用该视觉世界，将常用配置改为七分区编辑。分区按钮使用aria-current与冷银选中态，选中悬停仍为浅底深字。保存/预览/上下架/重新读取位于分区导航下方，桌面保存条随页面滚动固定在顶部，移动改为普通文档流；校验摘要限高170px，可点击定位字段。多条配置用16px名称、12px稳定ID及底边线分组，不新增装饰卡片。坐标用details折叠，桌面三轴并排，移动单列。封面预览、颜色选择与十六进制输入共享已有字段样式。

导览引用使用原生下拉框，空结构状态明确显示“保持当前”；返回全景步骤禁用其他执行项并解释内容仍保留。整页预览顶部显示回填目标、采集按钮和鼠标操作说明，不增加Canvas覆盖控制台。桌面1280/1440/1920与390/320同批检查后集中修正选中悬停对比度、镜头字段间距及空结构状态，一次确认结束本轮视觉检查，见.ai/admin-usability-validation.md。

### Buttons

普通按钮是深蓝灰实底、细描边与霜白文字，最小高度（42px），图标间距采用 wb-icon-gap。悬停加亮，背景与文字过渡为（150ms）；禁用透明度（0.4），不可操作。选中采用冷银蓝底和深墨文字，aria-pressed 与可见状态保持一致。配色和动作列表行的最小高度为（50px）。

工具条内部按钮使用透明底，选中后沿用同一高亮语言；关闭按钮为透明无边框图标控件。当前没有独立的按下位移或弹跳规则。

### Chips

“流程样板”和“正式展品”为非交互事实标记，透明底与细描边，文字跟随所在舞台的辅助字色；桌面使用 frontmatter 对应内边距，手机收至（2px 6px）。它不是筛选按钮或装饰性的栏目标签。

### Cards / Containers

工作台没有独立商品卡片网格。目录采用纵向文本条目，商品名、描述、分类和样板身份形成一行组，以底边线分隔；当前商品沿用选中底色。其余分组由间距和线条组织。

面板标题与关闭按钮并排，正文和操作列表向下排列；统一“还原商品”区域通过上边线与更大间隔分开。它附有恢复范围说明，不与“复位视角”混称。

### Inputs / Fields

原生下拉框与输入框保持深色字段底、细描边与明确焦点。目录搜索使用透明输入和底部细线，保留可访问名称及搜索图标；分类为带文字标签的原生下拉框。目录有读取中、错误重试、空搜索结果三个文字状态。

打字机细节沿用原生搜索与部件组下拉，字段最小高度（44px），文字（14px），内边距（10px 12px），圆角（4px）；字段、正文、标签与占位字沿用 wb-field、wb-foreground、wb-label、wb-placeholder，焦点采用 wb-focus 的（2px）实线与（3px）外偏移。默认列表先展示八个重点部件；名称搜索、部件组或“查看全部”可以访问完整（572）个部件，按（40）条递增展示。单个字母按键按名称末尾字母精确匹配，输入 A 对应 A 键与 A 字杆；part- 开头的输入匹配稳定部件编号前缀，其他输入匹配名称。

### Navigation

顶栏保留品牌与“商品目录”，桌面右端显示当前商品名。底部相机工具包含命名视角、缩小、放大和“复位视角”；探索导航根据商品能力显示外观、细节、结构与动作、导览。经导航打开面板后关闭按钮获得焦点，关闭时恢复原入口焦点，Escape 可关闭当前面板。

面板进入由 GSAP 完成透明度过渡（240ms，power3.out）；当前没有离场滑动或持续浮动动画。窄屏工具缩小内边距，保留文字与图标，不改成仅图标导航。

### Hotspots and Stage States

舞台热点由部件端点、细引线（0.85px）与中文名称组成，标签沿用辅助字级（12px），最小高度（32px），局部圆角（3px）。标签使用当前舞台底色与主字色，引线使用舞台辅助字色；悬停增加下划线，选中增加字重与下划线并加深引线，键盘焦点保留明确描边。点击名称继续聚焦原部件，选中名称也可在细节列表及描述中确认。

整机默认隐藏舞台标签；分层、平铺、拆解或持续开门按实际结构姿态自动渐显，合拢时淡出，瞬时打字动作不展开整组标签。未展开时，细节面板未选中部件可显示配置重点标记，选中后显示当前部件；展开时选中标签优先，并可与其余重点标签共存。舞台最多保留（12）个候选标签，标记密度不随全部部件数量增加。

标签跟随当前世界锚点投影，避开可见介绍、工具、输入提示与其它标签；紧凑锚点群还预留中心观察区域。可容纳的名称平滑移动；可能穿过标签或障碍的路径先短暂淡出，再重定位并渐显。越界、视锥外或放不下的名称被抑制，完整部件继续在细节列表中可选；移动端沿用同一规则。减弱动态直接到合法位置，淡出的标签立即退出指针与键盘交互。本次三件商品与最终截图证据见 [.ai/callout-design-documentation.md](.ai/callout-design-documentation.md)。

加载和失败覆盖层保留同一舞台空间。加载显示“正在准备商品”，真实首帧完成才开放操作。失败显示“暂时无法展示”，提供重新加载和打开目录；错误与等待分别使用 alert / status 语义，不以静态样例假装加载完成。

### Observation and Guide

命名视角及部件聚焦使用（650ms，power3.out），状态切换和结构动作使用（550ms，power3.out），瞬时按键动作使用单程（180ms，power1.inOut）并返回。导览由开始、上一步、下一步、完成及退出组成，步骤文字主动更新，不自动推进。

### 打字机结构与主动导览（2026-10-09）

结构面板以“合拢整机”“分层展开”“平铺部件”三个具名按钮表达观察结果，选中态沿用冷银蓝；访客不常驻百分比滑条。统一进度程序的三个目标为（0 / 0.6 / 1），配置全程（4秒），仍支持暂停、继续和“复原动作”。结构变化保留当前观察视角；“展开全景”“平铺俯视”另列为镜头按钮，镜头和结构不互相代替。

当前打字机的五步手动导览为整机、一次按键的连接、分层、平铺、返回整机；A 键带动按键、键杠杆与字杆，是参考结构的联动演绎。返回全景合拢结构并保留已选外观；正式展品身份不表示工厂 CAD 或维修拆解顺序。实现与本轮证据见 [.ai/typewriter-migration-validation.md](.ai/typewriter-migration-validation.md)。

**The 主动观察 Rule.** 默认静止呈现商品；拖动或缩放立即接手镜头并退出导览，关闭面板保留观察状态。

减弱动态时 GSAP 面板、镜头和状态切换直接到达目标态，瞬时动作不循环；全局 CSS 将动画与过渡缩至（0.01ms）。页面隐藏暂停场景和补间。详细生命周期与状态契约由 [.ai/architecture.md](.ai/architecture.md) 和 [.ai/workbench-contract.md](.ai/workbench-contract.md) 维护。

## Do's and Don'ts

### 2026-10-10 汽车沿用共同舞台

Reventón 使用与前两件一致的暖白舞台、深蓝灰工具和单活动面板。汽车动作分“双门开合”和“部件分离”两组：两列具名开/合按钮、状态说明、暂停/继续，以及共同动作复原；访客无常驻百分比滑条。组间留 28px、上内边距 24px、按钮间隔 8px，使用一条细分隔线。整车、座舱和结构取景独立于动作。动作復原保留配色与相机；还原商品继续说明完整范围。

整车取景扩大主体，座舱从门后侧观察实际内部；结构取景给七组移动组件和细引线标签留空间。车身保留原材质、EXR 金属反射、薄玻璃处理、局部面光源和变化接触阴影。座舱及门板绒面使用干净的炭灰底色，保留原法线、粗糙度及 AO 细节；缝线与内饰装饰使用原透明贴图，以单次双面绘制、轻微深度偏移减少叠层接缝。默认静止，用户输入立即暂停动作。目录使用真实 renderer 封面，不带 DOM 控件。三个桌面与 390/320 截图按一轮集中修正检查；移动端仅作基础兼容，近景与小屏标签密度仍由观察角度和可用面积决定。

### Do:

- **Do** 让模型保持主要观察面积，沿用单活动面板与共享工具。
- **Do** 使用已记录的深蓝灰层次、冷银选中态和独立键盘焦点。
- **Do** 按资产事实标注正式展品或流程样板，并为操作状态、错误与空结果提供文字。
- **Do** 让暖色舞台上的商品身份与底部提示保持深色可读文字，工具和面板沿用既有深色体系。
- **Do** 区分复位视角、返回全景和还原商品，保留各自范围说明。
- **Do** 用真实场景和实机截图验证当前实现，扩展正式模型时复用现有界面。

### Don't:

- **Don't** 把 legacy 的影片、固定导演流程或常驻完整控制台规则带入当前工作台。
- **Don't** 用图片、影片或装饰光效代替真实三维操作与样板身份。
- **Don't** 让左目录和右面板同时占据工作台，或让手机面板盖住模型。
- **Don't** 把样板配色、分层关系或静态截图写成真实商品、维修顺序、帧率或照片级画质结论。

## 静止精修状态（2026-10-12）

实验工作台保留方案 C，画面精修反馈只占一条浅色毛玻璃状态条：桌面距左 24px、底 74px，14px 圆角、12px 文字、32px 按钮；小屏兼容提示距底 170px，避开商品快速栏、标题与底部工具。状态使用“画面精修中／正在整理光影／精细展示”，提供继续精修、仅实时展示和失败重试，不展示访客采样滑块。管理预览共用状态条，不改变管理表单主题。

128 样本完整降噪结果在同一 Canvas 内用 240ms 融入；操作即时返回实时画面。主动“继续精修”保留当前有效采样并显示正在累积的 1024 样本原图，不沿用旧降噪画面；操作立即取消并重回常规 128 样本目标。减弱动态直接呈现完整结果。首次真实光栅帧开放操作，精修准备不遮住商品也不阻止鼠标；失败说明仍可正常观察。默认入口继续 WebGL，当前只交付打字机混合入口供用户验收，钢琴和汽车另行规划。

## 打字机摄影棚样片（2026-10-11）

方案 C 界面保持。`typewriter-v1` 使用低矮圆角地台与银灰绿天空盒；先前侧窗框、背墙与可见软箱已按用户反馈移除。六面背景按统一方向连续着色，去除相机平移，不会在自由转动中露出布景边界；顶部 `#f0f3ef`、水平 `#e7e9e5`、下方 `#cbd4c8`。地面近处仍真实受光，远处在 14—30 场景单位平滑淡出。软箱仅存在于临时 PMREM 捕获场景，光源与反射沿用同一布局。其他商品继续原有舞台，管理预览的界面主题不改，但共用打字机摄影棚。

场景单位参数：地台宽 3.8、深 3、高 0.22、圆角 0.065，顶面跟随商品原 groundY；不改变原模型落点和拆解关系。地台为灰绿 Physical 表面（roughness 0.32、metalness 0.055、clearcoat 0.2），使用 5×5 高斯柔化的低强度平面反射和实时接触阴影，打字机不叠加方向光硬阴影。面积灯与环境软箱负责稳定的宽高光，无自动相机或持续装饰动画。

默认整机相机位置为 `[1.7248, 1.44152, 2.5604]`，观察目标仍为 `[0, 0.47, -0.15]`；沿原观察方向将距离乘 0.88，FOV 38 保持。`camera` 与 `perspective` 使用同一取景，展开全景、平铺俯视及细节视角不改。该变更写入初始配置和生成脚本，本机商品经管理 API 明确保存；不在渲染器中隐藏修改镜头，也不自动覆盖用户后续保存的配置。本次验收见 `.ai/typewriter-skybox-validation.md`。

打字机曝光 1、环境强度 0.9、环境底光 0.16。漆面采用非金属底色与清漆层，主要 enamel 粗糙度 0.26、清漆 0.76、清漆粗糙度 0.15；shellGloss 调整为 0.23/0.8/0.14。早期程序噪纹已撤除：UV 完整的 shellGloss/shellRim 和金属通过确定性 128² 标准法线/粗糙度贴图呈现细微表面，法线权重漆面 0.055、拉丝金属 0.09、铁 0.035，线性通道和 mipmap 减少远处闪烁。金属色彩与源金属度保留，弱各向异性不把所有金属变成镜面。enamel/steel 含无 UV 的源表面，本轮保持干净标准参数，未声称已补齐这些表面的精细贴图。键帽、丝带、贴花和三种外壳配色沿用原资源，不用高强度 Bloom 掩盖材质。

A 键仍通过具名动作触发。字杆摆角由过大的 1.15 rad 校准为有限 0.35 rad，按键、键杠杆与字杆保持联动。源几何、初始姿态与最终平铺端点保留，但分层两盖板路径和十个大件的平铺区间已经修正：盖板避开滚筒/字杆，平铺先腾出横向与转向空间再下降，仍允许任意进度停留和回退。接触阴影使用 1024² HalfFloat 深度与模糊目标，收紧过宽阴影、减轻高空部件的投影，并保持投影与接收面的世界尺寸一致。本轮未改变相机或摄影棚布局。

以上是标准材质与机构演绎的实现事实，CPU 测试不能替代画质或全模型碰撞验收。金属比较以 part-046 金色键缘为主；part-094 标尺边条画面不能单独代表完整金属近景，原 part-000 在合拢态被罩壳遮挡。part-095 大面 enamel 没有新增微表面贴图，不把路径采样颗粒称为漆面纹理。生产确认完成 10 组检查、35 张截图和零浏览器错误，包含全景、近景、分层/平铺、桌面与移动基础兼容；B0 七张历史实机图和摘要保持不变。

2026-10-12 管线比较完成（混合管线接入前）：独立共同场景的五取景 × WebGL2/WebGPU 光栅/静止路径追踪共 15 图通过，另补整机与金属各 1024 样本。正式交互保留增强 WebGL2；路径追踪在静止参考中改善互反射、暗部遮挡与软影，该次比较时尚未接入工作台连续交互，随后已完成打字机实验入口接入；当前状态见上文静止精修说明及混合管线验收。基础 WebGPU 光栅未见独立画质跃升，本轮未测试 SSGI/SSR。共同实验移除了生产平面反射、接触阴影和专属 PMREM，BRDF/过滤也存在差异，不能把实验图冒充当前生产管线或物理真值。本轮只精修打字机，未宣称三件等质。事实、原图与限制见 [.ai/typewriter-quality-validation.md](.ai/typewriter-quality-validation.md)、[.ai/render-pipeline-comparison.md](.ai/render-pipeline-comparison.md)。

## 2026-10-03：正式资产状态补充

2026-10-11 本机交付收尾：当前目录为打字机、钢琴和汽车三件正式 GLB，辅助提示改为“选择展品，自由观察外观、部件与结构。”；保留现有布局、字号、颜色和真实封面。生产目录截图等待三件商品及封面就绪，不使用读取中画面作为完成证据。以下为历史状态。

以下为当时的阶段记录；“三件流程样板”与音箱默认状态属于历史，当前以 Overview 和打字机组件记录为准。

工作台布局与视觉体系保持。加载覆盖层显示真实阶段（读取商品、核对资源、读取模型纹理、准备模型、准备材质光照、即将进入）；不显示估算百分比。失败保留重新加载和目录入口。首帧之前禁用模型操作与热点。

目录封面字段存在时显示实际资源封面，4:3、object-fit cover；未提供时保留原文字行，不生成假图。商品标记按 displayStatus 区分“流程样板/正式展品”，当前三件仍为流程样板。v2 专属舞台可配置背景、地面、曝光与灯光，不增加自动演出。

### 2026-10-08 键盘观察与兼容回退

展示区为可聚焦group，Tab进入后显示方向键、+/−、Home和Tab操作说明，并在舞台内侧显示2px焦点边框。方向键只改变相机，退出导览但不重置部件或配色；原生面板按键不被截获。说明在桌面右上，移动端移至工具条上方；未聚焦时视觉隐藏，保留可访问说明。

不支持WebGL2或渲染器启动失败时改为可滚动图文区，保留产品名、说明、真实样板封面和部件内容。使用36px/27px标题、15px产品说明/部件名称、14px解释正文；15px为本次明确增加的阅读字号。没有三维工具或伪首帧状态。无封面与接口错误分别处理，仍可打开目录；桌面与390/320截图和真实浏览器检查通过。

三件样板封面为960×720的纯Three.js场景截图，不包含DOM工具与热点，按实际API引用展示。来源/摘要见public/covers/workbench/manifest.json。当前为流程样板，不能作为正式GLB画质证据。

### 2026-10-08 可逆结构进度

此处百分比滑条与 2 秒行程记录对应原有轨道样板；当前打字机使用上文的具名结构按钮与独立镜头，不套用这段面板表达。

视觉体系和单面板布局保持。结构与动作面板新增具名原生range、0.0—100.0%输出及两列按钮，步长0.1%；输出使用tabular-nums，范围控件沿用冷银蓝accent-color与键盘焦点。滑条高度42px，按钮42px，间隔8px；进度组以22px上内边距和单条边线分隔，不添加嵌套卡片。状态说明为12px，明确显示播放中/初始状态/已停留。

进度动作全程2秒、线性补间，部分行程按剩余距离计算；这替代音箱分层和双门原先的离散550ms动作。旋钮、打字机联动、汽车分离及相机时长保持。手动拖动/缩放/视角/选择部件暂停进度，关闭面板不重置，继续必须主动触发。减弱动态自动操作直接定位，原生滑条仍工作。动作复原只复原该动作，统一还原商品入口继续显示恢复范围。

## 冷白摄影棚概念材质候选（2026-10-23）

`carShowroom=cold-studio` revision 6采用真实1.8米石砖、2毫米砖缝与连续弧墙；墙面保持低反差炭灰，顶棚降至5.2米，两块顶灯、侧墙竖灯与后墙横向补光共同构成中性白摄影棚。生成底色原生1254²，线性微法线与粗糙度1024²，不能描述成原生4K扫描材质。灯板、灯光和同场景环境捕获共用配置；普通入口与汽车材质保持。来源、失败对照与验证范围见 `.ai/reventon-studio-refinement.md`。仅为摄影棚候选，车身世界空间反射未扩展。

revision 7补充墙面空间尺度：6厘米厚喷涂墙板、1.8厘米真实开缝、8毫米倒角与12厘米金属收边；墙脚圆弧收紧为0.45米。墙面底色使用镜像边缘采样减少重复边界的亮度跳变，技术法线保持周期采样。结构通过真实轮廓与掠射光提供细节，不用新增背景光条或假阴影贴图装饰墙面；汽车与灯光参数保持。

revision 8修正墙脚发白环：建筑表面使用实际面积光的直接高光，间接镜面采用灯板置黑的房间捕获；汽车与地板沿用完整灯板环境。此分流不通过整体压暗或移除微表面掩盖问题，墙面暗部质感仍待进一步视觉确认。

revision 9以可信摄影棚空间为当前目标：房间14×18、高4.6场景单位，石砖1.2、墙板约2.4宽，0.45圆弧墙脚保持。顶棚增加20厘米宽、16厘米高的实体安装框架，与顶灯灯壳搭接；框架共用一个合并网格、喷涂深灰材质，进入原有捕获/避让/释放。地面底色乘中性#bfbfbf，框架与收边#3b3d40、roughness 0.45、metalness 0.1。灯具随建筑重新定位，曝光与辐射强度不变；未改变汽车材质、动作和镜头范围。这些是场景设计尺度，不是实测建筑或汽车尺寸。
