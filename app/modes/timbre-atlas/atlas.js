// Timbre atlas: pure logic (no DOM), tested by test.mjs. Gestures and region lookup live in app/core/.
export { voiceAt, distKm } from '../../core/geo.js';
export { gestureNotes, gestureLength, degreeCents, liftToFloor } from '../../core/gestures.js';

// A compact fingerprint of a voice's sound, for checking that instruments differ.
export function timbreSignature(v) {
  const r = (x) => Math.round(x * 100) / 100;
  return JSON.stringify([(v.harmonics || []).map(r), (v.partials || []).map((p) => [r(p.ratio), r(p.amp), r(p.decay ?? 0)]),
    v.envelope && ['attack', 'decay', 'sustain', 'release'].map((k) => r(v.envelope[k] ?? 0)), v.noise?.amount]);
}
