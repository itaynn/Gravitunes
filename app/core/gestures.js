// Instrument gestures: turn a voice (data/earth/instruments.json shape) into a short idiomatic phrase. Pure.
import { MAX_FUND_HZ } from './sound.js';
import { shapeForPitch } from './voices.js';

const cents = (f, c) => f * 2 ** (c / 1200);

// Cents of scale degree `step` (may be negative or beyond one period).
export function degreeCents({ scale = [0], period = 1200 }, step) {
  const n = scale.length, p = Math.floor(step / n);
  return p * period + scale[((step % n) + n) % n];
}

// Notes for one gesture: [{ freq, t, dur, amp, glide?, vibrato? }]. phrase=false gives a single tonic note.
// Everything (including glide targets and vibrato peaks) is shifted down by octaves until it is <= C5.
export function gestureNotes(voice, baseHz, { phrase = true, floorHz = 0 } = {}) {
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
  let peak = Math.max(...notes.map(notePeak)), shift = 1;
  while (peak * shift > MAX_FUND_HZ + 1e-6) shift /= 2;
  shiftNotes(notes, shift);
  return floorHz ? liftToFloor(notes, floorHz, MAX_FUND_HZ) : notes;
}

// Highest and lowest pitch a note reaches (glide end and vibrato included).
export const notePeak = (n) => Math.max(n.freq, n.glide?.to || 0) * 2 ** ((n.vibrato?.depth || 0) / 1200);
export const noteLow = (n) => Math.min(n.freq, n.glide?.to ?? n.freq) * 2 ** (-(n.vibrato?.depth || 0) / 1200);

// Multiply every note (and its glide target) by `factor`, in place.
export function shiftNotes(notes, factor) {
  if (factor !== 1) for (const n of notes) { n.freq *= factor; if (n.glide) n.glide = { ...n.glide, to: n.glide.to * factor }; }
  return notes;
}

// Raise notes an octave at a time while the lowest is under floorHz and the highest stays <= ceilHz.
export function liftToFloor(notes, floorHz, ceilHz = MAX_FUND_HZ) {
  const lo = () => Math.min(...notes.map(noteLow)), hi = () => Math.max(...notes.map(notePeak));
  while (notes.length && lo() < floorHz - 1e-6 && hi() * 2 <= ceilHz + 1e-6) shiftNotes(notes, 2);
  return notes;
}

// Length of a gesture in seconds (start of last note + its duration).
export const gestureLength = (notes) => Math.max(0, ...notes.map((n) => n.t + n.dur));

// Play gesture notes with a voice through ctx.sound (pitch-safe shaping per note).
export function playNotes(sound, voice, notes, { amp = 0.4, pan = 0 } = {}) {
  for (const n of notes) {
    const sh = shapeForPitch(voice, n.freq);
    sound.play({ freq: n.freq, t: n.t, dur: n.dur, amp: amp * (n.amp ?? 1), pan,
      harmonics: sh.harmonics, partials: sh.partials, envelope: sh.envelope, noise: sh.noise,
      glide: n.glide, vibrato: n.vibrato, wah: n.wah && sh.wah });
  }
}
