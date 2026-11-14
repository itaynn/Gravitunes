# Flow tracers

**Status:** idea. Needs [Flow analysis](flow-analysis.md).

## What you hear
On load, a few dozen tracer points are scattered evenly over the whole map. Play the animation and each tracer drifts with the flow, singing as it goes — you hear plumes and storms carry sound across the stereo field.

## Mapping
- Seeding: evenly spread, not clustered (blue-noise / Poisson-disk sampling); a "re-scatter" button; count slider (default ~30).
- Each tracer is a sustained voice, advected by the flow field each frame.
- Pitch: the data value under the tracer (scale-quantized, ≈C2–C5). Pan: longitude. Brightness or tremolo: tracer speed. Loudness: value.
- Timbre: from the world-orchestra region it is passing through (changes as it travels), with a dropdown for alternatives (single voice, by speed).
- Tracers leaving the data area or fading below a value go quiet; optional respawn.
- Visual: flow shown as drifting particles or arrows (toggle); tracers drawn larger with short trails.
- Hover or arrow keys: hear local flow (speed → note rate, direction → pan glide) and announce "moving north-east, 30 km/h".

## Build as a demo
- Mode folder: `app/modes/flow-tracers/`
- Dataset: precipitation 4285 first.
