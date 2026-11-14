// node app/modes/timbre-atlas/test.mjs -- instruments are present and distinct; gestures stay <= C5.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gestureNotes, degreeCents, timbreSignature, voiceAt, liftToFloor } from './atlas.js';
import { shapeForPitch } from '../../core/voices.js';
import { noteHz } from '../../core/scales.js';
import { MAX_FUND_HZ } from '../../core/sound.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const J = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const centers = J('data/earth/musical-centers.json').centers;
const instruments = J('data/earth/instruments.json').instruments;

// every center's instrument exists, has a gesture, and sounds different from every other instrument
const ids = [...new Set(centers.map((c) => c.instrument))];
for (const id of ids) {
  const v = instruments[id];
  assert.ok(v, `missing instrument ${id}`);
  assert.ok(v.label && v.inspiredBy && v.gesture?.steps?.length, `${id}: label, inspiredBy, gesture`);
}
const sigs = new Map();
for (const id of ids) {
  const sig = timbreSignature(instruments[id]);
  assert.ok(!sigs.has(sig), `${id} sounds the same as ${sigs.get(sig)}`);
  sigs.set(sig, id);
}
// envelope families differ: plucked/struck (sustain ~0, fast attack) vs blown/bowed (slow attack, sustain)
assert.ok(instruments.duduk.envelope.attack > 5 * instruments.guzheng.envelope.attack);
assert.equal(instruments.guzheng.envelope.sustain, 0);
assert.ok(instruments.organ.envelope.sustain >= 0.8);
// bar ratios for the gamelan and bright, faster-decaying upper partials for plucked strings
assert.deepEqual(instruments.gamelan.partials.slice(1, 3).map((p) => p.ratio), [2.76, 5.4]);
for (const id of ['guzheng', 'koto', 'oud', 'kora', 'banjo', 'balalaika']) {
  const ps = instruments[id].partials.filter((p) => Number.isInteger(p.ratio) && p.ratio >= 3);
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i].decay <= ps[i - 1].decay, `${id}: higher partials decay faster`);
}

// gestures: never above C5 (including glides and vibrato peaks), for all base pitches and both modes
for (const id of Object.keys(instruments)) for (let semis = -19; semis <= 0; semis++) for (const phrase of [true, false]) {
  const notes = gestureNotes(instruments[id], noteHz(semis), { phrase });
  assert.ok(notes.length >= 1);
  for (const n of notes) {
    const peak = Math.max(n.freq, n.glide?.to || 0) * 2 ** ((n.vibrato?.depth || 0) / 1200);
    assert.ok(peak <= MAX_FUND_HZ + 1e-6, `${id} ${semis} ${peak}`);
    assert.ok(n.freq > 30 && n.t >= 0 && n.dur > 0);
    const sh = shapeForPitch(instruments[id], n.freq);
    assert.ok(sh.harmonics.every((a, k) => a === 0 || n.freq * (k + 1) <= 4000));
  }
}
// floor: after lifting, every gesture's lowest note is >= C2 at the lowest base pitch (F2), still <= C5
for (const id of Object.keys(instruments)) for (const phrase of [true, false]) {
  const notes = liftToFloor(gestureNotes(instruments[id], noteHz(-19), { phrase }), noteHz(-24), MAX_FUND_HZ);
  assert.ok(Math.min(...notes.map((n) => n.freq)) >= noteHz(-24) - 1e-6 ||
    Math.max(...notes.map((n) => n.freq)) * 2 > MAX_FUND_HZ, `${id} too low`);
  assert.ok(notes.every((n) => Math.max(n.freq, n.glide?.to || 0) <= MAX_FUND_HZ + 1e-6));
}
const lowInst = Object.values(instruments).find((v) => v.octave === -1);
if (lowInst) assert.ok(liftToFloor(gestureNotes(lowInst, noteHz(-19)), noteHz(-24), MAX_FUND_HZ)[0].freq >= noteHz(-24) - 1e-6);
// phrases are phrases; tremolo repeats; scales are idiomatic
assert.ok(gestureNotes(instruments.guzheng, noteHz(-12)).length >= 4);
assert.ok(gestureNotes(instruments.balalaika, noteHz(-12)).length >= 12);
assert.equal(gestureNotes(instruments.koto, noteHz(-12), { phrase: false }).length, 1);
assert.equal(degreeCents(instruments.oud.gesture, 2), 350);                 // rast neutral third
assert.equal(degreeCents(instruments.gamelan.gesture, 7), 1220);            // pelog stretched period
assert.ok(gestureNotes(instruments.sitar, noteHz(-12)).every((n) => n.glide));  // meend
// blended voice keeps the nearer instrument's gesture
assert.equal(voiceAt(28.61, 77.21, centers, instruments, 900).voice.gesture, instruments.sitar.gesture);
console.log('timbre-atlas tests ok');
