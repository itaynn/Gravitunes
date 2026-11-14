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

from .sources import REPO_ROOT, load_dataset

FLOW_SCRIPT = REPO_ROOT / "analysis" / "scripts" / "flow" / "run.py"


def run_flow(dataset: str, data_dir: Path | None, out: Path, coarse: list[str]) -> None:
    cmd = [sys.executable, str(FLOW_SCRIPT), "--dataset", dataset, "--out", str(out), "--diagnostics", "0",
           "--coarse", *coarse]
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
              "note": "relative precipitation 0..1 (IMERG PNG alpha), from mode_export.py"}
    (dest / f"field_{W}x{H}.json").write_text(json.dumps(header))


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
                vortices: bool = False, min_track_frames: int = 3, work: Path | None = None) -> Path:
    work = work or REPO_ROOT / "data" / "derived" / dataset / "flow"
    run_flow(dataset, data_dir, work, coarse)
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
    total = sum(p.stat().st_size for p in dest.iterdir())
    print(f"[{mode}] wrote {total / 1e6:.2f} MB to {dest}")
    return dest
