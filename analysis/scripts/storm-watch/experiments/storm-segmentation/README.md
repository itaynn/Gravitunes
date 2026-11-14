# Storm segmentation experiment

This isolated experiment compares three ways of separating precipitation regions in the 48 half-hourly IMERG snapshots:

- **Connected components**: OpenCV connected-component labeling on the precipitation alpha mask.
- **Core watershed**: the existing core-seeded watershed segmentation in `analysis/scripts/storm-watch/preprocess.py`.
- **K-means**: OpenCV unsupervised k-means clustering of each multi-core region's spatial and RGB features, initialized from separated dark red/blue core detections.

Each method uses the same Farneback optical-flow tracker. The primary metrics are (1) how often distant same-color core pairs remain in separate regions and (2) the component match rate between adjacent frames. The selection score prioritizes separation (70%) over component match rate (30%); optical-flow-linked core lineage continuity is also reported as a stricter diagnostic. Regions above the configurable 5,000-pixel area threshold and large regions containing multiple detected cores are counted separately.

These are image-derived diagnostics, **not meteorological ground truth**. Colored peaks are only core proxies; alpha segmentation, local maxima, and optical flow can misidentify or miss real storms. Review `artifacts/comparison.png` along with the numerical metrics before treating the selected method as preferable.

## Run

From the repository root, install the parent tracker dependencies if needed:

```sh
python3 -m pip install -r analysis/scripts/storm-watch/requirements.txt
python analysis/scripts/storm-watch/experiments/storm-segmentation/compare.py
```

Generated artifacts are:

- `artifacts/comparison.png`: five timestamps side by side for each segmentation method; colors encode tracked IDs.
- `artifacts/comparison.json`: settings, aggregate metrics, and the per-method selection.
- `artifacts/timeseries.csv`: frame-by-frame segment, merge/split, and cluster-size diagnostics.

Use `--output-dir`, `--minimum-area`, `--maximum-motion`, or `--large-cluster-area` to customize the run. The defaults analyze at 900 pixels wide and do not modify the existing browser track artifact.
