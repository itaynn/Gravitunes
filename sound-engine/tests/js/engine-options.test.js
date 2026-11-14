import test from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../../js/engine.js";

// Options are checked before any AudioContext exists, so these run in node.
test("output / balance / width options validate with helpful errors", () => {
  assert.throws(() => createEngine({ output: "surround" }), /output must be "mono".*"stereo"/);
  assert.throws(() => createEngine({ balance: 2 }), /balance: must be a number from -1/);
  assert.throws(() => createEngine({ width: -0.1 }), /width: must be a number from 0/);
  const e = createEngine({ output: "mono", balance: -0.5, width: 0.3 });
  assert.equal(e.output, "mono"); assert.equal(e.balance, -0.5); assert.equal(e.width, 0.3);
  assert.equal(createEngine().output, "stereo");
});

test("setters validate and update without a context", () => {
  const e = createEngine();
  assert.throws(() => e.setOutput("left"), /engine.setOutput: output must be/);
  assert.throws(() => e.setBalance(NaN), /engine.setBalance/);
  assert.throws(() => e.setWidth(3), /engine.setWidth/);
  e.setOutput("mono").setWidth(1).setBalance(0.25);
  assert.equal(e.output, "mono"); assert.equal(e.width, 1); assert.equal(e.balance, 0.25);
});

test("engine.voice with { live: true } validates and keeps the old definition on error", () => {
  const e = createEngine();
  e.voice("v", { harmonics: [1, 0.5] }, { live: true });
  assert.deepEqual(e.voice("v").harmonics, [1, 0.5]);
  assert.throws(() => e.voice("v", { extends: "nope" }, { live: true }), /unknown voice "nope"/);
  assert.deepEqual(e.voice("v").harmonics, [1, 0.5]);
});
