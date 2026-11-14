"""Build, load and export decoded value grids for an SVS dataset."""
from __future__ import annotations

import json
import shutil
import subprocess
import warnings
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from . import svs
from .colors import BlendDecoder, line_mask, read_colorbar
from .paths import DESCRIPTOR_DIR, dataset_dir

FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
NODATA = 255


def descriptor(svs_id) -> dict:
    p = DESCRIPTOR_DIR / f"{svs_id}.json"
    if not p.exists():
        raise FileNotFoundError(f"No descriptor {p}. Datasets with a decoder so far: "
                                f"{sorted(x.stem for x in DESCRIPTOR_DIR.glob('*.json'))}")
    return json.loads(p.read_text())


def _parse_time(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


@dataclass
class Dataset:
    """Decoded values on a regular lat/lon grid.

    values: float32 (T, H, W), NaN = no data.  times: UTC datetimes.  lat/lon: cell centres.
    """
    values: np.ndarray
    times: list
    lat: np.ndarray
    lon: np.ndarray
    meta: dict = field(default_factory=dict)

    @property
    def units(self) -> str:
        return self.meta.get("units", "")

    def pixel_at(self, lat: float, lon: float) -> tuple[int, int]:
        H, W = self.values.shape[1:]
        y = int(np.clip((90 - lat) / 180 * H, 0, H - 1))
        x = int(np.clip(((lon + 180) % 360) / 360 * W, 0, W - 1))
        return y, x

    def value_at(self, lat: float, lon: float, t: int = 0) -> float:
        y, x = self.pixel_at(lat, lon)
        return float(self.values[t, y, x])

    def iter(self):
        for t, frame in zip(self.times, self.values):
            yield t, frame

    def to_npz(self, path) -> Path:
        path = Path(path)
        np.savez_compressed(path, values=self.values, times=np.array([t.isoformat() for t in self.times]),
                            lat=self.lat, lon=self.lon, meta=json.dumps(self.meta))
        return path


# ---------------------------------------------------------------- download

def fetch_sources(svs_id, png_hours: range | list = (), progress=print) -> Path:
    """Download the MP4, colour bar, and optionally a few PNG frames (by hour index)."""
    d = descriptor(svs_id)
    out = dataset_dir(svs_id) / "source"
    base = svs.vis_dir_url(svs_id)
    files = [(base + d["frames"]["mp4"]["file"], out / d["frames"]["mp4"]["file"], None),
             (base + d["colorbar"]["file"], out / d["colorbar"]["file"], None)]
    png = d["frames"]["png"]
    for h in png_hours:
        n = h - png["first_hour"] + 1
        files.append((f"{base}{png['folder']}{n:08d}.png", out / "png" / f"{n:08d}.png", None))
    todo = [f for f in files if not f[1].exists()]
    if todo:
        progress(f"downloading {len(todo)} file(s) from {base}")
        svs.download_many(todo, progress)
    return out


def video_frames(path: Path, indices=None, size=None):
    """Yield RGB uint8 frames from a video (all, or only the given indices)."""
    W, H = size
    vf = []
    if indices is not None:
        vf = ["-vf", "select='" + "+".join(f"eq(n\\,{i})" for i in indices) + "'", "-vsync", "0"]
    p = subprocess.Popen([FFMPEG, "-v", "error", "-i", str(path), *vf, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         stdout=subprocess.PIPE)
    n = W * H * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(H, W, 3)
    p.wait()


def _down(v: np.ndarray, k: int) -> np.ndarray:
    H, W = v.shape
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmean(v.reshape(H // k, k, W // k, k), (1, 3))


# ---------------------------------------------------------------- build

def build(svs_id, sizes=((512, 256), (256, 128)), fill_from_png: bool = True, progress=print) -> dict:
    """Decode the whole dataset into uint8 grids (value = offset + byte*scale) saved as .npz.

    Uses the MP4 (small). Hours the MP4 doesn't cover are filled from PNG frames when fill_from_png.
    """
    d = descriptor(svs_id)
    mp4, png = d["frames"]["mp4"], d["frames"]["png"]
    first, count = mp4["first_hour"], mp4["count"]
    total = max(first + count, png["first_hour"] + png["count"])
    early = list(range(png["first_hour"], first)) if fill_from_png else []
    src = fetch_sources(svs_id, early, progress)
    W0, H0 = mp4["size"]

    ramp = read_colorbar(src / d["colorbar"]["file"], d["colorbar"].get("row"), d["colorbar"].get("x0"), d["colorbar"].get("x1"))
    lo, hi = d["range"]
    dec = BlendDecoder(ramp, lo, hi, d["encoding"].get("opacity"))

    progress("fitting background + overlay mask from 24 video frames")
    sample = np.stack(list(video_frames(src / mp4["file"], np.linspace(0, count - 1, 24).astype(int), (W0, H0))))
    bg = dec.fit_background(sample)
    mask = line_mask(sample, d.get("masks", []))
    work = dataset_dir(svs_id)
    Image.fromarray(bg).save(work / "background.png")
    Image.fromarray((~mask * 255).astype(np.uint8)).save(work / "overlay_mask.png")

    scale, offset = (hi - lo) / 254.0, float(lo)
    grids = {s: np.full((total, s[1], s[0]), NODATA, np.uint8) for s in sizes}
    filled = np.zeros(total, bool)

    def put(hour, frame):
        v = dec.decode(frame, bg)
        v[mask] = np.nan
        for (W, H), g in grids.items():
            a = _down(v, W0 // W)
            g[hour] = np.where(np.isfinite(a), np.clip(np.round((a - offset) / scale), 0, 254), NODATA)
        filled[hour] = True

    progress(f"decoding {count} video frames")
    for i, fr in enumerate(video_frames(src / mp4["file"], None, (W0, H0))):
        put(first + i, fr)
    for h in early:
        n = h - png["first_hour"] + 1
        put(h, np.asarray(Image.open(src / "png" / f"{n:08d}.png").convert("RGB")))

    start = _parse_time(d["start"])
    times = [(start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ") for h in range(total)]
    out = {}
    for (W, H), g in grids.items():
        p = work / f"{svs_id}_{W}x{H}.npz"
        np.savez_compressed(p, data=g, scale=scale, offset=offset, times=np.array(times), filled=filled,
                            meta=json.dumps({k: d[k] for k in ("id", "title", "units", "range", "source", "credits", "disclaimer")}))
        out[(W, H)] = p
        progress(f"wrote {p} ({p.stat().st_size / 1e6:.1f} MB)")
    return out


# ---------------------------------------------------------------- load / export

def _grid_path(svs_id, size) -> Path:
    W, H = size
    return dataset_dir(svs_id) / f"{svs_id}_{W}x{H}.npz"


def load(svs_id, size=(256, 128), every: int = 1, build_if_missing: bool = True) -> Dataset:
    """Decoded values for an SVS dataset as a Dataset (values float32 (T,H,W), NaN = no data).

    >>> ds = load("5152")                 # near-surface ozone, 256x128, hourly
    >>> ds.values.shape, ds.units
    """
    p = _grid_path(svs_id, size)
    if not p.exists():
        if not build_if_missing:
            raise FileNotFoundError(f"{p} missing; run `gravitunes_data build {svs_id}`")
        build(svs_id, sizes=(tuple(size),))
    z = np.load(p)
    g = z["data"][::every]
    vals = np.where(g == NODATA, np.nan, z["offset"] + g.astype(np.float32) * z["scale"]).astype(np.float32)
    T, H, W = vals.shape
    times = [_parse_time(t) for t in z["times"][::every]]
    meta = json.loads(str(z["meta"]))
    meta["filled"] = z["filled"][::every].tolist()
    lat = np.linspace(90 - 90 / H, -90 + 90 / H, H)
    lon = np.linspace(-180 + 180 / W, 180 - 180 / W, W)
    return Dataset(vals, times, lat, lon, meta)


def export_web(svs_id, size=(256, 128)) -> tuple[Path, Path]:
    """Write <id>_<W>x<H>.bin (uint8 T*H*W, row 0 = north, 255 = no data) + .json header to data/nasa-svs/<id>/web/."""
    p = _grid_path(svs_id, size)
    if not p.exists():
        build(svs_id, sizes=(tuple(size),))
    z = np.load(p)
    g = np.ascontiguousarray(z["data"])
    T, H, W = g.shape
    web = dataset_dir(svs_id) / "web"
    web.mkdir(parents=True, exist_ok=True)
    stem = f"{svs_id}_{W}x{H}"
    (web / f"{stem}.bin").write_bytes(g.tobytes())
    meta = json.loads(str(z["meta"]))
    header = {"id": str(svs_id), "dims": [W, H], "frames": T, "dtype": "uint8", "layout": "t,y,x (y=0 is 90N, x=0 is 180W)",
              "nodata": NODATA, "scale": float(z["scale"]), "offset": float(z["offset"]),
              "units": meta["units"], "range": meta["range"], "times": z["times"].tolist(),
              "filled": z["filled"].astype(int).tolist(), "source": meta["source"], "credits": meta["credits"],
              "disclaimer": meta["disclaimer"]}
    (web / f"{stem}.json").write_text(json.dumps(header))
    return web / f"{stem}.bin", web / f"{stem}.json"
