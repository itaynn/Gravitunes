// Flow tracers: pure logic (no DOM), tested by test.mjs.
import { flowAt, advect } from '../../core/flow.js';

// Seeded RNG (mulberry32) so a scatter can be reproduced in tests.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rad = (d) => (d * Math.PI) / 180;
export function distKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Even (blue-noise) scatter: best-candidate sampling on the sphere between latMin..latMax.
// Each new point is the farthest of k uniform-area candidates from the points already placed.
// accept(lat, lon) can veto candidates (e.g. "has rain"); falls back to any candidate if all are vetoed.
export function scatter(n, { random = Math.random, k = 12, latMax = 70, accept = null, avoid = [] } = {}) {
  const pts = [];
  const zMax = Math.sin(rad(latMax));
  const cand = () => ({ lat: (Math.asin((random() * 2 - 1) * zMax) * 180) / Math.PI, lon: random() * 360 - 180 });
  const all = () => [...avoid, ...pts];
  for (let i = 0; i < n; i++) {
    let best = null, bestD = -1;
    for (let tries = 0; tries < k * 4 && (best == null || tries < k); tries++) {
      const c = cand();
      if (accept && !accept(c.lat, c.lon) && tries < k * 4 - 1) continue;
      const d = all().reduce((m, p) => Math.min(m, distKm(c.lat, c.lon, p.lat, p.lon)), Infinity);
      if (d > bestD) { bestD = d; best = c; }
    }
    pts.push(best || cand());
  }
  return pts;
}

// One tracer step: move with the flow for dtH hours (in `sub` substeps). A tracer with no flow under it stays.
// Returns the new tracer object with speed (km/h), u, v and `quiet` frame count updated.
export function stepTracer(tr, flow, t, dtH, { sub = 4, value = null, minValue = 0.06 } = {}) {
  let { lat, lon } = tr, u = 0, v = 0, moved = false;
  for (let i = 0; i < sub; i++) {
    const f = flowAt(flow, lat, lon, t);
    if (!f) break;
    ({ lat, lon } = advect(lat, lon, f.u, f.v, dtH / sub));
    u = f.u; v = f.v; moved = true;
  }
  const val = value ? value(lat, lon) : null;
  const silent = val == null || val < minValue;
  return { ...tr, lat, lon, u, v, speed: moved ? Math.hypot(u, v) : 0, value: val,
    quiet: silent ? (tr.quiet || 0) + 1 : 0,
    trail: [...(tr.trail || []), { lat: tr.lat, lon: tr.lon }].slice(-8) };
}

// Which tracers sound this frame: audible ones (value >= minValue), loudest first, at most maxVoices.
export function pickVoices(tracers, maxVoices, minValue = 0.06) {
  return tracers.map((tr, i) => ({ i, v: tr.value }))
    .filter((x) => x.v != null && x.v >= minValue)
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .slice(0, Math.max(0, maxVoices))
    .map((x) => x.i);
}

// Speed (km/h) -> 0..1 brightness, relative to a typical top speed. Used for lowpass cutoff.
export const speedBrightness = (kmh, top = 60) => Math.max(0, Math.min(1, kmh / top));

// Hover: speed -> notes per second (1..6), and the pan glide from the point along the motion.
export function hoverGesture(u, v, lon, top = 60) {
  const s = Math.hypot(u, v);
  const rate = 1 + 5 * Math.max(0, Math.min(1, s / top));
  const p0 = lon / 180, dir = s > 0 ? u / s : 0;
  const p1 = Math.max(-1, Math.min(1, p0 + 0.5 * dir));
  return { rate, notes: Math.max(2, Math.round(rate)), pan0: p0, pan1: p1 };
}
