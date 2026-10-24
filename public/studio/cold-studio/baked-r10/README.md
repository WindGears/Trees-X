# Cold studio r10 persisted probes

Original Trees X procedural room and generated stone texture, captured with Three.js (MIT).
No car, borrowed EXR, screenshot, UI, contact-shadow overlay or Bloom is baked into these assets.
Redistribution follows this repository's project terms; Three.js attribution remains in the dependency notices.

`specular.rgba32f.bin`: 4096 × 2048, linear-sRGB, RGBA Float32, little-endian, gzip lossless.
`indirect.rgba32f.bin`: 1024 × 512, same format; visible emitters are black in this capture.
Orientation is identical to the runtime `DataTexture` capture (`flipY=false`).
Checksums and capture configuration are in `manifest.json`.
The `.bin` suffix is deliberate: preview servers may interpret `.gz` as an HTTP
precompressed resource, transparently decompressing it before the application can verify it.

These are persisted **raster room probes**, not path-traced illumination or surface lightmaps.
They preserve the existing captured values exactly. They do not contain dynamic car reflections,
nor do they improve the underlying central-probe spatial approximation.
PMREM filtering remains a one-time runtime preparation step; this is not a prefiltered GPU cache.

Reproduce explicitly using `node scripts/bake-cold-studio-probes.mjs` against the matching,
built production capture route (no `carFloor=baked`). All GPU work is headless and serial.
Changing geometry, lighting or materials requires a new versioned bake; do not overwrite released assets.
The runtime rejects changed serialized configuration, missing files and checksum mismatches.
