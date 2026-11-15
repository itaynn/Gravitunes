# Flow analysis (shared by flow-tracers and vortex-melodies)

Apparent motion of a dataset's pattern between frames (Farneback optical flow), its vorticity and divergence,
Okubo–Weiss vortices, and vortex tracks. Code: `analysis/gravitunes_analysis/{flow,tracking,sources}.py`.
Idea doc: `docs/ideas/flow-analysis.md`.

## Run

From the repo root:

```sh
uv venv .venv && uv pip install -p .venv -e analysis pytest
.venv/bin/python analysis/scripts/flow/run.py --dataset 4285            # IMERG PNGs, ~10 s, ~0.7 MB
.venv/bin/python analysis/scripts/flow/run.py --dataset 5152 --count 72 # data-tools web grid (run `gravitunes_data export 5152` first)
.venv/bin/python -m pytest analysis/tests                                # synthetic checks, <1 s
```

Output goes to `data/derived/<id>/flow/` (git-ignored). Copy what a mode needs into `app/modes/<mode>/data/<id>/`.

Inputs (`sources.py`): `data/nasa-svs/4285/imergert_alpha.*.png` (alpha channel = precipitation, the same signal
storm-watch thresholds), or any data-tools grid `data/nasa-svs/<id>/web/<id>_<W>x<H>.json + .bin`.
`--data-dir` or `$GRAVITUNES_DATA_DIR` points at another `data/` folder.

Useful options: `--width` (analysis grid, default 1024 for PNGs / 512 for grids), `--coarse 64x32 128x64`,
`--temporal` (average ±N frame pairs, default 2), `--flow-sigma` (flow smoothing px at 1024 wide, default 8),
`--k` (Okubo–Weiss threshold, default 0.4), `--min-area-km2` (default 20000), `--min-lifetime-frames` (default 2),
`--start/--count/--every` (grid datasets), `--diagnostics N`.

## Output format (the contract for the front end)

All grids are equirectangular, row 0 = north edge (90°N), column 0 = west edge (180°W), one entry per input frame.

### `flow.json` (header)

```jsonc
{
  "format": "gravitunes-flow", "version": 1, "dataset": "4285",
  "times": ["2026-11-07T00:00:00Z", ...], "frames": 48, "dt_hours": 0.5,
  "grid": {"projection": "equirectangular", "lon_west": -180, "lon_east": 180, "lat_north": 90, "lat_south": -90},
  "analysis_size": [1024, 512],
  "layers": {
    "flow_64x32":       {"file": "flow_64x32.bin", "dims": [64, 32], "dtype": "int8", "layout": "t,c,y,x",
                         "components": ["u", "v"], "nodata": -128, "scale": 0.53, "units": "km/h"},
    "vorticity_64x32":  {"file": "vorticity_64x32.bin",  "dims": [64, 32], "dtype": "int8", "layout": "t,y,x",
                         "nodata": -128, "scale": 0.0012, "units": "1/h"},
    "divergence_64x32": {... same as vorticity ...}
  },
  "params": {...}, "vortices": "vortices.json", "caveat": "..."
}
```

Decoding a `.bin`: `Int8Array`; value = `byte * scale`; `-128` = no data (no rain / no signal there).
Flow index: `((t * 2 + c) * H + y) * W + x`, `c = 0` is u (km/h toward east), `c = 1` is v (km/h toward north).
Vorticity/divergence index: `(t * H + y) * W + x`.
Vorticity > 0 is counterclockwise on a north-up map (cyclonic in the north, anticyclonic in the south).
Divergence > 0 means spreading out, < 0 converging. Each `--coarse` size adds its own three layers.

To advect a tracer at (lon, lat): `lon += u * dt / (111.32 * cos(lat))`, `lat += v * dt / 111.32` (dt in hours).

### `vortices.json`

