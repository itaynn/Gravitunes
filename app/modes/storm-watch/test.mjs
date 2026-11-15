// node app/modes/storm-watch/test.mjs  -- the storm sound mapping (pure logic).
import assert from 'node:assert/strict';
import {
  ranks, targetRank, orderRank, stormTune, tuneFreq, tuneSteps, noteCount, dueNotes, mixGains, loopSeconds, panOf, kmBetween, cssToRgb, DEFAULT_MAP, SOURCES, PITCH_LOW, PITCH_HIGH,
} from './mapping.js';
import { scaleFreqs, noteHz } from '../../core/scales.js';

const tones = scaleFreqs('pentatonic-major', noteHz(PITCH_LOW), noteHz(PITCH_HIGH));
assert.deepEqual(DEFAULT_MAP, { pitch: 'nothing', volume: 'size', tempo: 'speed', notes: 'size' });
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

const tune = (c, map, lat) => stormTune(ranks(c, comps, props(lat)), map);
const M = (o) => ({ pitch: 'nothing', volume: 'nothing', tempo: 'nothing', notes: 'nothing', ...o });
// Default: bigger = louder and more notes; same root; faster storm = shorter loop.
assert.ok(tune(big, DEFAULT_MAP).amp > tune(small, DEFAULT_MAP).amp);
assert.ok(tune(big, DEFAULT_MAP).n > tune(small, DEFAULT_MAP).n);
assert.equal(tune(big, DEFAULT_MAP).root, tune(small, DEFAULT_MAP).root);
assert.ok(tune(small, DEFAULT_MAP).loop < tune(big, DEFAULT_MAP).loop);
assert.equal(tune(mid, M({ notes: 'nothing' })).n, 5);
assert.equal(noteCount(0), 3); assert.equal(noteCount(1), 8); assert.deepEqual(tuneSteps(3), [0, 2, 1]);
// Pitch <- latitude (itay's original): north = higher.
assert.ok(tune(mid, M({ pitch: 'latitude' }), { 2: 50 }).root > tune(mid, M({ pitch: 'latitude' }), { 2: -50 }).root);
assert.ok(tune(small, M({ volume: 'rain' })).amp > tune(big, M({ volume: 'rain' })).amp);
assert.equal(tune(mid, M({ tempo: 'speed' })).loop, loopSeconds(null));
// Every note within the range (default C2..E6) and on the scale; the tune is not one repeated note.
for (const src of SOURCES) for (const c of comps) for (const lat of [-90, -30, 0, 30, 90]) {
  const t = tune(c, M({ pitch: src, volume: src, tempo: src, notes: src }), { [c.id]: lat });
  const fs = tuneSteps(t.n).map((k) => tuneFreq(tones, noteHz(t.root), k));
  for (const f of fs) { assert.ok(f >= noteHz(PITCH_LOW) - 1e-6 && f <= noteHz(PITCH_HIGH) + 1e-6, `${f}`); assert.ok(tones.includes(f)); }
  assert.ok(new Set(fs).size > 1);
  assert.ok(t.amp > 0 && t.amp <= 1 && t.loop >= 1.4 && t.loop <= 3.6);
}
assert.deepEqual(dueNotes(4, 2, 0, 0, 1).map((d) => d.k), [1, 2]);
const g = mixGains([0.5, 0.9, 0.1, 0.7, 0.3, 0.2, 0.8, 0.6, 0.4, 1], 8);
assert.equal(g.filter((x) => x > 0).length, 8); assert.equal(g[2], 0); assert.equal(g[5], 0);
assert.ok(g.reduce((a, b) => a + b, 0) < 4);
assert.ok(Math.abs(kmBetween({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111.2) < 1e-6);
assert.ok(Math.abs(kmBetween({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 }) - 111.2) < 1e-6);
assert.equal(panOf(-180), -1); assert.equal(panOf(90), 0.5); assert.equal(panOf(200), 1);
assert.deepEqual([cssToRgb('hsl(0 100% 50%)').r, cssToRgb('hsl(0 100% 50%)').g], [255, 0]);
assert.equal(cssToRgb('hsl(120 100% 50%)').g, 255);
console.log('storm-watch mapping tests ok');
