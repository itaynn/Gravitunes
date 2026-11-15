// World orchestra: pure logic (no DOM), tested by app/modes/world-orchestra/test.mjs.
// Shared pieces live in app/core/ (geo.js, voices.js, triggers.js) and are re-exported here.
export { blendVoices, shapeForPitch } from '../../core/voices.js';
export { selectTriggers, percentileOf } from '../../core/triggers.js';
export { distKm, nearestCenters, blendWeight, voiceAt } from '../../core/geo.js';
export { gestureNotes, gestureLength, degreeCents, liftToFloor } from '../../core/gestures.js';
import { SCALES, noteHz } from '../../core/scales.js';

// A compact fingerprint of a voice's sound (recording + synthesized timbre + phrase), for checking instruments differ.
export function timbreSignature(v) {
  const r = (x) => Math.round(x * 100) / 100;
  return JSON.stringify([v.sample || null, (v.harmonics || []).map(r), (v.partials || []).map((p) => [r(p.ratio), r(p.amp), r(p.decay ?? 0)]),
    v.envelope && ['attack', 'decay', 'sustain', 'release'].map((k) => r(v.envelope[k] ?? 0)), v.noise?.amount, v.gesture]);
}

// The same melody for every region, so only the timbre differs. Steps are scale degrees; nothing above A5.
export const MELODIES = {
  single: { label: 'Single note', steps: [0] },
  scale: { label: 'Scale up', steps: [0, 1, 2, 3, 4, 5] },
  arpeggio: { label: 'Arpeggio', steps: [0, 2, 4, 5, 4, 2, 0] },
  tune: { label: 'Short tune', steps: [0, 1, 2, 0, 2, 3, 4, 2] },
};
const TOP_HZ = noteHz(21);
export function melodyNotes(scaleId, baseSemis, melody, { gap = 0.32, dur = 0.5 } = {}) {
  const sc = SCALES[scaleId] || SCALES['pentatonic-major'], n = sc.cents.length;
  const steps = (MELODIES[melody] || MELODIES.single).steps;
  return steps.map((st, i) => {
    let f = noteHz(baseSemis) * 2 ** ((Math.floor(st / n) * sc.period + sc.cents[st % n]) / 1200);
    while (f > TOP_HZ * 1.001) f /= 2;
    return { freq: f, t: i * gap, dur: i === steps.length - 1 ? dur * 1.6 : dur, amp: 1 };
  });
}
