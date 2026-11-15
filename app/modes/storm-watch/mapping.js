// Storm watch sound mapping: pure logic (no DOM), tested by test.mjs.
// Location always picks the instrument (world-orchestra region) and the pan. Each sound property (pitch,
// volume, tempo) takes its value from one storm property (size, latitude, rain intensity, speed) or nothing,
// chosen in the More menus. Defaults: volume <- size, pitch and tempo fixed.
import { noteHz, snapToScale } from '../../core/scales.js';

export const PITCH_LOW = -12, PITCH_HIGH = 28;   // semitones from C4: C3..E6
export const SOURCES = ['nothing', 'size', 'latitude', 'rain', 'speed'];
export const TARGETS = ['pitch', 'volume', 'tempo'];
export const DEFAULT_MAP = { pitch: 'nothing', volume: 'size', tempo: 'nothing' };

const clamp01 = (x) => Math.max(0, Math.min(1, x));
// Rank 0..1 of `v` among `values` (1 = largest, ties share the middle); null when v is unknown.
export function orderRank(v, values) {
  if (v == null) return null;
  const known = values.filter((x) => x != null);
  if (known.length < 2) return 1;
  const below = known.filter((x) => x < v).length, equal = known.filter((x) => x === v).length;
  return (below + (equal - 1) / 2) / (known.length - 1);
}
// 0..1 per property for storm `c` among this frame's `comps`. props(c) gives { lat, rain, speed } (rain and
// speed may be null). Size, rain and speed are ranks within the frame; latitude: 60S = 0 .. 60N = 1.
export function ranks(c, comps, props) {
  const all = comps.map(props), me = props(c);
  return {
    size: orderRank(c.area, comps.map((x) => x.area)),
    latitude: clamp01((me.lat + 60) / 120),
    rain: orderRank(me.rain, all.map((p) => p.rain)),
    speed: orderRank(me.speed, all.map((p) => p.speed)),
  };
}
// Rank of the source chosen for `target`, or null for nothing (or an unknown value).
export const targetRank = (r, map, target) => (map[target] && map[target] !== 'nothing' ? r[map[target]] ?? null : null);
// Tempo: seconds between repeated notes, 0.5 s (slow) .. 0.15 s (fast); null = a single note.
export const noteGap = (rank) => (rank == null ? null : 0.5 - 0.35 * clamp01(rank));
// Note frequency (snapped to `tones`, within C3..E6), amplitude and repeat gap. Unmapped pitch sits
// mid-range (about E4); unmapped volume is a steady medium level; unmapped tempo plays a single note.
export function stormNote(r, map, tones) {
  const p = targetRank(r, map, 'pitch'), v = targetRank(r, map, 'volume');
  const semis = PITCH_LOW + (PITCH_HIGH - PITCH_LOW) * (p ?? 0.4);
  const lo = noteHz(PITCH_LOW), hi = noteHz(PITCH_HIGH);
  const freq = Math.max(lo, Math.min(hi, snapToScale(noteHz(semis), tones)));
  return { freq, amp: 0.25 + 0.5 * (v ?? 0.5), gap: noteGap(targetRank(r, map, 'tempo')) };
}
// Start times (s) of the notes within `window` seconds: one note, or one every `gap`.
export function noteTimes(gap, window) {
  if (gap == null) return [0];
  const out = [];
  for (let t = 0; t < window - 1e-9; t += gap) out.push(t);
  return out.length ? out : [0];
}
export const panOf = (lon) => Math.max(-1, Math.min(1, lon / 180));
// Distance in km between two lat/lon points (equirectangular; fine for half-hour moves).
export function kmBetween(a, b) {
  let dLon = Math.abs(a.lon - b.lon);
  if (dLon > 180) dLon = 360 - dLon;
  const x = dLon * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180), y = a.lat - b.lat;
  return 111.2 * Math.hypot(x, y);
}

// "hsl(H S% L%)" -> {r,g,b,css} for the storm outline drawer.
export function cssToRgb(css) {
  const m = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(css);
  if (!m) return { r: 200, g: 200, b: 200, css };
  const h = +m[1], s = m[2] / 100, l = m[3] / 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return { r: f(0), g: f(8), b: f(4), css };
}
