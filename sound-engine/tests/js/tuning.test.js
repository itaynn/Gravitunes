import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTuning, resolveTuning, BUILTIN_TUNINGS } from "../../js/tuning.js";
const fx = (n) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), "utf8");
const pre = (n) => readFileSync(new URL(`../../presets/${n}`, import.meta.url), "utf8");
const near = (a, b, e = 1e-3) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);
const C4 = 261.6256;

test("12tet default", () => {
  const t = createTuning("12tet");
  assert.equal(t.size, 12);
  near(t.freq(0), C4);
  near(t.freq(9), 440);
  near(t.freq(7), 391.9954);
  near(t.freq(-3), 220);
  near(t.freq(21), 880);
  near(t.freq(12), 2 * C4);
  near(t.freq(-12), C4 / 2);
  assert.equal(t.refStep, 0);
  assert.equal(createTuning(undefined).name, "12tet");
});
test("a4 option", () => {
  near(createTuning("12tet", { a4: 432 }).freq(9), 432);
  near(createTuning({ type: "12tet", a4: 432 }).freq(9), 432);
});
test("refStep/refFreq", () => {
  const t = createTuning("12tet", { refStep: 9, refFreq: 440 });
  near(t.freq(9), 440);
  near(t.freq(21), 880);
  near(createTuning({ type: "edo", n: 12, refFreq: 100 }).freq(0), 100);
});
test("edo", () => {
  const t = createTuning("edo:19");
  assert.equal(t.size, 19);
  near(t.freq(19), 2 * C4);
  near(t.freq(1) / t.freq(0), Math.pow(2, 1 / 19), 1e-9);
  near(createTuning({ type: "edo", n: 5 }).freq(-5), C4 / 2);
  assert.throws(() => createTuning("edo:0"), /edo/);
});
test("just5", () => {
  const t = createTuning("just5");
  assert.equal(t.size, 12);
  near(t.freq(7) / t.freq(0), 1.5, 1e-9);
  near(t.freq(4) / t.freq(0), 1.25, 1e-9);
  near(t.freq(16) / t.freq(0), 2 * 1.25, 1e-9);
  near(t.freq(-5) / t.freq(0), 1.5 / 2, 1e-9);
});
test("shruti22", () => {
  const t = createTuning("shruti22");
  assert.equal(t.size, 22);
  near(t.freq(13) / t.freq(0), 1.5, 1e-9);
  near(t.freq(22), 2 * C4);
  near(t.freq(-13) / t.freq(0), 4 / 3 / 2, 1e-9);
  near(t.freq(44 + 4) / t.freq(0), 4 * 9 / 8, 1e-9);
});
test("presets match builtins", () => {
  for (const [file, name] of [["12tet.scl", "12tet"], ["just-5limit.scl", "just5"], ["shruti-22.scl", "shruti22"]]) {
    const a = createTuning(pre(file)), b = createTuning(name);
    assert.equal(a.size, b.size);
    for (let s = -15; s < 30; s++) near(a.freq(s), b.freq(s), 1e-6);
  }
});
test("scl text, object forms", () => {
  const t = createTuning(fx("shruti-22.scl"));
  assert.equal(t.size, 22);
  near(t.freq(13) / t.freq(0), 1.5, 1e-9);
  const o = createTuning({ scl: fx("19edo.scl"), refStep: 0, refFreq: 100 });
  near(o.freq(19), 200, 1e-4);
  const r = createTuning({ ratios: ["9/8", 1.5, 2] });
  assert.equal(r.size, 3);
  near(r.freq(2) / r.freq(0), 1.5, 1e-6);
  const c = createTuning({ cents: [200, 700, 1200] });
  near(c.freq(1) / c.freq(0), Math.pow(2, 200 / 1200), 1e-8);
  const tri = createTuning({ cents: [1901.955] }); // tritave
  assert.equal(tri.size, 1);
  near(tri.periodCents, 1901.955);
  near(tri.freq(1) / tri.freq(0), 3, 1e-6);
});
test("existing tuning returned as-is", () => {
  const t = createTuning("12tet");
  assert.equal(createTuning(t), t);
});
test("interpolation, cents, stepOf", () => {
  const t = createTuning("12tet");
  near(t.freq(0.5) / t.freq(0), Math.pow(2, 0.5 / 12), 1e-9);
  near(t.cents(12), 1200);
  near(t.stepOf(440), 9, 1e-6);
  near(t.stepOf(220), -3, 1e-6);
  const s = createTuning("shruti22");
  for (const st of [0, 5, 13, 22, -7, 50]) near(s.stepOf(s.freq(st)), st, 1e-5);
  near(createTuning("12tet").stepOf(t.freq(4.25)), 4.25, 1e-6);
});
test("kbm with unmapped keys", () => {
  const t = createTuning({ scl: "5 note\n5\n 9/8\n 5/4\n 3/2\n 5/3\n 2/1\n", kbm: fx("gaps.kbm") });
  // key 60 = step 0 = degree 0, ref freq 261.6256
  near(t.freq(0), 261.6256);
  assert.ok(Number.isNaN(t.freq(1)));
  near(t.freq(2) / t.freq(0), 9 / 8, 1e-9);
  near(t.freq(3) / t.freq(0), 5 / 4, 1e-9);
  assert.ok(Number.isNaN(t.freq(4)));
  near(t.freq(5) / t.freq(0), 3 / 2, 1e-9);
  near(t.freq(7) / t.freq(0), 2, 1e-9); // next repeat: octave degree 5 -> 2/1
  assert.ok(Number.isNaN(t.freq(-3)));
  near(t.freq(-2) / t.freq(0), 3 / 2 / 2, 1e-9);
  near(t.freq(-1) / t.freq(0), 5 / 3 / 2, 1e-9);
});
test("sample kbm with 12tet", () => {
  const t = createTuning({ scl: pre("12tet.scl"), kbm: pre("sample.kbm") });
  near(t.freq(9), 440);
  assert.equal(t.refStep, 9);
});
test("errors", () => {
  assert.throws(() => createTuning("nope"), (e) => BUILTIN_TUNINGS.every((n) => e.message.includes(n)));
  assert.throws(() => createTuning(fx("bad-pitch.scl")), /line 5/);
  assert.throws(() => createTuning({ foo: 1 }), /unrecognized/);
});
test("resolveTuning fetches URLs", async () => {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u) => {
    seen.push(u);
    return { ok: true, status: 200, text: async () => (u.endsWith(".kbm") ? fx("gaps.kbm") : fx("19edo.scl")) };
  };
  try {
    const t = await resolveTuning("https://example.com/x.scl");
    assert.equal(t.size, 19);
    const t2 = await resolveTuning("./foo.scl");
    assert.equal(t2.size, 19);
    const t3 = await resolveTuning({ scl: "/a/b.scl", kbm: "/a/b.kbm" });
    assert.equal(t3.size, 19);
    assert.equal(t3.refFreq, 261.6256);
    assert.equal((await resolveTuning("shruti22")).size, 22);
    assert.equal(seen.length, 4);
    globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => "" });
    await assert.rejects(resolveTuning("https://example.com/missing.scl"), /404/);
  } finally { globalThis.fetch = real; }
});

test("stepOf inverts freq for a non-linear 7-key kbm (middle 62, octave degree 12)", () => {
  const t = createTuning({ scl: pre("12tet.scl"), kbm: fx("major7.kbm") });
  near(t.freq(9), 440);
  // consecutive keys skip degrees: 2 semitones, then 2, then 1 ...
  near(t.cents(10) - t.cents(9), 200, 1e-6);
  near(t.cents(12) - t.cents(11), 100, 1e-6);
  for (let st = -15; st <= 30; st++) near(t.stepOf(t.freq(st)), st, 1e-6);
  for (const st of [0.25, 3.5, 9.75, -4.5, 17.1]) near(t.stepOf(t.freq(st)), st, 1e-6);
});
