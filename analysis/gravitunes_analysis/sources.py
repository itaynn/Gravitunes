"""Load a dataset as a (T, H, W) float32 stack of 0..1 scalar fields on an equirectangular grid.

Two sources:
- "imerg-png": 4285 IMERG RGBA snapshots in data/nasa-svs/4285/ (alpha = precipitation, as storm-watch uses).
- "web-grid":  data-tools browser grids data/nasa-svs/<id>/web/<id>_<W>x<H>.bin + .json (uint8, 255 = no data).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
import math
import os
from pathlib import Path
import re

import cv2
import numpy as np

from .flow import Grid

REPO_ROOT = Path(__file__).resolve().parents[2]


def data_root() -> Path:
    return Path(os.environ.get("GRAVITUNES_DATA_DIR", REPO_ROOT / "data"))


@dataclass
class FrameStack:
    dataset: str
    fields: np.ndarray        # (T, H, W) float32 0..1, NaN = no data
    grid: Grid
    times: list[str]          # ISO UTC
    dt_hours: float
    units: str
    value_range: tuple[float, float]   # physical value at field 0 and 1 (approximate)
    source: str


def _parse_time(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


# The SVS 4285 frames are RGBA with a binary alpha (rain / no rain); the rate is in the colour, a 10-step
# palette per phase (svs.gsfc.nasa.gov/4285 rainbarblack2.png, snowbarblack2.png), bins 0.1..50 mm/h.
RATE_EDGES = [0.1, 0.2, 0.3, 0.5, 1, 2, 3, 5, 10, 20, 50]
RAIN_COLORS = [(0, 129, 20), (0, 139, 82), (0, 179, 48), (96, 211, 0), (180, 231, 0), (255, 251, 0),
               (255, 196, 0), (255, 147, 0), (255, 0, 0), (200, 0, 0), (145, 0, 0)]
SNOW_COLORS = [(69, 255, 255), (73, 221, 255), (77, 187, 255), (79, 154, 255), (81, 122, 255), (82, 93, 255),
               (83, 70, 255), (90, 47, 217), (115, 33, 187), (140, 20, 156)]
RATE_LOG_RANGE = (math.log10(0.1), math.log10(50.0))


def rate_to_field(rate):
    """mm/h -> 0..1 on a log scale (0.1 mm/h -> 0, 50 mm/h -> 1); 0 stays 0 (dry)."""
    r = np.asarray(rate, np.float32)
    lo, hi = RATE_LOG_RANGE
    f = (np.log10(np.maximum(r, 1e-6)) - lo) / (hi - lo)
    return np.where(r > 0, np.clip(f, 0.02, 1.0), 0.0).astype(np.float32)


def palette_rates() -> list[tuple[tuple[int, int, int], float]]:
    """(rgb, representative mm/h) per palette colour: geometric bin centre; the 11th rain colour is > 50."""
    out = []
    for cols in (RAIN_COLORS, SNOW_COLORS):
        for i, c in enumerate(cols):
            lo, hi = (RATE_EDGES[i], RATE_EDGES[i + 1]) if i + 1 < len(RATE_EDGES) else (50.0, 50.0)
            out.append((c, math.sqrt(lo * hi)))
    return out


def decode_rate(rgba: np.ndarray) -> np.ndarray:
    """RGBA SVS frame -> 0..1 log-rate field (nearest palette colour; transparent = 0)."""
    pal = palette_rates()
    cols = np.array([c for c, _ in pal], np.int32)
    vals = rate_to_field([r for _, r in pal])
    key = (rgba[..., 0].astype(np.int32) << 16) | (rgba[..., 1].astype(np.int32) << 8) | rgba[..., 2]
    uniq, inv = np.unique(key, return_inverse=True)
    urgb = np.stack([uniq >> 16, (uniq >> 8) & 255, uniq & 255], -1)
    nearest = ((urgb[:, None] - cols[None]) ** 2).sum(-1).argmin(-1)
    out = vals[nearest][inv.reshape(key.shape)]
    out[rgba[..., 3] < 128] = 0.0
    return out.astype(np.float32)


def load_imerg_pngs(folder: Path, width: int = 1440, dataset: str = "4285", field: str = "rate") -> FrameStack:
    pat = re.compile(r"imergert_alpha\.(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)\.png$")
    files = sorted((p for p in folder.iterdir() if pat.search(p.name)), key=lambda p: p.name)
    if not files:
        raise FileNotFoundError(f"No imergert_alpha.*.png in {folder}")
    times = [pat.search(p.name).group(1) for p in files]
    frames = []
    for p in files:
        img = cv2.imread(str(p), cv2.IMREAD_UNCHANGED)
        if img is None or img.ndim != 3 or img.shape[2] != 4:
            raise ValueError(f"Expected RGBA PNG: {p}")
        h = round(img.shape[0] * width / img.shape[1])
        rgba = cv2.cvtColor(img, cv2.COLOR_BGRA2RGBA)
        if field == "alpha":
            f = rgba[:, :, 3].astype(np.float32) / 255.0
        else:  # decode at 1800 px wide (exact palette), then area-average down
            small = cv2.resize(rgba, (1800, 900), interpolation=cv2.INTER_NEAREST)
            f = decode_rate(small)
        frames.append(cv2.resize(f, (width, h), interpolation=cv2.INTER_AREA))
    dt = (_parse_time(times[1]) - _parse_time(times[0])).total_seconds() / 3600 if len(times) > 1 else 1.0
    fields = np.stack(frames)
    units = "relative precipitation (PNG alpha)" if field == "alpha" else "precipitation rate, log scale 0.1..50 mm/h"
    return FrameStack(dataset, fields, Grid(width, fields.shape[1]), times, dt,
                      units, (0.0, 1.0), f"{folder}/imergert_alpha.*.png")


def load_web_grid(header: Path, width: int | None = None, start: int = 0, count: int | None = None,
                  every: int = 1) -> FrameStack:
    meta = json.loads(header.read_text())
    W, H = meta["dims"]
    T = meta["frames"]
    raw = np.fromfile(header.with_suffix(".bin"), dtype=np.uint8).reshape(T, H, W)
    sel = list(range(start, T if count is None else min(T, start + count * every), every))
    raw = raw[sel]
    nodata = meta.get("nodata", 255)
    fields = raw.astype(np.float32) / max(1, nodata - 1)
    fields[raw == nodata] = np.nan
    if width and width != W:
        h = round(H * width / W)
        out = np.empty((len(sel), h, width), np.float32)
        for i, f in enumerate(fields):
            nan = np.isnan(f)
            g = cv2.resize(np.nan_to_num(f), (width, h), interpolation=cv2.INTER_LINEAR)
            m = cv2.resize(nan.astype(np.float32), (width, h), interpolation=cv2.INTER_LINEAR) > 0.5
            g[m] = np.nan
            out[i] = g
        fields, W, H = out, width, h
    times = [meta["times"][i] for i in sel]
    dt = (_parse_time(times[1]) - _parse_time(times[0])).total_seconds() / 3600 if len(times) > 1 else 1.0
    lo = meta.get("offset", 0.0)
    hi = lo + meta.get("scale", 1.0) * (nodata - 1)
    return FrameStack(str(meta["id"]), fields, Grid(W, H), times, dt, meta.get("units", ""), (lo, hi), str(header))


def load_dataset(dataset: str, width: int | None = None, data_dir: Path | None = None, **kw) -> FrameStack:
    """Pick the right loader for a dataset id. `width` is the analysis grid width (height follows 2:1)."""
    root = Path(data_dir) if data_dir else data_root()
    folder = root / "nasa-svs" / str(dataset)
    if any(folder.glob("imergert_alpha.*.png")):
        return load_imerg_pngs(folder, width or 1440, str(dataset))
    web = folder / "web"
    headers = sorted(web.glob(f"{dataset}_*x*.json"), key=lambda p: int(p.stem.split("_")[-1].split("x")[0]))
    if not headers:
        raise FileNotFoundError(f"No frames for dataset {dataset} in {folder} "
                                f"(expected imergert_alpha PNGs or web/{dataset}_WxH.json; run gravitunes_data export)")
    # smallest grid at least as wide as requested, else the largest
    pick = next((h for h in headers if width and int(h.stem.split("_")[-1].split("x")[0]) >= width), headers[-1])
    if width is None:
        pick = headers[0]
    return load_web_grid(pick, width, **kw)


__all__ = ["FrameStack", "load_dataset", "load_imerg_pngs", "load_web_grid", "data_root"]
