// World orchestra: pure logic (no DOM), tested by app/modes/world-orchestra/test.mjs.
// Shared pieces live in app/core/ (geo.js, voices.js, triggers.js) and are re-exported here.
export { blendVoices, shapeForPitch } from '../../core/voices.js';
export { selectTriggers, percentileOf } from '../../core/triggers.js';
export { distKm, nearestCenters, blendWeight, voiceAt } from '../../core/geo.js';
export { gestureNotes, gestureLength, degreeCents, liftToFloor } from '../../core/gestures.js';

// A compact fingerprint of a voice's sound (recording + synthesized timbre + phrase), for checking instruments differ.
export function timbreSignature(v) {
  const r = (x) => Math.round(x * 100) / 100;
  return JSON.stringify([v.sample || null, (v.harmonics || []).map(r), (v.partials || []).map((p) => [r(p.ratio), r(p.amp), r(p.decay ?? 0)]),
    v.envelope && ['attack', 'decay', 'sustain', 'release'].map((k) => r(v.envelope[k] ?? 0)), v.noise?.amount, v.gesture]);
}
