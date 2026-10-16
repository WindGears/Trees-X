# Amber lounge depth-proxy experiment v1

This directory is a numerical runtime candidate for an explicitly experimental typewriter background. It does not replace the original panorama or represent a complete reconstructed room.

`radial-distance.f32` is the actual DA² model prediction resampled to 512×256, little-endian Float32, top-left row-major, pixel-centre UVs. Distances are radial from the panorama optical centre; they are scale-invariant relative values, **not metres, view-Z, or inverse depth**. Exact hashes and inference provenance are in `manifest.json`.

The original RGB source is the unchanged 1774×887 generated LDR panorama at `/studio/amber-lounge/v1/lounge-panorama.png`. RGB and depth share image UVs. For Y-up Three coordinates, use `theta=2*pi*(u-.5)`, `latitude=pi*(.5-v)`, direction `(cos(latitude)*cos(theta), sin(latitude), cos(latitude)*sin(theta))`, then multiply by the distance and an explicit scene calibration scale. Browser code separately owns placement, sample orientation, geometry rejection and texture sampling.

Source: [DA²: Depth Anything in Any Direction](https://github.com/EnVision-Research/DA-2), code commit `d659838585f2bc9967c7e9367af573795271dbbb`, Apache-2.0. Model: [haodongli/DA-2](https://huggingface.co/haodongli/DA-2), revision `0d55ccb5e46b8ed4715fae3a4c04fc897f1689f3`, Apache-2.0 model card; model weights are kept outside public assets. The Apache license from the pinned repository is retained adjacent to this record.

The network is unmodified. The official optional PyTorch SDPA fallback is used instead of xFormers. The source is resized only in memory to the official 1092×546 sphere grid for inference; no source image file is rewritten. Float distances are bilinearly resampled to the runtime grid. See `scripts/lounge-spatial/README.md` for reproduction.

Predicted hidden surfaces, complete occlusion recovery, correct metric geometry and photo-equivalent full-room lighting are **not** provided. Runtime fallback layers must not be described as observed geometry. Numerical validation cannot establish acceptable full-orbit appearance; real camera movement and product layout tests remain required.
