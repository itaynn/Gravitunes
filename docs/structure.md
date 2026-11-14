# Structure

- `data-tools/`: download NASA SVS datasets; load frames as arrays; base maps
- `analysis/`: Python computer vision; `scripts/<mode>/` writes into `app/modes/<mode>/data/`
- `sound-engine/`: all sound synthesis (JS); Python drives it with JSON scores
- `app/`: browser front end; `core/` is shared, `modes/<name>/` holds one idea each
- `data/`: local downloads (git-ignored)
- `dist/`: generated standalone demos, one offline HTML file each (`python3 app/tools/build-standalone.py`; git-ignored)

Flow: data-tools → analysis → app → sound-engine.
