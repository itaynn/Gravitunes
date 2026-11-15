// node app/modes/storm-watch/test.mjs  -- the storm sound mapping (pure logic).
import assert from 'node:assert/strict';
import {
  ranks, targetRank, orderRank, stormNote, noteTimes, noteGap, panOf, kmBetween, cssToRgb, DEFAULT_MAP, SOURCES, PITCH_LOW, PITCH_HIGH,
} from './mapping.js';
import { scaleFreqs, noteHz } from '../../core/scales.js';

const tones = scaleFreqs('pentatonic-major', noteHz(PITCH_LOW), noteHz(PITCH_HIGH));
assert.deepEqual(DEFAULT_MAP, { pitch: 'nothing', volume: 'size', tempo: 'nothing' });
assert.deepEqual(SOURCES, ['nothing', 'size', 'latitude', 'rain', 'speed']);

// Storms: area, latitude, rain, speed (km/h; null = just appeared).
const big = { id: 1, area: 900 }, mid = { id: 2, area: 400 }, small = { id: 3, area: 100 }, comps = [small, big, mid];
const base = { 1: { lat: 0, rain: 0.2, speed: 10 }, 2: { lat: 0, rain: 0.5, speed: null }, 3: { lat: 0, rain: 0.9, speed: 40 } };
const props = (lat) => (c) => ({ ...base[c.id], lat: lat?.[c.id] ?? 0 });

assert.equal(orderRank(5, [1, 5, 9]), 0.5); assert.equal(orderRank(null, [1, 2]), null); assert.equal(orderRank(3, [3]), 1);
let r = ranks(big, comps, props());
assert.equal(r.size, 1); assert.equal(r.rain, 0); assert.equal(r.speed, 0);
assert.equal(ranks(small, comps, props()).size, 0); assert.equal(ranks(small, comps, props()).rain, 1);
assert.equal(ranks(mid, comps, props()).speed, null);
assert.equal(ranks(big, comps, props({ 1: 60 })).latitude, 1); assert.equal(ranks(big, comps, props({ 1: -90 })).latitude, 0);
assert.equal(targetRank(r, DEFAULT_MAP, 'pitch'), null); assert.equal(targetRank(r, DEFAULT_MAP, 'volume'), 1);

const note = (c, map, lat) => stormNote(ranks(c, comps, props(lat)), map, tones);
const M = (o) => ({ ...{ pitch: 'nothing', volume: 'nothing', tempo: 'nothing' }, ...o });
// Default: bigger = louder; fixed pitch; single note.
assert.ok(note(big, DEFAULT_MAP).amp > note(small, DEFAULT_MAP).amp);
assert.equal(note(big, DEFAULT_MAP).freq, note(small, DEFAULT_MAP).freq);
assert.equal(note(big, DEFAULT_MAP).gap, null);
// Pitch <- size: bigger = higher; volume constant.
assert.ok(note(big, M({ pitch: 'size' })).freq > note(small, M({ pitch: 'size' })).freq);
assert.equal(note(big, M({ pitch: 'size' })).amp, note(small, M({ pitch: 'size' })).amp);
// Pitch <- latitude (itay's original): north = higher.
assert.ok(note(mid, M({ pitch: 'latitude' }), { 2: 50 }).freq > note(mid, M({ pitch: 'latitude' }), { 2: -50 }).freq);
// Volume <- rain: heavier = louder. Tempo <- speed: faster storm = shorter gap; unknown speed = single note.
assert.ok(note(small, M({ volume: 'rain' })).amp > note(big, M({ volume: 'rain' })).amp);
assert.ok(note(small, M({ tempo: 'speed' })).gap < note(big, M({ tempo: 'speed' })).gap);
assert.equal(note(mid, M({ tempo: 'speed' })).gap, null);
assert.equal(noteGap(0), 0.5); assert.ok(Math.abs(noteGap(1) - 0.15) < 1e-9);
assert.deepEqual(noteTimes(null, 0.8), [0]); assert.deepEqual(noteTimes(0.5, 0.8), [0, 0.5]);
assert.equal(noteTimes(0.15, 0.8).length, 6);
// Always within C3..E6 and on the scale.
for (const src of SOURCES) for (const c of comps) for (const lat of [-90, -30, 0, 30, 90]) {
  const { freq, amp } = note(c, M({ pitch: src, volume: src, tempo: src }), { [c.id]: lat });
  assert.ok(freq >= noteHz(PITCH_LOW) - 1e-6 && freq <= noteHz(PITCH_HIGH) + 1e-6, `${freq}`);
  assert.ok(tones.some((t) => Math.abs(t - freq) < 1e-6));
  assert.ok(amp > 0 && amp <= 0.75);
}
assert.ok(Math.abs(kmBetween({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111.2) < 1e-6);
assert.ok(Math.abs(kmBetween({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 }) - 111.2) < 1e-6);
assert.equal(panOf(-180), -1); assert.equal(panOf(90), 0.5); assert.equal(panOf(200), 1);
assert.deepEqual([cssToRgb('hsl(0 100% 50%)').r, cssToRgb('hsl(0 100% 50%)').g], [255, 0]);
assert.equal(cssToRgb('hsl(120 100% 50%)').g, 255);
console.log('storm-watch mapping tests ok');
