import test from "node:test";
import assert from "node:assert/strict";
import { createScale, BUILTIN_SCALES } from "../../js/scale.js";
import { createTuning } from "../../js/tuning.js";

test("builtins all construct", () => {
  for (const n of BUILTIN_SCALES) createScale(n);
  for (const n of ["major", "minor", "ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian", "pentatonic-major", "pentatonic-minor", "chromatic", "yaman", "bhairav", "yaman-22", "bhairav-22"]) assert.ok(BUILTIN_SCALES.includes(n), n);
});
test("major / modes", () => {
  assert.deepEqual(createScale("major").up, [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual(createScale("minor").up, [0, 2, 3, 5, 7, 8, 10]);
  assert.deepEqual(createScale("dorian").up, [0, 2, 3, 5, 7, 9, 10]);
  assert.deepEqual(createScale("lydian").up, [0, 2, 4, 6, 7, 9, 11]);
  assert.deepEqual(createScale("locrian").up, [0, 1, 3, 5, 6, 8, 10]);
  assert.deepEqual(createScale("pentatonic-minor").up, [0, 3, 5, 7, 10]);
});
test("quantize", () => {
  const s = createScale("major");
  assert.equal(s.quantize(1), 2); // tie between 0 and 2 -> up
  assert.equal(s.quantize(3.2), 4);
  assert.equal(s.quantize(5.4), 5);
  assert.equal(s.quantize(11.6), 12);
  assert.equal(s.quantize(-0.4), 0);
  assert.equal(s.quantize(-0.6), -1);
  assert.equal(s.quantize(25), 26);
  assert.equal(s.quantize(8), 9);
  assert.equal(createScale("pentatonic-major").quantize(5), 4);
});
test("quantize ties go up, integers unchanged", () => {
  const s = createScale({ up: [0, 4, 8] });
  assert.equal(s.quantize(2), 4);
  assert.equal(s.quantize(6), 8);
  for (let i = 0; i < 12; i++) assert.equal(createScale("chromatic").quantize(i), i);
});
test("root offset", () => {
  const s = createScale({ up: [0, 2, 4], period: 7, root: 3 });
  assert.equal(s.quantize(3), 3);
  assert.equal(s.degree(0), 3);
  assert.equal(s.degree(3), 10);
});
test("degree across octaves", () => {
  const s = createScale("major");
  assert.equal(s.degree(0), 0);
  assert.equal(s.degree(6), 11);
  assert.equal(s.degree(7), 12);
  assert.equal(s.degree(9), 16);
  assert.equal(s.degree(-1), -1);
  assert.equal(s.degree(-7), -12);
  assert.equal(s.degree(-8), -13);
});
test("fromValue", () => {
  const s = createScale("major");
  assert.equal(s.fromValue(0), 0);
  assert.equal(s.fromValue(1), 24);
  assert.equal(s.fromValue(-5), 0);
  assert.equal(s.fromValue(9), 24);
  assert.equal(s.fromValue(0.5), 12);
  assert.equal(s.fromValue(50, { min: 0, max: 100 }), 12);
  assert.equal(s.fromValue(0, { low: 60, high: 72 }), 60);
  assert.equal(s.fromValue(1, { low: 60, high: 72 }), 72);
  for (let i = 0; i <= 20; i++) assert.ok(Number.isInteger(s.fromValue(i / 20)));
  assert.equal(s.fromValue(5, { min: 5, max: 5 }), 0);
});
test("raga up/down sets", () => {
  const y = createScale("yaman");
  assert.notDeepEqual(y.up, y.down);
  assert.equal(y.vadi, 4);
  assert.equal(y.samvadi, 11);
  assert.ok(!y.up.includes(7) && y.down.includes(7));
  assert.ok(y.up.includes(6) && !y.up.includes(5)); // tivra Ma
  assert.equal(y.quantize(7, { direction: "up" }), 6);
  assert.equal(y.quantize(7, { direction: "down" }), 7);
  const b = createScale("bhairav");
  assert.deepEqual(b.up, [0, 1, 4, 5, 7, 8, 11]);
  assert.equal(b.vadi, 8);
  assert.equal(b.samvadi, 1);
  assert.equal(b.period, 12);
});
test("22-shruti ragas work with shruti22 tuning", () => {
  const t = createTuning("shruti22");
  for (const n of ["yaman-22", "bhairav-22"]) {
    const s = createScale(n, t);
    assert.equal(s.period, 22);
    for (const d of [...s.up, ...s.down]) assert.ok(d >= 0 && d < 22);
  }
  const y = createScale("yaman-22", t);
  // Ga = 5/4
  assert.ok(Math.abs(t.freq(y.vadi) / t.freq(0) - 1.25) < 1e-9);
  assert.ok(Math.abs(t.freq(y.samvadi) / t.freq(0) - 15 / 8) < 1e-9);
  const bh = createScale("bhairav-22", t);
  assert.ok(Math.abs(t.freq(bh.vadi) / t.freq(0) - 8 / 5) < 1e-9);
  assert.ok(Math.abs(t.freq(bh.samvadi) / t.freq(0) - 16 / 15) < 1e-9);
});
test("default period from tuning", () => {
  const t = createTuning("edo:19");
  const s = createScale("chromatic", t);
  assert.equal(s.period, 19);
  assert.equal(s.up.length, 19);
  assert.equal(createScale(null, t).period, 19);
  assert.equal(createScale({ up: [0, 5, 10] }, t).period, 19);
  assert.equal(createScale({ up: [0, 5] }).period, 12);
});
test("existing scale returned, errors", () => {
  const s = createScale("major");
  assert.equal(createScale(s), s);
  assert.throws(() => createScale("nope"), /pentatonic-major/);
  assert.throws(() => createScale({ up: [0, 12] }), /degree 12 is outside 0\.\.11/);
  assert.throws(() => createScale({ up: [0, 1.5] }), /integer/);
  assert.throws(() => createScale({ up: [] }), /non-empty/);
});

test("12-step built-ins refuse tunings of another size", () => {
  const t22 = createTuning("shruti22"), t19 = createTuning("edo:19");
  assert.equal(createScale("major", createTuning("12tet")).period, 12);
  assert.equal(createScale("major", createTuning("just5")).period, 12);
  assert.throws(() => createScale("major", t22), /scale 'major' is defined for 12-step tunings; tuning shruti22 has 22 steps — use 'chromatic'.*yaman-22/);
  assert.throws(() => createScale("pentatonic-minor", t19), /19 steps/);
  assert.throws(() => createScale("yaman", t22), /12-step/);
  assert.throws(() => createScale("yaman-22", createTuning("12tet")), /22-step tunings; tuning 12tet has 12/);
  assert.equal(createScale("chromatic", t22).period, 22);
});
