# analysis: Python computer vision on dataset frames

- `gravitunes_analysis/`: reusable functions (hotspots and regions, tracking, field statistics, time series). Add a function here once two modes need it.
- `scripts/<mode>/run.py --dataset <svs-id>`: per-mode analysis. It loads frames through `data-tools`, and writes whatever small JSON or binary output that mode needs into `app/modes/<mode>/data/<svs-id>/`.

Big intermediate files go in `data/` (git-ignored), not here.
