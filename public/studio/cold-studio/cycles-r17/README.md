# Cold studio r17 / broad fill reflection study

Trees X authored room geometry and existing generated floor textures; provenance
is retained in ../concept-v2/. No car or third-party HDR is included.

Explicit carStudioFinish=wrap derives from r16. Only the existing fill changes:
width 5.6, height 1, position [5.65,3.05,2], target [1,0,2], radiance/intensity 7.68.
Area times radiance is preserved relative to r16. This does not imply the same
incident irradiance at every surface: emitter position and angular size change.
The car material, other lights, room, output size and reflection budget remain.

Reproduce with export-cold-studio-source.mjs --wrap, background factory-startup
Blender running scripts/blender/cold_studio_cycles.py with source
artifacts/car-showroom/cycles-r17/scene.json, then register-cold-studio-cycles.mjs
--wrap. Cycles OptiX, 256 samples, 12 bounces, OIDN; six 1024-square faces per
signal. Gzip RGBA16F, bottom-up equirect rows, flipY=false, linear sRGB.
Manifest records configuration, source/runtime digests, sizes and conversion error.

This is room radiance for view-dependent reflection, not fixed car highlights or
a surface lightmap. Single-probe spatial and Blender/Three BRDF approximations
remain. The indirect source hides emitter camera rays while retaining secondary
illumination; it is not an exact per-light decomposition. Runtime texture sizes
match r16, with different compressed bytes. Ordinary entry stays unchanged.

Visual and runtime outcomes are recorded in .ai/reventon-wrap-room-validation.md.
This optional candidate does not itself establish overall quality acceptance.
