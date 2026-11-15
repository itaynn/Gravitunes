// node app/modes/world-orchestra/test.mjs  -- pure logic + real grid decoding (if the export exists).
// GRID_DIR overrides where 5152_256x128.{json,bin} are read from.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nearestCenters, blendWeight, voiceAt, blendVoices, shapeForPitch, selectTriggers, distKm } from './orchestra.js';
import { quantize, scaleFreqs, SCALES, noteHz } from '../../core/scales.js';
import { parseGrid, frameForHour } from '../../core/grid.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const J = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const centers = J('data/earth/musical-centers.json').centers;
const instruments = J('data/earth/instruments.json').instruments;
const cities = J('data/earth/cities.json').cities;

// data sanity
assert.ok(cities.length >= 200 && cities.length <= 300, `cities: ${cities.length}`);
for (const c of centers) assert.ok(instruments[c.instrument], `missing instrument ${c.instrument}`);
for (const [n, , lat, lon] of cities) assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, n);

// nearest center + blend
const near = (lat, lon) => nearestCenters(lat, lon, centers)[0].center.instrument;
assert.equal(near(28.61, 77.21), 'sitar');        // Delhi
assert.equal(near(35.68, 139.69), 'koto');        // Tokyo
assert.equal(near(-6.21, 106.85), 'gamelan');     // Jakarta
assert.equal(near(53.35, -6.26), 'fiddle');       // Dublin
assert.equal(near(-34.6, -58.38), 'bandoneon');   // Buenos Aires
assert.equal(near(-17.83, 31.05), 'mbira');       // Harare
assert.equal(blendWeight(100, 2000, 800), 1);
assert.equal(blendWeight(500, 500, 800), 0.5);
assert.equal(blendWeight(500, 900, 800), 0.75);
const far = voiceAt(27, 80, centers, instruments, 300);
assert.equal(far.weight, 1); assert.equal(far.secondary, null);
const mix = blendVoices(instruments.organ, instruments.gamelan, 0.25);
assert.ok(Math.abs(mix.envelope.attack - (instruments.organ.envelope.attack * 0.25 + instruments.gamelan.envelope.attack * 0.75)) < 1e-9);
assert.ok(Math.abs(mix.harmonics[0] - 1) < 1e-9 && Math.abs(mix.harmonics[1] - 0.7 * 0.25) < 1e-9);
assert.equal(mix.partials.length, 4);
assert.ok(Math.abs(mix.partials[0].amp - 0.6 * 0.75) < 1e-9);
// halfway between Berlin-ish organ and Athens bouzouki: blended
const mid = voiceAt(44.7, 18.0, centers, instruments, 2000);
assert.ok(mid.weight < 1 && mid.secondary);

// pitch shaping: upper partials roll off as pitch rises, nothing above 4 kHz
const lowV = shapeForPitch(instruments.banjo, 100), highV = shapeForPitch(instruments.banjo, 500);
assert.ok(highV.harmonics[7] < lowV.harmonics[7]);
assert.ok(shapeForPitch(instruments.balafon, 500).partials.every((p) => p.ratio * 500 <= 4000));

// threshold triggering
const prev = [10, 40, 29, null, 20, 31];
const cur  = [35, 45, 30, 50, 50, 29];
assert.deepEqual(selectTriggers({ prev, cur, threshold: 30, frame: 5 }), [4, 0, 2]);   // loudest first
assert.deepEqual(selectTriggers({ prev, cur, threshold: 30, frame: 5, maxNotes: 1 }), [4]);
assert.deepEqual(selectTriggers({ prev, cur, threshold: 30, frame: 5, lastPlayed: [null, null, null, null, 3], cooldown: 4 }), [0, 2]);
assert.deepEqual(selectTriggers({ prev, cur, threshold: 30, frame: 5, lastPlayed: [null, null, null, null, 1], cooldown: 4 }), [4, 0, 2]);

// scale quantization
const lo = noteHz(-24), hi = noteHz(12);            // C2..C5
assert.equal(scaleFreqs('pentatonic-major', noteHz(0), noteHz(12)).length, 6);
assert.ok(Math.abs(quantize(5, [5, 60], 'pentatonic-major', lo, hi).freq - noteHz(-24)) < 1e-6);
assert.ok(Math.abs(quantize(60, [5, 60], 'pentatonic-major', lo, hi).freq - noteHz(12)) < 1e-6);
for (const k of Object.keys(SCALES)) for (let v = 5; v <= 60; v += 0.7) {
  const { freq } = quantize(v, [5, 60], k, noteHz(-17), noteHz(7));
  assert.ok(freq >= noteHz(-17) * 0.999 && freq <= noteHz(7) * 1.001, `${k} ${v} ${freq}`);
}
const sl = scaleFreqs('slendro', noteHz(0), noteHz(12.2));
assert.ok(Math.abs(1200 * Math.log2(sl[1] / sl[0]) - 238) < 1e-6);
assert.ok(Math.abs(1200 * Math.log2(sl[5] / sl[0]) - 1210) < 1e-6);   // stretched period
// monotonic
let last = 0;
for (let v = 5; v <= 60; v++) { const f = quantize(v, [5, 60], 'pelog').freq; assert.ok(f >= last); last = f; }

// grid decoding (real export)
assert.equal(frameForHour([{ hour: 0 }, { hour: 16 }, { hour: 32 }], 20), 1);
const dirs = [process.env.GRID_DIR, join(root, 'data/nasa-svs/5152/web'),
  '/Users/moranshapira/projects/personal/Gravitunes/.claude/worktrees/data-tools/data/nasa-svs/5152/web'].filter(Boolean);
