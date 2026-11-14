// node app/tools/test-core.mjs  -- tests the pure parts of app/core (no browser needed).
import assert from 'node:assert/strict';
import { buildLut, decode } from '../core/colorbar.js';
import { valueToFreq } from '../core/sound.js';

// Synthetic color bar: 100x4, transparent margins, white -> purple from x=10..89 on row 2.
const W = 100, H = 4, rgba = new Uint8ClampedArray(W * H * 4);
const color = (f) => [255 - 160 * f, 255 - 210 * f, 255 - 60 * f];
for (let x = 10; x < 90; x++) {
  const [r, g, b] = color((x - 10) / 79);
  rgba.set([r, g, b, 255], (2 * W + x) * 4);
}
const lut = buildLut(rgba, W, H, { row: 2, range: [5, 60] });
const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
near(decode(lut, ...color(1)), 60);
near(decode(lut, ...color(0.5)), 32.5);
near(decode(lut, 30, 30, 30), 5);        // grey/black base map -> low
near(decode(lut, 255, 255, 255), 5);     // white -> low
assert.equal(valueToFreq(5, [5, 60]), 220);
assert.equal(valueToFreq(60, [5, 60]), 220 * 8);
assert.ok(valueToFreq(30, [5, 60]) > 220);
console.log('core tests ok');
