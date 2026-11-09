# Pinned Three SSR derivative

Source: installed `three@0.185.1`, `examples/jsm/tsl/display/SSRNode.js` and
`examples/jsm/tsl/utils/SpecularHelpers.js`. Copyright three.js authors, MIT;
complete license retained in `THREE-LICENSE.txt`. This is an explicitly modified
local derivative, not an unmodified upstream module or a new reflection algorithm.

Reproduce with `node scripts/car-world-ssr-source.mjs`; verify with `--check`.
The generator rejects different upstream SHA-256 hashes and checks every insertion
has exactly one match. Line endings are normalized only for reproducibility.
Generated files retain upstream formatting; only these exact files are excluded
from formatting/linting. Type declarations and integration code remain checked.

Changes:

- Absolute addon imports; local specular helper import.
- Build-time `worldFallback` callback, only after a stochastic SSR miss. Its result
  is outgoing linear HDR radiance and positive world-space distance (zero declines).
  Native sample direction, GGX weight and dominant-distance factor are reused.
  No independent ray resampling, extra environment addition or readback.
- Tangent basis checks the raw cross product before normalization. The upstream
  normalization-first sequence is degenerate for a normal parallel to view Z.
  This fix is local to this candidate, not a global Three prototype mutation.

The callback owns neither acceleration structures nor source textures. It is fixed
for a compiled graph; binding changes rebuild the graph, scalar changes use uniforms.
Each SSR instance retains its original target/material lifecycle. The production
factory remains native until a prepared world-query owner is explicitly supplied.

Validation: `node scripts/car-world-reflection-check.mjs` runs isolated, headless,
actual WebGPU rendering. It does not assert full-car shading equivalence, world-hit
temporal rejection, clearcoat support, performance or visual acceptance.
