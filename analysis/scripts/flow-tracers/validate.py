#!/usr/bin/env python3
"""Compare optical-flow settings for 4285 by warp error: move frame t along the flow for one step and
compare with frame t+1 (mean absolute error over cells with rain in either frame, on the decoded log-rate field).
Also draws a streamline PNG of the new flow.

    .venv/bin/python analysis/scripts/flow-tracers/validate.py [--width 1440] [--png out.png]
"""
import argparse
from pathlib import Path
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from gravitunes_analysis.flow import FlowParams, compute_flow  # noqa: E402
from gravitunes_analysis.sources import load_imerg_pngs, data_root  # noqa: E402

# Pixel sizes for a 1440-wide grid. OLD: the previous defaults (scaled from 1024 px), run on the binary alpha.
OLD = FlowParams(pre_sigma=2.1, levels=4, winsize=29, iterations=5, poly_n=7, poly_sigma=1.5, flow_sigma=11.0,
                 valid_threshold=0.06, valid_dilate=8, min_weight=0.25, temporal=2)
NEW = FlowParams(pre_sigma=2.0, levels=6, winsize=41, iterations=6, poly_n=7, poly_sigma=1.5,
                 flow_sigma=10.0, valid_threshold=0.03, valid_dilate=10, min_weight=0.2, temporal=2)


def warp_error(fields, dx, dy, dt):
    """MAE between frame t moved by the flow and frame t+1. dx, dy: px/h. Returns (flow MAE, zero-flow MAE)."""
    T, H, W = fields.shape
    gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    e, e0 = [], []
    for t in range(T - 1):
        a, b = fields[t], fields[t + 1]
        u = np.nan_to_num(dx[t]) * dt
        v = np.nan_to_num(dy[t]) * dt
        pred = cv2.remap(a, (gx - u) % W, gy - v, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        m = (a > 0) | (b > 0)
        e.append(np.abs(pred - b)[m].mean())
        e0.append(np.abs(a - b)[m].mean())
    return float(np.mean(e)), float(np.mean(e0))


def draw(field, dx, dy, path, step=20, hours=24.0):
    """Streamlets: from a grid of seeds, follow the flow for `hours` (px/h) and draw the path."""
    H, W = field.shape
    img = cv2.applyColorMap(np.clip(field * 255, 0, 255).astype(np.uint8), cv2.COLORMAP_VIRIDIS)
    img[field <= 0] = (30, 30, 30)
    n = 12
    for y in range(step // 2, H, step):
        for x in range(step // 2, W, step):
            px, py, pts = float(x), float(y), []
            for _ in range(n):
                ix, iy = int(px) % W, int(np.clip(py, 0, H - 1))
                u, v = dx[iy, ix], dy[iy, ix]
                if not np.isfinite(u):
                    break
                pts.append((int(px) % W, int(py)))
                px += u * hours / n
                py += v * hours / n
            for p0, p1 in zip(pts, pts[1:]):
                if abs(p0[0] - p1[0]) < W / 2:
                    cv2.line(img, p0, p1, (255, 255, 255), 1, cv2.LINE_AA)
            if len(pts) > 1:
                cv2.circle(img, pts[-1], 2, (0, 200, 255), -1)
    cv2.imwrite(str(path), img)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--width", type=int, default=1440)
    p.add_argument("--png", type=Path)
    a = p.parse_args()
    folder = data_root() / "nasa-svs" / "4285"
    rate = load_imerg_pngs(folder, a.width, field="rate")
    alpha = load_imerg_pngs(folder, a.width, field="alpha")
    for name, fields, prm in [("old (alpha field, old params)", alpha.fields, OLD),
                              ("new (rate field, new params)", rate.fields, NEW)]:
        t0 = time.time()
        fs = compute_flow(fields, rate.dt_hours, rate.grid, prm)
        e, e0 = warp_error(rate.fields, fs.dx, fs.dy, rate.dt_hours)
        print(f"{name}: warp MAE {e:.4f} (no motion {e0:.4f}, {100 * (1 - e / e0):.1f}% lower)  {time.time() - t0:.0f}s")
        if a.png and prm is NEW:
            draw(rate.fields[24], fs.dx[24], fs.dy[24], a.png)


if __name__ == "__main__":
    main()
