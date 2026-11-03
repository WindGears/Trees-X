# wrap 亮银接缝法线隔离（2026-11-03）

## 范围与发现

保持 r18 wrap-wide、原亮银、曝光、相机和灯光，仅在后台浏览器的临时
几何副本中对照法线。没有修改汽车 GLB、生产材质或默认入口。

在相同斜前和正侧取景下：

- 原法线＋关闭 SSR/GI 修正：接缝亮细边仍然可见。
- 面法线：部分门板细亮边减弱，但引擎盖、翼子板和侧面出现明显三角形
  块状高光，不能作为修复。
- Three `computeVertexNormals()` 面积加权：保留平滑外观，但细亮边仍在，
  没有足够收益支持整车替换。

这说明原始插值法线参与了接缝高光的形成，不证明所有亮边均为错误，也不
证明 SSR 不存在其他颗粒。不能据此关掉镜面、增加全局模糊或重算整个资产。
下一步应针对可见问题接缝检查倒角及跨面法线，保留大面的原始平滑与折线。
尚未完成局部几何修复、运动闪烁验收或实际呈现性能验收。

## 工具与边界

`scripts/reventon-paint-lighting-check.mjs` 增加 `normals` 隔离模式及明确的
rim/r14、wrap/r17、wrap-wide/r18 选择。几何仅在所有材质槽均属于实际20159
漆面时派生；检查位置、UV、其他属性及索引保持逐值一致。原始几何借用，
派生副本独占释放，在 finally 恢复原几何。没有新的生产 pass 或绘制时钟。

面法线直接使用 Three 原生 flatShading；面积加权只用于诊断，不替换源资产。
native 模式关闭 SSR/GI 最终修正，不声称停掉全部辅助计算。DDGI 和阴影代理
没有重新制作为另一份完整参考，因此图像不是各光照分量的独立数值测量。

恢复阶段核对实际材质输入、几何身份、相机与曝光；每张图核对唯一 Canvas、
renderer、输出1440×1000、四灯和环境身份及GPU错误。结果写入忽略的
`artifacts/car-showroom/silver-normal-r18-final`；visualPassed保持false。

```powershell
$env:TREES_PAINT_STUDY='silver'
$env:TREES_PAINT_AUDIT='normals'
$env:TREES_STUDIO_FINISH='wrap-wide'
$env:TREES_PAINT_OUTPUT='artifacts/car-showroom/silver-normal-r18-final'
node scripts/reventon-paint-lighting-check.mjs
```

首次原生/面法线10张、扩展面积加权14张已完成。最终工具增加属性不变及
清理检查后再次完成14张，report.json的passed=true、visualPassed=false、
errors为空。四个实际车漆网格均恢复原几何，输入及曝光检查通过。

`npm run check` 的TypeScript与ESLint通过；仍仅被用户未提交的
PERFORMANCE_OPTIMIZATION.md格式阻断，未修改该文件，后续单测没有执行。
本轮没有生产行为修改，不引用上一批单测数量冒充重跑。`npm run build`
通过，已恢复原有六组对照入口并增加本轮诊断图集；不将静帧诊断计为性能验收。
