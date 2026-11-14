// Timbre atlas: pure logic (no DOM), tested by test.mjs. Gestures and region lookup live in app/core/.
export { voiceAt, distKm } from '../../core/geo.js';
export { gestureNotes, gestureLength, degreeCents } from '../../core/gestures.js';

// A compact fingerprint of a voice's sound, for checking that instruments differ.
export function timbreSignature(v) {
  const r = (x) => Math.round(x * 100) / 100;
  return JSON.stringify([(v.harmonics || []).map(r), (v.partials || []).map((p) => [r(p.ratio), r(p.amp), r(p.decay ?? 0)]),
    v.envelope && ['attack', 'decay', 'sustain', 'release'].map((k) => r(v.envelope[k] ?? 0)), v.noise?.amount]);
}

// Raise gesture notes an octave at a time while the lowest is under floorHz and the highest stays <= ceilHz.
// (core/gestures.js only shifts down to the ceiling.)
export function liftToFloor(notes, floorHz, ceilHz) {
  const top = (n) => Math.max(n.freq, n.glide?.to || 0) * 2 ** ((n.vibrato?.depth || 0) / 1200);
  const lo = () => Math.min(...notes.map((n) => n.freq)), hi = () => Math.max(...notes.map(top));
  while (notes.length && lo() < floorHz && hi() * 2 <= ceilHz + 1e-6)
    for (const n of notes) { n.freq *= 2; if (n.glide) n.glide = { ...n.glide, to: n.glide.to * 2 }; }
  return notes;
}
