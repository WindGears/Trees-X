import type { ModelKit } from './modelKit'
import type { SampleKey } from './types'

function speaker(k: ModelKit) {
  const shell = k.node('shell', [0, 1.12, 0], [0, 0, -0.45])
  k.box(shell, [1.55, 2.05, 0.82], [0, 0, 0])
  const front = k.node('front', [0, 1.12, 0.48], [0, 0, 0.65])
  k.box(front, [1.4, 1.9, 0.12], [0, 0, 0], k.dark)
  const driver = k.node('driver', [0, -0.3, 0.1], [0, 0, 0.15], front)
  for (const [r, d, z] of [
    [0.5, 0.1, 0],
    [0.4, 0.12, 0.07],
    [0.24, 0.14, 0.14],
  ] as const) {
    const mesh = k.cylinder(driver, r, d, [0, 0, z], r === 0.5 ? k.metal : k.rubber)
    mesh.rotation.x = Math.PI / 2
  }
  const tweeter = k.cylinder(front, 0.22, 0.08, [0, 0.55, 0.12])
  tweeter.rotation.x = Math.PI / 2
  k.sphere(front, 0.13, [0, 0.55, 0.17])
  const knob = k.node('knob', [0.38, 2.22, 0.04], [0, 0.45, 0])
  k.cylinder(knob, 0.19, 0.15, [0, 0, 0])
  k.box(knob, [0.025, 0.015, 0.1], [0, 0.09, 0.07], k.dark, 0.004)
  k.box(k.root, [1.45, 0.12, 0.8], [0, 0.08, 0], k.rubber)
  return (values: Record<string, number>) => {
    knob.rotation.y = (values['turn-knob'] ?? 0) * Math.PI * 1.3
  }
}
function typewriter(k: ModelKit) {
  const shell = k.node('shell', [0, 0.25, 0], [0, -0.1, 0])
  k.box(shell, [2.75, 0.45, 2.05], [0, 0, 0])
  const keys = k.node('keys', [0, 0.55, 0.5], [0, 0.5, 0.65])
  k.box(keys, [2.5, 0.12, 1.1], [0, 0, 0], k.dark)
  const key = k.node('key', [0, 0.11, 0.25], [0, 0, 0], keys)
  k.box(key, [0.2, 0.12, 0.2], [0, 0, 0], k.paper, 0.035)
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 10; col++) {
      if (row === 3 && col === 5) continue
      k.box(keys, [0.17, 0.1, 0.17], [(col - 4.5) * 0.23, 0.1, (row - 1.5) * 0.23], k.paper, 0.03)
    }
  k.box(keys, [1.35, 0.1, 0.16], [0, 0.09, 0.57], k.metal, 0.03)
  const carriage = k.node('carriage', [0, 1.05, -0.65], [0, 0.6, -0.45])
  const roller = k.cylinder(carriage, 0.22, 2.35, [0, 0, 0], k.rubber)
  roller.rotation.z = Math.PI / 2
  for (const x of [-1.3, 1.3]) {
    const cap = k.cylinder(carriage, 0.25, 0.16, [x, 0, 0])
    cap.rotation.z = Math.PI / 2
  }
  k.box(carriage, [1.75, 0.8, 0.035], [0, 0.45, -0.14], k.paper, 0.01)
  const lever = k.node('lever', [0, 0.65, -0.42], [0, 0.35, 0])
  k.box(lever, [0.07, 0.09, 0.86], [0, 0.04, 0.38], k.metal, 0.015)
  k.box(lever, [0.18, 0.14, 0.12], [0, 0.05, 0.82], k.metal, 0.015)
  return (values: Record<string, number>) => {
    const p = values['press-key'] ?? 0
    key.position.y -= p * 0.075
    lever.rotation.x = -p * 0.8
    carriage.position.x += p * 0.12
  }
}
function car(k: ModelKit) {
  const body = k.node('body', [0, 0.55, 0], [0, 0.1, 0])
  k.box(body, [1.9, 0.4, 3.55], [0, 0, 0], k.finish, 0.12)
  k.box(body, [1.8, 0.28, 1.35], [0, 0.22, 1.03], k.finish, 0.08)
  k.box(body, [1.85, 0.3, 0.8], [0, 0.2, -1.24], k.finish, 0.08)
  k.box(body, [1.84, 0.12, 0.12], [0, 0.02, 1.81], k.dark, 0.02)
  for (const x of [-0.64, 0.64]) k.box(body, [0.4, 0.08, 0.05], [x, 0.16, 1.8], k.paper, 0.02)
  const cabin = k.node('cabin', [0, 0.85, -0.28], [0, 0.45, 0])
  k.box(cabin, [1.5, 0.09, 1.4], [0, 0, 0], k.dark)
  for (const x of [-0.4, 0.4]) {
    k.box(cabin, [0.5, 0.15, 0.5], [x, 0.08, -0.2], k.rubber)
    const seat = k.box(cabin, [0.5, 0.52, 0.14], [x, 0.33, -0.48], k.rubber)
    seat.rotation.x = -0.12
  }
  k.box(cabin, [1.45, 0.22, 0.28], [0, 0.22, 0.48], k.dark)
  const windshield = k.box(body, [1.58, 0.6, 0.045], [0, 0.58, 0.48], k.glass, 0.02)
  windshield.rotation.x = -0.4
  k.box(body, [1.56, 0.08, 0.85], [0, 0.85, -0.27], k.finish, 0.05)
  const doors = [-1, 1].map((side) => {
    const door = k.node(
      side === -1 ? 'door-left' : 'door-right',
      [side * 0.97, 0.57, 0.38],
      [side * 0.55, 0.1, 0],
    )
    k.box(door, [0.09, 0.42, 1.3], [0, 0.15, -0.54])
    k.box(door, [0.045, 0.33, 1.12], [0, 0.53, -0.5], k.glass, 0.02)
    return door
  })
  for (const side of [-1, 1])
    for (const z of [-1.14, 1.14]) {
      const wheel = k.node(
        'wheel-' + side + '-' + z,
        [side * 0.98, 0.34, z],
        [side * 0.6, -0.05, z * 0.12],
      )
      const tyre = k.cylinder(wheel, 0.34, 0.25, [0, 0, 0], k.rubber)
      tyre.rotation.z = Math.PI / 2
      const rim = k.cylinder(wheel, 0.22, 0.27, [0, 0, 0], k.metal)
      rim.rotation.z = Math.PI / 2
      const hub = k.cylinder(wheel, 0.09, 0.29, [0, 0, 0], k.dark)
      hub.rotation.z = Math.PI / 2
    }
  return (values: Record<string, number>) => {
    const p = values['open-doors'] ?? 0
    for (const door of doors) door.rotation.x = -p * 1.15
  }
}
export const sampleBuilders: Record<
  SampleKey,
  (kit: ModelKit) => (values: Record<string, number>) => void
> = { speaker, typewriter, car }
