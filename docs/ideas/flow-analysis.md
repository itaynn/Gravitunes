# Flow analysis (shared building block)

**Status:** idea. Used by [Flow tracers](flow-tracers.md) and [Vortex melodies](vortex-melodies.md).

Offline Python in `analysis/gravitunes_analysis/flow.py` (+ `scripts/flow/run.py --dataset <id>`), for any dataset with a value grid:
1. Optical flow between consecutive frames (Farneback, as in itay's storm tracker) → velocity field (u, v) per point.
2. Vorticity (curl) and divergence; longitude distances scaled by cos(latitude).
3. Vortices: Okubo–Weiss criterion (rotation dominates strain) → connected regions, minimum size, smoothing.
4. Vortex tracking across frames: id, center, radius, spin rate, spin direction, strength, lifetime (reuse storm-tracker matching).
5. Output, small enough for the browser: per-frame coarse flow field (~64×32), vorticity/divergence grids, vortex tracks JSON.

First dataset: precipitation 4285 (storms visibly move and spin). Later: compare with real NASA winds (GEOS) as a truth check.

Caveat: flow measures apparent pattern motion, not true wind; ozone's daily sunlight cycle creates fake motion.
