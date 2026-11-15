"""Copy flow-analysis outputs into a self-contained app mode folder (app/modes/<mode>/data/<id>/).

Used by analysis/scripts/flow-tracers/build.py and analysis/scripts/vortex-melodies/build.py.
Writes:
- field_256x128.json/.bin: the dataset's 0..1 field as a uint8 value grid (app/core/grid.js format), so the
  mode can show and probe the dataset without a data-tools export.
- flow.json: the flow header (times, layers), trimmed to the layers copied.
- the requested layer .bin files, unchanged.
- vortices.json (optional): tracks with at least `min_track_frames` frames, compact per-frame lists.
"""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys

import cv2
import numpy as np

from .sources import REPO_ROOT, data_root, load_dataset

FLOW_SCRIPT = REPO_ROOT / "analysis" / "scripts" / "flow" / "run.py"


def run_flow(dataset: str, data_dir: Path | None, out: Path, coarse: list[str], width: int = 1440,
             diagnostics: int = 0) -> None:
    cmd = [sys.executable, str(FLOW_SCRIPT), "--dataset", dataset, "--out", str(out),
           "--diagnostics", str(diagnostics), "--width", str(width), "--coarse", *coarse]
    if data_dir:
        cmd += ["--data-dir", str(data_dir)]
    subprocess.run(cmd, check=True)


def write_field_grid(dataset: str, data_dir: Path | None, dest: Path, times: list[str], size=(256, 128)) -> None:
    stack = load_dataset(dataset, width=1024, data_dir=data_dir)
    W, H = size
    out = np.empty((len(stack.fields), H, W), np.uint8)
    for i, f in enumerate(stack.fields):
        g = cv2.resize(np.nan_to_num(f), (W, H), interpolation=cv2.INTER_AREA)
        out[i] = np.clip(np.round(g * 254), 0, 254).astype(np.uint8)
    out.tofile(dest / f"field_{W}x{H}.bin")
    header = {"id": dataset, "dims": [W, H], "frames": int(out.shape[0]), "dtype": "uint8", "layout": "t,y,x",
              "offset": 0.0, "scale": 1 / 254, "nodata": 255, "units": "relative", "times": times,
              "note": "precipitation rate 0..1 = log10 scale 0.1..50 mm/h decoded from the SVS colours (0 = dry), from mode_export.py",
              "rate_log10": [-1.0, 1.69897]}
    (dest / f"field_{W}x{H}.json").write_text(json.dumps(header))


