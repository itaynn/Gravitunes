# Status

Kept up to date by the main Claude session. Ideas: `docs/ideas/`.

## In main
- App: gallery, core (viewer, timeline, input, panel, sound adapter with frequency caps), dataset picker, Natural Earth basemap
- Modes: explore (former ozone-probe + layered-maps), world-orchestra (with the former timbre-atlas as its Instruments view), mapping-lab, synth-lab, itay's scanning-line, precipitation-ball, storm-watch
- Sound engine (caps, rolloff, lowpass, sample voices, open instrument library; scales, tunings, Scala, live edits, mono/stereo)
- Data tools: ozone (5152), CO (5153), NOx (5154) value grids; log grids in front end
- Flow analysis (analysis/): optical flow, vorticity, vortices + tracking (on 4285)
- Standalone demos: `python3 app/tools/build-standalone.py` → dist/ (git-ignored) 

## Running (agents)
| Agent | Doing |
|---|---|
| Flow tracers + vortex melodies | two demos on 4285 using flow analysis |
| App polish | one consistent app + standalone with demo switcher; tone demo; timbre map |

## Next
1. Fresh critic per demo → fix → new critic, until clean

## Needs Moran
- Listen in Chrome (`python3 app/tools/serve.py` → `/app/`; it supports byte ranges, which video seeking needs — plain `python3 -m http.server` does not) or open `dist/index.html`
- Browser-only checks: `/sound-engine/tests/browser/smoke.html`, `realtime.html`, `playground.html#selftest`
- Clean old worktrees (sandbox blocks it for Claude)
