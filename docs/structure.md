# Structure

- `data-tools/`: download NASA SVS datasets; load frames as arrays; base maps
- `analysis/`: Python computer vision; `scripts/<mode>/` writes into `app/modes/<mode>/data/`
- `sound-engine/`: all sound synthesis (JS); Python drives it with JSON scores
- `app/`: browser front end; `core/` is shared, `modes/<name>/` holds one idea each
- `data/`: local downloads (git-ignored); `data/derived/<id>/...` holds analysis outputs
- `dist/`: generated standalone demos, one offline HTML file each (`python3 app/tools/build-standalone.py`; git-ignored)

Flow: data-tools → analysis → app → sound-engine.

## Building a new demo from the shared tools

1. **Analysis (Python, offline): `analysis/gravitunes_analysis/`.**
   - `sources.load_dataset(id)` gives a dataset as a (T, H, W) array of 0..1 values.
   - `flow.py` has optical flow (`compute_flow`, and `farneback_gray` for plain images), vorticity and divergence, and Okubo–Weiss vortices. `tracking.py` follows those vortices over time. CLI: `analysis/scripts/flow/run.py`, output in `data/derived/<id>/flow/`.
   - `storms.py` (itay's) finds and tracks storms. It finds storm cores, splits rain areas with watershed, matches them across frames with optical flow, and records which storms merge and split. CLI: `gravitunes-storms --dataset 4285 [--mode <mode>]`. Output goes to `data/derived/<id>/storms/tracks.json`. With `--mode` it is also copied to `app/modes/<mode>/data/<id>/storms.json`, together with the field grid. `storm_benchmark.py` compares tracker variants.
   - `mode_export.export_mode(...)` copies flow layers and vortices, plus a small field grid, into a mode's `data/<id>/`.
2. **Ship the data with the mode.** Put files in `app/modes/<mode>/data/<id>/` and set `"datasetDirs": {"<id>": "data/<id>/"}` in `mode.json`. The host then loads that copy, and the standalone build bundles the whole folder. Keep each mode's files small enough for its standalone page to stay under 10 MB.
3. **Browser (`app/core/`), used from `main.js`:**
   - The host gives you `ctx`: dataset, viewer overlays, time, input as lat/lon, panel, describe, and sound.
   - The panel helpers are `scale-control.js` (the shared Scale menu) and `ui.js` (volume, hints, throttle).
   - `scales.js` has notes and frequencies. Keep notes within C2–C5; the sound core already caps fundamentals at C5 and overtones at 5 kHz.
   - `flow.js` loads and draws the flow layers. `geo.js` turns places into text and picks regional voices.
   - `storms.js` covers storm tracks:
     - `loadStormTracks`, and grid ↔ lat/lon conversion;
     - `stormAt`, `stepStorm`, and `familyParts` (merge and split families);
     - `stormPlace` and `stormSize` (spoken descriptions);
     - `drawStormShape` and `drawCoreMarker`.
   - `imerg.js` covers IMERG colours: colour → rain amount, rain wording, and MIDI scale helpers clamped to C2–C5.
4. **Example:** `app/modes/storm-watch/main.js` loads storm tracks, draws them as a viewer overlay, sonifies them, and adds keys, all in about 150 lines. A demo that hears vortices inside storms could load both `storms.json` and `vortices.json` the same way.

Modes don't import each other: when two modes need the same code, move it into `core/` or `gravitunes_analysis/`. A mode may still be a plain page (`index.html`). itay's `precipitation-ball` and `scanning-line` are plain pages that use `core/imerg.js` and the switcher. storm-watch also keeps his full studio at `studio.html`.
