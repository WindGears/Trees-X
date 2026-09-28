/**
 * 整机共享尺寸：键盘行、字杆扇、滑架基准线。
 * 单位约定 1 = 10cm；整机占地约 3.2 × 3.0，组装态底部落在 y=0。
 * 前方 = +Z（键盘朝向观察者），滑架在后（-Z）。
 */

export interface KeySeed {
  /** 键位字符（功能键为空） */
  char?: string
  /** 功能键种别 */
  fn?: 'tab' | 'backspace' | 'shiftL' | 'shiftR' | 'marginRelease' | 'space'
  x: number
  y: number
  z: number
  row: number
  /** 空格杆加宽 */
  wide: number
}

/** 44 个字符键：行主序，决定字杆编号 */
export const CHAR_ROWS: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '/'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '?'],
]
export const CHARS: string[] = CHAR_ROWS.flat()

const ROW_Y = [0.86, 0.76, 0.66, 0.56]
const ROW_Z = [0.55, 0.88, 1.21, 1.54]
const STEP = 0.2
/** 键帽前倾角（弧度） */
export const KEY_TILT = -0.3

/** 生成 50 个键位（44 字符 + TAB/BACK/SHIFT×2/M.R./SPACE） */
export function keyLayout(): KeySeed[] {
  const keys: KeySeed[] = []
  const pushRow = (row: number, chars: string[], x0: number) =>
    chars.forEach((char, i) =>
      keys.push({ char, x: x0 + i * STEP, y: ROW_Y[row]!, z: ROW_Z[row]!, row, wide: 1 }),
    )
  // Row1：TAB + 12 字符 + BACK
  keys.push({ fn: 'tab', x: -1.3, y: ROW_Y[0]!, z: ROW_Z[0]!, row: 0, wide: 1 })
  pushRow(0, CHAR_ROWS[0]!, -1.1)
  keys.push({ fn: 'backspace', x: 1.3, y: ROW_Y[0]!, z: ROW_Z[0]!, row: 0, wide: 1 })
  // Row2：11 字符 + M.R.
  pushRow(1, CHAR_ROWS[1]!, -1.1)
  keys.push({ fn: 'marginRelease', x: 1.2, y: ROW_Y[1]!, z: ROW_Z[1]!, row: 1, wide: 1 })
  // Row3：11 字符
  pushRow(2, CHAR_ROWS[2]!, -1.0)
  // Row4：SHIFT + 10 字符 + SHIFT
  keys.push({ fn: 'shiftL', x: -1.2, y: ROW_Y[3]!, z: ROW_Z[3]!, row: 3, wide: 1 })
  pushRow(3, CHAR_ROWS[3]!, -0.9)
  keys.push({ fn: 'shiftR', x: 1.2, y: ROW_Y[3]!, z: ROW_Z[3]!, row: 3, wide: 1 })
  // Row5：空格杆
  keys.push({ fn: 'space', x: 0, y: 0.5, z: 1.93, row: 4, wide: 5 })
  return keys
}

/** 字杆扇：篮弧圆心、半径、枢轴高度、扇面半角 */
export const BASKET = {
  cx: 0,
  cz: 0.18,
  radius: 0.5,
  pivotY: 0.48,
  spread: 1.02,
  count: 44,
}

/** 第 i 根字杆的扇面角（-spread..+spread） */
export function barAngle(i: number): number {
  return -BASKET.spread + (i / (BASKET.count - 1)) * BASKET.spread * 2
}

/** 第 i 根字杆的枢轴位置（弧缘略向前包） */
export function barPivot(i: number): [number, number, number] {
  const a = barAngle(i)
  return [
    BASKET.cx + BASKET.radius * Math.sin(a),
    BASKET.pivotY,
    BASKET.cz - BASKET.radius * (1 - Math.cos(a)) * 0.55 - BASKET.radius * Math.cos(a) * 0.18,
  ]
}

/** 字杆静置俯仰（+Z 端略向下）与击发俯仰 */
export const BAR_REST_PITCH = 0.1
export const BAR_STRIKE_PITCH = -1.18

/** 滑架基准线 */
export const CARRIAGE = {
  railY: 1.06,
  railZ: -0.6,
  platenY: 1.3,
  platenZ: -0.66,
  platenRadius: 0.14,
  platenLength: 2.5,
  halfSpan: 1.34,
}

/** 打印点（字杆击发目标、色带喉口） */
export const PRINT_POINT: [number, number, number] = [0, 1.12, -0.42]

/** 机身外壳轮廓 */
export const BODY = {
  width: 3.2,
  depth: 3.0,
  cheekX: 1.5,
  deckY: 0.98,
}
