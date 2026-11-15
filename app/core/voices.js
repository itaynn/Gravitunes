// Instrument voices (data/earth/instruments.json shape): crossfade and pitch-safe shaping. Pure, runs in node too.

import { snapToScale, MIN_FUND_HZ, MAX_FUND_HZ } from './scales.js';

const lerp = (a, b, w) => a * w + b * (1 - w);

// Crossfade two instrument presets: w = weight of `a`.
export function blendVoices(a, b, w) {
  if (!b || w >= 1) return { ...a };
  if (w <= 0) return { ...b };
  if (a.sample && a.sample === b.sample) return blendVoices({ ...a, sample: null }, { ...b, sample: null }, w) && { ...blendVoices({ ...a, sample: null }, { ...b, sample: null }, w), samples: [{ id: a.sample, w: 1 }] };
  const ha = a.harmonics || [], hb = b.harmonics || [];
  const n = Math.max(ha.length, hb.length);
  const harmonics = n ? Array.from({ length: n }, (_, k) => lerp(ha[k] || 0, hb[k] || 0, w)) : undefined;
  const partials = [
    ...(a.partials || []).map((p) => ({ ...p, amp: p.amp * w })),
    ...(b.partials || []).map((p) => ({ ...p, amp: p.amp * (1 - w) })),
  ];
  const ea = { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.4, ...a.envelope };
  const eb = { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.4, ...b.envelope };
  const envelope = Object.fromEntries(Object.keys(ea).map((k) => [k, lerp(ea[k], eb[k], w)]));
  const na = a.noise, nb = b.noise;
  const noise = na || nb ? {
    amount: lerp(na?.amount || 0, nb?.amount || 0, w),
    attack: lerp(na?.attack ?? 0.01, nb?.attack ?? 0.01, w),
    decay: lerp(na?.decay ?? 0.1, nb?.decay ?? 0.1, w),
    cutoff: lerp(na?.cutoff ?? 2000, nb?.cutoff ?? 2000, w),
  } : undefined;
  // Expressive traits (vibrato, slides, wah, gesture, octave) are not averaged: the nearer voice wins.
  const dom = w >= 0.5 ? a : b;
  // Recorded instruments crossfade by weight (playNotes plays each); a side without a sample is synthesized.
  const samples = [{ id: a.sample, w }, { id: b.sample, w: 1 - w }].filter((m) => m.id);
  return {
    samples,
    vibrato: dom.vibrato, slide: dom.slide, wah: dom.wah, gesture: dom.gesture, octave: dom.octave,
    harmonics: harmonics || [0], partials, envelope, noise,
    brightness: lerp(a.brightness ?? 0.5, b.brightness ?? 0.5, w),
    dur: lerp(a.dur ?? 0.4, b.dur ?? 0.4, w),
  };
}

// Make a voice safe at pitch `freq`: apply brightness, then roll off upper partials as pitch rises
// so bright voices never get shrill. Partials above `ceiling` Hz are dropped.
export function shapeForPitch(voice, freq, { cutoff = 1800, ceiling = 4000 } = {}) {
  const b = voice.brightness ?? 0.5;
  const tilt = 1 - b;                                  // 0 = keep, 1 = extra 1/k
  const roll = (f) => (f <= cutoff ? 1 : (cutoff / f) ** 2);
  const shapeH = (hs) => hs.map((h, i) => {
    const k = i + 1, f = freq * k;
    return f > ceiling ? 0 : h * k ** -tilt * roll(f);
  });
  const harmonics = shapeH(voice.harmonics || [1]);
  const wah = voice.wah && { ...voice.wah, harmonics: shapeH(voice.wah.harmonics || [1]) };
  const partials = (voice.partials || []).filter((p) => freq * p.ratio <= ceiling)
    .map((p) => ({ ...p, amp: p.amp * roll(freq * p.ratio) }));
  const noise = voice.noise && { ...voice.noise, cutoff: Math.min(voice.noise.cutoff ?? 2000, 3000) };
  return { ...voice, harmonics: harmonics.some((h) => h > 0) ? harmonics : [1], partials, noise, ...(wah ? { wah } : {}) };
}


// A playable note for `voice` at `freq` (Hz): the voice's octave shift is applied, then the pitch is kept in
// MIN_FUND_HZ..MAX_FUND_HZ (C2..E6; or the span of `tones` when given) by folding whole octaves (so nearby values keep distinct pitches), snapped to `tones`,
// then shaped for pitch. Returns { note, dur }.
export function voiceNote(voice, freq, { tones } = {}) {
  let f = freq * 2 ** (voice.octave || 0);
  const lo = tones?.length ? tones[0] : MIN_FUND_HZ, hi = tones?.length ? tones.at(-1) : MAX_FUND_HZ;
  if (f > 0) { while (f < lo - 1e-6) f *= 2; while (f > hi + 1e-6) f /= 2; } else f = lo;
  if (tones?.length) f = snapToScale(f, tones);
  f = Math.max(lo, Math.min(hi, f));
  const { harmonics, partials, envelope, noise, vibrato, wah, dur } = shapeForPitch(voice, f);
  return { note: { freq: f, harmonics, partials, envelope, noise, vibrato, wah }, dur: dur ?? 0.4 };
}

// Instrument id chosen by a 0..1 rank (e.g. size or speed) over the list `ids`.
export function pickVoice(ids, rank) {
  return ids[Math.max(0, Math.min(ids.length - 1, Math.floor(rank * ids.length)))];
}
