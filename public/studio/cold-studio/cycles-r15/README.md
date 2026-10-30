# Cold studio r15 / ground reflectance study

Trees X authored room geometry and existing generated floor textures; provenance
is retained in ../concept-v2/. No car or third-party HDR is included.

Only floor tint changes from r14 #999999 to #dddddd. Geometry, texture maps,
roughness, four lamps, camera, exposure and car materials are unchanged.
The browser candidate is carStudioFinish=stone, not the default entry.

Reproduce with export-cold-studio-source.mjs --stone, background factory-startup
Blender running scripts/blender/cold_studio_cycles.py with source
artifacts/car-showroom/cycles-r15/scene.json, then register-cold-studio-cycles.mjs
--stone. Cycles OptiX, 256 samples, 12 bounces, OIDN, six 1024-square faces per
signal. Gzipped RGBA16F uses bottom-up equirect rows, flipY=false, linear sRGB.
Manifest records source digest, runtime digests, sizes and quantization error.

Room radiance probes are not floor lightmaps or a baked car animation. Native
Blender/Three BRDF differences remain. Indirect camera rays hide panels but
secondary rays retain their illumination; this is not exact direct subtraction.

Actual paired views show a more readable floor, but no substantial side-paint
improvement. This is an explicit comparison, not overall visual acceptance.
