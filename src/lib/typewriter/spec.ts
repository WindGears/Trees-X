import type { BufferGeometry } from 'three'

/**
 * 打字机机械研究的零件规格核心。
 * 本模块只包含类型与常量，不创建 Three 对象；几何由零件构建器惰性生成。
 */

export type GroupId =
  'shell' | 'carriage' | 'ribbon' | 'typebars' | 'keys' | 'levers' | 'frame' | 'hardware'

export interface GroupMeta {
  id: GroupId
  /** 目录与筛选用中文名 */
  name: string
  /** 序列号前缀，如 SHL-001 */
  prefix: string
  /** 拆解阶段起点（0..1，越小越早分离）：外壳与字车架先行 */
  explodeStart: number
  /** 平铺阶段的组内排布提示色（仅 UI 使用） */
  tint: string
  blurb: string
}

/** 分离顺序：外壳、字车架 → 色带 → 字杆 → 键盘 → 连杆 → 机架 → 五金 */
export const GROUPS: GroupMeta[] = [
  {
    id: 'shell',
    name: '外壳',
    prefix: 'SHL',
    explodeStart: 0,
    tint: '#3c3f45',
    blurb: '缎面黑珐琅壳体、卷边饰板与 Kimi 徽标。',
  },
  {
    id: 'carriage',
    name: '字车架',
    prefix: 'CAR',
    explodeStart: 0.04,
    tint: '#8a7a5c',
    blurb: '胶辊、压纸尺、刻度尺与回车扳手所在的滑架。',
  },
  {
    id: 'ribbon',
    name: '色带',
    prefix: 'RIB',
    explodeStart: 0.18,
    tint: '#7d2c33',
    blurb: '黑红双色色带、带盘与升降导带叉。',
  },
  {
    id: 'typebars',
    name: '字杆',
    prefix: 'TYP',
    explodeStart: 0.3,
    tint: '#9aa4ae',
    blurb: '44 根扇形排布的字杆与带槽字杆篮。',
  },
  {
    id: 'keys',
    name: '键盘',
    prefix: 'KEY',
    explodeStart: 0.44,
    tint: '#e9e0c8',
    blurb: '50 枚象牙键帽与镍圈，含功能键与空格杆。',
  },
  {
    id: 'levers',
    name: '连杆',
    prefix: 'LEV',
    explodeStart: 0.58,
    tint: '#b08d4f',
    blurb: '键杆、拉线、万向杆与功能扳杆。',
  },
  {
    id: 'frame',
    name: '机架',
    prefix: 'FRM',
    explodeStart: 0.72,
    tint: '#5c6570',
    blurb: '主机架、横梁、棘轮与弹簧鼓。',
  },
  {
    id: 'hardware',
    name: '五金',
    prefix: 'HDW',
    explodeStart: 0.82,
    tint: '#8f969e',
    blurb: '枢轴销、回位弹簧、垫圈、螺钉与脚垫。',
  },
]

export type MaterialKey =
  | 'enamel' // 缎面黑珐琅（壳体）
  | 'enamelFlat' // 哑光黑（底壳内侧、空格杆）
  | 'gold' // 金色调镍饰件
  | 'ivory' // 象牙键帽
  | 'keyDark' // 深色功能键帽
  | 'steel' // 抛光钢（可见加工痕）
  | 'steelSatin' // 缎面钢（字杆臂）
  | 'rubber' // 胶辊橡胶
  | 'ribbon' // 黑红色带织物
  | 'cast' // 铸铁皱纹漆（机架）
  | 'paper' // 标尺纸面
  | 'badge' // Kimi 徽标金底字面

export interface Transform {
  /** 位置 */
  p: [number, number, number]
  /** 欧拉角（弧度，XYZ 序） */
  r: [number, number, number]
}

export interface PartSpec {
  id: string
  serial: string
  group: GroupId
  name: string
  description: string
  /** interpreted=依常见结构演绎；uncertain=缺少参照、明确标注为推测 */
  certainty: 'interpreted' | 'uncertain'
  material: MaterialKey
  /** 惰性构建几何（构建器内部做缓存共享） */
  make: () => BufferGeometry
  /** 整机组装态 */
  assembled: Transform
  /** 机构爆炸态 */
  exploded: Transform
  /** 平铺时的朝向（绕 Y  yaw，弧度） */
  flatYaw: number
  /** 平铺落地高度（零件平放后的半高） */
  flatHeight: number
  /** 平铺占地（宽 × 深） */
  flatSize: [number, number]
  /** 组内错峰 0..0.14 */
  stageOffset: number
  /** 字符键/字杆对应的字符 */
  char?: string
}

export const identity: Transform = { p: [0, 0, 0], r: [0, 0, 0] }

export function at(
  p: [number, number, number],
  r: [number, number, number] = [0, 0, 0],
): Transform {
  return { p, r }
}

/** 在两个变换之间插值（位置线性、角度线性，供三态管线使用） */
export function lerpTransform(a: Transform, b: Transform, t: number): Transform {
  const m = (x: number, y: number) => x + (y - x) * t
  return {
    p: [m(a.p[0], b.p[0]), m(a.p[1], b.p[1]), m(a.p[2], b.p[2])],
    r: [m(a.r[0], b.r[0]), m(a.r[1], b.r[1]), m(a.r[2], b.r[2])],
  }
}

export const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/**
 * 进度 p ∈ [0,1] 的三态分解：
 *   [0, 0.45)      整机 → 爆炸（按组错峰）
 *   [0.45, 1]      爆炸 → 平铺（按组错峰）
 */
export const EXPLODE_PHASE = 0.45

export function phaseWindow(p: number, start: number, span: number, phaseStart = 0, phaseSpan = 1) {
  const local = (p - phaseStart) / phaseSpan
  const t = (local - start) / span
  return smoothstep(t)
}
