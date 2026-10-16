import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from depth_io import direction, read_float32, sha256, write_float32


class DepthIOTests(unittest.TestCase):
    def test_radial_directions_are_unit_length_and_orientation_is_explicit(self):
        for u in (0, 0.1, 0.5, 0.9, 1):
            for v in (0, 0.1, 0.5, 0.9, 1):
                self.assertAlmostEqual(sum(x * x for x in direction(u, v)), 1)
        self.assertAlmostEqual(direction(0.5, 0.5)[0], 1)
        self.assertAlmostEqual(direction(0.75, 0.5)[2], 1)
        self.assertAlmostEqual(direction(0.5, 0)[1], 1)
        self.assertAlmostEqual(direction(0.5, 1)[1], -1)
        for first, last in zip(direction(0, 0.4), direction(1, 0.4)):
            self.assertAlmostEqual(first, last)

    def test_little_endian_round_trip_and_stable_hash(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "radial.bin"
            write_float32(path, [0.5, 0.25, 1.0, 2.0], 2, 2)
            self.assertEqual(path.read_bytes()[:4], b"\x00\x00\x00\x3f")
            self.assertEqual(read_float32(path, 2, 2), (0.5, 0.25, 1.0, 2.0))
            before = sha256(path)
            write_float32(path, [0.5, 0.25, 1.0, 2.0], 2, 2)
            self.assertEqual(sha256(path), before)
            with self.assertRaises(ValueError):
                read_float32(path, 3, 2)

    def test_invalid_values_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            for invalid in (0, -1, math.inf, math.nan):
                with self.assertRaises(ValueError):
                    write_float32(Path(folder) / "bad.bin", [1, 1, 1, invalid], 2, 2)
            with self.assertRaises(ValueError):
                write_float32(Path(folder) / "bad.bin", [1, 1], 2, 2)


if __name__ == "__main__":
    unittest.main()
