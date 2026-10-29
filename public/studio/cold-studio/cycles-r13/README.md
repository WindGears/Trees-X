# Cold studio r13 / key-light placement study

Trees X authored room geometry and existing generated floor textures. No car
geometry or third-party HDR is included. Floor provenance stays in `../concept-v2/`.

Same geometry, materials, exposure, light sizes and radiance as r12; only the
main ceiling softbox moves from z=1.2 to z=-3, with its target moving identically.
The purpose is to move its reflection off the default windshield observation
area without reducing the glass specular response or changing transmission.
This artistic layout is not a measured studio and still requires visual review.

Reproduce: `node scripts/export-cold-studio-source.mjs --balanced`, then run
`scripts/blender/cold_studio_cycles.py` using background factory-startup Blender
with `--python-exit-code 1 -- --source artifacts/car-showroom/cycles-r13/scene.json`.
Register with `node scripts/register-cold-studio-cycles.mjs --balanced`.

Blender 5.2.2 LTS / Cycles OptiX, 256 fixed samples, OIDN, 12 total bounces, no clamp.
Six 1024-square linear EXRs per signal become losslessly gzipped RGBA16F:
4096 by 2048 specular radiance and 1024 by 512 indirect input. The manifest records
source/runtime hashes, byte counts, emitter direction checks and half-float error.
Bottom-up equirectangular rows, `flipY=false`, linear sRGB.

Native Blender/Three BRDF differences remain. Indirect capture hides panels from
camera rays only, retaining secondary illumination; this is not an exact
direct-light subtraction. These are central room probes, not a floor lightmap
or a baked car animation. The car and its planar reflection remain realtime.

Explicit candidate: `carStudioFinish=balanced` on the cold-studio Cycles entry.
Old r10/r11/r12 resources and the default entry are preserved. Material/appearance
acceptance must be recorded separately from successful registration and checks.
