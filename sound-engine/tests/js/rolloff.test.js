import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS, resolveVoice, resolveRolloff, rolloffGain, applyRolloff, DEFAULT_ROLLOFF, validateVoiceDef,
  capFade, limitNoteFreq, DEFAULT_MAX_FREQ, DEFAULT_MAX_NOTE_FREQ } from "../../js/voices.js";

test("capFade: full below 0.8x the cap, smooth to 0 at the cap (maxFreq and Nyquist)", () => {
  assert.equal(capFade(1000, 5000), 1);
  assert.equal(capFade(4000, 5000), 1);
  assert.equal(capFade(5000, 5000), 0);
  assert.equal(capFade(9000, 5000), 0);
  assert.ok(Math.abs(capFade(4500, 5000) - 0.5) < 1e-9);
  // monotonic and continuous: an upward glide fades a harmonic out without jumps
  let prev = 1;
  for (let f = 3900; f <= 5100; f += 10) { const g = capFade(f, 5000); assert.ok(g <= prev + 1e-12 && prev - g < 0.03); prev = g; }
  assert.equal(capFade(30000, Infinity), 1);
  // Nyquist at 44.1 kHz: a harmonic gliding toward 22050 Hz is silent before it gets there
  assert.equal(capFade(22050, 22050), 0);
  assert.ok(capFade(21000, 22050) < 0.2);
  assert.equal(DEFAULT_MAX_FREQ, 5000);
});

test("limitNoteFreq folds by octaves (default) or clamps", () => {
  assert.equal(DEFAULT_MAX_NOTE_FREQ, 1050);
  assert.equal(limitNoteFreq(440, 1050), 440);
  assert.equal(limitNoteFreq(2093, 1050), 2093 / 2);
  assert.equal(limitNoteFreq(4186, 1050), 4186 / 4);
  assert.equal(limitNoteFreq(2093, 1050, "clamp"), 1050);
  assert.equal(limitNoteFreq(2093, 1050, "off"), 2093);
  assert.equal(limitNoteFreq(2093, Infinity), 2093);
});

const C3 = 130.81, C6 = 1046.5;
const energyAbove = (h, f0, hz) => h.reduce((s, a, i) => s + (f0 * (i + 1) > hz ? a * a : 0), 0);

test("rolloff is on by default, gentle, and can be turned off", () => {
  assert.deepEqual(resolveRolloff(), { ...DEFAULT_ROLLOFF });
  assert.equal(resolveRolloff(false), null);
  assert.deepEqual(resolveRolloff({ slope: 3 }), { freq: DEFAULT_ROLLOFF.freq, slope: 3 });
  assert.throws(() => resolveRolloff({ freq: -1 }), /freq/);
  const r = resolveRolloff();
  assert.equal(rolloffGain(r.freq, r), 1);
  assert.equal(rolloffGain(100, r), 1);
  // one octave above the corner: -slope dB
  assert.ok(Math.abs(20 * Math.log10(rolloffGain(r.freq * 2, r)) + r.slope) < 1e-9);
  assert.equal(rolloffGain(20000, null), 1);
});

test("a bright voice keeps its timbre at C3 but loses shrill highs at C6", () => {
  const v = resolveVoice("bright"), r = resolveRolloff();
  const low = applyRolloff(v, C3, r), high = applyRolloff(v, C6, r);
  // C3: all 16 harmonics are below 2.1 kHz, nothing changes
  assert.deepEqual(low.harmonics, v.harmonics);
  // C6: the fundamental is untouched, the top harmonic is clearly softer
  assert.equal(high.harmonics[0], v.harmonics[0]);
  assert.ok(high.harmonics[15] < v.harmonics[15] * 0.25);
  // energy above 4 kHz drops by more than half (a gentle, not a brick-wall, filter)
  const before = energyAbove(v.harmonics, C6, 4000), after = energyAbove(high.harmonics, C6, 4000);
  assert.ok(after < before * 0.5 && after > before * 0.02, `${before} -> ${after}`);
  // monotonic: each harmonic is attenuated at least as much as the one below it
  const g = high.harmonics.map((a, i) => a / v.harmonics[i]);
  for (let i = 1; i < g.length; i++) assert.ok(g[i] <= g[i - 1] + 1e-12);
  // the input voice is not mutated
  assert.deepEqual(v.harmonics, PRESETS.bright.harmonics);
});

test("rolloff also applies to inharmonic partials", () => {
  const v = resolveVoice("bell"), r = resolveRolloff();
  const out = applyRolloff(v, C6, r);
  const top = v.partials.at(-1);
  assert.ok(out.partials.at(-1).amp < top.amp);
  assert.equal(out.partials.at(-1).ratio, top.ratio);
  assert.deepEqual(applyRolloff(v, C6, null).partials, v.partials);
});

test("sample voice definitions are validated and carried by resolveVoice", () => {
  const def = { harmonics: [1, 0.5], sample: { url: "organ/organ.trim.wav", f0: 261.6, loop: true, loopStart: 0.5, loopEnd: 1.5 } };
  validateVoiceDef(def);
  const v = resolveVoice("x", {}, { x: def });
  assert.equal(v.sample.f0, 261.6);
  assert.equal(resolveVoice("sine").sample, null);
  assert.throws(() => validateVoiceDef({ sample: { url: "a.wav" } }), /f0/);
  assert.throws(() => validateVoiceDef({ sample: { f0: 200 } }), /url/);
  assert.throws(() => validateVoiceDef({ sample: { url: "a.wav", f0: 200, loop: "yes" } }), /loop/);
});

test("lowpass: validated on events and voices, carried by resolveVoice", async () => {
  const { validateScore } = await import("../../js/score.js");
  assert.equal(validateScore({ version: 1, events: [{ t: 0, freq: 440, lowpass: 800 }] }).valid, true);
  assert.equal(validateScore({ version: 1, events: [{ t: 0, freq: 440, lowpass: 5 }] }).valid, false);
  validateVoiceDef({ lowpass: 1200 });
  assert.throws(() => validateVoiceDef({ lowpass: 1e6 }), /lowpass/);
  assert.equal(resolveVoice("x", {}, { x: { lowpass: 1200 } }).lowpass, 1200);
  assert.equal(resolveVoice("sine").lowpass, undefined);
});
