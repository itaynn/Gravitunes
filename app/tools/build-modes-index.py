#!/usr/bin/env python3
"""Scan app/modes/*/mode.json (skipping names that start with "_") and write app/modes/index.json.

Run from anywhere: python3 app/tools/build-modes-index.py
"""
import json
from pathlib import Path

MODES = Path(__file__).resolve().parent.parent / "modes"


def main():
    modes = []
    for d in sorted(MODES.iterdir()):
        meta_path = d / "mode.json"
        if not d.is_dir() or d.name.startswith("_") or not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text())
        entry = {"id": d.name, **meta}
        if "href" not in meta and not (d / "main.js").exists():
            if (d / "index.html").exists():
                entry["href"] = "index.html"
            else:
                print(f"skip {d.name}: no main.js, index.html or href")
                continue
        modes.append(entry)
    out = MODES / "index.json"
    out.write_text(json.dumps({"modes": modes}, indent=2) + "\n")
    print(f"wrote {out} ({len(modes)} modes)")


if __name__ == "__main__":
    main()