```jsonc
{
  "dataset": "4285", "times": [...], "dt_hours": 0.5,
  "frames": [ {"t": 0, "time": "...", "vortices": [
      {"id": 4, "lat": 38.3, "lon": -30.9, "x": 0.414, "y": 0.287,   // x, y: 0..1 from the NW corner
       "radius_km": 540, "area_km2": 915000,                          // equivalent-circle radius
       "spin_turns_per_hour": 0.011, "period_hours": 88,              // solid-body: vorticity / 4π
       "direction": "ccw", "cyclonic": true,                          // cyclonic = ccw north / cw south
       "vorticity_per_h": 0.14, "circulation_km2_per_h": 128000,     // signed, + = ccw; |circulation| = strength
       "u_kmh": 22.1, "v_kmh": 3.0,                                   // drift of the vortex region
       "intensity": 0.31}                                             // mean field value 0..1 inside
  ]}, ...],
  "tracks": [ {"id": 4, "birth": 0, "death": 47, "frames": 48, "lifetime_hours": 24,
               "direction": "ccw", "cyclonic": true, "max_radius_km": 628,
               "mean_spin_turns_per_hour": 0.0114, "max_abs_circulation_km2_per_h": ...,
               "points": [{"t": 0, "lat": ..., "lon": ..., "radius_km": ..., "spin_turns_per_hour": ...,
                           "circulation_km2_per_h": ...}, ...]} ]
}
```

`birth`/`death` are frame indices. A track can skip up to `--memory-frames` frames (2) without ending.
Ids are the same in `frames[*].vortices` and `tracks`. Tracks shorter than `--min-lifetime-frames` are removed from both.

### `diagnostics/`

`flow_tNNN.png` (field + flow arrows + vortex circles, green = ccw, magenta = cw) and `vorticity_tNNN.png`
(red = ccw, blue = cw). For checking, not for the app.

## Method

1. Scalar field 0..1 → Gaussian blur → 8-bit; Farneback (`winsize` 21, 4 levels, Gaussian window) on each consecutive
   pair, with wrap-around padding at the date line. Flow for frame t averages the pairs t−2…t+1.
2. Flow kept only where the field has signal (dilated `field ≥ 0.06`), smoothed by normalized convolution.
3. u = dx·(km/px)·cos(lat), v = −dy·(km/px), per hour. Vorticity = ∂v/∂x − ∂u/∂y + u·tan(lat)/R,
   divergence = ∂u/∂x + ∂v/∂y − v·tan(lat)/R. Rows beyond ±80° are dropped.
4. Okubo–Weiss W = s_n² + s_s² − ω²; vortex cells are W < −k·std(W) (std over the whole sequence), split by
   vorticity sign, connected regions ≥ `min-area-km2`.
5. Tracking (`tracking.py`, after storm-watch's flow association): advect each live track by its drift, then
   Hungarian matching on advected great-circle distance (gate max(600 km, 1.5·radius)) minus mask overlap (IoU of
   the flow-shifted previous mask); spin direction must match; up to 2 missed frames.

## Caveats

- This is the **apparent motion of the picture**, not wind. Rain bands that grow or decay look like motion.
- Spin rates are low compared with real cyclone vorticity (median period ~90 h on 4285): spatial and temporal
  smoothing averages the rotation down. Treat them as relative ("faster / slower"), not physical.
- 5152 ozone: flow is smooth and global, but vortex directions are ~50 % cyclonic (essentially random), so ozone
  vortices are mostly noise; the daily sunlight cycle also creates fake motion. Use 4285 for vortex demos.

## Per-dataset settings

`gravitunes_analysis/profiles.py` holds the stride, analysis width and vortex thresholds per dataset; `mode_export.export_mode`
uses them (flow-tracers and vortex-melodies build all four: `build.py --dataset 4285 5152 5153 5154 --data-dir <data>`).
Gases run every 6 h (66 frames over 16.5 days) with stricter Okubo-Weiss thresholds (ozone k 1.0 / 300 000 km2,
CO and NOx k 0.6 / 100 000 km2) so each has about 7-13 tracked vortices per frame (rain: about 19).
