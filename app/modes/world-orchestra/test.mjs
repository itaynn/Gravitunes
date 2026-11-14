// node app/modes/world-orchestra/test.mjs  -- pure logic + real grid decoding (if the export exists).
// GRID_DIR overrides where 5152_256x128.{json,bin} are read from.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nearestCenters, blendWeight, voiceAt, blendVoices, shapeForPitch, selectTriggers } from './orchestra.js';
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
assert.equal(near(53.35, -6.26), 'celticharp');   // Dublin
assert.equal(near(-34.6, -58.38), 'bandoneon');   // Buenos Aires
assert.equal(near(-17.83, 31.05), 'mbira');       // Harare
assert.equal(blendWeight(100, 2000, 800), 1);
assert.equal(blendWeight(500, 500, 800), 0.5);
assert.equal(blendWeight(500, 900, 800), 0.75);
const far = voiceAt(28.61, 77.21, centers, instruments, 800);
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
console.log('world-orchestra tests ok');
