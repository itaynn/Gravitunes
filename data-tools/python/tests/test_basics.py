"""Offline tests (no network). Run: python -m unittest discover data-tools/python/tests"""
import json
import os
import tempfile
import unittest
from pathlib import Path

import numpy as np

from gravitunes_data import svs
from gravitunes_data.colors import BlendDecoder, line_mask
from gravitunes_data.paths import DESCRIPTOR_DIR

LISTING = """<html><body><h1>Index of /vis/a000000/a005100/a005152/frames/x/</h1>
<a href="?C=N;O=D">Name</a> <a href="?C=M;O=A">Last modified</a>
<a href="/vis/a000000/a005100/a005152/frames/">Parent Directory</a>
<a href="00000001.png">00000001.png</a> 2023-09-26 12:00  6.0M
<a href="00000002.png">00000002.png</a> 2023-09-26 12:00  6.0M
<a href="flatalpha/">flatalpha/</a>
</body></html>"""


def ramp(n=200):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) * np.array([254, 254, 255.0]) + t * np.array([65, 32, 192.0])


OPACITY = {"values": [5, 20, 32.5], "alpha": [0, 0.45, 1.0]}


class TestSVS(unittest.TestCase):
    def test_vis_url(self):
        self.assertEqual(svs.vis_dir_url(5152), "https://svs.gsfc.nasa.gov/vis/a000000/a005100/a005152/")
        self.assertEqual(svs.vis_dir_url(4285), "https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/")
        self.assertEqual(svs.vis_dir_url(14321), "https://svs.gsfc.nasa.gov/vis/a010000/a014300/a014321/")

    def test_parse_listing(self):
        self.assertEqual(svs.parse_listing(LISTING), ["00000001.png", "00000002.png", "flatalpha/"])


class TestDecoder(unittest.TestCase):
    def setUp(self):
        self.dec = BlendDecoder(ramp(), 5, 60, OPACITY)

    def test_roundtrip_over_black(self):
        v = np.linspace(22, 60, 400, dtype=np.float32).reshape(20, 20)   # readable range over ocean
        out = self.dec.decode(self.dec.render(v))
        self.assertLess(np.nanmean(np.abs(out - v)), 0.6)

    def test_roundtrip_with_background(self):
        rng = np.random.default_rng(0)
        bg = rng.choice([0, 96, 160, 248], size=(30, 30)).astype(np.uint8)
        v = rng.uniform(25, 60, size=(30, 30)).astype(np.float32)
        out = self.dec.decode(self.dec.render(v, bg), bg)
        self.assertLess(np.nanmean(np.abs(out - v)), 1.0)

    def test_fit_background(self):
        rng = np.random.default_rng(1)
        bg = np.repeat(np.array([[0, 120, 248]], np.uint8), 4, 0)
        frames = np.stack([self.dec.render(rng.uniform(5, 60, bg.shape), bg) for _ in range(30)])
        est = self.dec.fit_background(frames).astype(int)
        self.assertTrue(np.all(np.abs(est - bg) <= 8), est)

    def test_log_scale_roundtrip(self):
        n = 200
        vals = np.logspace(-3, 1.3, n)
        dec = BlendDecoder(ramp(n), vals[0], vals[-1], {"values": [0.001, 0.002], "alpha": [0, 1]}, values=vals, log=True)
        v = np.logspace(-2, 1.2, 100, dtype=np.float32).reshape(10, 10)
        out = dec.decode(dec.render(v))
        self.assertLess(np.nanmean(np.abs(np.log10(out) - np.log10(v))), 0.05)

    def test_ramp_values_from_ticks(self):
        from gravitunes_data.dataset import ramp_values
        d = {"colorbar": {"x0": 10, "ticks": [[10, 0.01], [20, 0.1], [30, 1]], "scale": "log"}}
        v, log = ramp_values(d, 21)
        self.assertTrue(log)
        self.assertAlmostEqual(v[0], 0.01); self.assertAlmostEqual(v[10], 0.1); self.assertAlmostEqual(v[20], 1.0)
        self.assertEqual(ramp_values({"colorbar": {}}, 5), (None, False))

    def test_bad_colour_is_nan(self):
        green = np.zeros((1, 1, 3), np.uint8); green[..., 1] = 255
        self.assertTrue(np.isnan(self.dec.decode(green)[0, 0]))


