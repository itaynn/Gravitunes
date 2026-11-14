import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseScl, parseKbm } from "../../js/scala.js";
const fx = (n) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), "utf8");
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

test("parse 22 shruti", () => {
  const s = parseScl(fx("shruti-22.scl"));
  assert.equal(s.count, 22);
  assert.equal(s.pitches.length, 22);
  assert.equal(s.description, "22 shruti (Indian classical, just ratios)");
  near(s.periodCents, 1200);
  assert.equal(s.pitches[12].text, "3/2");
  near(s.pitches[12].cents, 701.955, 1e-3);
  near(s.pitches[12].ratio, 1.5);
});
test("mixed ratios and cents, trailing text ignored", () => {
  const s = parseScl(fx("just-mixed.scl"));
  assert.equal(s.count, 7);
  assert.equal(s.pitches[2].ratio, null);
  near(s.pitches[2].cents, 498.045);
  assert.equal(s.pitches[1].text, "5/4");
  near(s.pitches[6].cents, 1200);
  assert.equal(s.pitches[6].ratio, null);
});
test("bare integer is a ratio", () => {
  const s = parseScl("x\n1\n2\n");
  assert.equal(s.pitches[0].ratio, 2);
  near(s.periodCents, 1200);
});
test("19 edo", () => {
  const s = parseScl(fx("19edo.scl"));
  assert.equal(s.count, 19);
  near(s.pitches[0].cents, 1200 / 19, 1e-5);
});
test("empty description and CRLF", () => {
  const s = parseScl("! c\r\n\r\n2\r\n3/2\r\n2/1\r\n");
  assert.equal(s.description, "");
  assert.equal(s.count, 2);
});
test("malformed scl errors", () => {
  assert.throws(() => parseScl(fx("bad-count.scl")), /count says 5 .* only 3/);
  assert.throws(() => parseScl(fx("bad-pitch.scl")), /line 5: expected a pitch like 3\/2 or 701\.955, got 'foo'/);
  assert.throws(() => parseScl(fx("extra-pitch.scl")), /line 5: .*more pitch lines/);
  assert.throws(() => parseScl(fx("bad-header.scl")), /line 2: expected the number of notes .* 'notanumber'/);
  assert.throws(() => parseScl(""), /description/);
  assert.throws(() => parseScl("d\n0\n"), /at least 1/);
  assert.throws(() => parseScl("d\n1\n3/0\n"), /line 3/);
});
test("parse kbm with x", () => {
  const k = parseKbm(fx("gaps.kbm"));
  assert.equal(k.size, 7);
  assert.equal(k.octaveDegree, 5);
  assert.equal(k.refFreq, 261.6256);
  assert.deepEqual(k.mapping, [0, null, 1, 2, null, 3, 4]);
  assert.equal(k.middle, 60);
  assert.equal(k.last, 127);
});
test("parse sample kbm", () => {
  const k = parseKbm(readFileSync(new URL("../../presets/sample.kbm", import.meta.url), "utf8"));
  assert.equal(k.mapping.length, 12);
  assert.equal(k.refNote, 69);
  assert.equal(k.refFreq, 440);
});
test("malformed kbm", () => {
  assert.throws(() => parseKbm(fx("bad.kbm")), /line 6: expected a number for reference frequency, got 'abc'/);
  assert.throws(() => parseKbm("3\n0\n127\n60\n69\n440\n3\n0\n1\n"), /only 2 mapping/);
  assert.throws(() => parseKbm("1\n0\n"), /missing field 'last/);
  assert.throws(() => parseKbm("1\n0\n127\n60\n69\n440\n1\nq\n"), /line 8: .*'x'/);
});
