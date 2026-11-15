# data: NASA downloads, deployment grids, and reference layers

- `nasa-svs/<svs-id>/`: source frames and movies, exported browser grids under `web/`, and manifests
- `earth/`: base maps, coastlines, borders, cities, musical regions and instruments

Most source downloads and intermediate grids are git-ignored and can be recreated with `data-tools`.
Committed assets include `earth/*.json`, the prepared IMERG demo set in `nasa-svs/4285/`, and compact
browser-grid exports for datasets used by the static app. Check `git ls-files data` for the current list.
Add the source and attribution to the relevant catalog entry when adding a dataset.
