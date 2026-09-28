import { PartBuilder } from './builder'
import { cyl, roundedBox } from './geometry'
import { keyLayout, KEY_TILT, type KeySeed } from './dim'
import { at } from './spec'

/**
 * 键盘组：50 键 = 50 键帽 + 50 镍圈 = 100 件。
 * 字符键使用 ivory 材质，功能键使用 keyDark 材质。
 */

export interface KeyPartIds {
  cap: string
  ring: string
  char?: string
  fn?: KeySeed['fn']
  keyIndex: number
}

const CAP_R = 0.078
const RING_R = 0.094

const FN_NAME: Record<NonNullable<KeySeed['fn']>, string> = {
  tab: '制表键',
  backspace: '退格键',
  shiftL: '左换档键',
  shiftR: '右换档键',
  marginRelease: '边距释放键',
  space: '空格杆',
}

export function buildKeys(): { parts: ReturnType<PartBuilder['add']>[]; keyIds: KeyPartIds[] } {
  const b = new PartBuilder('keys', 'KEY')
  const keyIds: KeyPartIds[] = []
  const keys = keyLayout()
  const capParts: ReturnType<PartBuilder['add']>[] = []

  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const key = keys[keyIndex]!
    const char = key.char
    const isSpace = key.fn === 'space'
    const label = char ? `键帽 ${char}` : FN_NAME[key.fn ?? 'space']
    const mat: 'ivory' | 'keyDark' = char ? 'ivory' : 'keyDark'

    const cap = b.add({
      name: label,
      description: char
        ? `象牙色键帽，字面铸印「${char}」。按战前便携机样式配镍圈与微拱顶面；字符排布为演绎推测。`
        : `深色功能键帽（${label}）。尺寸与字符键一致，保持阵列的完整节奏。`,
      material: mat,
      make: () =>
        isSpace
          ? roundedBox(0.98, 0.055, 0.17, 0.024)
          : cyl(CAP_R * 0.94, CAP_R, 0.055, 20),
      assembled: at([key.x, key.y, key.z], [KEY_TILT, 0, 0]),
      exploded: at(
        [key.x, key.y + 0.52 + key.row * 0.09, key.z + 0.08 * key.row],
        [KEY_TILT, 0, 0],
      ),
      flatSize: isSpace ? [1.0, 0.19] : [0.17, 0.17],
      flatHeight: isSpace ? 0.028 : 0.03,
      flatYaw: ((keyIndex % 5) - 2) * 0.05,
      char,
    })
    capParts.push(cap)
  }

  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const key = keys[keyIndex]!
    const char = key.char
    const isSpace = key.fn === 'space'
    const label = char ? `键圈 ${char}` : `${FN_NAME[key.fn ?? 'space']}饰圈`

    const ring = b.add({
      name: label,
      description: isSpace
        ? '空格杆下方金色调压条，与前脸饰条呼应（演绎件）。'
        : '键帽外圈金色调镍圈，滚边压合固定字面；表面保留细微车削痕。',
      material: 'gold',
      make: () =>
        isSpace
          ? roundedBox(1.04, 0.02, 0.22, 0.008)
          : cyl(RING_R + 0.006, RING_R + 0.006, 0.045, 20),
      assembled: at([key.x, key.y - 0.012, key.z], [KEY_TILT, 0, 0]),
      exploded: at(
        [key.x, key.y + 0.86 + key.row * 0.09, key.z + 0.1 * key.row],
        [KEY_TILT, 0, 0],
      ),
      flatSize: isSpace ? [1.06, 0.24] : [0.2, 0.2],
      flatHeight: isSpace ? 0.011 : 0.023,
      flatYaw: ((keyIndex % 5) - 2) * -0.04,
      char,
    })
    keyIds.push({
      cap: capParts[keyIndex]!.id,
      ring: ring.id,
      char,
      fn: key.fn,
      keyIndex,
    })
  }

  return { parts: b.parts, keyIds }
}
