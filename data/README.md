# data: NASA downloads and derived files

- `nasa-svs/<svs-id>/`: frames, color bars, grids and `manifest.json` (made by `data-tools`)
- `earth/`: base maps, coastlines, borders, cities, musical regions and instruments

Most of `data/` is git-ignored and recreated with `data-tools` (see the top-level README).
Committed: this README, `earth/*.json` (small, hand-made or simplified layers) and the
prepared IMERG demo set in `nasa-svs/4285/` (the storm and flow demos need its exact frames).
Check `git ls-files data` for the current list.
