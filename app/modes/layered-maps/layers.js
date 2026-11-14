// Layered maps: pure mapping logic (runs in node too). Each gas is a layer with its own voice and register.
import { noteHz, scaleFreqs } from '../../core/scales.js';

// Registers in semitones from C4, all inside C2..C5 and not overlapping. CO low, ozone middle, NOx upper.
export const LAYERS = [
  { id: '5153', name: 'carbon monoxide', low: -24, high: -13,  // C2..B2: soft, round bass
    harmonics: [1, 0.5, 0.3, 0.15], envelope: { attack: 0.04, decay: 0.3, sustain: 0.5, release: 0.3 }, amp: 0.26, delay: 0 },
  { id: '5152', name: 'ozone', low: -12, high: -3,             // C3..A3: warm, flute-like
    harmonics: [1, 0.12, 0.05], envelope: { attack: 0.06, decay: 0.2, sustain: 0.6, release: 0.3 }, amp: 0.22, delay: 0.09 },
  { id: '5154', name: 'nitrogen oxides', low: 0, high: 12,     // C4..C5: plucked, gently bright
    harmonics: [1, 0.4, 0.22, 0.12, 0.06], envelope: { attack: 0.005, decay: 0.25, sustain: 0.15, release: 0.2 },
    lowpass: 2200, amp: 0.18, delay: 0.18 },
];

// 0..1 -> frequency in the layer's register on `scale` (core/scales.js does the quantizing).
export function layerFreq(layer, x, scale = 'pentatonic-major') {
  const fs = scaleFreqs(scale, noteHz(layer.low), noteHz(layer.high));
  if (!fs.length) return noteHz(layer.low);
  return fs[Math.round(Math.max(0, Math.min(1, x ?? 0)) * (fs.length - 1))];
}

// state: { [id]: 'on' | 'mute' | 'solo' } -> Set of audible ids. Any solo wins over everything else.
export function audible(layers, state) {
  const solo = layers.filter((l) => state[l.id] === 'solo');
  return new Set((solo.length ? solo : layers.filter((l) => (state[l.id] || 'on') !== 'mute')).map((l) => l.id));
}

// Frame of a dataset (count frames, timeOf(i) -> Date, sorted) nearest to `date`.
export function frameAtDate(count, timeOf, date) {
  if (!count || !date) return 0;
  let lo = 0, hi = count - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (+timeOf(m) < +date) lo = m + 1; else hi = m; }
  if (lo > 0 && Math.abs(+timeOf(lo - 1) - date) <= Math.abs(+timeOf(lo) - date)) lo--;
  return lo;
}

// readings: [{ layer, value, norm }] -> notes to play (muted and no-data layers skipped).
export function notesFor(readings, state, pan = 0, scale = 'pentatonic-major') {
  const on = audible(readings.map((r) => r.layer), state);
  return readings.filter((r) => r.value != null && on.has(r.layer.id)).map(({ layer, norm }) => ({
    id: layer.id, freq: layerFreq(layer, norm, scale), harmonics: layer.harmonics, envelope: layer.envelope,
    ...(layer.lowpass && { lowpass: layer.lowpass }),
    amp: layer.amp, t: layer.delay, dur: 0.45, pan,
  }));
}

// "ozone 34 ppbv, carbon monoxide 120 ppbv, nitrogen oxides 0.5 ppbv"
export function describeReadings(readings, fmt) {
  return readings.map((r) => `${r.layer.name} ${fmt(r)}`).join(', ');
}
