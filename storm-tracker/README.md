# Storm Watch

Storm Watch follows precipitation shapes through the 48 bundled half-hourly NASA IMERG snapshots for 2026-11-07. The browser loads compact, offline-generated polygons from `data/preprocessed-tracks.json`; it does not run inference or download a model.

## Rebuild the polygon tracks

From the repository root, use Python 3.10+:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r storm-tracker/requirements.txt
python storm-tracker/preprocess.py
```

The two runtime packages are NumPy and headless OpenCV; no neural-network runtime or model is required. The script analyzes all 48 bundled RGBA PNGs at 900 × 450 pixels and rewrites `storm-tracker/data/preprocessed-tracks.json`. Defaults are configurable, for example:

```sh
python storm-tracker/preprocess.py --minimum-area 200 --maximum-motion 64 --output storm-tracker/data/preprocessed-tracks.json
```

The explainable CV pipeline thresholds the precipitation alpha channel, closes tiny mask gaps, detects dark saturated red/blue local core peaks, watershed-splits connected masks using separated core seeds, attaches nearby non-core fragments only when distance and color agree, and simplifies the resulting contours. Frame association forward-warps masks with Farneback optical flow, then scores overlap, advected core distance, area, and color. Merges retain their source IDs as lineage anchors; separated children are assigned to those anchors where possible. The artifact contains polygon rings, track IDs, lineage, and core anchors rather than per-pixel label arrays.

The page fetches this file by default. To run it, serve the repository root (the project already expects HTTP rather than `file://`):

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/storm-tracker/`. Slider values continue to persist in browser local storage. Changing a tracker control starts the existing interactive in-browser reanalysis; to rebuild the offline optical-flow polygons with new settings, rerun `preprocess.py` with CLI options.

## Reproducible benchmark

Run:

```sh
python storm-tracker/benchmark.py
```

The benchmark compares connected-mask/core-nearest and core-watershed variants with and without optical flow, and evaluates core thresholds, area cutoffs, and motion settings. It writes `data/benchmark-results.json`, updates the selected polygon artifact, and creates `data/diagnostics/storm38-continuity.jpg`, a side-by-side snapshot/overlay montage spanning the earlier Storm 38 drift/merge period.

Its pseudo-labels are deliberately image-derived: dark red/blue local maxima are core signals, and Farneback-advected maxima are temporal links. It reports core assignment coverage, separation of distant core peaks, false-merge rate, flow-linked identity continuity and merge-link continuity (with the complementary false-split rate). These values are tuning aids, **not meteorological ground truth**: peak thresholding and optical flow can mistake color texture, growth, or fading for a storm core or identity. The diagnostic montage should be visually checked alongside the scores.

## Inputs and attribution

The project bundles the 48 half-hourly IMERG snapshots and NASA SVS 4285's reference MP4 in `data/`. The source page is [NASA Scientific Visualization Studio: IMERG](https://svs.gsfc.nasa.gov/4285/).
