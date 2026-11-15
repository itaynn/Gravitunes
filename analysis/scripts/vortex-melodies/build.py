#!/usr/bin/env python3
"""Regenerate app/modes/vortex-melodies/data/<id>/ from the flow analysis (see analysis/scripts/flow/README.md).
Keeps vortex tracks of at least 3 frames (shorter ones flicker).

    .venv/bin/python analysis/scripts/vortex-melodies/build.py --dataset 4285 [--data-dir /path/to/data]
"""

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from gravitunes_analysis.mode_export import export_mode  # noqa: E402

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--dataset", default="4285")
p.add_argument("--data-dir", type=Path)
p.add_argument("--min-track-frames", type=int, default=8)
a = p.parse_args()
export_mode("vortex-melodies", a.dataset, ["flow_64x32", "divergence_64x32"], ["160x80", "64x32"], a.data_dir,
            vortices=True, min_track_frames=a.min_track_frames)
