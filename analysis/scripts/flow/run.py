#!/usr/bin/env python3
"""Flow analysis for one dataset: optical flow, vorticity/divergence, Okubo-Weiss vortices and vortex tracks.

Writes browser-ready files to data/derived/<id>/flow/ (see README.md next to this script for the format).
"""

from __future__ import annotations

import argparse
from dataclasses import asdict
import json
import math
from pathlib import Path
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # run without installing the package
from gravitunes_analysis.flow import FlowParams, VortexParams, compute_flow, detect_vortices, kinematics  # noqa: E402
from gravitunes_analysis.sources import REPO_ROOT, load_dataset  # noqa: E402
from gravitunes_analysis.tracking import TrackParams, VortexTracker  # noqa: E402

FORMAT_VERSION = 1


def parse_size(s: str) -> tuple[int, int]:
    w, h = s.lower().split("x")
    return int(w), int(h)


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dataset", required=True, help="SVS id, e.g. 4285 (IMERG PNGs) or 5152 (data-tools web grid)")
    p.add_argument("--data-dir", type=Path, help="data root (default: <repo>/data or $GRAVITUNES_DATA_DIR)")
    p.add_argument("--out", type=Path, help="output folder (default: <repo>/data/derived/<id>/flow)")
    p.add_argument("--width", type=int, help="analysis grid width (default 1024 for PNG frames, 512 for grids)")
    p.add_argument("--coarse", nargs="+", default=["64x32"], help="coarse output sizes WxH")
    p.add_argument("--start", type=int, default=0, help="first frame (web grids)")
    p.add_argument("--count", type=int, help="number of frames (web grids)")
    p.add_argument("--every", type=int, default=1, help="frame stride (web grids)")
    # flow
    d = FlowParams()
    p.add_argument("--pre-sigma", type=float, default=d.pre_sigma)
    p.add_argument("--winsize", type=int, default=d.winsize)
    p.add_argument("--levels", type=int, default=d.levels)
    p.add_argument("--flow-sigma", type=float, default=d.flow_sigma)
    p.add_argument("--valid-threshold", type=float, default=d.valid_threshold)
    p.add_argument("--temporal", type=int, default=d.temporal)
    p.add_argument("--iterations", type=int, default=d.iterations)
    p.add_argument("--valid-dilate", type=int, default=d.valid_dilate)
    # vortices
    v = VortexParams()
    p.add_argument("--k", type=float, default=v.k, help="Okubo-Weiss threshold: W < -k * std(W)")
    p.add_argument("--min-area-km2", type=float, default=v.min_area_km2)
    p.add_argument("--min-spin", type=float, default=v.min_spin_turns_per_hour, help="turns/hour")
    t = TrackParams()
    p.add_argument("--max-distance-km", type=float, default=t.max_distance_km)
    p.add_argument("--memory-frames", type=int, default=t.memory_frames)
    p.add_argument("--min-lifetime-frames", type=int, default=2,
                   help="tracks shorter than this are dropped from tracks and per-frame lists")
    p.add_argument("--diagnostics", type=int, default=4, help="number of frames to draw diagnostic PNGs for")
    return p.parse_args(argv)


def coarsen(a: np.ndarray, size: tuple[int, int], min_cover: float = 0.15) -> np.ndarray:
    """NaN-aware area average to (h, w). Cells with less than `min_cover` valid fine cells are NaN."""
    w, h = size
    ok = np.isfinite(a).astype(np.float32)
    num = cv2.resize(np.nan_to_num(a).astype(np.float32), (w, h), interpolation=cv2.INTER_AREA)
    den = cv2.resize(ok, (w, h), interpolation=cv2.INTER_AREA)
    out = np.full((h, w), np.nan, np.float32)
    good = den >= min_cover
    out[good] = num[good] / den[good]
    return out


def quantize(stack: np.ndarray, percentile: float = 99.5) -> tuple[np.ndarray, float]:
    """float -> int8 with value = byte * scale; NaN -> -128. Scale fits the given percentile of |value|."""
    finite = stack[np.isfinite(stack)]
    top = float(np.percentile(np.abs(finite), percentile)) if finite.size else 1.0
    scale = max(top, 1e-9) / 127.0
    q = np.clip(np.round(np.nan_to_num(stack / scale)), -127, 127).astype(np.int8)
    q[~np.isfinite(stack)] = -128
    return q, scale


def r(x, n=4):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), n)


def vortex_json(vx: dict) -> dict:
    return {
        "id": vx["id"], "lat": r(vx["lat"], 3), "lon": r(vx["lon"], 3), "x": r(vx["x"], 5), "y": r(vx["y"], 5),
        "radius_km": r(vx["radius_km"], 1), "area_km2": r(vx["area_km2"], 0),
        "spin_turns_per_hour": r(vx["spin_turns_per_hour"], 5), "period_hours": r(vx["period_hours"], 2),
        "direction": vx["direction"], "cyclonic": vx["cyclonic"],
        "vorticity_per_h": r(vx["vorticity"], 5), "circulation_km2_per_h": r(vx["circulation_km2_per_h"], 0),
        "u_kmh": r(vx["u_kmh"], 2), "v_kmh": r(vx["v_kmh"], 2), "intensity": r(vx.get("intensity"), 3),
    }