const dir = dirs.find((d) => existsSync(join(d, '5152_256x128.bin')));
if (!dir) console.log('skip grid test: no 5152_256x128.bin found');
else {
  const header = JSON.parse(readFileSync(join(dir, '5152_256x128.json'), 'utf8'));
  const g = parseGrid(header, new Uint8Array(readFileSync(join(dir, '5152_256x128.bin'))));
  assert.equal(g.width, 256); assert.equal(g.height, 128); assert.equal(g.frames, 396);
  assert.equal(g.times[0], '2026-10-29T09:00:00Z');
  let n = 0, nul = 0;
  for (let t = 0; t < g.frames; t += 37) for (const [, , lat, lon] of cities) {
    const v = g.valueAt(lat, lon, t);
    if (v == null) { nul++; continue; }
    assert.ok(v >= 5 - 1e-9 && v <= 60 + 1e-6, `value ${v}`); n++;
  }
  assert.ok(n > nul, `${n} values, ${nul} nodata`);
  // manual decode of one cell matches
  const x = Math.floor(((77.21 + 180) / 360) * 256), y = Math.floor(((90 - 28.61) / 180) * 128);
  const b = g.bytes[3 * 256 * 128 + y * 256 + x];
  assert.equal(g.valueAt(28.61, 77.21, 3), b === 255 ? null : header.offset + b * header.scale);
  const p70 = g.percentile(0.7);
  assert.ok(p70 > 5 && p70 < 60, `p70 ${p70}`);
  console.log(`grid ok: ${dir}, p70 = ${p70.toFixed(1)} ppbv, Delhi t3 = ${g.valueAt(28.61, 77.21, 3)?.toFixed(1)}`);
}

// ---- Instruments view (the former Timbre atlas)
{
const { gestureNotes, degreeCents, timbreSignature, liftToFloor } = await import('./orchestra.js');
const { noteHz, MIN_FUND_HZ, MAX_FUND_HZ } = await import('../../core/scales.js');
const samples = J('sound-engine/library/samples/index.json');
assert.ok(centers.length >= 40 && centers.length <= 70, `${centers.length} regions`);
// no big silent area: every land point of a coarse grid is within 2500 km of a land region
const land = centers.filter((c) => c.instrument !== 'ocean');
for (const [lat, lon] of [[62, 100], [65, 140], [55, 60], [0, 20], [-25, 20], [15, 0], [60, -100], [-10, -60], [45, 90]])
  assert.ok(Math.min(...land.map((c) => distKm(lat, lon, c.lat, c.lon))) < 1500, `gap near ${lat},${lon}`);
// drums play patterns at their own pitch
const djembe = gestureNotes(instruments.djembe, noteHz(-12));
assert.ok(djembe.length >= 6 && djembe.some((n) => n.amp < 1) && new Set(djembe.map((n) => n.t)).size === djembe.length);
assert.deepEqual(gestureNotes(instruments.djembe, noteHz(-12)).map((n) => n.freq), gestureNotes(instruments.djembe, noteHz(-5)).map((n) => n.freq));
assert.ok(gestureNotes(instruments.talkingdrum, noteHz(-12)).every((n) => n.glide));

// every center's instrument exists, has a gesture, and sounds different from every other instrument
const ids = [...new Set(centers.map((c) => c.instrument))];
for (const id of ids) {
  const v = instruments[id];
  assert.ok(v, `missing instrument ${id}`);
  if (v.sample) assert.ok(samples[v.sample], `${id}: sample ${v.sample} not in samples/index.json`);
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
for (const id of ['guzheng', 'koto', 'oud', 'kora', 'banjo', 'balalaika'].filter((k) => instruments[k])) {
  const ps = instruments[id].partials.filter((p) => Number.isInteger(p.ratio) && p.ratio >= 3);
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i].decay <= ps[i - 1].decay, `${id}: higher partials decay faster`);
}

// gestures: never above MAX_FUND_HZ (A5) (including glides and vibrato peaks), for all base pitches and both modes
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
// floor: after lifting, every gesture's lowest note is >= C2 at the lowest base pitch (F2), still <= A5
for (const id of Object.keys(instruments)) for (const phrase of [true, false]) {
  const notes = liftToFloor(gestureNotes(instruments[id], noteHz(-19), { phrase }), MIN_FUND_HZ, MAX_FUND_HZ);
  assert.ok(Math.min(...notes.map((n) => n.freq)) >= MIN_FUND_HZ - 1e-6 ||
    Math.max(...notes.map((n) => n.freq)) * 2 > MAX_FUND_HZ, `${id} too low`);
  assert.ok(notes.every((n) => Math.max(n.freq, n.glide?.to || 0) <= MAX_FUND_HZ + 1e-6));
}
const lowInst = Object.values(instruments).find((v) => v.octave === -1);
if (lowInst) assert.ok(liftToFloor(gestureNotes(lowInst, noteHz(-19)), MIN_FUND_HZ, MAX_FUND_HZ)[0].freq >= MIN_FUND_HZ - 1e-6);
// phrases are phrases; tremolo repeats; scales are idiomatic
assert.ok(gestureNotes(instruments.guzheng, noteHz(-12)).length >= 4);
assert.ok(gestureNotes(instruments.balalaika, noteHz(-12)).length >= 12);
assert.equal(gestureNotes(instruments.koto, noteHz(-12), { phrase: false }).length, 1);
assert.equal(degreeCents(instruments.oud.gesture, 2), 350);                 // rast neutral third
assert.equal(degreeCents(instruments.gamelan.gesture, 7), 1220);            // pelog stretched period
assert.ok(gestureNotes(instruments.sitar, noteHz(-12)).every((n) => n.glide));  // meend
// blended voice keeps the nearer instrument's gesture
assert.equal(voiceAt(28.61, 77.21, centers, instruments, 900).voice.gesture, instruments.sitar.gesture);

}
console.log('world-orchestra tests ok');
