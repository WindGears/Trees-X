# Cold studio r11 / refined lighting candidate

Trees X authored room geometry and existing generated stone textures, exported from
the same runtime configuration. No car geometry or external HDR is included.
Original texture provenance remains in `../concept-v2/`.

Reproduce with `node scripts/export-cold-studio-source.mjs --refined`, then run
`scripts/blender/cold_studio_cycles.py` in background Blender with factory startup,
`--python-exit-code 1`, and source `artifacts/car-showroom/cycles-r11/scene.json`.
Register using `node scripts/register-cold-studio-cycles.mjs --refined`.

Blender 5.2.2 LTS / OptiX, 256 fixed samples, OIDN, 12 total bounces, no radiance
clamp. Each signal starts as six 1024-square linear EXRs. Runtime is losslessly
gzipped RGBA16F: full room radiance 4096×2048, indirect input 1024×512. Exact
checksums, byte counts, half-float errors and four emitter landmarks are in
`manifest.json`. Bottom-up equirect rows use `flipY=false`.

This candidate narrows ceiling emitters and the side fill, increases wall
reflectance, and uses restrained floor micro-normal strength. Artistic material
values are not measured physical samples. Blender/Three BRDFs differ. Indirect
capture removes panels from camera rays while retaining secondary illumination;
it is not an exact direct-light subtraction. This remains a central room probe,
not a floor lightmap or baked car animation.

Use `carStudioFinish=refined` with the audited cold-studio Cycles entry. The optional
`carStudioPaint=graphite` changes only verified body paint. Default remains r10;
visual acceptance is pending. Earlier unpublished r11 trials are archived locally
under `artifacts/car-showroom/r11-*-baseline`, not overwritten source assets.
