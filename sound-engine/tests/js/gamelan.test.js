import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTuning, BUILTIN_TUNINGS, SLENDRO_CENTS, PELOG_CENTS } from "../../js/tuning.js";
import { createScale, BUILTIN_SCALES } from "../../js/scale.js";
import { PRESETS, validateVoiceDef } from "../../js/voices.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const C4 = 440 * Math.pow(2, -9 / 12);

test("slendro and pelog are built-in, with stretched (non-1200) periods", () => {
  assert.ok(BUILTIN_TUNINGS.includes("slendro") && BUILTIN_TUNINGS.includes("pelog"));
  const s = createTuning("slendro"), p = createTuning("pelog");
  assert.equal(s.size, 5); assert.equal(p.size, 7);
  assert.equal(s.periodCents, 1210); assert.equal(p.periodCents, 1220);
  assert.equal(s.labels.length, 5); assert.equal(p.labels.length, 7);
  assert.deepEqual(createTuning({ type: "pelog" }).periodCents, 1220);
});

test("freq and stepOf across periods with a non-1200 period", () => {
  for (const [name, cents] of [["slendro", SLENDRO_CENTS], ["pelog", PELOG_CENTS]]) {
    const t = createTuning(name), n = t.size, per = cents[n - 1];
    near(t.freq(0), C4);
    near(t.freq(n), C4 * Math.pow(2, per / 1200));         // NOT exactly 2x
    assert.ok(t.freq(n) / t.freq(0) > 2.005);
    near(t.freq(-n), C4 * Math.pow(2, -per / 1200));
    near(t.freq(n + 2), C4 * Math.pow(2, (per + cents[1]) / 1200));
    near(t.cents(2 * n + 1), 2 * per + cents[0]);
    for (const st of [-n - 1, -1, 0, 1, n - 1, n, n + 3, 2 * n + 2, 2.5]) near(t.stepOf(t.freq(st)), st, 1e-6);
  }
  // step sizes: slendro near-equal, pelog a mix of small and large
  const steps = (c) => c.map((x, i) => x - (i ? c[i - 1] : 0));
  for (const d of steps(SLENDRO_CENTS)) assert.ok(d > 225 && d < 260, `slendro step ${d}`);
  const ps = steps(PELOG_CENTS);
  assert.ok(ps.some((d) => d < 170) && ps.some((d) => d > 240));
});

test("presets/slendro.scl and pelog.scl match the built-ins", () => {
  for (const name of ["slendro", "pelog"]) {
    const a = createTuning(readFileSync(new URL(`../../presets/${name}.scl`, import.meta.url), "utf8")), b = createTuning(name);
    assert.equal(a.size, b.size); assert.equal(a.periodCents, b.periodCents);
    for (let st = -8; st < 16; st++) near(a.freq(st), b.freq(st));
  }
});

test("gamelan scales declare their tuning size", () => {
  const sl = createTuning("slendro"), pl = createTuning("pelog");
  for (const n of ["slendro", "slendro-nem", "slendro-sanga", "slendro-manyura"]) assert.equal(createScale(n, sl).period, 5);
  for (const n of ["pelog", "pelog-lima", "pelog-nem", "pelog-barang"]) assert.equal(createScale(n, pl).period, 7);
  assert.ok(BUILTIN_SCALES.includes("pelog-nem"));
  assert.deepEqual(createScale("pelog-nem", pl).up, [0, 1, 2, 4, 5]);
  assert.deepEqual(createScale("pelog-barang", pl).up, [1, 2, 4, 5, 6]);
  assert.throws(() => createScale("pelog-nem", createTuning("12tet")), /7-step.*major/);
  assert.throws(() => createScale("major", pl), /pelog, pelog-lima, pelog-nem, pelog-barang/);
  assert.throws(() => createScale("slendro", pl), /5-step/);
});

test("value -> pelog-nem -> Hz data path", () => {
  const t = createTuning("pelog"), sc = createScale("pelog-nem", t);
  const per = PELOG_CENTS[6], deg = [0, ...PELOG_CENTS.slice(0, 6)];
  const expectHz = (step) => { const o = Math.floor(step / 7); return C4 * Math.pow(2, (o * per + deg[step - o * 7]) / 1200); };
  let prev = -Infinity;
  for (let i = 0; i <= 40; i++) {
    const v = i / 40, step = sc.fromValue(v, { min: 0, max: 1 });
    assert.ok([0, 1, 2, 4, 5].includes(((step % 7) + 7) % 7), `step ${step} in pelog-nem`);
    const hz = t.freq(step);
    near(hz, expectHz(step), 1e-6);
    assert.ok(hz >= prev); prev = hz;
  }
  assert.equal(sc.fromValue(0), -14); assert.equal(sc.fromValue(1), 7);
  near(t.freq(7), C4 * Math.pow(2, per / 1200));
});

test("gamelan voice presets are valid and match presets/*.json", () => {
  for (const n of ["saron", "gong"]) {
    validateVoiceDef(PRESETS[n]);
    const j = JSON.parse(readFileSync(new URL(`../../presets/${n}.json`, import.meta.url), "utf8"));
    const { name, ...def } = j;
    assert.equal(name, n); assert.deepEqual(def, PRESETS[n]);
  }
});
