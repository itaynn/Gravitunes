# Storm watch

By **itay**, brought over from his `clustering` branch (`storm-tracker/`).

Two views of the same offline storm tracks (`data/4285/storms.json`, made by `analysis/gravitunes_analysis/storms.py`):

- `main.js`: the gallery mode, on the shared host (`app/mode.html?mode=storm-watch`). It shows the 4285 field grid in `data/4285/` with storm outlines on top, built from `app/core/storms.js`. Hover, or press N and P on the map, to hear about a storm and hear its note: north sounds higher and bigger storms louder, using the shared Scale menu within C2–C5. Enter or a click follows a storm. When storms merge and split, the whole family stays marked, and a storm that drops below the size cutoff is shown dashed where it is expected. Page Up and Page Down step through time, and Escape stops following.
- `studio.html` + `app.js`: itay's full tracking studio. It plays the full-size snapshots from `data/nasa-svs/4285/` and has tracker tuning sliders. If the track file is missing or a setting changes, it reanalyses the frames in the browser. It also uses `app/core/storms.js` for drawing, hit tests and descriptions.

## Run

From the repo root: `python3 -m http.server 8000`, then open http://localhost:8000/app/mode.html?mode=storm-watch (or `app/modes/storm-watch/studio.html`).

## Rebuild the tracks

From the repo root, with the analysis package installed (`analysis/README.md`):

```sh
gravitunes-storms --dataset 4285 --mode storm-watch   # writes data/derived/4285/storms/tracks.json, copies it here with the field grid
```

The benchmark, diagnostics and segmentation experiments are described in `analysis/scripts/storm-watch/README.md`.

Source: [NASA SVS 4285, IMERG](https://svs.gsfc.nasa.gov/4285/). Visualizations by Horace Mitchell (NASA/GSFC).
