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

// Scale menu wiring: every motif note, in every menu scale and voice octave, is a scale tone within C4..E6.
{
  const { motifFreq: mf } = await import('./vortex.js');
  const { PLEASANT, scaleFreqs, noteHz, LOW_SEMIS, HIGH_SEMIS } = await import('../../core/scales.js');
  for (const id of PLEASANT) {
    const { TUNE_LOW, TUNE_HIGH } = await import('./vortex.js');
    const ts = scaleFreqs(id, noteHz(TUNE_LOW), noteHz(TUNE_HIGH));
    for (const m of MOTIFS) for (const dir of ['ccw', 'cw']) for (const oct of [-1, 0, 1]) {
      const fs = orient(m.steps, dir).map((st) => mf(ts, noteHz(m.root), st, oct));
      for (const f of fs) assert.ok(ts.includes(f) && f >= noteHz(TUNE_LOW) * 0.999 && f <= noteHz(TUNE_HIGH) * 1.001, `${id} ${f}`);
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

// rotating marker: one turn per melody, at note k exactly k/n of a turn, continuous across the loop
{
  const { markTurn } = await import('./vortex.js');
  assert.equal(markTurn(0, 4), 0); assert.equal(markTurn(1, 4), 0.25); assert.equal(markTurn(4, 4), 0);
  assert.ok(Math.abs(markTurn(3.9999, 4) - 1) < 1e-6 || markTurn(3.9999, 4) < 1e-6);
  assert.ok(markTurn(0.5, 4) > 0 && markTurn(0.5, 4) < 0.25);
  const src = readFileSync(join(here, 'main.js'), 'utf8');
  assert.doesNotMatch(src, /lowpass:/);
}
console.log('vortex-melodies marker ok');

// mapping: defaults, shared targets average, nothing -> neutral
{
  const { targetRank, mapped, DEFAULT_MAP } = await import('./vortex.js');
  const { noteCount, motifSteps, pitchRoot } = await import('./vortex.js');
  const v = { sizeRank: 1, strengthRank: 0, spinRank: 0.5, fade: 1 };
  assert.equal(targetRank(v, DEFAULT_MAP, 'pitch'), 1);
  assert.equal(targetRank(v, DEFAULT_MAP, 'notes'), 1);
  assert.equal(targetRank(v, { ...DEFAULT_MAP, tempo: 'nothing' }, 'tempo'), null);
  const m = mapped(v, DEFAULT_MAP);
  assert.equal(m.root, -24);                           // big = low (C2, the default range's bottom)
  assert.equal(m.n, 8);                                // big = more notes
  assert.equal(mapped({ ...v, sizeRank: 0 }, DEFAULT_MAP).n, 3);
  assert.ok(pitchRoot(0) > pitchRoot(1));
  assert.ok(Math.abs(m.loud - 0.35) < 1e-9);          // weakest = quietest
  assert.ok(Math.abs(m.loop - loopSeconds(0.5)) < 1e-9);
  const q = mapped(v, { pitch: 'nothing', volume: 'size', tempo: 'nothing', notes: 'nothing' });
  assert.equal(q.loud, 1); assert.equal(q.loop, loopSeconds(0.5)); assert.equal(q.n, 5); assert.equal(q.root, -4);
  assert.equal(pitchRoot(1, -12, 28), -12); assert.equal(pitchRoot(0, -12, 28), 16);   // follows the Low / High range
  for (let n = 3; n <= 8; n++) assert.equal(motifSteps(n).length, n);
  assert.equal(noteCount(null), 5);
  const src = readFileSync(join(here, 'main.js'), 'utf8');
  assert.match(src, /'Notes'/); assert.match(src, /steps = p\.n/); assert.match(src, /n = p \? p\.n/);
}

// Every dataset in the Data menu ships flow, divergence and vortices on the same time axis.
{
  const meta = JSON.parse(readFileSync(join(here, 'mode.json'), 'utf8'));
  assert.deepEqual(meta.datasets, ['4285', '5152', '5153', '5154']);
  for (const id of meta.datasets) {
    const dir = join(here, meta.datasetDirs[id]);
    const head = JSON.parse(readFileSync(join(dir, 'flow.json'), 'utf8'));
    const v = JSON.parse(readFileSync(join(dir, 'vortices.json'), 'utf8'));
    assert.equal(v.frames.length, head.frames, `${id} vortex frames`);
    assert.ok(v.tracks.length >= 20, `${id}: ${v.tracks.length} tracks`);
    for (const k of ['flow_64x32', 'divergence_64x32']) assert.ok(head.layers[k], `${id} ${k}`);
  }
}
console.log('vortex-melodies datasets ok');

// ---- hotspots: clustering + tracking
{
  const { findHotspots, trackHotspots, buildHotspots, cutoff } = await import('./hotspots.js');
  const { HOTSPOT_MAP, mapped } = await import('./vortex.js');
  const W = 64, H = 32, blank = () => new Float32Array(W * H).fill(0.05);
  const put = (lv, x0, y0, w, h, val) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) lv[y * W + ((x + W) % W)] = val; };
  const lv = blank();
  put(lv, 10, 14, 4, 4, 0.9);    // big strong blob near the equator
  put(lv, 40, 10, 2, 2, 0.6);    // smaller weaker blob
  put(lv, 62, 20, 4, 2, 0.8);    // wraps across the date line: one blob
  put(lv, 25, 5, 1, 1, 0.95);    // single cell: dropped as tiny
  const hs = findHotspots(lv, W, H, { top: 1, minLevel: 0.1, mergeKm: 300 });
  assert.equal(hs.length, 3);
  assert.ok(hs[0].mean > 0.85 && Math.abs(hs[0].peak - 0.9) < 1e-4);
  assert.ok(hs.find((h) => Math.abs(h.lon) > 170), 'date-line blob is one hotspot');
  assert.ok(hs.every((h) => h.area > 0 && h.r === Math.round(Math.sqrt(h.area / Math.PI))));
  // merging: two close blobs become one
  const lv2 = blank(); put(lv2, 10, 14, 3, 3, 0.9); put(lv2, 14, 14, 3, 3, 0.9);
  assert.equal(findHotspots(lv2, W, H, { top: 0.5, minLevel: 0.1, mergeKm: 0 }).length, 2);
  assert.equal(findHotspots(lv2, W, H, { top: 0.5, minLevel: 0.1, mergeKm: 3000 }).length, 1);
  assert.equal(cutoff(blank(), 0.1, 0.1), Infinity);   // nothing above minLevel: no hotspots
  // tracking keeps ids for a moving blob; a new far one gets its own id
  const tr = trackHotspots([[{ lat: 0, lon: 0, r: 200 }], [{ lat: 1, lon: 3, r: 200 }, { lat: 50, lon: 100, r: 200 }], [{ lat: 2, lon: 6, r: 200 }, { lat: 50, lon: 101, r: 200 }]], { minTrackFrames: 2 });
  assert.equal(tr.kind, 'hotspots');
  assert.deepEqual(tr.frames.map((f) => f[0].id), [1, 1, 1]);
  assert.equal(tr.frames[1][1].id, 2); assert.equal(tr.frames[2][1].id, 2);
  // plugs into the mode's ranks / active list; stronger = higher pitch root
  const data = buildHotspots((lat, lon, t) => (Math.abs(lat - 10) < 8 && Math.abs(lon - 5 * t) < 10 ? 0.9 : Math.abs(lat + 30) < 5 && Math.abs(lon + 90) < 5 ? 0.5 : 0.05), 4, 64, 32, { top: 1, minLevel: 0.1, minCells: 1 });
  assert.ok(data.tracks.length >= 2, `${data.tracks.length} tracks`);
  const rk = buildRanks(data), act = activeVortices(data, rk, 1, Infinity, new Map(data.tracks.map((t) => [t.id, t])));
  const strong = act.find((v) => v.mean > 0.8), weak = act.find((v) => v.mean < 0.6);
  assert.ok(mapped(strong, HOTSPOT_MAP).root > mapped(weak, HOTSPOT_MAP).root);
}
console.log('hotspots ok');
