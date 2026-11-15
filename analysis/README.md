# analysis: Python computer vision on dataset frames

- `gravitunes_analysis/`: reusable functions (hotspots and regions, tracking, field statistics, time series). Add a function here once two modes need it.
- `scripts/<mode>/run.py --dataset <svs-id>`: per-mode analysis. It loads frames through `data-tools`, and writes whatever small JSON or binary output that mode needs into `app/modes/<mode>/data/<svs-id>/`.

Big intermediate files go in `data/` (git-ignored), not here.

Install the package: `uv venv .venv && uv pip install -p .venv -e analysis` (numpy, opencv-python-headless, scipy). Tests: `.venv/bin/python -m pytest analysis/tests`.

- `gravitunes_analysis/flow.py`, `tracking.py`, `sources.py`: optical flow, vorticity/divergence, Okubo–Weiss vortices and vortex tracking, used by `scripts/flow/run.py` (writes to `data/derived/<id>/flow/`; format in `scripts/flow/README.md`).
- `gravitunes_analysis/storms.py` (itay's storm segmentation + tracking: core peaks, watershed split, Farneback-warped mask association, split/merge lineage) and `storm_benchmark.py` (variant comparison and diagnostics). CLI: `gravitunes-storms --dataset 4285 [--mode storm-watch]` (or `python -m gravitunes_analysis.storms`) writes `data/derived/<id>/storms/tracks.json`; `--mode` also copies it to `app/modes/<mode>/data/<id>/storms.json` (plus its field grid). Its optical flow is `flow.farneback_gray`. `scripts/storm-watch/preprocess.py` and `benchmark.py` are thin wrappers kept for old commands.