class TestMask(unittest.TestCase):
    def test_lines_and_boxes(self):
        rng = np.random.default_rng(2)
        frames = rng.integers(120, 255, size=(6, 40, 80, 3)).astype(np.uint8)
        frames[:, 20, :, :] = 0                       # a constant black 1-px "coastline"
        m = line_mask(frames, boxes=[(0, 0, 0.25, 0.25)])
        self.assertTrue(m[20, 40:60].all())
        self.assertTrue(m[:10, :20].all())
        self.assertFalse(m[30:, 40:].any())


class TestDescriptors(unittest.TestCase):
    def test_descriptors_valid(self):
        # index.json lists the descriptors; it is not one itself.
        files = [p for p in DESCRIPTOR_DIR.glob("*.json") if p.name != "index.json"]
        self.assertTrue(files)
        ids = json.loads((DESCRIPTOR_DIR / "index.json").read_text())["ids"]
        self.assertEqual(sorted(ids), sorted(p.stem for p in files))
        for p in files:
            d = json.loads(p.read_text())
            for k in ("id", "title", "units", "range", "start", "step_hours", "colorbar", "frames", "masks"):
                self.assertIn(k, d, f"{p.name} missing {k}")
            self.assertEqual(d["id"], p.stem)
            stops = d["colorbar"]["stops"]
            self.assertEqual(stops[0][0], d["range"][0]); self.assertEqual(stops[-1][0], d["range"][1])
            self.assertTrue(all(a[0] < b[0] for a, b in zip(stops, stops[1:])))


class TestExport(unittest.TestCase):
    def test_load_and_export_roundtrip(self):
        from gravitunes_data import dataset
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["GRAVITUNES_DATA_DIR"] = tmp
            try:
                d = Path(tmp) / "nasa-svs" / "5152"; d.mkdir(parents=True)
                g = np.array([[[0, 254], [255, 127]]] * 3, np.uint8)
                times = np.array([f"2026-10-29T{9 + h:02d}:00:00Z" for h in range(3)])
                meta = {k: "x" for k in ("id", "title", "units", "source", "disclaimer")} | {"range": [5, 60], "credits": []}
                np.savez_compressed(d / "5152_2x2.npz", data=g, scale=55 / 254, offset=5.0, times=times,
                                    filled=np.ones(3, bool), meta=json.dumps(meta))
                ds = dataset.load("5152", size=(2, 2))
                self.assertAlmostEqual(ds.values[0, 0, 0], 5.0, places=4)
                self.assertAlmostEqual(ds.values[0, 0, 1], 60.0, places=4)
                self.assertTrue(np.isnan(ds.values[0, 1, 0]))
                self.assertEqual(ds.pixel_at(60, -170), (0, 0))
                b, j = dataset.export_web("5152", (2, 2))
                h = json.loads(j.read_text())
                self.assertEqual(h["dims"], [2, 2]); self.assertEqual(b.stat().st_size, 12)
                self.assertEqual(np.frombuffer(b.read_bytes(), np.uint8).reshape(3, 2, 2)[0, 1, 1], 127)
            finally:
                del os.environ["GRAVITUNES_DATA_DIR"]


class TestWebPacking(unittest.TestCase):
    def test_delta_gzip_round_trip(self):
        import gzip
        from gravitunes_data.web import pack, quantize, undelta
        g = np.random.default_rng(1).integers(0, 256, (7, 3, 5), dtype=np.uint8)
        parts = pack(g, chunk=3)
        self.assertEqual([(s, n) for s, n, _ in parts], [(0, 3), (3, 3), (6, 1)])
        back = np.concatenate([undelta(np.frombuffer(gzip.decompress(b), np.uint8).reshape(n, 3, 5)) for _, n, b in parts])
        np.testing.assert_array_equal(back, g)
        q = quantize(g, 6)
        self.assertTrue(np.all((q == 255) | (q % 4 == 0)))
        self.assertTrue(np.all(q[g == 255] == 255))


if __name__ == "__main__":
    unittest.main()
