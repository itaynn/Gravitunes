# Status

Kept up to date by the main Claude session. Ideas: `docs/ideas/`.

## In main
- App: gallery, core (viewer, timeline, input, panel, sound adapter with frequency caps), dataset picker
- Modes: ozone-probe, world-orchestra, mapping-lab, synth-lab, itay's scanning-line, precipitation-ball, storm-watch
- Sound engine (scales, tunings, Scala, voices, live edits, mono/stereo)
- Data tools: ozone (5152), CO (5153), NOx (5154) value grids

## Running (agents)
| Agent | Doing |
|---|---|
| Flow analysis | optical flow → vorticity/divergence → vortices + tracking, on precipitation 4285 |
| Sound library + engine | library manifest/fetch/analysis → presets; engine: rolloff, 5 kHz cap, per-note low-pass, C3 pads, glide fix, live bridge test, gamelan cents |
| Log grids + picker | front end reads NOx log grids; picker lists ozone, CO, NOx |

## Next
1. Flow tracers demo, then vortex melodies demo (after flow analysis)
2. Layered maps (hear several gases together)
3. Shareable demo file ("Download this demo")
4. Natural Earth basemap in `data/earth/`

## Needs Moran
- Listen in Chrome (`python3 -m http.server 8000` → `/app/`) and give feedback
- Browser-only checks: `/sound-engine/tests/browser/smoke.html`, `realtime.html`, `playground.html#selftest`
- Clean old worktrees (sandbox blocks it for Claude)
