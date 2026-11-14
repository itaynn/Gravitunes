"""Synthetic checks for gravitunes_analysis.flow and .tracking. Run: .venv/bin/python -m pytest analysis/tests"""

import math
import unittest

import cv2
import numpy as np

from gravitunes_analysis.flow import (FlowParams, Grid, VortexParams, compute_flow, detect_vortices, kinematics,
                                      spin_turns_per_hour)
from gravitunes_analysis.tracking import VortexTracker

# 0.1 degree pixels around the equator (~11 km), not global, so no wrap.
GRID = Grid(400, 200, lon_west=-20, lon_east=20, lat_north=10, lat_south=-10)
PARAMS = FlowParams(valid_threshold=0.0, valid_dilate=0, flow_sigma=3.0)


def texture(seed=0):
    rng = np.random.default_rng(seed)
    f = cv2.GaussianBlur(rng.random((GRID.height, GRID.width)).astype(np.float32), (0, 0), 3)
    f = (f - f.min()) / (f.max() - f.min())
    return 0.2 + 0.8 * f


def warp_seq(base, matrix_for_step, n=3):
    frames = []
    for k in range(n):
        m = matrix_for_step(k)
        frames.append(cv2.warpAffine(base, m, (GRID.width, GRID.height), flags=cv2.INTER_CUBIC,
                                     borderMode=cv2.BORDER_REFLECT))
    return np.stack(frames)


