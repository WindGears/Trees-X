"""Pure numerical DA² distance packaging. No RGB image is rewritten here."""

import hashlib
import math
import struct
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def direction(u: float, v: float) -> tuple[float, float, float]:
    """Image UV: top-left origin, u right, v down; Three.js Y-up."""
    theta = (u - 0.5) * 2 * math.pi
    latitude = (0.5 - v) * math.pi
    return (
        math.cos(latitude) * math.cos(theta),
        math.sin(latitude),
        math.cos(latitude) * math.sin(theta),
    )


def write_float32(path: Path, values: list[float], width: int, height: int) -> None:
    if width <= 1 or height <= 1 or len(values) != width * height:
        raise ValueError("Distance dimensions do not match row-major data")
    if not all(math.isfinite(value) and value > 0 for value in values):
        raise ValueError("DA² distances must be positive and finite")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(struct.pack(f"<{len(values)}f", *values))


def read_float32(path: Path, width: int, height: int) -> tuple[float, ...]:
    data = path.read_bytes()
    if len(data) != width * height * 4:
        raise ValueError("Distance byte length mismatch")
    values = struct.unpack(f"<{width * height}f", data)
    if not all(math.isfinite(value) and value > 0 for value in values):
        raise ValueError("Invalid distance value")
    return values
