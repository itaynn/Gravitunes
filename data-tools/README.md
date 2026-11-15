# data-tools: NASA SVS visualizations → NumPy values

```bash
uv venv .venv && uv pip install -p .venv -e data-tools/python
.venv/bin/gravitunes_data build 5152            # ~22 MB MP4 + 24 PNG frames -> decoded ozone grids
.venv/bin/python -c "from gravitunes_data import load; ds = load('5152'); print(ds.values.shape, ds.units)"
.venv/bin/gravitunes_data export 5152           # browser grids -> data/nasa-svs/5152/web/
```

High-resolution set for the app (run once per dataset after `build ... --size 1024x512 512x256 256x128`):

```bash
.venv/bin/gravitunes_data export-hd 5152   # web/: 256x128 + chunked 1024x512 grids (delta-gzip), SVS frames as WebP
```

It writes, into `data/nasa-svs/<id>/web/`: `frames2048/` + `frames.json` (every hour, original 2048x1024 SVS frames,
WebP q75), `frames1024/` + `frames_1024.json`, `colorbar.png` (the labelled SVS bar), `<id>_256x128.json/.bin(.gz)`
(loaded first), `<id>_1024x512.json` + 24-hour chunks (loaded in the background), and `light/` (256x128, 6-bit) and
`hd/` (512x256) grids for `app/tools/build-standalone.py`. Delta-gzip: per chunk, first frame as is, later frames
as byte differences mod 256, gzipped (the browser unpacks it with `DecompressionStream`).

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
If the header has `"transform": "log10"` (5154 NOx), value = `10 ** (offset + byte * scale)`.

## Dataset descriptors

`data-tools/datasets/<id>.json` lets the browser use a dataset without Python. Each one records units, range,
start time and step, frame sources, color bar position and stops, the opacity curve, and overlay boxes.
Available: `5152.json` (ozone), `5153.json` (carbon monoxide), `5154.json` (nitrogen oxides). A non-linear color bar
has `colorbar.ticks` (`[[x, value], ...]` in color-bar pixels) and `colorbar.scale` (`linear` or `log`, how to
interpolate between ticks); without ticks the bar is linear over `range`.

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
- 5153 and 5154 have the same frame layout and the same 24 h MP4 offset (checked on the date box).

### 5153 (CO) and 5154 (NOx)

- **CO** color bar is not linear: labels 40/100/130/200/500 ppbv are unevenly spaced; values between them are
  interpolated linearly (label positions ±3 px). CO is drawn fully opaque (measured), so the background doesn't matter.
  Re-render error median ~2.2 RGB levels; MP4 vs PNG ~1.0 ppbv mean (0.5 median) at 512×256. Decoded 47–484 ppbv.
- **NOx** color bar is logarithmic, 0.001 to ~22 ppbv (top value extrapolated; decades are not evenly spaced).
  Grids store log10(value). Opacity rises from 0 at ~0.0011 to 1 at ~0.0022 ppbv, so below ~0.002 is just "very low".
  Re-render error median ~3.3 RGB levels; MP4 vs PNG ~0.04 log10 units mean (~9 %) at 512×256. Decoded 0.001–18.8 ppbv;
  the darkest green saturates over the biggest cities (Beijing, Delhi).
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
