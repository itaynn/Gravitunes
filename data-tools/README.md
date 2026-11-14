# data-tools: NASA SVS visualizations → NumPy values

```bash
uv venv .venv && uv pip install -p .venv -e data-tools/python
.venv/bin/gravitunes_data build 5152            # ~22 MB MP4 + 24 PNG frames -> decoded ozone grids
.venv/bin/python -c "from gravitunes_data import load; ds = load('5152'); print(ds.values.shape, ds.units)"
.venv/bin/gravitunes_data export 5152           # browser grids -> data/nasa-svs/5152/web/
```

## Python API

```python
from gravitunes_data import load
ds = load("5152", size=(256, 128), every=1)   # builds on first use if missing
ds.values        # float32 (T, H, W), ppbv, NaN = no data (logo/date boxes)
ds.times         # UTC datetimes, hourly
ds.lat, ds.lon   # cell centres; row 0 = north, col 0 = 180°W
ds.value_at(34.05, -118.25, t=0)              # Los Angeles, first hour
for t, grid in ds.iter(): ...
ds.to_npz("ozone.npz")
```

Sizes built by default: 512x256 and 256x128 (add `--size 128x64` etc.).

## CLI

| command | what it does |
|---|---|
| `gravitunes_data list <id>` | title, credits, movies, frame folders, color bars (SVS JSON API) |
| `gravitunes_data size <id> [--every N]` | download size estimate vs free disk, without downloading |
| `gravitunes_data build <id> [--size WxH ...] [--no-png]` | download sources and decode value grids (`.npz`) |
| `gravitunes_data export <id> [--size WxH ...]` | write `<id>_<W>x<H>.bin` + `.json` to `data/nasa-svs/<id>/web/` |

Browser grid format: `.bin` is uint8, `T*H*W`, layout `t,y,x` (y=0 is 90°N, x=0 is 180°W), 255 = no data,
value = `offset + byte * scale` (from the `.json` header, which also has `times`, `units`, `credits`).

## Dataset descriptors

`data-tools/datasets/<id>.json` lets the browser use a dataset without Python. Each one records units, range,
start time and step, frame sources, color bar position and stops, the opacity curve, and overlay boxes.
So far only `5152.json` (near-surface ozone) exists; 5153 (CO) and 5154 (NOx) share the same layout.

## How the decoding works (5152 / GEOS-CF style)

Each frame pixel is `a(v)·colorbar(v) + (1−a(v))·B`, where `B` is a fixed greyscale Earth (black ocean, white ice,
grey land) under the data, and the opacity `a(v)` rises from 0 at 5 ppbv to 1 at ~32.5 ppbv (measured from the frames).
That is why low-ozone ocean looks black and low-ozone Antarctica looks white. `build` fits `B` per pixel from 24
frames, then picks the value whose blended color best matches each pixel. Black coastlines and the logo and date boxes
are masked out. Debug outputs: `data/nasa-svs/<id>/background.png` and `overlay_mask.png`.

Accuracy for 5152: redrawing a frame from the decoded numbers matches the original to a median of ~1.3 RGB levels.
MP4-decoded values agree with PNG-decoded values to ~0.4 ppbv mean at 512×256. Values below ~18 ppbv are drawn
nearly transparent and are rough. **These are approximations from visualization colors, not raw science data.**

Gotchas found:
- The 5152 MP4 starts **24 h after** the PNG frames. `build` fills hours 0–23 from PNG frames 1–24.
- The color bar image has a white border pixel at its right end. Sample x 71–462 on row 60, not up to 464.
- SVS folders: `vis/a0X0000/a0XXX00/a0XXXXX/` (ten-thousands, then hundreds), e.g. 5152 → `a000000/a005100/a005152`.

## Data location

Everything downloaded goes to `data/nasa-svs/<id>/` (git-ignored). Override with `GRAVITUNES_DATA_DIR`.

## Raw science data (not implemented)

GEOS-CF output is on the NASA GMAO / NCCS portal (no login). IMERG precipitation for 4285 is at NASA GES DISC
(free Earthdata login). Use these instead when exact values matter.

## Attribution

Credit NASA's Scientific Visualization Studio and the people in each descriptor's or header's `credits`.
For 5152: visualizer Joseph V. Ardizzone (NASA/GSFC), data NASA GMAO GEOS-CF.

## Tests

`.venv/bin/python -m unittest discover -s data-tools/python/tests` (offline, ~1.5 min because of the color lookup tables).
