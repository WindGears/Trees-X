"""Run unmodified pinned DA² inference; export actual scale-invariant radial data.

The upstream Gradio/Accelerate shell is deliberately bypassed, not the network.
This avoids installing unrelated GUI, training and point-cloud dependencies.
"""

import argparse
import importlib
import importlib.metadata
import json
import os
import platform
import subprocess
import sys
import time
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from depth_io import sha256, write_float32

ROOT = Path(__file__).resolve().parents[2]
CODE = ROOT / ".tools/lounge-depth/DA-2"
WEIGHTS = ROOT / ".tools/lounge-depth/weights/model.safetensors"
SOURCE = ROOT / "public/studio/amber-lounge/v1/lounge-panorama.png"
ARTIFACTS = ROOT / "artifacts/lounge-spatial-assets"
RUNTIME = ROOT / "public/studio/amber-lounge/spatial-v1"
CODE_COMMIT = "d659838585f2bc9967c7e9367af573795271dbbb"
MODEL_COMMIT = "0d55ccb5e46b8ed4715fae3a4c04fc897f1689f3"
MODEL_SHA = "d8ea568fc3dfb7d7432e5b763de499dd03fb6dc1c2020d84639f35e2dfa4f78e"
SOURCE_SHA = "fdab4d13b88d04526f6acb4da84334a2dd11d2e6441e0f66e1378713370b5402"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--inference-width", type=int, default=1092)
    parser.add_argument("--width", type=int, default=512)
    args = parser.parse_args()
    if args.inference_width % 28 or args.width < 4 or args.width % 2:
        raise ValueError("Full panorama inference width must divide 28; output width must be even")
    actual_commit = subprocess.check_output(["git", "-C", str(CODE), "rev-parse", "HEAD"], text=True).strip()
    if actual_commit != CODE_COMMIT or sha256(WEIGHTS) != MODEL_SHA or sha256(SOURCE) != SOURCE_SHA:
        raise RuntimeError("Pinned source, upstream code or checkpoint digest mismatch")
    if subprocess.check_output(["git", "-C", str(CODE), "status", "--porcelain"], text=True).strip():
        raise RuntimeError("DA² clone is modified; inference must use the unmodified pinned source")

    # Prevent an unrelated application's optional binary xFormers wheel being used.
    # Upstream's ImportError path already uses torch scaled_dot_product_attention.
    sys.modules["xformers"] = None
    package = types.ModuleType("da2")
    package.__path__ = [str(CODE / "src/da2")]
    sys.modules["da2"] = package
    import numpy as np
    import torch
    import torch.nn.functional as functional
    from PIL import Image
    from safetensors.torch import load_file

    SphereViT = importlib.import_module("da2.model.spherevit").SphereViT
    config = json.loads((CODE / "configs/infer.json").read_text(encoding="utf8"))
    height = args.inference_width // 2
    pixels = args.inference_width * height
    # The official sphere dimensions must match the full equirectangular input.
    # At the default 1092x546, all inference settings equal configs/infer.json.
    config["spherevit"]["sphere"]["width"] = args.inference_width
    config["spherevit"]["sphere"]["height"] = height
    config["inference"]["min_pixels"] = pixels
    config["inference"]["max_pixels"] = pixels
    torch.manual_seed(42)
    device = torch.device(args.device)
    if device.type == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("No CUDA device available; no implicit CPU substitution")
        torch.cuda.reset_peak_memory_stats()
    model = SphereViT(config)
    state = load_file(str(WEIGHTS), device="cpu")
    model.load_state_dict(state, strict=True)
    del state
    model = model.to(device).eval()
    with Image.open(SOURCE) as image:
        original_size = list(image.size)
        image = image.convert("RGB").resize((args.inference_width, height), Image.Resampling.BILINEAR)
        array = np.asarray(image).astype(np.float32) / 255.0
    tensor = torch.from_numpy(array.transpose(2, 0, 1).copy()).unsqueeze(0).to(device)
    start = time.monotonic()
    print(f"Inference starts {args.inference_width}x{height}, {device}, source {SOURCE_SHA}", flush=True)
    with torch.inference_mode(), torch.autocast(device_type=device.type, enabled=device.type == "cuda", dtype=torch.float16):
        prediction = model(tensor)
    if device.type == "cuda":
        torch.cuda.synchronize()
    elapsed = time.monotonic() - start
    raw = prediction.float().cpu().numpy()[0]
    if not np.isfinite(raw).all() or not (raw > 0).all():
        raise RuntimeError("DA² produced non-finite or non-positive radial distance")
    small = functional.interpolate(torch.from_numpy(raw)[None, None], size=(args.width // 2, args.width), mode="bilinear", align_corners=False)[0, 0].numpy()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    np.save(ARTIFACTS / "radial-native.npy", raw)
    np.save(ARTIFACTS / "radial-runtime.npy", small)
    # A numerical visualisation only; RGB panorama pixels remain untouched.
    visual = ((np.log(raw) - np.log(raw.min())) / (np.log(raw.max()) - np.log(raw.min())) * 65535).astype(np.uint16)
    Image.fromarray(visual).save(ARTIFACTS / "radial-log-visualisation.png")
    distance_path = RUNTIME / "radial-distance.f32"
    write_float32(distance_path, small.ravel().tolist(), args.width, args.width // 2)
    def stats(values):
        return {"min": float(values.min()), "max": float(values.max()), "mean": float(values.mean()), "quantiles": {str(q): float(np.quantile(values, q)) for q in (0.01, 0.05, 0.5, 0.95, 0.98, 0.99)}}
    packages = {name: importlib.metadata.version(name) for name in ("torch", "torchvision", "safetensors", "huggingface-hub", "einops", "numpy", "pillow")}
    manifest = {
        "schemaVersion": 1,
        "id": "amber-lounge-spatial-v1",
        "entry": distance_path.name,
        "files": [{"path": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)} for path in (distance_path, RUNTIME / "DA2-LICENSE.txt")],
        "status": "experimental-single-view-proxy",
        "source": {"url": "/studio/amber-lounge/v1/lounge-panorama.png", "sha256": SOURCE_SHA, "bytes": SOURCE.stat().st_size, "width": original_size[0], "height": original_size[1], "altered": False},
        "distance": {"url": "/studio/amber-lounge/spatial-v1/radial-distance.f32", "file": distance_path.name, "sha256": sha256(distance_path), "bytes": distance_path.stat().st_size, "width": args.width, "height": args.width // 2, "type": "float32", "endianness": "little", "layout": "row-major", "semantic": "scale-invariant-radial-distance", "units": "relative-not-metres", "origin": "top-left", "u": "right", "v": "down", "samplePosition": "pixel-centre", "directionThreeYUp": "theta=2*pi*(u-0.5); latitude=pi*(0.5-v); xyz=(cos(latitude)*cos(theta),sin(latitude),cos(latitude)*sin(theta))", "statistics": stats(small)},
        "estimator": {"name": "DA²: Depth Anything in Any Direction", "repository": "https://github.com/EnVision-Research/DA-2", "codeCommit": CODE_COMMIT, "codeLicense": "Apache-2.0", "model": "https://huggingface.co/haodongli/DA-2", "modelCommit": MODEL_COMMIT, "modelSha256": MODEL_SHA, "modelBytes": WEIGHTS.stat().st_size, "modelLicense": "Apache-2.0", "networkModified": False, "sourceCodeSHA256": {str(path.relative_to(CODE)).replace(os.sep, "/"): sha256(path) for path in (CODE / "src/da2/model/spherevit.py", CODE / "src/da2/model/vit_w_esphere.py", CODE / "src/da2/utils/d2pc.py")}},
        "inference": {"inputWidth": args.inference_width, "inputHeight": height, "inputResample": "bilinear-RGB-analysis-only", "runtimeResample": "bilinear-radial-float32-align_corners-false", "config": config, "seed": 42, "mixedPrecision": "fp16" if device.type == "cuda" else "float32", "attention": "upstream-torch-SDPA-fallback-xformers-disabled", "device": str(device), "deviceName": torch.cuda.get_device_name() if device.type == "cuda" else platform.processor(), "seconds": elapsed, "peakTorchAllocatedBytes": torch.cuda.max_memory_allocated() if device.type == "cuda" else None, "peakTorchReservedBytes": torch.cuda.max_memory_reserved() if device.type == "cuda" else None, "python": platform.python_version(), "packages": packages, "nativeStatistics": stats(raw)},
        "limitations": ["Single-image geometry is inferred, with no ground-truth metric error available.", "Distances are radial from the panorama optical origin, not camera-view Z and not inverse depth.", "The model divides its distance by the 98th percentile; the browser must apply an explicit scene calibration scale.", "Occluded surfaces have no observation; this asset does not contain hallucinated colour layers or completed room geometry.", "Depth discontinuities, source-image seams and the poles require runtime mesh rejection/fallback and visual inspection.", "Native RGB source is generated LDR, not a measured HDR environment or calibrated physical room."]
    }
    (RUNTIME / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    (ARTIFACTS / "inference-report.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"passed": True, "seconds": elapsed, "distanceSHA256": manifest["distance"]["sha256"], "statistics": manifest["distance"]["statistics"], "peakTorchAllocatedBytes": manifest["inference"]["peakTorchAllocatedBytes"]}), flush=True)


if __name__ == "__main__":
    main()
