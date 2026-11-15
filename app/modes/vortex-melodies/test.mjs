// node app/modes/vortex-melodies/test.mjs  -- pure logic + the shipped 4285 vortex data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseLayer } from '../../core/flow.js';
import { MOTIFS, orient, buildRanks, loopSeconds, lifeFade, motifIndex, activeVortices, convergence, periodText, dueNotes } from './vortex.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, 'data/4285');

// direction: ccw ascending, cw mirrored descending
assert.deepEqual(orient([0, 2, 4], 'ccw'), [0, 2, 4]);
assert.deepEqual(orient([0, 2, 4], 'cw'), [4, 2, 0]);
assert.deepEqual(orient([0, 1, 3], 'cw'), [3, 2, 0]);

// loop speed from spin rank; fades; motif choice
assert.equal(loopSeconds(0), 4); assert.ok(Math.abs(loopSeconds(1) - 1.2) < 1e-9); assert.ok(loopSeconds(0.5) < 4);
const tr = { birth: 10, death: 20 };
assert.equal(lifeFade(10, tr), 0.5); assert.equal(lifeFade(15, tr), 1); assert.equal(lifeFade(20, tr), 0.5);
assert.equal(lifeFade(25, tr), 0);
assert.equal(motifIndex('size', { sizeRank: 0 }), 0);
assert.equal(motifIndex('size', { sizeRank: 1 }), MOTIFS.length - 1);
assert.ok(MOTIFS[MOTIFS.length - 1].root < MOTIFS[0].root);           // big = lower
assert.ok(MOTIFS[MOTIFS.length - 1].steps.length > MOTIFS[0].steps.length);        // big = longer
assert.equal(motifIndex('region', { regionIndex: 4 }), 1);
assert.equal(periodText(1 / 6), '1 turn per 6 hours'); assert.equal(periodText(1 / 88), '1 turn per 4 days');

// scheduler: notes due in a window
assert.deepEqual(dueNotes(4, 2, 0, 0, 1).map((x) => x.k), [1, 2]);     // steps at 0.5, 1.0
assert.deepEqual(dueNotes(4, 2, 0, 1.9, 2.6).map((x) => x.k), [0, 1]); // 2.0 wraps to step 0, 2.5
assert.equal(dueNotes(3, 3, 0, 0.1, 0.2).length, 0);

// synthetic vortex data: ranking, cap, loudest first
const syn = {
  tracks: [{ id: 1, birth: 0, death: 9, frames: 10, direction: 'ccw' }, { id: 2, birth: 0, death: 9, frames: 10, direction: 'cw' },
    { id: 3, birth: 5, death: 9, frames: 5, direction: 'ccw' }],
  frames: Array.from({ length: 10 }, () => [
    { id: 1, lat: 10, lon: 0, r: 500, spin: 0.01, circ: 1000 },
    { id: 2, lat: -10, lon: 90, r: 100, spin: 0.02, circ: 100 },
    { id: 3, lat: 30, lon: -90, r: 300, spin: 0.015, circ: 500 }]),
};
const ranks = buildRanks(syn);
assert.ok(ranks.spin(0.02) > ranks.spin(0.015) && ranks.spin(0.015) > ranks.spin(0.01));
const byId = new Map(syn.tracks.map((t) => [t.id, t]));
const act = activeVortices(syn, ranks, 7, 2, byId);
assert.deepEqual(act.map((v) => v.id), [1, 3]);
assert.equal(act[0].spinRank, ranks.spin(0.01));
assert.ok(activeVortices(syn, ranks, 5, 5, byId).find((v) => v.id === 3).loud < activeVortices(syn, ranks, 7, 5, byId).find((v) => v.id === 3).loud);

// convergence: synthetic all-negative divergence = +1
const D = { dims: [4, 2], scale: 1, nodata: -128 };
assert.equal(convergence(parseLayer(D, new Int8Array(8).fill(-5)), 0), 1);
assert.equal(convergence(parseLayer(D, new Int8Array(8).fill(5)), 0), -1);
assert.equal(convergence(parseLayer(D, new Int8Array(8).fill(-128)), 0), 0);

// shipped data: no flickering tracks, ids consistent, ranks spread
const data = JSON.parse(readFileSync(join(dataDir, 'vortices.json'), 'utf8'));
assert.ok(data.tracks.length > 20, `${data.tracks.length} tracks`);
assert.ok(data.tracks.every((t) => t.frames >= 3));
const ids = new Set(data.tracks.map((t) => t.id));
assert.ok(data.frames.flat().every((v) => ids.has(v.id) && v.spin > 0 && v.r > 0));
const R = buildRanks(data), map = new Map(data.tracks.map((t) => [t.id, t]));
const counts = data.frames.map((_, t) => activeVortices(data, R, t, 4, map).length);
assert.ok(Math.max(...counts) === 4);
const head = JSON.parse(readFileSync(join(dataDir, 'flow.json'), 'utf8'));
const dl = head.layers.divergence_64x32;
const div = parseLayer(dl, new Int8Array(readFileSync(join(dataDir, dl.file))));
const bed = data.frames.map((_, t) => convergence(div, t));
assert.ok(bed.every((c) => c >= -1 && c <= 1));
console.log(`vortex-melodies tests ok (${data.tracks.length} tracks, bed ${Math.min(...bed).toFixed(2)}..${Math.max(...bed).toFixed(2)})`);

// Scale menu wiring: every motif note, in every menu scale and voice octave, is a scale tone within C2..C5.
{
  const { motifFreq: mf } = await import('./vortex.js');
  const { PLEASANT, scaleFreqs, noteHz } = await import('../../core/scales.js');
  for (const id of PLEASANT) {
    const ts = scaleFreqs(id, noteHz(-24), noteHz(12));
    for (const m of MOTIFS) for (const dir of ['ccw', 'cw']) for (const oct of [-1, 0, 1]) {
      const fs = orient(m.steps, dir).map((st) => mf(ts, noteHz(m.root), st, oct));
      for (const f of fs) assert.ok(ts.includes(f) && f >= noteHz(-24) * 0.999 && f <= noteHz(12) * 1.001, `${id} ${f}`);
      if (oct === 0) assert.ok(new Set(fs).size >= Math.min(3, new Set(m.steps).size), `${id} ${m.name} stays melodic`);
    }
  }
  const src = readFileSync(join(here, 'main.js'), 'utf8');
  assert.match(src, /scaleControl\(panel/);
  assert.doesNotMatch(src, /world-orchestra\/|const getJson/);
}
console.log('vortex-melodies scale wiring ok');

// keyboard text: nearest vortex distance and compass direction
{
  const { nearestText } = await import('./vortex.js');
  const { distKm, compass } = await import('../../core/geo.js');
  assert.equal(compass(0, 0, 10, -10), 'north-west'); assert.equal(compass(0, 0, -10, 0), 'south');
  assert.equal(compass(0, 0, 0, 10), 'east');
  assert.match(nearestText(0, 0, [{ lat: 10, lon: -10 }, { lat: -40, lon: 60 }], distKm, compass), /^no vortex; nearest 1600 km north-west$/);
  assert.equal(nearestText(0, 0, [], distKm, compass), 'no vortex; none at this time');
}
