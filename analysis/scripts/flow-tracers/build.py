#!/usr/bin/env python3
"""Regenerate app/modes/flow-tracers/data/<id>/ from the flow analysis (see analysis/scripts/flow/README.md).

    .venv/bin/python analysis/scripts/flow-tracers/build.py --dataset 4285 5152 5153 5154 [--data-dir /path/to/data]

Gas datasets (data-tools grids) are strided and tuned per gravitunes_analysis/profiles.py and ship the 64x32 flow
(their fields are smooth); IMERG rain keeps the finer 160x80 flow.
"""

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from gravitunes_analysis.mode_export import export_mode  # noqa: E402

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--dataset", nargs="+", default=["4285"])
p.add_argument("--data-dir", type=Path)
a = p.parse_args()
for ds in a.dataset:
    export_mode("flow-tracers", ds, ["flow_160x80" if ds == "4285" else "flow_64x32"], ["160x80", "64x32"], a.data_dir)
