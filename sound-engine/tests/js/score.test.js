import test from "node:test";
import assert from "node:assert/strict";
import { validateScore, assertScore, normalizeEvent, normalizeScore, resolvePitch } from "../../js/score.js";
import { createTuning } from "../../js/tuning.js";
import { createScale } from "../../js/scale.js";
const near = (a, b, e = 1e-3) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

test("valid score", () => {
  const r = validateScore({ version: 1, events: [{ t: 0, note: "A4" }, { freq: 440 }, { step: 3 }, { value: 0.5 }, { type: "stop", id: "a" }] });
  assert.deepEqual(r, { valid: true, errors: [] });
});
test("invalid score messages", () => {
  const r = validateScore({ version: 2, bogus: 1, events: [{ note: "A4" }, { note: "A4", amp: 1.5 }, { t: -1, freq: 1 }, {}, { type: "set" }, { note: "H9" }] });
  assert.equal(r.valid, false);
  const j = r.errors.join("\n");
  assert.match(j, /version: must be 1/);
  assert.match(j, /bogus: unknown/);
  assert.match(j, /events\[1\]\.amp: must be 0\.\.1, got 1\.5/);
  assert.match(j, /events\[2\]\.t: must be >= 0.*got -1/);
  assert.match(j, /events\[3\]: needs a pitch/);
  assert.match(j, /events\[4\]\.id: set events need an id/);
  assert.match(j, /events\[5\]\.note: must look like/);
  assert.ok(!/events\[0\]/.test(j));
});
test("score-level errors", () => {
  assert.equal(validateScore(null).valid, false);
  assert.match(validateScore({ version: 1 }).errors[0], /events: required/);
  assert.match(validateScore({ version: 1, events: [], tempo: 0 }).errors[0], /tempo/);
  assert.match(validateScore({ version: 1, events: [], valueRange: [1] }).errors[0], /valueRange/);
  assert.match(validateScore({ version: 1, events: [], scale: { up: [1.5] } }).errors[0], /scale\.up/);
  assert.match(validateScore({ version: 1, events: [], voices: { a: { envelope: { sustain: 2 } } } }).errors[0], /voices\.a\.envelope\.sustain/);
  assert.equal(validateScore({ version: 1, events: [], tempo: null, scale: null }).valid, true);
});
test("assertScore throws, max 10 listed", () => {
  assert.throws(() => assertScore({ version: 1, events: Array.from({ length: 15 }, () => ({})) }), /and 5 more/);
  assert.doesNotThrow(() => assertScore({ version: 1, events: [] }));
});
test("normalizeEvent aliases and defaults", () => {
  const e = normalizeEvent({ note: "A4", amplitude: 0.3, duration: 2 });
  assert.equal(e.type, "note");
  assert.equal(e.t, 0);
  assert.equal(e.amp, 0.3);
  assert.equal(e.dur, 2);
  assert.ok(!("amplitude" in e) && !("duration" in e));
  assert.equal(normalizeEvent({ note: "A4", amp: 0.1, amplitude: 0.9 }).amp, 0.1);
  assert.equal(normalizeEvent({ note: "A4" }).amp, undefined);
  assert.equal(normalizeEvent({ type: "stop", id: 3 }).id, 3);
});
test("normalizeEvent errors", () => {
  assert.throws(() => normalizeEvent({}), /^Error: event: needs a pitch — give one of freq \(Hz\)/);
  assert.throws(() => normalizeEvent({}, { path: "events[7]" }), /events\[7\]: needs a pitch/);
  assert.throws(() => normalizeEvent({ type: "set" }), /id/);
  assert.throws(() => normalizeEvent({ note: "A4", t: -1 }), /t:/);
});
test("normalizeEvent tempo", () => {
  const e = normalizeEvent({ note: "A4", t: 2, dur: 1, glide: { to: 880, time: 0.5, at: 1 }, ramp: 0.2 }, { tempo: 120 });
  assert.equal(e.t, 1);
  assert.equal(e.dur, 0.5);
  assert.equal(e.glide.time, 0.25);
  assert.equal(e.glide.at, 0.5);
  assert.equal(e.glide.to, 880);
  assert.equal(e.ramp, 0.2);
});
test("normalizeScore sorting, duration, tempo, valueRange", () => {
  const n = normalizeScore({ version: 1, title: "x", events: [
    { t: 2, freq: 100, dur: 1 }, { t: 0, value: 10, id: "a" }, { t: 0, value: 30, glide: { to: { value: 50 } } }, { t: 1, type: "stop", id: "a" },
  ] });
  assert.deepEqual(n.valueRange, [10, 50]);
  assert.equal(n.duration, 3);
  assert.deepEqual(n.events.map((e) => e.t), [0, 0, 1, 2]);
  assert.equal(n.events[0].id, "a"); // stable
  assert.deepEqual(n.voices, {});
  assert.equal(n.title, "x");
  assert.equal(n.version, 1);
  const t = normalizeScore({ version: 1, tempo: 60, valueRange: [0, 5], events: [{ t: 4, freq: 1, dur: 2 }] });
  assert.equal(t.duration, 6);
  assert.deepEqual(t.valueRange, [0, 5]);
  const t2 = normalizeScore({ version: 1, tempo: 120, events: [{ t: 4, freq: 1, dur: 2 }] });
  assert.equal(t2.duration, 3);
  assert.deepEqual(t2.valueRange, [0, 1]);
  assert.throws(() => normalizeScore({ version: 1, events: [{}] }), /events\[0\]/);
});
test("resolvePitch priority", () => {
  const ctx = { tuning: createTuning("12tet") };
  near(resolvePitch({ freq: 100, note: "A4", step: 0, value: 1 }, ctx), 100);
  near(resolvePitch({ note: "A4", step: 0 }, ctx), 440);
  near(resolvePitch({ note: "A4" }, { ...ctx, a4: 432 }), 432);
  near(resolvePitch({ step: 9, value: 1 }, ctx), 440);
  near(resolvePitch({ step: -3 }, ctx), 220);
  assert.throws(() => resolvePitch({}, ctx), /needs one of/);
  assert.throws(() => resolvePitch({ freq: -1 }, ctx), /positive/);
});
test("resolvePitch value", () => {
  const tuning = createTuning("12tet");
  const scale = createScale("major", tuning);
  near(resolvePitch({ value: 0 }, { tuning, scale }), 261.6256 / 4); // default output range C2..C5
  near(resolvePitch({ value: 1 }, { tuning, scale }), 261.6256 * 2);
  near(resolvePitch({ value: 5, range: [0, 10] }, { tuning, scale }), 261.6256 * 2 ** (-5 / 12)); // middle: F#3 snaps (ties up) to G3
  near(resolvePitch({ value: 5 }, { tuning, scale, valueRange: [0, 10] }), 261.6256 * 2 ** (-5 / 12)); // middle: F#3 snaps (ties up) to G3
  near(resolvePitch({ value: 5, range: [0, 5] }, { tuning, scale, valueRange: [0, 100] }), 261.6256 * 2);
  near(resolvePitch({ value: 0.5 }, { tuning }), 261.6256 * 2 ** (-6 / 12)); // chromatic default: F#3, the middle of C2..C5
  // step is not quantized by the scale
  near(resolvePitch({ step: 1 }, { tuning, scale }), 261.6256 * Math.pow(2, 1 / 12));
  // unmapped kbm key
  const kt = createTuning({ scl: "k\n1\n2/1\n", kbm: "2\n0\n127\n60\n61\n261.6\n1\nx\n0\n" });
  assert.throws(() => resolvePitch({ step: 0 }, { tuning: kt }), /finite positive/);
});

