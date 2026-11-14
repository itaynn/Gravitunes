// node app/modes/mapping-lab/test.mjs -- mapping functions, URL round-trip, presets, comfort caps.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PRESETS, encodeMapping, decodeMapping, presetOf, cloneMapping, emptyMapping, controls,
  sourceValues, renderNote, describeNote, makePoints, familyVoice, depthHz, attackSec } from './mapping.js';
import { capTimbre, applyLowpass, MAX_FUND_HZ } from '../../core/sound.js';
import { noteHz } from '../../core/scales.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const instruments = JSON.parse(readFileSync(join(root, 'data/earth/instruments.json'), 'utf8')).instruments;
const range = [5, 60];
const opts = { range, instruments };

// points
const pts = makePoints();
assert.ok(pts.length >= 250 && pts.length <= 350, `points ${pts.length}`);

// presets exist, round-trip through URL, and are recognized
assert.deepEqual(Object.values(PRESETS).map((p) => p.label), ['Classic', 'Deep south', 'Storm rush', 'Around the world']);
for (const [k, p] of Object.entries(PRESETS)) {
  assert.equal(presetOf(decodeMapping(encodeMapping(p.mapping))), k);
  assert.equal(presetOf(decodeMapping(k)), k);
}
assert.equal(PRESETS.classic.mapping.pitch.src, 'value');
assert.equal(PRESETS.classic.mapping.pan.src, 'lon');
assert.equal(PRESETS.deepsouth.mapping.depth.src, 'lat');
assert.equal(PRESETS.aroundworld.mapping.timbre.src, 'lon');

// custom mapping with flips round-trips; junk is ignored
const m = emptyMapping();
m.pitch = { src: 'lat', flip: true }; m.depth = { src: 'change', flip: false }; m.attack = { src: 'value', flip: true };
const enc = encodeMapping(m);
assert.equal(enc, 'pitch:-lat,depth:change,attack:-value');
assert.deepEqual(decodeMapping(enc), m);
assert.equal(presetOf(m), null);
assert.deepEqual(decodeMapping('bogus:value,pitch:nope,pan:lon'), { ...emptyMapping(), pan: { src: 'lon', flip: false } });
assert.equal(encodeMapping(decodeMapping('none')), '');
assert.equal(decodeMapping(null), null);
const c = cloneMapping(m); c.pitch.flip = false; assert.equal(m.pitch.flip, true);

// sources and controls
const sv = sourceValues({ lat: 90, lon: -180, value: 60, prev: 54.5 }, range);
assert.equal(sv.lat, 1); assert.equal(sv.lon, 0); assert.equal(sv.value, 1); assert.ok(Math.abs(sv.change - 1) < 1e-9);
assert.equal(sourceValues({ lat: 0, lon: 0, value: 30, prev: 40 }, range).change, 0);
const ctl = controls(m, { lat: 0.8, lon: 0.1, value: 0.25, change: 0.5 });
assert.ok(Math.abs(ctl.pitch - 0.2) < 1e-9); assert.equal(ctl.depth, 0.5); assert.equal(ctl.attack, 0.75); assert.equal(ctl.pan, 0.5);

// pitch follows value, stays in C2..C5, flip reverses
const cl = PRESETS.classic.mapping;
const note = (mp, value) => renderNote(mp, { lat: 0, lon: 0, value, prev: value }, opts);
const fLo = note(cl, 5).play.freq, fHi = note(cl, 60).play.freq;
assert.ok(Math.abs(fLo - noteHz(-24)) < 0.5 && Math.abs(fHi - noteHz(12)) < 0.5, `${fLo} ${fHi}`);
assert.equal(note(cl, 60).labels.pitch, 'C5'); assert.equal(note(cl, 5).labels.pitch, 'C2');
const flipped = cloneMapping(cl); flipped.pitch.flip = true;
assert.ok(note(flipped, 60).play.freq < note(flipped, 5).play.freq);
assert.ok(note(cl, 60).play.amp > note(cl, 5).play.amp);
assert.ok(renderNote(cl, { lat: 0, lon: 170, value: 30 }, opts).play.pan > 0.8);

// depth, attack, timbre, brightness
assert.ok(depthHz(0) < 250 && depthHz(1) > 3900 && depthHz(1) < 4100); assert.ok(attackSec(0) > attackSec(1));
const ds = PRESETS.deepsouth.mapping;
const south = renderNote(ds, { lat: -70, lon: 0, value: 30 }, opts), north = renderNote(ds, { lat: 70, lon: 0, value: 30 }, opts);
assert.ok(south.play.lowpass < north.play.lowpass); assert.equal(south.labels.depth, 'dark'); assert.equal(north.labels.depth, 'bright');
const sr = PRESETS.stormrush.mapping;
const fast = renderNote(sr, { lat: 0, lon: 0, value: 40, prev: 30 }, opts), slow = renderNote(sr, { lat: 0, lon: 0, value: 40, prev: 40 }, opts);
assert.ok(fast.play.envelope.attack < slow.play.envelope.attack);
assert.ok(fast.play.harmonics.length > slow.play.harmonics.length);
assert.equal(familyVoice(0, instruments).label, 'organ'); assert.equal(familyVoice(0.5, instruments).label, 'bell');
assert.equal(familyVoice(1, instruments).label, 'flute');
assert.equal(renderNote(PRESETS.aroundworld.mapping, { lat: 0, lon: -179, value: 30 }, opts).labels.timbre, 'organ');

// announcement
const n45 = renderNote(ds, { lat: 30, lon: 0, value: 45 }, opts);
const said = describeNote(ds, { lat: 30, lon: 0, value: 45 }, n45.labels, 'ppbv');
assert.match(said, /^value 45 ppbv gives pitch [A-G]#?\d(, [a-z ]+ \w+)*; latitude 30°N gives depth \w+$/);
assert.equal(describeNote(emptyMapping(), { lat: 0, lon: 0, value: 1 }, {}), 'nothing mapped');

// comfort caps (app/core/sound.js): fundamentals <= C5, nothing above 5 kHz, faded near the cap
const capped = capTimbre({ freq: 1000, harmonics: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], partials: [{ ratio: 10, amp: 1 }, { ratio: 2, amp: 1 }] });
assert.equal(capped.freq, MAX_FUND_HZ);
capped.harmonics.forEach((a, k) => { if (MAX_FUND_HZ * (k + 1) >= 5000) assert.equal(a, 0); });
assert.ok(capped.harmonics[7] > 0 && capped.harmonics[7] < 1);     // 4186 Hz: faded
assert.equal(capped.partials.length, 1);
for (const v of [5, 30, 60]) for (const p of Object.values(PRESETS)) {
  const { play } = renderNote(p.mapping, { lat: 50, lon: 100, value: v, prev: v - 3 }, opts);
  assert.ok(play.freq <= MAX_FUND_HZ + 0.01, `${play.freq}`);
}
const lp = applyLowpass({ harmonics: [1, 1, 1, 1] }, 200, 200);
assert.ok(lp.harmonics[0] > lp.harmonics[3] && lp.harmonics[3] < 0.1);

console.log('mapping-lab tests ok');