def centre(a, r=40):
    h, w = a.shape[-2:]
    return a[..., h // 2 - r:h // 2 + r, w // 2 - r:w // 2 + r]


class FlowTests(unittest.TestCase):
    def test_rotation_ccw(self):
        deg_per_hour = 3.0   # counterclockwise on a north-up map
        c = (GRID.width / 2, GRID.height / 2)
        frames = warp_seq(texture(), lambda k: cv2.getRotationMatrix2D(c, deg_per_hour * k, 1.0))
        fs = compute_flow(frames, 1.0, GRID, PARAMS)
        kin = kinematics(fs.u[1], fs.v[1], GRID)
        omega = np.nanmedian(centre(kin["vorticity"]))
        expected = 2 * math.radians(deg_per_hour)
        self.assertGreater(omega, 0)
        self.assertAlmostEqual(omega, expected, delta=0.2 * expected)
        self.assertAlmostEqual(spin_turns_per_hour(omega), deg_per_hour / 360, delta=0.2 * deg_per_hour / 360)
        self.assertLess(abs(np.nanmedian(centre(kin["divergence"]))), 0.2 * expected)

    def test_detect_rotating_disk(self):
        """A spinning disk in a still background is found as one ccw vortex at the right place and rate."""
        base = texture(4)
        c = (GRID.width / 2, GRID.height / 2)
        yy, xx = np.mgrid[:GRID.height, :GRID.width]
        disk = np.hypot(xx - c[0], yy - c[1]) < 50
        frames = []
        for k in range(3):
            rot = cv2.warpAffine(base, cv2.getRotationMatrix2D(c, 3.0 * k, 1.0), (GRID.width, GRID.height),
                                 flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
            frames.append(np.where(disk, rot, base))
        fs = compute_flow(np.stack(frames), 1.0, GRID, PARAMS)
        kin = kinematics(fs.u[1], fs.v[1], GRID)
        vort, labels = detect_vortices(kin, fs.u[1], fs.v[1], GRID, VortexParams(min_area_km2=5000))
        big = max(vort, key=lambda v: v["area_km2"])
        self.assertEqual(big["direction"], "ccw")
        self.assertLess(abs(big["lat"]), 1.0)
        self.assertLess(abs(big["lon"]), 1.0)
        self.assertGreater(big["radius_km"], 200)
        self.assertAlmostEqual(big["spin_turns_per_hour"], 3.0 / 360, delta=0.4 * 3.0 / 360)

    def test_rotation_cw(self):
        c = (GRID.width / 2, GRID.height / 2)
        frames = warp_seq(texture(1), lambda k: cv2.getRotationMatrix2D(c, -3.0 * k, 1.0))
        fs = compute_flow(frames, 1.0, GRID, PARAMS)
        kin = kinematics(fs.u[1], fs.v[1], GRID)
        self.assertLess(np.nanmedian(centre(kin["vorticity"])), 0)

    def test_translation(self):
        sx, sy = 2.0, -1.0   # px per hour: east and north (image y up = negative)
        frames = warp_seq(texture(2), lambda k: np.float32([[1, 0, sx * k], [0, 1, sy * k]]))
        dt = 0.5
        fs = compute_flow(frames, dt, GRID, PARAMS)
        u = np.nanmedian(centre(fs.u[1]))
        v = np.nanmedian(centre(fs.v[1]))
        km = GRID.deg_x * 111.32
        self.assertAlmostEqual(u, sx * km / dt, delta=0.1 * sx * km / dt)
        self.assertAlmostEqual(v, -sy * km / dt, delta=0.15 * abs(sy) * km / dt)
        kin = kinematics(fs.u[1], fs.v[1], GRID)
        self.assertLess(abs(np.nanmedian(centre(kin["vorticity"]))), 0.01)
        self.assertLess(abs(np.nanmedian(centre(kin["divergence"]))), 0.01)

    def test_divergence_of_source(self):
        s = 1.03   # radial expansion per hour around the centre
        c = (GRID.width / 2, GRID.height / 2)
        frames = warp_seq(texture(3), lambda k: cv2.getRotationMatrix2D(c, 0, s ** k))
        fs = compute_flow(frames, 1.0, GRID, PARAMS)
        kin = kinematics(fs.u[1], fs.v[1], GRID)
        div = np.nanmedian(centre(kin["divergence"]))
        expected = 2 * math.log(s)
        self.assertAlmostEqual(div, expected, delta=0.25 * expected)
        self.assertLess(abs(np.nanmedian(centre(kin["vorticity"]))), 0.2 * expected)


class TrackingTests(unittest.TestCase):
    def vx(self, lat, lon, direction="ccw", label=1):
        return {"lat": lat, "lon": lon, "u_kmh": 40.0, "v_kmh": 0.0, "radius_km": 200.0, "direction": direction,
                "cyclonic": direction == "ccw", "spin_turns_per_hour": 0.05, "circulation_km2_per_h": 1e4,
                "label": label}

    def test_ids_persist(self):
        tr = VortexTracker(dt_hours=1.0)
        ids = []
        for t in range(6):
            a = self.vx(30.0, -60.0 + 0.4 * t)
            b = self.vx(-20.0, 100.0 - 0.3 * t, "cw", 2)
            tr.update(t, [b, a] if t % 2 else [a, b])
            ids.append((a["id"], b["id"]))
        self.assertEqual(len(set(ids)), 1)
        self.assertNotEqual(ids[0][0], ids[0][1])
        tracks = tr.finish()
        self.assertEqual(len(tracks), 2)
        self.assertEqual(tracks[0]["frames"], 6)

    def test_gap_and_birth(self):
        tr = VortexTracker(dt_hours=1.0)
        first = self.vx(10, 10)
        tr.update(0, [first])
        tr.update(1, [])                       # missed one frame, kept in memory
        again = self.vx(10, 10.8)
        tr.update(2, [again, self.vx(50, 50)])  # far away one is a new track
        self.assertEqual(first["id"], again["id"])
        tracks = tr.finish()
        self.assertEqual(len(tracks), 2)

    def test_direction_must_match(self):
        tr = VortexTracker(dt_hours=1.0)
        a = self.vx(10, 10)
        tr.update(0, [a])
        b = self.vx(10, 10.3, "cw")
        tr.update(1, [b])
        self.assertNotEqual(a["id"], b["id"])


if __name__ == "__main__":
    unittest.main()
