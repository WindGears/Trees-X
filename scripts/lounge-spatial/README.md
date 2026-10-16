# DA² panoramic distance candidate

This tooling runs the unmodified official network, not a hand-painted or luminance-derived depth field. It only writes independent numerical data and diagnostic visualisations. The source PNG is not edited or replaced.

## Pinned inputs

- Code: [EnVision-Research/DA-2](https://github.com/EnVision-Research/DA-2), commit `d659838585f2bc9967c7e9367af573795271dbbb`, Apache-2.0.
- Checkpoint: [haodongli/DA-2](https://huggingface.co/haodongli/DA-2), revision `0d55ccb5e46b8ed4715fae3a4c04fc897f1689f3`, Apache-2.0 model card. `model.safetensors`, 1,378,513,064 bytes, SHA-256 `d8ea568fc3dfb7d7432e5b763de499dd03fb6dc1c2020d84639f35e2dfa4f78e`.
- RGB: `public/studio/amber-lounge/v1/lounge-panorama.png`, 1774×887. SHA-256 `fdab4d13b88d04526f6acb4da84334a2dd11d2e6441e0f66e1378713370b5402`.

The code clone, checkpoint and download cache stay in ignored `.tools/lounge-depth/`; neither model weights nor a Python environment are distributed with the browser app.

## Current local environment

The standalone Python embedded in the existing Comfy installation is borrowed **read-only**: Python 3.13.11, torch 2.10.0+cu130, torchvision 0.25.0+cu130. It already supports the RTX 5060 Laptop GPU (`sm_120`); no package is installed into, upgraded in or removed from that application. All core model dependencies already exist. Optional xFormers is disabled so the unmodified model uses its official PyTorch SDPA fallback. Training, Gradio, Accelerate and point-cloud helpers are not imported.

On this Windows machine, set a PowerShell variable without repurposing system options:

```powershell
$treesDepthPython='I:/AICreate/ComfyUI_windows_portable_nvidia/ComfyUI_windows_portable/python_embeded/python.exe'
git clone https://github.com/EnVision-Research/DA-2.git .tools/lounge-depth/DA-2
git -C .tools/lounge-depth/DA-2 checkout d659838585f2bc9967c7e9367af573795271dbbb
& $treesDepthPython scripts/lounge-spatial/download_da2.py
& $treesDepthPython scripts/lounge-spatial/test_depth_io.py
& $treesDepthPython scripts/lounge-spatial/infer_da2.py
& $treesDepthPython scripts/lounge-spatial/validate_depth.py
```

The download command only runs during asset preparation. The browser never imports or runs DA², Python, CUDA or inference code. When using a proxy, configure its environment in the calling shell; no proxy or credential is embedded in these tools.

GPU inference must run serially with browser GPU testing. The exporter verifies the pinned checkpoint, source and clean upstream checkout before inference. It resizes the source in memory to the official 1092×546 sphere grid (divisible by DINO's 14-pixel patch size); the source file remains unchanged. The official pixel-range clamp resolves to the same pixel count at this size. The model output is bilinearly resampled as float data to 512×256.

## Output contract

`public/studio/amber-lounge/spatial-v1/radial-distance.f32` contains raw little-endian Float32 values with no header, 512 columns × 256 rows, row-major, top-left origin, pixel-centre UVs. All values must be positive and finite. The adjacent manifest records dimensions, semantics, hashes, exact source/model versions, settings and actual measurements.

This is **radial distance**, not view-Z, inverse depth or metres. The official network divides distance by its 98th percentile. Scene scale must be calibrated explicitly in the renderer. For a Y-up Three scene, image UVs use `theta=2*pi*(u-.5)`, `latitude=pi*(.5-v)` and direction `(cos(latitude)*cos(theta), sin(latitude), cos(latitude)*sin(theta))`. At `u=.5,v=.5` the direction is +X; at `u=.75,v=.5` it is +Z; image top is +Y.

The `.npy` native prediction, numerical depth visualisation and full report remain in ignored `artifacts/lounge-spatial-assets/`. No image-based model can establish a certified metric reconstruction or observe hidden surfaces from this input. Edge tears, unknown occlusion, pole and seam artifacts must be judged in the real renderer; passing these numerical checks is not a visual acceptance result.
