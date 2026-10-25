# Cold studio r10 / Cycles radiance candidate

Original Trees X procedural geometry (28 meshes) and generated floor textures.
No external HDR or automotive geometry is included. Source code and original
texture provenance remain in this repository; no new third-party model is redistributed.

Production:

1. `node scripts/export-cold-studio-source.mjs` exports current world-space triangles,
   vertex normals, UVs and material parameters to `artifacts/car-showroom/cycles-r10/scene.json`.
2. Run `scripts/blender/cold_studio_cycles.py` in an independent background Blender
   with `--factory-startup --python-exit-code 1`, source path above, `--size 1024 --samples 256`.
3. `node scripts/register-cold-studio-cycles.mjs` checks source dimensions/checksums
   and all four emitter directions, then creates the runtime data and TypeScript records.

Cycles 5.2.2 LTS, OptiX, 256 fixed samples, OIDN, 12 total bounces (8 diffuse/8 glossy),
no radiance clamp. Six 1024-square linear EXR faces per signal. Full specular panorama
is 4096×2048; indirect signal is 1024×512. This signal hides emitters from camera rays
while retaining their contribution to lighting and secondary rays. It is not a direct-light
pass subtraction, and the native Three/Blender BRDFs are not identical.

Runtime files are little-endian RGBA16F gzip, opaque `.bin` suffix to prevent HTTP automatic
decompression. `flipY=false`, bottom-up equirect rows match the previous WebGPU capture.
Half conversion errors, checksums, radiance landmark verification and configuration are
recorded in `manifest.json`. The 32F EXRs and .blend production master remain in the local
artifact directory and can be reproduced from the scripts.

This is offline path-traced room radiance, **not a floor surface lightmap**, not a car reflection,
and not a live path tracer. Central probe and box projection approximations remain.
Use `carFloor=cycles` within the existing audited cold studio candidate; defaults are unchanged.

Optional `carFloorLight=local` independently restores native area-light specular on the floor
and selects the indirect panorama for its environment input. Floor SSR stays disabled.
This routing comparison is separate from the baked-versus-Cycles capture comparison.
