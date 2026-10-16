"""Offline strict validation of the shipped DA² radial-distance candidate."""

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from depth_io import read_float32, sha256

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "public/studio/amber-lounge/spatial-v1"


def main():
    manifest = json.loads((RUNTIME / "manifest.json").read_text(encoding="utf8"))
    distance = manifest["distance"]
    path = RUNTIME / distance["file"]
    if distance["semantic"] != "scale-invariant-radial-distance" or distance["units"] != "relative-not-metres":
        raise ValueError("Distance semantics were changed")
    if distance["endianness"] != "little" or distance["type"] != "float32":
        raise ValueError("Distance byte format was changed")
    if path.stat().st_size != distance["bytes"] or sha256(path) != distance["sha256"]:
        raise ValueError("Distance digest or byte length mismatch")
    values = read_float32(path, distance["width"], distance["height"])
    source = ROOT / "public" / manifest["source"]["url"].lstrip("/")
    if sha256(source) != manifest["source"]["sha256"]:
        raise ValueError("Original RGB source digest changed")
    if not math.isclose(min(values), distance["statistics"]["min"], rel_tol=1e-7):
        raise ValueError("Stored minimum differs from actual float payload")
    if not math.isclose(max(values), distance["statistics"]["max"], rel_tol=1e-7):
        raise ValueError("Stored maximum differs from actual float payload")
    print(json.dumps({"passed": True, "count": len(values), "min": min(values), "max": max(values), "sha256": distance["sha256"], "sourceUnchanged": True}))


if __name__ == "__main__":
    main()
