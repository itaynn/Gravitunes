// node app/modes/synth-lab/test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toneNotes, chordSteps, neighbor } from './tones.js';
import { noteHz, PLEASANT, SCALES } from '../../core/scales.js';
for (const id of PLEASANT) assert.ok(SCALES[id].cents.length >= 5 && SCALES[id].label, id);
import { MAX_FUND_HZ } from '../../core/sound.js';
import { orderModes, oneLine } from '../../core/switcher.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const { instruments } = JSON.parse(readFileSync(join(root, 'data/earth/instruments.json'), 'utf8'));
const lib = JSON.parse(readFileSync(join(root, 'sound-engine/library/presets/index.json'), 'utf8'));
const voices = [...Object.values(instruments), ...lib.map((p) => JSON.parse(readFileSync(join(root, `sound-engine/library/presets/${p.id}.json`), 'utf8')))];

for (const v of voices) for (const semis of [-24, -12, 0, 12, 21]) for (const kind of ['note', 'scale', 'chord', 'phrase']) {
  const notes = toneNotes(v, noteHz(semis), kind);
  assert.ok(notes.length >= 1, kind);
  for (const n of notes) {
    assert.ok(n.freq >= 30 && n.freq <= MAX_FUND_HZ + 1e-6, `${kind} ${n.freq}`);
    if (n.glide) assert.ok(n.glide.to <= MAX_FUND_HZ + 1e-6);
  }
  if (kind === 'chord') assert.ok(notes.every((n) => n.t === 0) && notes.length === 3);
  if (kind === 'note') assert.equal(notes.length, 1);
}
assert.equal(toneNotes({}, noteHz(-12), 'scale').length, 8);
for (const id of PLEASANT) for (const semis of [-24, 0, 12]) for (const n of toneNotes({}, noteHz(semis), 'scale', id)) {
  assert.ok(n.freq >= 60 && n.freq <= MAX_FUND_HZ + 1e-6, `${id} ${n.freq}`);
}
assert.equal(toneNotes({}, noteHz(-12), 'scale', 'slendro').length, 6);
// Chords are root, a third and a fifth in every scale (C-E-G in major pentatonic, not C-E-A).
assert.deepEqual(chordSteps(SCALES['pentatonic-major'].cents), [0, 2, 3]);
for (const id of PLEASANT) assert.equal(toneNotes({}, noteHz(-12), 'chord', id).length, 3, id);

// Gallery / switcher order: tone lab first (world orchestra is hidden), then the rest in index order.
const { modes } = JSON.parse(readFileSync(join(root, 'app/modes/index.json'), 'utf8'));
const ids = orderModes(modes).map((m) => m.id);
assert.equal(ids[0], 'synth-lab');
assert.ok(!ids.includes('world-orchestra'));
assert.equal(ids.length, modes.length);
assert.equal(oneLine('One. Two.'), 'One.');
{
  const cs = [{ id: 'a', lat: 0, lon: 0 }, { id: 'e', lat: 2, lon: 30 }, { id: 'w', lat: 0, lon: -40 }, { id: 'n', lat: 40, lon: 5 }, { id: 'far', lat: 0, lon: 170 }];
  assert.equal(neighbor(cs, cs[0], 'right').id, 'e');
  assert.equal(neighbor(cs, cs[0], 'left').id, 'w');
  assert.equal(neighbor(cs, cs[0], 'up').id, 'n');
  assert.equal(neighbor(cs, cs[4], 'right').id, 'w');   // wraps across the date line
  assert.equal(neighbor(cs, cs[0], 'down'), null);
  const { centers } = JSON.parse(readFileSync(join(root, 'data/earth/musical-centers.json'), 'utf8'));
  for (const c of centers) for (const d of ['left', 'right']) assert.ok(neighbor(centers, c, d), `${c.id} ${d}`);
}
{
  const { waveHarmonics, builderFromVoice, builderSynth, brightHz, NH } = await import('./tones.js');
  assert.deepEqual(waveHarmonics('sine').slice(0, 2), [1, 0]);
  assert.equal(waveHarmonics('square')[1], 0);
  assert.equal(brightHz(1), 12000);
  for (const v of [{}, ...Object.values(instruments)]) {
    const b = builderFromVoice(v);
    assert.equal(b.harmonics.length, NH);
    const s = builderSynth(b);
    assert.ok(s.lowpass >= 600 && s.lowpass <= 12000 && s.envelope.attack > 0);
    if (v.sample && !v.samples) assert.equal(b.sample, v.sample);
  }
}
console.log('tone lab tests ok');
