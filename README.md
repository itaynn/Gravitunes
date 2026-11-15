# Gravitunes

NASA Space Apps 2026 "Earth Information Jukebox": NASA Earth visualizations turned into sound, usable by blind and
low-vision people. Layout: `docs/structure.md`.

## Build the demos

Needs Python ≥ 3.10, [uv](https://docs.astral.sh/uv/) and `ffmpeg` on `PATH` (it decodes the NASA movies). Node is only
used for the JS tests. Run from the repo root:

```bash
uv venv .venv && uv pip install -p .venv -e data-tools/python        # a few seconds

# Ozone, carbon monoxide, nitrogen oxides from NASA SVS: download frames + movie, decode, export browser grids.
# About 2.5 min and ~210 MB in data/nasa-svs/<id>/ per dataset (~8 min, ~650 MB in total).
for id in 5152 5153 5154; do
  .venv/bin/gravitunes_data build  $id --size 256x128
  .venv/bin/gravitunes_data export $id --size 256x128
done

python3 app/tools/build-standalone.py                                 # ~1 min, 11 demos + index.html, ~55 MB in dist/
```

Nothing else has to be downloaded or computed: the rain data (SVS 4285), base maps (`data/earth/*.json`) and the
flow and storm outputs the rain demos use (`app/modes/*/data/4285/`) are committed. To redo those analysis outputs, see
`analysis/README.md` (`analysis/scripts/flow/run.py`, `gravitunes-storms --dataset 4285 --mode storm-watch`).

Each `dist/<demo>.html` is self-contained and works offline from `file://`; `dist/index.html` (the demo menu) and the
in-demo switcher link to the sibling files, so share the whole folder for the menu.
