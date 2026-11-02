# Cold studio r16 / angled fill reflection study

Trees X authored room geometry and existing generated floor textures; provenance
is retained in ../concept-v2/. No car or third-party HDR is included.

This explicit carStudioFinish=bounce candidate changes only the existing fill
from r14: 3.36 by 1, position [5.65, 3.05, -0.2], target [1, 0, -0.2], radiance
and intensity 12.8. Its emitter area stays 3.36, but its energy is four times r14.
This is a lighting-content comparison, not an algorithm or equal-energy test.
The other three lights, room materials, car materials and exposure are unchanged.

Reproduce with export-cold-studio-source.mjs --bounce, background factory-startup
Blender running scripts/blender/cold_studio_cycles.py with source
artifacts/car-showroom/cycles-r16/scene.json, then register-cold-studio-cycles.mjs
--bounce. Cycles OptiX, 256 samples, 12 bounces, OIDN, six 1024-square faces per
signal. Gzipped RGBA16F uses bottom-up equirect rows, flipY=false, linear sRGB.
Manifest records source digest, runtime digests, sizes and quantization error.

These probes contain room radiance, not fixed highlights painted on the car.
Reflection lookup remains view dependent. Blender/Three BRDF differences and
single-probe spatial approximation remain. Camera rays of the indirect source
hide emitters while secondary rays retain their light; this is not exact direct
light subtraction. Resolution and decoded bytes match r14; compressed sizes differ.

Side-view silver highlights are more continuous, but the default oblique view
remains dark. This is an optional comparison, not overall visual acceptance.
