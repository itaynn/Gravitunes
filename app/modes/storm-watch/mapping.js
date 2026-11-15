// Storm watch sound mapping: pure logic (no DOM), tested by test.mjs.
// Location always picks the instrument (world-orchestra region) and the pan; size and latitude can each
// drive pitch or volume (More menus). Defaults: size -> volume, latitude -> nothing.
import { noteHz, snapToScale } from '../../core/scales.js';

export const PITCH_LOW = -12, PITCH_HIGH = 28;   // semitones from C4: C3..E6
export const DEFAULT_MAP = { size: 'volume', latitude: 'nothing' };

const clamp01 = (x) => Math.max(0, Math.min(1, x));
// 0..1 per property: size = rank among this frame's storms (1 = largest); latitude: 60S = 0 .. 60N = 1.
export function ranks(c, comps, lat) {
  const n = comps.length, i = comps.indexOf(c);
  return { size: n > 1 && i >= 0 ? 1 - i / (n - 1) : 1, latitude: clamp01((lat + 60) / 120) };
}
// Average rank of the properties mapped to `target`, or null when none is.
export function targetRank(r, map, target) {
  const xs = Object.keys(map).filter((k) => map[k] === target && r[k] != null).map((k) => r[k]);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
// Note frequency (snapped to `tones`, within C3..E6) and amplitude. Unmapped pitch sits mid-range (about E4);
// unmapped volume is a steady medium level.
export function stormNote(r, map, tones) {
  const p = targetRank(r, map, 'pitch'), v = targetRank(r, map, 'volume');
  const semis = PITCH_LOW + (PITCH_HIGH - PITCH_LOW) * (p ?? 0.4);
  const lo = noteHz(PITCH_LOW), hi = noteHz(PITCH_HIGH);
  const freq = Math.max(lo, Math.min(hi, snapToScale(noteHz(semis), tones)));
  return { freq, amp: 0.25 + 0.5 * (v ?? 0.5) };
}
export const panOf = (lon) => Math.max(-1, Math.min(1, lon / 180));

// "hsl(H S% L%)" -> {r,g,b,css} for the storm outline drawer.
export function cssToRgb(css) {
  const m = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(css);
  if (!m) return { r: 200, g: 200, b: 200, css };
  const h = +m[1], s = m[2] / 100, l = m[3] / 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return { r: f(0), g: f(8), b: f(4), css };
}
