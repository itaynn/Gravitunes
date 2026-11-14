// Timbre atlas: pure logic (no DOM), tested by test.mjs. Turns an instrument voice into a short idiomatic gesture.
import { MAX_FUND_HZ } from '../../core/sound.js';
export { voiceAt, distKm } from '../world-orchestra/orchestra.js';

const cents = (f, c) => f * 2 ** (c / 1200);

// Cents of scale degree `step` (may be negative or beyond one period).
export function degreeCents({ scale = [0], period = 1200 }, step) {
  const n = scale.length, p = Math.floor(step / n);
  return p * period + scale[((step % n) + n) % n];
}

// Notes for one hover: [{ freq, t, dur, amp, glide?, vibrato? }]. phrase=false gives a single tonic note.
// Everything (including glide targets and vibrato peaks) is shifted down by octaves until it is <= C5.
export function gestureNotes(voice, baseHz, { phrase = true } = {}) {
  const g = voice.gesture || { scale: [0], steps: [0], gap: 0.3 };
  const steps = phrase ? g.steps : [0];
  const base = baseHz * 2 ** (voice.octave || 0);
  const dur = g.dur ?? voice.dur ?? 0.4, gap = g.gap ?? 0.3;
  const notes = [];
  let t = 0;
  steps.forEach((st, i) => {
    const f = cents(base, degreeCents(g, st)), last = i === steps.length - 1;
    const trem = phrase && g.tremolo && (g.tremoloAll || last) ? g.tremolo : null;
    if (trem) {
      for (let j = 0; j < trem.count; j++) {
        const end = j === trem.count - 1;
        notes.push({ freq: f, t: t + j * trem.gap, dur: end ? dur : trem.gap * 1.5, amp: j % 2 ? 0.7 : 1 });
      }
      t += trem.count * trem.gap + (last ? 0 : gap * 0.4);
      return;
    }
    const n = { freq: f, t, dur: g.hold ? dur + (steps.length - 1 - i) * gap : dur, amp: 1 };
    if (voice.slide && (i === 0 || g.slideEach)) {
      n.freq = cents(f, voice.slide.cents);
      n.glide = { to: f, time: voice.slide.time ?? 0.1, at: 0 };
    }
    if (phrase && last && g.bend) n.glide = { to: cents(f, g.bend.cents), time: g.bend.time ?? 0.2, at: g.bend.at ?? 0.15 };
    if (voice.vibrato) n.vibrato = voice.vibrato;
    if (voice.wah) n.wah = voice.wah;
    notes.push(n);
    t += gap;
  });
  const top = (n) => Math.max(n.freq, n.glide?.to || 0) * 2 ** ((n.vibrato?.depth || 0) / 1200);
  let peak = Math.max(...notes.map(top)), shift = 1;
  while (peak * shift > MAX_FUND_HZ + 1e-6) shift /= 2;
  if (shift !== 1) for (const n of notes) { n.freq *= shift; if (n.glide) n.glide = { ...n.glide, to: n.glide.to * shift }; }
  return notes;
}

// Length of a gesture in seconds (start of last note + its duration).
export const gestureLength = (notes) => Math.max(0, ...notes.map((n) => n.t + n.dur));

// A compact fingerprint of a voice's sound, for checking that instruments differ.
export function timbreSignature(v) {
  const r = (x) => Math.round(x * 100) / 100;
  return JSON.stringify([(v.harmonics || []).map(r), (v.partials || []).map((p) => [r(p.ratio), r(p.amp), r(p.decay ?? 0)]),
    v.envelope && ['attack', 'decay', 'sustain', 'release'].map((k) => r(v.envelope[k] ?? 0)), v.noise?.amount]);
}
