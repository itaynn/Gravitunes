// Storm watch sound mapping: pure logic (no DOM), tested by test.mjs.
// Location always picks the instrument (world-orchestra region) and the pan. Each sound property (pitch,
// volume, tempo) takes its value from one storm property (size, latitude, rain intensity, speed) or nothing,
// chosen in the More menus. Each storm loops a short tune. Defaults: volume <- size, tempo <- speed, notes <- size, pitch fixed.
import { noteHz } from '../../core/scales.js';

export const PITCH_LOW = -12, PITCH_HIGH = 28;   // semitones from C4: C3..E6
export const SOURCES = ['nothing', 'size', 'latitude', 'rain', 'speed'];
export const TARGETS = ['pitch', 'volume', 'tempo', 'notes'];
export const DEFAULT_MAP = { pitch: 'nothing', volume: 'size', tempo: 'speed', notes: 'size' };

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
// Notes per tune: 3..8 (higher rank = more); nothing = 5.
export const NOTES_MIN = 3, NOTES_MAX = 8, NOTES_FIXED = 5;
export const noteCount = (rank) => (rank == null ? NOTES_FIXED : Math.round(NOTES_MIN + (NOTES_MAX - NOTES_MIN) * clamp01(rank)));
// Tune of n notes as scale steps: a rising zig-zag, prefix of 0 2 1 3 2 4 3 5.
const ZIGZAG = [0, 2, 1, 3, 2, 4, 3, 5];
export const tuneSteps = (n) => ZIGZAG.slice(0, Math.max(1, Math.min(ZIGZAG.length, n)));
// Tempo: seconds per tune loop, 3.6 s (slow) .. 1.4 s (fast); unknown/nothing = middle.
export const loopSeconds = (rank) => 3.6 - 2.2 * clamp01(rank ?? 0.5);
// Tune root (semitones from C4) from pitch rank: C3 (low) .. G5 (high), so the tune's top stays under E6; nothing = about E4.
export const tuneRoot = (rank) => Math.round(PITCH_LOW + 31 * clamp01(rank ?? 0.5));
// A storm's tune: root, notes, loudness and loop length under `map`.
export function stormTune(r, map) {
  const v = targetRank(r, map, 'volume');
  return { root: tuneRoot(targetRank(r, map, 'pitch')), n: noteCount(targetRank(r, map, 'notes')),
    amp: 0.3 + 0.7 * (v ?? 0.6), loop: loopSeconds(targetRank(r, map, 'tempo')) };
}
// Frequency of step `step` above the first scale tone at/above rootHz, within `tones` (C3..E6).
export function tuneFreq(tones, rootHz, step) {
  const i = Math.max(0, tones.findIndex((f) => f >= rootHz * 0.999));
  return tones[Math.max(0, Math.min(tones.length - 1, i + step))];
}
// Notes due in (from, to] seconds for a loop of n notes with origin t0: [{k, at}].
export function dueNotes(n, loop, t0, from, to) {
  const step = loop / n, out = [];
  for (let k = Math.ceil((from - t0) / step + 1e-9); t0 + k * step <= to; k++) out.push({ k: ((k % n) + n) % n, at: t0 + k * step });
  return out;
}
// Mix: the `max` loudest storms play, each scaled so the sum stays even (1/sqrt(count)); the rest are silent.
export function mixGains(amps, max = 8) {
  const order = amps.map((a, i) => i).sort((i, j) => amps[j] - amps[i] || i - j).slice(0, max);
  const k = order.length ? 1.4 / Math.sqrt(order.length) : 0, out = amps.map(() => 0);
  for (const i of order) out[i] = Math.min(1, k) * amps[i];
  return out;
}
// Tune-progress dot: loop position u (notes since origin) -> fraction of a turn; rests on note k's tick as it sounds.
export function markTurn(u, n) {
  const k = Math.floor(u), f = u - k, e = f * f * (3 - 2 * f);
  return ((((k + e) / n) % 1) + 1) % 1;
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
