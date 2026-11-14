# analysis: Python computer vision on dataset frames

- `gravitunes_analysis/`: reusable functions (hotspots and regions, tracking, field statistics, time series). Add a function here once two modes need it.
- `scripts/<mode>/run.py --dataset <svs-id>`: per-mode analysis. It loads frames through `data-tools`, and writes whatever small JSON or binary output that mode needs into `app/modes/<mode>/data/<svs-id>/`.

Big intermediate files go in `data/` (git-ignored), not here.

Install the package: `uv venv .venv && uv pip install -p .venv -e analysis` (numpy, opencv-python-headless, scipy). Tests: `.venv/bin/python -m pytest analysis/tests`.

- `gravitunes_analysis/flow.py`, `tracking.py`, `sources.py`: optical flow, vorticity/divergence, Okubo–Weiss vortices and vortex tracking, used by `scripts/flow/run.py` (writes to `data/derived/<id>/flow/`; format in `scripts/flow/README.md`).
