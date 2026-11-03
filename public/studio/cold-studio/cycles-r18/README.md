# Cold studio r18 / extended wrap fill study

Trees X authored room geometry and existing generated floor textures; provenance
is retained in ../concept-v2/. No car or third-party HDR is included.

Explicit carStudioFinish=wrap-wide derives from the user-selected r17 wrap.
Only the existing fill changes: width 7.4, position [5.65,3.05,1.1], target
[1,0,1.1]. Height 1 and radiance/intensity 7.68 stay fixed. The front longitudinal
edge stays at z=4.8; the opposite edge extends from -0.8 to -2.6.
Emitting area and area-radiance product increase by 32.14%; this is deliberately
not an equal-energy study. Light count, texture dimensions and draw budget stay.
Car materials, exposure, room surfaces and the other three lights are unchanged.

Reproduce with export-cold-studio-source.mjs --wrap-wide, background factory-startup
Blender running scripts/blender/cold_studio_cycles.py with source
artifacts/car-showroom/cycles-r18/scene.json, then register-cold-studio-cycles.mjs
--wrap-wide. Cycles OptiX, 256 samples, 12 bounces, OIDN; six 1024-square faces per
signal. Gzip RGBA16F, bottom-up equirect rows, flipY=false, linear sRGB.
Manifest records configuration, source/runtime digests, sizes and conversion error.

This is view-dependent room radiance, not painted-on highlights or a car lightmap.
Single-probe spatial and Blender/Three BRDF approximations remain. The indirect
source hides emitter camera rays while retaining secondary illumination.
This candidate does not establish overall visual or performance acceptance.
The original r17 remains intact. Validation: .ai/reventon-wrap-wide-validation.md.
