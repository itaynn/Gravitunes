// node app/modes/storm-watch/test.mjs  -- the storm sound mapping (pure logic).
import assert from 'node:assert/strict';
import { ranks, targetRank, stormNote, panOf, cssToRgb, DEFAULT_MAP, PITCH_LOW, PITCH_HIGH } from './mapping.js';
import { scaleFreqs, noteHz } from '../../core/scales.js';

const tones = scaleFreqs('pentatonic-major', noteHz(PITCH_LOW), noteHz(PITCH_HIGH));
const big = { id: 1 }, mid = { id: 2 }, small = { id: 3 }, sorted = [big, mid, small];
assert.deepEqual(DEFAULT_MAP, { size: 'volume', latitude: 'nothing' });
assert.equal(ranks(big, sorted, 0).size, 1); assert.equal(ranks(small, sorted, 0).size, 0);
assert.equal(ranks(big, [big], 0).size, 1);
assert.equal(ranks(big, sorted, 60).latitude, 1); assert.equal(ranks(big, sorted, -90).latitude, 0);
assert.equal(targetRank({ size: 1, latitude: 0 }, DEFAULT_MAP, 'pitch'), null);
assert.equal(targetRank({ size: 1, latitude: 0 }, { size: 'pitch', latitude: 'pitch' }, 'pitch'), 0.5);

const note = (c, lat, map) => stormNote(ranks(c, sorted, lat), map, tones);
// Default: bigger = louder; pitch does not depend on size or latitude.
assert.ok(note(big, 0, DEFAULT_MAP).amp > note(small, 0, DEFAULT_MAP).amp);
assert.equal(note(big, 50, DEFAULT_MAP).freq, note(small, -50, DEFAULT_MAP).freq);
// Size -> pitch: bigger = higher; volume constant.
const sp = { size: 'pitch', latitude: 'nothing' };
assert.ok(note(big, 0, sp).freq > note(small, 0, sp).freq);
assert.equal(note(big, 0, sp).amp, note(small, 0, sp).amp);
// Latitude -> pitch (itay's original): north = higher.
const lp = { size: 'nothing', latitude: 'pitch' };
assert.ok(note(mid, 50, lp).freq > note(mid, -50, lp).freq);
// Latitude -> volume: north louder.
const lv = { size: 'nothing', latitude: 'volume' };
assert.ok(note(mid, 50, lv).amp > note(mid, -50, lv).amp);
// Always within C3..E6 and on the scale.
for (const m of [DEFAULT_MAP, sp, lp, lv]) for (const c of sorted) for (const lat of [-90, -30, 0, 30, 90]) {
  const { freq, amp } = note(c, lat, m);
  assert.ok(freq >= noteHz(PITCH_LOW) - 1e-6 && freq <= noteHz(PITCH_HIGH) + 1e-6, `${freq}`);
  assert.ok(tones.some((t) => Math.abs(t - freq) < 1e-6));
  assert.ok(amp > 0 && amp <= 0.75);
}
assert.equal(panOf(-180), -1); assert.equal(panOf(90), 0.5); assert.equal(panOf(200), 1);
assert.deepEqual([cssToRgb('hsl(0 100% 50%)').r, cssToRgb('hsl(0 100% 50%)').g], [255, 0]);
assert.equal(cssToRgb('hsl(120 100% 50%)').g, 255);
console.log('storm-watch mapping tests ok');
