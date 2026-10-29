# Cold studio r14 / rear rim-light study

Trees X authored room geometry and existing generated floor textures. No car
geometry or third-party HDR is included. Floor provenance stays in `../concept-v2/`.

Same room, car, camera, exposure and three other lights as r13. The rim fixture
moves from the left wall to the rear wall at [-3.75, 2.25, 6.86], facing forward.
Its rectangle changes from 1.1 x 2.8 to 3.5 x 0.88: emitting area, radiance and
light intensity remain unchanged. Mirror footprints from actual model normals
suggest this placement can reach the roof without broad windshield coverage.
That diagnostic ignores occlusion and roughness; it is not visual acceptance.
The initial 4.4 x 0.7 candidate overlapped the default product description;
one concentrated correction shortened and shifted the fixture while keeping area.

Reproduce: `node scripts/export-cold-studio-source.mjs --rim`, then run
`scripts/blender/cold_studio_cycles.py` using background factory-startup Blender
with `--python-exit-code 1 -- --source artifacts/car-showroom/cycles-r14/scene.json`.
Register with `node scripts/register-cold-studio-cycles.mjs --rim`.

Cycles OptiX, 256 fixed samples, OIDN, 12 total bounces, no clamp. Six 1024-square
linear EXRs per signal become losslessly gzipped RGBA16F: 4096 x 2048 specular
radiance and 1024 x 512 indirect input. The manifest records source/runtime
hashes, byte counts, emitter direction checks and half-float error. Bottom-up
equirectangular rows, flipY=false, linear sRGB.

Native Blender/Three BRDF differences remain. Indirect capture hides panels from
camera rays only, retaining secondary illumination; it is not exact direct-light
subtraction. These are room probes, not a floor lightmap or baked car animation.
The car and its planar reflection remain realtime.

Explicit candidate: carStudioFinish=rim on the cold-studio Cycles entry. Earlier
resources and the default entry remain. Engineering and visual acceptance are
recorded separately in `.ai/reventon-rim-room-validation.md`.
