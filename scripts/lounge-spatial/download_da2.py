"""Download the pinned public checkpoint to the ignored local tools directory."""

import os
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from depth_io import sha256

REVISION = "0d55ccb5e46b8ed4715fae3a4c04fc897f1689f3"
EXPECTED = "d8ea568fc3dfb7d7432e5b763de499dd03fb6dc1c2020d84639f35e2dfa4f78e"
BYTES = 1378513064
ROOT = Path(__file__).resolve().parents[2]
DESTINATION = ROOT / ".tools/lounge-depth/weights/model.safetensors"


def main():
    if DESTINATION.exists() and DESTINATION.stat().st_size == BYTES:
        if sha256(DESTINATION) == EXPECTED:
            print("Pinned checkpoint already verified", flush=True)
            return
        raise RuntimeError("Existing checkpoint checksum mismatch")
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    partial = DESTINATION.with_suffix(".safetensors.part")
    url = f"https://huggingface.co/haodongli/DA-2/resolve/{REVISION}/model.safetensors?download=true"
    start = time.monotonic()
    with requests.get(url, stream=True, timeout=(30, 120)) as response:
        response.raise_for_status()
        written, next_report = 0, 100 * 1024 * 1024
        with partial.open("wb") as stream:
            for block in response.iter_content(1024 * 1024):
                stream.write(block)
                written += len(block)
                if written >= next_report:
                    print(f"Downloaded {written}/{BYTES} bytes in {time.monotonic() - start:.1f}s", flush=True)
                    next_report += 100 * 1024 * 1024
    if partial.stat().st_size != BYTES or sha256(partial) != EXPECTED:
        raise RuntimeError("Downloaded checkpoint does not match the pinned HF LFS digest")
    os.replace(partial, DESTINATION)
    print(f"Verified checkpoint {EXPECTED} in {time.monotonic() - start:.1f}s", flush=True)


if __name__ == "__main__":
    main()
