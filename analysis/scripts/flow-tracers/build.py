#!/usr/bin/env python3
"""Regenerate app/modes/flow-tracers/data/<id>/ from the flow analysis (see analysis/scripts/flow/README.md).

    .venv/bin/python analysis/scripts/flow-tracers/build.py --dataset 4285 [--data-dir /path/to/data]
"""

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from gravitunes_analysis.mode_export import export_mode  # noqa: E402

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--dataset", default="4285")
p.add_argument("--data-dir", type=Path)
a = p.parse_args()
export_mode("flow-tracers", a.dataset, ["flow_160x80"], ["160x80", "64x32"], a.data_dir)