def write_frames(dataset: str, data_dir: Path | None, dest: Path, times: list[str], width: int = 1800) -> None:
    """The original SVS RGBA frames (NASA colours, transparent where dry) as lossless WebP, one per time step,
    nearest-neighbour resized so the palette stays exact. Written to dest/frames/<i>.webp + frames.json."""
    from PIL import Image
    root = Path(data_dir) if data_dir else data_root()
    folder = root / "nasa-svs" / dataset
    (dest / "frames").mkdir(exist_ok=True)
    files = []
    for i, t in enumerate(times):
        im = Image.open(folder / f"imergert_alpha.{t}.png").convert("RGBA")
        im = im.resize((width, width // 2), Image.NEAREST)
        name = f"frames/{i:03d}.webp"
        im.save(dest / name, "WEBP", lossless=True, method=6)
        files.append(name)
    meta = {"source": "https://svs.gsfc.nasa.gov/4285 imergert_alpha frames (3600x1800), resized", "size": [width, width // 2],
            "files": files, "colorbars": {"rain": "frames/rainbar.png", "snow": "frames/snowbar.png"}}
    (dest / "frames.json").write_text(json.dumps(meta))
    for k in ("rain", "snow"):  # NASA colour bars (svs.gsfc.nasa.gov/4285 {rain,snow}barblack2.png) if downloaded
        src = folder / f"{k}barblack2.png"
        if src.is_file():
            shutil.copy(src, dest / "frames" / f"{k}bar.png")


def land_mask(lines: list[list[float]], W: int, H: int) -> np.ndarray:
    """Fill Natural Earth coastlines (data/earth/coastlines.json) into a land mask. Lines cut at the date line
    are chained back together; a chain that wraps the globe (Antarctica) is closed through the pole."""
    segs = [[(ln[i], ln[i + 1]) for i in range(0, len(ln), 2)] for ln in lines]
    polys = [sg for sg in segs if sg[0] == sg[-1]]
    open_ = [sg for sg in segs if sg[0] != sg[-1]]

    def key(p):
        lon = 180.0 if abs(abs(p[0]) - 180) < 1e-6 else p[0]
        return (round(lon, 2), round(p[1], 2))
    while open_:
        chain = open_.pop()
        while key(chain[-1]) != key(chain[0]) or len(chain) < 3:
            nxt = next((sg for sg in open_ if key(sg[0]) == key(chain[-1])), None)
            if nxt is None:
                break
            open_.remove(nxt)
            chain = chain + nxt[1:]
        out, off = [chain[0]], 0.0
        for lon, lat in chain[1:]:
            lon += off
            while lon - out[-1][0] > 180:
                lon -= 360; off -= 360
            while lon - out[-1][0] < -180:
                lon += 360; off += 360
            out.append((lon, lat))
        if abs(out[-1][0] - out[0][0]) > 300:
            pole = -90.0 if np.mean([p[1] for p in out]) < 0 else 90.0
            out += [(out[-1][0], pole), (out[0][0], pole)]
        polys.append(out)
    m = np.zeros((H, W), np.uint8)
    for p in polys:
        a = np.array(p, np.float64)
        for sh in (-360, 0, 360):
            pts = np.stack([(a[:, 0] + sh + 180) / 360 * W, (90 - a[:, 1]) / 180 * H], -1)
            if pts[:, 0].max() < 0 or pts[:, 0].min() > W:
                continue
            cv2.fillPoly(m, [np.round(pts * 8).astype(np.int32)], 255, cv2.LINE_8, shift=3)
    return m


def write_land(dest: Path, size=(1440, 720)) -> None:
    lines = json.loads((REPO_ROOT / "data" / "earth" / "coastlines.json").read_text())["lines"]
    cv2.imwrite(str(dest / "land.png"), land_mask(lines, *size))


def compact_vortices(v: dict, min_track_frames: int) -> dict:
    keep = {t["id"] for t in v["tracks"] if t["frames"] >= min_track_frames}

    def r(x, n=2):
        return None if x is None else round(x, n)

    tracks = [{"id": t["id"], "birth": t["birth"], "death": t["death"], "frames": t["frames"],
               "direction": t["direction"], "cyclonic": t["cyclonic"], "max_radius_km": r(t["max_radius_km"], 0),
               "mean_spin": r(abs(t["mean_spin_turns_per_hour"]), 5),
               "max_circ": r(t["max_abs_circulation_km2_per_h"], 0)}
              for t in v["tracks"] if t["id"] in keep]
    frames = [[{"id": x["id"], "lat": r(x["lat"]), "lon": r(x["lon"]), "r": r(x["radius_km"], 0),
                "spin": r(abs(x["spin_turns_per_hour"]), 5), "circ": r(abs(x["circulation_km2_per_h"]), 0),
                "u": r(x["u_kmh"], 1), "v": r(x["v_kmh"], 1), "int": r(x["intensity"], 3)}
               for x in f["vortices"] if x["id"] in keep] for f in v["frames"]]
    return {"dataset": v["dataset"], "dt_hours": v["dt_hours"], "min_track_frames": min_track_frames,
            "note": "spin = |turns per hour| (underestimated by smoothing: use relatively), circ = |circulation| km2/h",
            "tracks": tracks, "frames": frames}


def export_mode(mode: str, dataset: str, layers: list[str], coarse: list[str], data_dir: Path | None,
                vortices: bool = False, min_track_frames: int = 3, work: Path | None = None,
                frames_width: int = 1800, rerun: bool = True) -> Path:
    work = work or REPO_ROOT / "data" / "derived" / dataset / "flow"
    if rerun or not (work / "flow.json").is_file():
        run_flow(dataset, data_dir, work, coarse, diagnostics=4)
    dest = REPO_ROOT / "app" / "modes" / mode / "data" / dataset
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    head = json.loads((work / "flow.json").read_text())
    head["layers"] = {k: head["layers"][k] for k in layers}
    head.pop("source", None)
    if vortices:
        v = json.loads((work / "vortices.json").read_text())
        (dest / "vortices.json").write_text(json.dumps(compact_vortices(v, min_track_frames), separators=(",", ":")))
        head["vortices"] = "vortices.json"
    else:
        head.pop("vortices", None)
    (dest / "flow.json").write_text(json.dumps(head, indent=1))
    for k in layers:
        shutil.copy(work / head["layers"][k]["file"], dest / head["layers"][k]["file"])
    write_field_grid(dataset, data_dir, dest, head["times"])
    if frames_width:
        write_frames(dataset, data_dir, dest, head["times"], frames_width)
        write_land(dest)
    total = sum(p.stat().st_size for p in dest.rglob("*") if p.is_file())
    print(f"[{mode}] wrote {total / 1e6:.2f} MB to {dest}")
    return dest
