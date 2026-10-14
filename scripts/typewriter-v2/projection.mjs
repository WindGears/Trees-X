/** Per-face local projection for thin ribbon and flat spring strips; seams split only UV vertices. */
export function projectLocal({ mesh, positions, indices }) {
  const remap = [],
    uv = [],
    output = new Uint32Array(indices.length),
    vertices = new Map()
  for (let face = 0; face < indices.length; face += 3) {
    const [a, b, c] = [indices[face] * 3, indices[face + 1] * 3, indices[face + 2] * 3]
    const ab = [0, 1, 2].map((k) => positions[b + k] - positions[a + k])
    const ac = [0, 1, 2].map((k) => positions[c + k] - positions[a + k])
    const normal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ]
    const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)))
    const pair = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1]
    for (let k = 0; k < 3; k++) {
      const source = indices[face + k],
        key = `${source}:${axis}`
      let slot = vertices.get(key)
      if (slot === undefined) {
        slot = remap.length
        vertices.set(key, slot)
        remap.push(source)
        uv.push(positions[source * 3 + pair[0]], positions[source * 3 + pair[1]])
      }
      output[face + k] = slot
    }
  }
  return { mesh, remap: Uint32Array.from(remap), indices: output, uv: Float32Array.from(uv) }
}
