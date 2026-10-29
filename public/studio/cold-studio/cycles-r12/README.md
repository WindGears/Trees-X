# Cold studio r12 / compact physical room trial

Trees X authored room geometry and the existing generated floor textures. No car
geometry or external HDR is included. Texture provenance remains in `../concept-v2/`.

This independent trial reduces the room to 12 by 14 scene units and 3.8 units high,
lowers the two ceiling softboxes, and replaces the wide back panel with a vertical
light. The smooth wall finish is retained. Runtime car materials, exposure and
motion data are unchanged. These are artistic dimensions, not a measured building.

Reproduce: `node scripts/export-cold-studio-source.mjs --compact`, then run
`scripts/blender/cold_studio_cycles.py` with background factory-startup Blender and
`--python-exit-code 1 -- --source artifacts/car-showroom/cycles-r12/scene.json`.
Register with `node scripts/register-cold-studio-cycles.mjs --compact`.

Blender 5.2.2 LTS / Cycles OptiX, 256 fixed samples, OIDN, 12 total bounces, no clamp.
Six 1024-square linear EXRs per signal become losslessly gzipped RGBA16F:
4096 by 2048 specular radiance and 1024 by 512 indirect input. The manifest records
source and runtime hashes, byte counts, emitter landmarks and half-float error.
Bottom-up equirectangular rows, `flipY=false`, linear sRGB.

Blender and Three BRDFs are approximations of one another. Indirect capture hides
panels only from camera rays while preserving secondary illumination; it is not
an exact subtraction of every direct-light term. This is a central room probe,
not a floor lightmap or a baked car animation. Dynamic car reflections stay live.

Explicit candidate: `carStudioFinish=compact` with the cold-studio Cycles entry.
The existing r10/r11 resources remain unchanged. Overall visual acceptance is pending.
