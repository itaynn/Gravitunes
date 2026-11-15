#!/usr/bin/env python3
"""Scan app/modes/*/mode.json (skipping names that start with "_" and modes with "hidden": true) and write
app/modes/index.json. Hidden modes keep their code but are left out of the gallery, switcher and dist/.

Run from anywhere: python3 app/tools/build-modes-index.py
"""
import json
from pathlib import Path

MODES = Path(__file__).resolve().parent.parent / "modes"
# Datasets with an HD export (gravitunes_data export-hd); build-standalone.py makes <mode>-hd.html for host
# modes that show one of them from the shared data folder.
HD_DATASETS = {"5152", "5153", "5154"}


def main():
    modes = []
    for d in sorted(MODES.iterdir()):
        meta_path = d / "mode.json"
        if not d.is_dir() or d.name.startswith("_") or not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text())
        if meta.get("hidden"):
            print(f"hide {d.name}: hidden in mode.json")
            continue
        entry = {"id": d.name, **meta}
        if "href" not in meta and not (d / "main.js").exists():
            if (d / "index.html").exists():
                entry["href"] = "index.html"
            else:
                print(f"skip {d.name}: no main.js, index.html or href")
                continue
        ds = meta.get("datasets")
        own = meta.get("datasetDirs") or {}
        entry["hd"] = bool("href" not in entry and meta.get("data") is not False and isinstance(ds, list)
                           and any(str(d) in HD_DATASETS and str(d) not in own for d in ds))
        modes.append(entry)
    out = MODES / "index.json"
    out.write_text(json.dumps({"modes": modes}, indent=2) + "\n")
    print(f"wrote {out} ({len(modes)} modes)")


if __name__ == "__main__":
    main()
