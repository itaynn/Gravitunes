"""High-resolution web export: compressed value grids + the original SVS frames as WebP.

Grid encoding "delta-gzip" (read by app/core/grid.js unpackGrid): frames are split into chunks; inside a chunk
the first frame is stored as is and every later frame as (byte - previous byte) mod 256; each chunk is gzipped.
Unchanged cells become 0, so hourly data compresses about 2x better than plain gzip. Optional `bits` < 8 rounds
bytes down to that many bits first (smaller, coarser; 255 stays no data).
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np
from PIL import Image

from .dataset import NODATA, _grid_path, build, descriptor, fetch_sources, video_frames
from .paths import dataset_dir


def quantize(g: np.ndarray, bits: int = 8) -> np.ndarray:
    if bits >= 8:
        return g
    step = 1 << (8 - bits)
    q = (g // step) * step
    q[g == NODATA] = NODATA
    return q


def delta(g: np.ndarray) -> np.ndarray:
    d = g.copy()
    d[1:] = (g[1:].astype(np.int16) - g[:-1]).astype(np.uint8)
    return d


def undelta(d: np.ndarray) -> np.ndarray:
    return np.cumsum(d, axis=0, dtype=np.uint8)


def pack(g: np.ndarray, chunk: int | None = None, bits: int = 8) -> list[tuple[int, int, bytes]]:
    """[(start, frames, gzip bytes)] for g (T, H, W) uint8."""
    g = quantize(g, bits)
    T = len(g)
    chunk = chunk or T
    return [(s, min(chunk, T - s), gzip.compress(delta(g[s:s + chunk]).tobytes(), 9, mtime=0)) for s in range(0, T, chunk)]


def write_grid(svs_id, size, out: Path, chunk: int | None = None, bits: int = 8, raw: bool = False) -> Path:
    """Write <id>_<W>x<H>.json + .bin.gz (or .c<k>.bin.gz chunks) into out/. Returns the header path."""
    p = _grid_path(svs_id, size)
    if not p.exists():
        build(svs_id, sizes=(tuple(size),))
    z = np.load(p)
    g = np.ascontiguousarray(z["data"])
    T, H, W = g.shape
    out.mkdir(parents=True, exist_ok=True)
    stem = f"{svs_id}_{W}x{H}"
    parts = pack(g, chunk, bits)
    chunks = []
    for i, (s, n, b) in enumerate(parts):
        name = f"{stem}.bin.gz" if len(parts) == 1 else f"{stem}.c{i:03d}.bin.gz"
        (out / name).write_bytes(b)
        chunks.append({"file": name, "start": s, "frames": n})
    if raw:  # plain .bin for node tests and older readers
        (out / f"{stem}.bin").write_bytes(quantize(g, bits).tobytes())
    meta = json.loads(str(z["meta"]))
    header = {"id": str(svs_id), "dims": [W, H], "frames": T, "dtype": "uint8", "layout": "t,y,x (y=0 is 90N, x=0 is 180W)",
              "nodata": NODATA, "scale": float(z["scale"]), "offset": float(z["offset"]),
              "transform": meta.get("transform", "linear"), "encoding": "delta-gzip", "bits": bits, "chunks": chunks,
              "units": meta["units"], "range": meta["range"], "times": z["times"].tolist(),
              "filled": z["filled"].astype(int).tolist(), "source": meta["source"], "credits": meta["credits"],
              "disclaimer": meta["disclaimer"]}
    hp = out / f"{stem}.json"
    hp.write_text(json.dumps(header))
    return hp


def hour_frames(svs_id, size):
    """Yield (hour, RGB uint8 frame at size) for every hour: early hours from PNG frames, the rest from the MP4."""
    d = descriptor(svs_id)
    mp4, png = d["frames"]["mp4"], d["frames"]["png"]
    early = list(range(png["first_hour"], mp4["first_hour"]))
    src = fetch_sources(svs_id, early)
    W0, H0 = mp4["size"]
    for h in early:
        n = h - png["first_hour"] + 1
        yield h, Image.open(src / "png" / f"{n:08d}.png").convert("RGB")
    for i, fr in enumerate(video_frames(src / mp4["file"], None, (W0, H0))):
        yield mp4["first_hour"] + i, Image.fromarray(fr)


def write_frames(svs_id, out: Path, width: int = 2048, quality: int = 75, folder: str | None = None) -> Path:
    """Original SVS frames, one WebP per hour, + frames.json manifest + the labelled SVS colour bar."""
    d = descriptor(svs_id)
    folder = folder or f"frames{width}"
    fdir = out / folder
    fdir.mkdir(parents=True, exist_ok=True)
    frames = []
    for h, im in hour_frames(svs_id, None):
        if im.width != width:
            im = im.resize((width, width // 2), Image.LANCZOS)
        name = f"{folder}/{h:05d}.webp"
        im.save(out / name, "WEBP", quality=quality, method=4)
        frames.append({"hour": h, "file": name})
    src = dataset_dir(svs_id) / "source"
    labelled = src / d["colorbar"]["file"].replace("_plain", "")
    if labelled.exists():
        (out / "colorbar.png").write_bytes(labelled.read_bytes())
    m = {"start": d["start"], "size": [width, width // 2], "frames": frames, "colorbar": "colorbar.png" if labelled.exists() else None}
    mp = out / ("frames.json" if folder == f"frames{width}" and width >= 2048 else f"frames_{width}.json")
    mp.write_text(json.dumps(m))
    return mp


def export_hd(svs_id, fine=(1024, 512), coarse=(256, 128), frame_width=2048, quality=75, chunk=24, progress=print):
    """Served-app set in data/nasa-svs/<id>/web/: coarse full grid (fast start), fine chunked grid, WebP frames."""
    web = dataset_dir(svs_id) / "web"
    for size, ch in ((coarse, None), (fine, chunk)):
        hp = write_grid(svs_id, size, web, chunk=ch, raw=size == coarse)
        progress(f"wrote {hp}")
    mp = write_frames(svs_id, web, frame_width, quality)
    progress(f"wrote {mp}")
    mp = write_frames(svs_id, web, 1024, 65)  # smaller copy for the standalone -hd build
    progress(f"wrote {mp}")
    export_standalone(svs_id, progress)
    return web


def export_standalone(svs_id, progress=print):
    """Grids for app/tools/build-standalone.py: web/light/ (256x128, 6-bit, every hour) and web/hd/ (512x256, 8-bit)."""
    web = dataset_dir(svs_id) / "web"
    for sub, size, bits in (("light", (256, 128), 6), ("hd", (512, 256), 8)):
        hp = write_grid(svs_id, size, web / sub, bits=bits)
        progress(f"wrote {hp}")
