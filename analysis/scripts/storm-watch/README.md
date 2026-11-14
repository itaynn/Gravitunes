# Storm Watch (analysis)

By **itay**, brought over from his `clustering` branch (`storm-tracker/`). Run everything from the repo root. Inputs: `data/nasa-svs/4285/`. Output: `app/modes/storm-watch/data/preprocessed-tracks.json`.

Storm Watch follows precipitation shapes through the 48 bundled half-hourly NASA IMERG snapshots for 2026-11-07. The browser loads compact, offline-generated polygons from `app/modes/storm-watch/data/preprocessed-tracks.json`; it does not run inference or download a model.

## Rebuild the polygon tracks

From the repository root, use Python 3.10+:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r analysis/scripts/storm-watch/requirements.txt
python analysis/scripts/storm-watch/preprocess.py
```

The two runtime packages are NumPy and headless OpenCV; no neural-network runtime or model is required. The script analyzes all 48 bundled RGBA PNGs at 900 × 450 pixels and rewrites `app/modes/storm-watch/data/preprocessed-tracks.json`. Defaults are configurable, for example:

```sh
python analysis/scripts/storm-watch/preprocess.py --minimum-area 200 --maximum-motion 64 --output app/modes/storm-watch/data/preprocessed-tracks.json
```

The explainable CV pipeline thresholds the precipitation alpha channel, closes tiny mask gaps, detects dark saturated red/blue local core peaks, watershed-splits connected masks using separated core seeds, attaches nearby non-core fragments only when distance and color agree, and simplifies the resulting contours. Frame association forward-warps masks with Farneback optical flow, then scores overlap, advected core distance, area, and color. Core identity updates are motion-gated even when a merged component's mask overlaps; lineage anchors that cannot be matched are retained only while they remain inside the associated component. Family IDs still propagate across splits, while stale anchors no longer pull the marker away from a branch. The artifact contains polygon rings, track IDs, lineage, and core anchors rather than per-pixel label arrays.

The page fetches this file by default. To run it, serve the repository root (the project already expects HTTP rather than `file://`):

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/app/modes/storm-watch/`. Slider values continue to persist in browser local storage. Changing a tracker control starts the existing interactive in-browser reanalysis; to rebuild the offline optical-flow polygons with new settings, rerun `preprocess.py` with CLI options.

## Reproducible benchmark

Run:

```sh
python analysis/scripts/storm-watch/benchmark.py
```

The benchmark compares connected-mask/core-nearest and core-watershed variants with and without optical flow, and evaluates core thresholds, area cutoffs, motion settings, and flow-vs-core association weights. It writes `analysis/scripts/storm-watch/benchmark-results.json`, updates the selected polygon artifact, and creates `analysis/scripts/storm-watch/diagnostics/storm38-continuity.jpg` plus the focused `analysis/scripts/storm-watch/diagnostics/storm38-detail.jpg` side-by-side snapshot/overlay montage. The generated track nearest the prior Storm 38 diagnostic position at 10:00 UTC is assigned ID 38 in the artifact for direct comparison; the report records its original generated ID.

Its pseudo-labels are deliberately image-derived: dark red/blue local maxima (saturation ≥100, strength ≥160) are core signals, and Farneback-advected maxima within 56 analysis pixels are temporal links. It reports core assignment coverage, separation of peak pairs at least 32 pixels apart, false-merge rate, flow-linked identity continuity, merge-link continuity, lineage-anchor proximity to polygon outlines (within 12 analysis pixels, allowing storm-eye holes), and the complementary false-split rate. The composite score equally weights coverage, separation, continuity, and anchor proximity. These values are tuning aids, **not meteorological ground truth**: peak thresholding and optical flow can mistake color texture, growth, or fading for a storm core or identity.

On the bundled sequence, the selected 200-pixel/strong-core profile scored 81.90 versus 77.03 for the connected-mask/core-nearest baseline: core assignment coverage 29.63% vs 18.60%, distant-core separation 99.51% vs 91.04% (false merges 0.49% vs 8.96%), identity continuity 98.53% vs 98.70%, merge-link continuity 98.48% vs 98.25%, and anchor proximity 99.92% vs 99.80%. Only 3 of 3,959 selected-profile anchors and 2 of 996 baseline anchors fell more than 12 pixels from their polygon outline. A 50-pixel cutoff raises core coverage to 46.53% and the composite to 85.76, but produces 326 identities and 5,839 frame polygons versus 152 and 2,414 for the selected profile, while continuity falls to 96.73%; the higher cutoff was retained to avoid that fragmentation. The score is the unweighted mean of coverage, separation, continuity, and anchor proximity; it is a reproducible tuning summary, not a meteorological skill score. Inspect the montage as well as these metrics.

## Inputs and attribution

The project bundles the 48 half-hourly IMERG snapshots and NASA SVS 4285's reference MP4 in `data/nasa-svs/4285/`. The source page is [NASA Scientific Visualization Studio: IMERG](https://svs.gsfc.nasa.gov/4285/).