# ---------- diagnostics ----------

def _field_rgb(f: np.ndarray) -> np.ndarray:
    g = np.clip(np.nan_to_num(f) * 255, 0, 255).astype(np.uint8)
    rgb = cv2.applyColorMap(g, cv2.COLORMAP_VIRIDIS)
    rgb[np.nan_to_num(f) < 0.02] = (25, 25, 25)
    return rgb


def draw_flow(f: np.ndarray, u: np.ndarray, v: np.ndarray, vortices: list[dict], step_px: int = 32,
              kmh_per_px: float = 1.5) -> np.ndarray:
    img = _field_rgb(f)
    H, W = f.shape
    cu = coarsen(u, (W // step_px, H // step_px), 0.3)
    cv = coarsen(v, (W // step_px, H // step_px), 0.3)
    for j in range(cu.shape[0]):
        for i in range(cu.shape[1]):
            if not np.isfinite(cu[j, i]):
                continue
            x0, y0 = int((i + 0.5) * step_px), int((j + 0.5) * step_px)
            x1, y1 = int(x0 + cu[j, i] / kmh_per_px), int(y0 - cv[j, i] / kmh_per_px)
            cv2.arrowedLine(img, (x0, y0), (x1, y1), (255, 255, 255), 1, cv2.LINE_AA, tipLength=0.3)
    _draw_vortices(img, vortices)
    return img


def draw_vorticity(vort: np.ndarray, vortices: list[dict], scale: float) -> np.ndarray:
    z = np.nan_to_num(vort / scale)
    red = np.clip(z, 0, 1)
    blue = np.clip(-z, 0, 1)
    img = np.full(vort.shape + (3,), 30, np.uint8)
    img[..., 2] = np.clip(30 + red * 225, 0, 255)       # ccw = red
    img[..., 0] = np.clip(30 + blue * 225, 0, 255)      # cw = blue
    img[..., 1] = 30
    img[~np.isfinite(vort)] = (0, 0, 0)
    _draw_vortices(img, vortices)
    return img


def _draw_vortices(img: np.ndarray, vortices: list[dict]) -> None:
    H, W = img.shape[:2]
    km_px = 40075.0 / W
    for vx in vortices:
        x, y = int(vx["x"] * W), int(vx["y"] * H)
        rad = max(3, int(vx["radius_km"] / (km_px * max(math.cos(math.radians(vx["lat"])), 0.2))))
        color = (0, 255, 0) if vx["direction"] == "ccw" else (255, 0, 255)
        cv2.circle(img, (x, y), rad, color, 1, cv2.LINE_AA)
        cv2.putText(img, str(vx.get("id", "")), (x + 3, y - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1, cv2.LINE_AA)


def main(argv=None) -> int:
    a = parse_args(argv)
    t0 = time.time()
    data_dir = a.data_dir
    is_png = (Path(data_dir or REPO_ROOT / "data") / "nasa-svs" / a.dataset).glob("imergert_alpha.*.png")
    width = a.width or (1024 if any(is_png) else 512)
    stack = load_dataset(a.dataset, width, data_dir,
                         **({} if a.dataset == "4285" else {"start": a.start, "count": a.count, "every": a.every}))
    grid = stack.grid
    T = len(stack.fields)
    print(f"[flow] {a.dataset}: {T} frames, analysis grid {grid.width}x{grid.height}, dt {stack.dt_hours} h")
    fp = FlowParams(pre_sigma=a.pre_sigma, winsize=a.winsize, levels=a.levels, flow_sigma=a.flow_sigma,
                    valid_threshold=a.valid_threshold, temporal=a.temporal,
                    iterations=a.iterations, valid_dilate=a.valid_dilate)
    # Flow pixel sizes are tuned for ~1024 px wide globes; keep them in degrees for other widths.
    k = grid.width / 1024
    fp.pre_sigma *= k
    fp.flow_sigma *= k
    fp.valid_dilate = max(1, round(fp.valid_dilate * k))
    fp.winsize = max(7, int(round(fp.winsize * k)) | 1)
    fs = compute_flow(stack.fields, stack.dt_hours, grid, fp,
                      progress=lambda i, n: print(f"\r[flow] optical flow {i}/{n}", end="", flush=True))
    print()

    kins = [kinematics(fs.u[t], fs.v[t], grid) for t in range(T)]
    all_w = np.concatenate([kk["okubo_weiss"][np.isfinite(kk["okubo_weiss"])] for kk in kins])
    w_std = float(np.std(all_w)) if all_w.size else 0.0
    vp = VortexParams(k=a.k, min_area_km2=a.min_area_km2, min_spin_turns_per_hour=a.min_spin)
    tp = TrackParams(max_distance_km=a.max_distance_km, memory_frames=a.memory_frames,
                     min_lifetime_frames=a.min_lifetime_frames)
    tracker = VortexTracker(stack.dt_hours, tp)
    per_frame = []
    for t in range(T):
        vort, labels = detect_vortices(kins[t], fs.u[t], fs.v[t], grid, vp, w_std=w_std, field01=stack.fields[t])
        tracker.update(t, vort, labels, (fs.dx[t], fs.dy[t]))
        per_frame.append(vort)
    tracks = tracker.finish()
    kept = {tr["id"] for tr in tracks}
    per_frame = [[vx for vx in fr if vx["id"] in kept] for fr in per_frame]

    out = a.out or REPO_ROOT / "data" / "derived" / a.dataset / "flow"
    out.mkdir(parents=True, exist_ok=True)
    header = {
        "format": "gravitunes-flow", "version": FORMAT_VERSION,
        "dataset": a.dataset, "source": stack.source, "units_field": stack.units,
        "times": stack.times, "frames": T, "dt_hours": stack.dt_hours,
        "grid": {"projection": "equirectangular", "lon_west": grid.lon_west, "lon_east": grid.lon_east,
                 "lat_north": grid.lat_north, "lat_south": grid.lat_south},
        "analysis_size": [grid.width, grid.height],
        "params": {"flow": asdict(fp), "vortex": asdict(vp), "tracking": asdict(tp), "okubo_weiss_std": w_std},
        "layers": {},
        "vortices": "vortices.json",
        "caveat": "Optical flow measures apparent pattern motion of the visualization, not true wind.",
    }
    for size in map(parse_size, a.coarse):
        cw, ch = size
        uv = np.stack([np.stack([coarsen(fs.u[t], size), coarsen(fs.v[t], size)]) for t in range(T)])
        q, s = quantize(uv)
        name = f"flow_{cw}x{ch}.bin"
        q.tofile(out / name)
        header["layers"][f"flow_{cw}x{ch}"] = {
            "file": name, "dims": [cw, ch], "dtype": "int8", "layout": "t,c,y,x", "components": ["u", "v"],
            "nodata": -128, "scale": s, "units": "km/h", "note": "u east, v north; value = byte * scale"}
        for key, label in (("vorticity", "vorticity"), ("divergence", "divergence")):
            g = np.stack([coarsen(kins[t][key], size) for t in range(T)])
            q, s = quantize(g)
            name = f"{label}_{cw}x{ch}.bin"
            q.tofile(out / name)
            header["layers"][f"{label}_{cw}x{ch}"] = {
                "file": name, "dims": [cw, ch], "dtype": "int8", "layout": "t,y,x", "nodata": -128, "scale": s,
                "units": "1/h", "note": ("+ = counterclockwise" if key == "vorticity" else "+ = spreading out")}
    (out / "flow.json").write_text(json.dumps(header, indent=1))

    vjson = {
        "dataset": a.dataset, "times": stack.times, "dt_hours": stack.dt_hours,
        "frames": [{"t": t, "time": stack.times[t], "vortices": [vortex_json(vx) for vx in fr]}
                   for t, fr in enumerate(per_frame)],
        "tracks": [{**{kk: (r(vv, 5) if isinstance(vv, float) else vv) for kk, vv in tr.items() if kk != "points"},
                    "points": [{kk: (r(vv, 5) if isinstance(vv, float) else vv) for kk, vv in p.items()}
                               for p in tr["points"]]} for tr in tracks],
    }
    (out / "vortices.json").write_text(json.dumps(vjson, separators=(",", ":")))

    if a.diagnostics:
        dd = out / "diagnostics"
        dd.mkdir(exist_ok=True)
        vscale = float(np.nanpercentile(np.abs(np.concatenate([kk["vorticity"][np.isfinite(kk["vorticity"])]
                                                                 for kk in kins[::max(1, T // 8)]])), 99))
        speed = np.nanpercentile(np.hypot(fs.u[T // 2], fs.v[T // 2]), 95)
        for t in np.linspace(1, T - 2, a.diagnostics).astype(int):
            cv2.imwrite(str(dd / f"flow_t{t:03d}.png"),
                        draw_flow(stack.fields[t], fs.u[t], fs.v[t], per_frame[t], 32, max(speed / 24, 1e-6)))
            cv2.imwrite(str(dd / f"vorticity_t{t:03d}.png"), draw_vorticity(kins[t]["vorticity"], per_frame[t], vscale))

    n_v = [len(fr) for fr in per_frame]
    total = sum(f.stat().st_size for f in out.iterdir() if f.is_file())
    print(f"[flow] vortices/frame mean {np.mean(n_v):.1f} (max {max(n_v)}), tracks {len(tracks)}; "
          f"wrote {total / 1e6:.2f} MB to {out} in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
