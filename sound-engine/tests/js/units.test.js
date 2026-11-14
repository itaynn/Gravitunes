import test from "node:test";
import assert from "node:assert/strict";
import { noteToMidi, noteToFreq, midiToFreq, dbToAmp, ampToDb, centsBetween } from "../../js/units.js";
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

test("note names", () => {
  assert.equal(noteToMidi("A4"), 69);
  assert.equal(noteToMidi("C4"), 60);
  assert.equal(noteToMidi("C#3"), 49);
  assert.equal(noteToMidi("Bb2"), 46);
  assert.equal(noteToMidi("C-1"), 0);
  assert.equal(noteToMidi("a4"), 69);
});
test("freq", () => {
  near(noteToFreq("A4"), 440);
  near(noteToFreq("C4"), 261.6256, 1e-3);
  near(noteToFreq("A4", 432), 432);
  near(noteToFreq("A5"), 880);
  near(midiToFreq(57), 220);
});
test("bad names", () => {
  assert.throws(() => noteToMidi("H4"), /"H4".*A4/);
  assert.throws(() => noteToMidi("A"), /invalid note/);
  assert.throws(() => noteToMidi(5), /invalid note/);
});
test("db/amp/cents", () => {
  near(dbToAmp(0), 1);
  near(dbToAmp(-6.0206), 0.5, 1e-4);
  near(ampToDb(1), 0);
  assert.equal(ampToDb(0), -Infinity);
  near(centsBetween(440, 880), 1200);
  near(centsBetween(440, 220), -1200);
});
