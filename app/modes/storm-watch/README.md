# Storm watch

By **itay**, brought over from his `clustering` branch (`storm-tracker/`).

The browser viewer plays the 48 half-hourly IMERG snapshots from `data/nasa-svs/4285/` and overlays storm polygons loaded from `data/preprocessed-tracks.json` (this folder). If that file is missing it falls back to analyzing the snapshots in the browser.

## Run

From the repo root: `python3 -m http.server 8000`, then open http://localhost:8000/app/modes/storm-watch/

## Rebuild the tracks

The offline Python pipeline (preprocess, benchmark, segmentation experiments) lives in `analysis/scripts/storm-watch/`; see its README. Run it from the repo root:

```sh
python3 -m pip install -r analysis/scripts/storm-watch/requirements.txt
python3 analysis/scripts/storm-watch/preprocess.py
```

Source: [NASA SVS 4285, IMERG](https://svs.gsfc.nasa.gov/4285/). Visualizations by Horace Mitchell (NASA/GSFC).