test("score notes with id hold (no default dur); others get 1 s, or 1 beat with tempo", () => {
  const s = normalizeScore({ version: 1, events: [
    { t: 0, id: "storm", step: 0 }, { t: 0.5, step: 2 },
    { t: 1, type: "set", id: "storm", amp: 0.1 }, { t: 3, type: "stop", id: "storm" }] });
  assert.equal(s.events[0].dur, undefined);
  assert.equal(s.events[1].dur, 1);
  assert.equal(s.duration, 3); // includes the stop event
  const b = normalizeScore({ version: 1, tempo: 120, events: [{ t: 0, step: 0 }, { t: 0, id: "a", step: 1 }] });
  assert.equal(b.events[0].dur, 0.5);
  assert.equal(b.events[1].dur, undefined);
});

test("value direction: per id, else previous value event; explicit direction wins", () => {
  const s = normalizeScore({ version: 1, events: [
    { t: 0, value: 5 }, { t: 1, value: 3 }, { t: 2, value: 3 },
    { t: 3, id: "a", value: 10 }, { t: 4, value: 1 }, { t: 5, type: "set", id: "a", value: 9 },
    { t: 6, type: "set", id: "a", value: 12 }, { t: 7, value: 20, direction: "down" }, { t: 8, value: 0 }] });
  assert.deepEqual(s.events.map((e) => e.direction), ["up", "down", "up", "up", "down", "down", "up", "down", "down"]);
  assert.throws(() => normalizeEvent({ value: 1, direction: "sideways" }), /direction/);
});

test("raga phrase uses the down set when descending", () => {
  const tuning = createTuning("12tet"), scale = createScale("yaman", tuning);
  const s = normalizeScore({ version: 1, valueRange: [0, 36], events: [{ t: 0, value: 36 }, { t: 1, value: 31 }, { t: 2, value: 24 }, { t: 3, value: 31 }] });
  const steps = s.events.map((e) => tuning.stepOf(resolvePitch(e, { tuning, scale, valueRange: s.valueRange })));
  near(steps[1], 7);   // Pa: only in yaman's down set
  near(steps[3], 6);   // ascending skips Pa
});
