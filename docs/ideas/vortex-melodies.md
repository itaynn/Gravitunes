# Vortex melodies

**Status:** built (`app/modes/vortex-melodies/`, data via `analysis/scripts/vortex-melodies/build.py`). Needs [Flow analysis](flow-analysis.md).

## What you hear
Every detected vortex (storm, swirl) plays its own short repeating melody. The faster it spins, the faster its melody loops; stronger and larger vortices are louder. Counterclockwise vortices play their motif rising, clockwise ones play it mirrored and falling. A soft background bed swells where air converges and thins where it spreads out.

## Mapping
- Vortices from the tracked vortex list (id, center, radius, spin rate, direction, strength, lifetime).
- Loop tempo: spin rate. Loudness: strength × size. Pan: longitude. Fade in at birth, out at death.
- Spin direction: counterclockwise = ascending motif, clockwise = mirrored descending.
- Melody and timbre — dropdowns, defaults:
  - Timbre: world-orchestra region at the vortex center (alt: by size, by strength, single voice).
  - Melody: from a small motif set by size — big = longer, lower; small = short, higher (alt: by region, by lifetime).
- Divergence bed: soft pad; convergence swells and brightens, divergence thins.
- Layers with mute/solo: vortex melodies, divergence bed, (optional) flow tracers.
- Visual: flow particles or arrows (toggle), vortices drawn as rotating rings sized by radius, colored by direction.
- Hover or arrow keys on a vortex: solo it and announce "Vortex 12, counterclockwise, 1 turn per 6 hours, 400 km wide".

## Build as a demo
- Mode folder: `app/modes/vortex-melodies/`
- Dataset: precipitation 4285 first.
- Open question: how many simultaneous vortices before it's too busy (cap + loudest first).
