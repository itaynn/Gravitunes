// node app/modes/flow-tracers/test.mjs  -- pure logic + the shipped 4285 flow data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseLayer, flowAt, advect, compass, rankNormaliser } from '../../core/flow.js';
import { parseGrid } from '../../core/grid.js';
import { distKm } from '../../core/geo.js';
import { rng, scatter, stepTracer, pickVoices, speedBrightness, hoverGesture, flowBetween, rateOf, rateText, moveParticle } from './tracers.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, 'data/4285');

// compass + advect
assert.equal(compass(1, 0), 'east'); assert.equal(compass(1, 1), 'north-east'); assert.equal(compass(0, -1), 'south');
assert.equal(compass(-1, -1), 'south-west');
const a = advect(0, 0, 111.32, 0, 1);
assert.ok(Math.abs(a.lon - 1) < 1e-9 && a.lat === 0);
const b = advect(60, 179.9, 111.32, 111.32, 1);       // wraps the date line, 2 deg lon at 60N
assert.ok(b.lon < -177 && b.lon > -178.5 && Math.abs(b.lat - 61) < 1e-9);

// rank normaliser
const rn = rankNormaliser([5, 1, 3, 3, 10]);
assert.equal(rn(1), 0); assert.equal(rn(10), 1); assert.equal(rn(3), 0.375); assert.equal(rn(NaN), 0);

// synthetic flow layer: 4x2 grid, u = 10 km/h everywhere except one empty cell
const L = { dims: [4, 2], components: ['u', 'v'], scale: 1, nodata: -128 };
const bytes = new Int8Array(2 * 2 * 4 * 2).fill(0);
for (let t = 0; t < 2; t++) for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) bytes[((t * 2) * 2 + y) * 4 + x] = 10;
bytes[(0 * 2 + 1) * 4 + 3] = -128; bytes[((0 * 2 + 1) * 2 + 1) * 4 + 3] = -128;   // t0, y1, x3: no data
const fl = parseLayer(L, bytes);
assert.equal(fl.frames, 2);
assert.deepEqual(flowAt(fl, 45, -135, 0), { u: 10, v: 0 });
assert.deepEqual(flowAt(fl, -40, 120, 0), { u: 10, v: 0 });   // neighbours fill the empty cell
assert.equal(flowAt(fl, -45, 135, 0), null);                  // exactly on the empty cell
const empty = new Int8Array(bytes.length).fill(-128);
assert.equal(flowAt(parseLayer(L, empty), 10, 10, 0), null);

// tracer step: moves east, a tracer with no flow stays and counts quiet frames
const tr = stepTracer({ id: 0, lat: 0, lon: 0 }, fl, 0, 1, { value: () => 0.5 });
assert.ok(Math.abs(tr.lon - 10 / 111.32) < 1e-9 && tr.speed === 10 && tr.quiet === 0 && tr.trail.length === 1);
const still = stepTracer({ id: 1, lat: 0, lon: 0, quiet: 2 }, parseLayer(L, empty), 0, 1, { value: () => 0 });
assert.equal(still.lon, 0); assert.equal(still.quiet, 3); assert.equal(still.speed, 0);

// between frames: blend, rain rate decoding, particle motion
{
  const two = new Int8Array(bytes.length);
  for (let i = 0; i < 16; i++) two[i] = 10;          // t0: u = 10, v = 10
  for (let i = 16; i < 32; i++) two[i] = (i % 16) < 8 ? 30 : 0;   // t1: u = 30, v = 0
  const fl2 = parseLayer(L, two);
  const m = flowBetween(fl2, 10, 10, 0, 0.5, 2);
  assert.ok(Math.abs(m.u - 20) < 1e-9 && Math.abs(m.v - 5) < 1e-9);
  { const z = flowBetween(fl2, 10, 10, 0, 0, 2); assert.ok(Math.abs(z.u - 10) < 1e-9 && Math.abs(z.v - 10) < 1e-9); }
  assert.equal(rateOf(0), 0); assert.ok(Math.abs(rateOf(1) - 50) < 1e-9); assert.ok(Math.abs(rateOf(0.02) - 0.1) < 0.02);
  assert.equal(rateText(0), 'dry'); assert.match(rateText(0.5), /moderate rain, \d mm per hour/);
  const p = { lat: 0, lon: 0, age: 0, life: 2 };
  assert.equal(moveParticle(p, { u: 111.32, v: 0 }, 1), true); assert.ok(Math.abs(p.lon - 1) < 1e-9);
  assert.equal(moveParticle(p, null, 1), false);       // too old
}

// voices: loudest first, capped, quiet ones excluded
const trs = [{ value: 0.2 }, { value: null }, { value: 0.9 }, { value: 0.01 }, { value: 0.5 }];
assert.deepEqual(pickVoices(trs, 2), [2, 4]);
assert.deepEqual(pickVoices(trs, 10), [2, 4, 0]);
assert.equal(speedBrightness(30), 0.5); assert.equal(speedBrightness(500), 1);
const g = hoverGesture(30, 0, 0);
assert.ok(g.rate === 3.5 && g.pan1 > g.pan0);
assert.ok(hoverGesture(0, 0, 90).notes === 2);

// scatter is even: nearest-neighbour distance is far above uniform random
const pts = scatter(30, { random: rng(7) });
assert.equal(pts.length, 30);
const nn = (ps) => Math.min(...ps.map((p, i) => Math.min(...ps.filter((_, j) => j !== i).map((q) => distKm(p.lat, p.lon, q.lat, q.lon)))));
const r = rng(7), uni = Array.from({ length: 30 }, () => ({ lat: Math.asin(r() * 2 - 1) * 180 / Math.PI * 0.78, lon: r() * 360 - 180 }));
assert.ok(nn(pts) > 1500, `min spacing ${nn(pts)}`);
assert.ok(nn(pts) > nn(uni));
assert.ok(pts.every((p) => Math.abs(p.lat) <= 70.001));
const rainy = scatter(5, { random: rng(3), accept: (lat) => lat > 0 });
assert.ok(rainy.every((p) => p.lat > 0));

// shipped data
const head = JSON.parse(readFileSync(join(dataDir, 'flow.json'), 'utf8'));
const lay = head.layers.flow_160x80;
const real = parseLayer(lay, new Int8Array(readFileSync(join(dataDir, lay.file))));
assert.equal(real.frames, head.frames);
let moving = 0, n = 0;
for (let lat = -60; lat <= 60; lat += 10) for (let lon = -170; lon < 180; lon += 10) {
  const f = flowAt(real, lat, lon, 20); if (f) { n++; if (Math.hypot(f.u, f.v) > 1) moving++; }
}
assert.ok(n > 30 && moving > n / 2, `${n} cells with flow, ${moving} moving`);
const fh = JSON.parse(readFileSync(join(dataDir, 'field_256x128.json'), 'utf8'));
const field = parseGrid(fh, new Uint8Array(readFileSync(join(dataDir, 'field_256x128.bin'))));
assert.equal(field.frames, head.frames);
assert.ok(field.percentile(0.99) > 0.1);
console.log(`flow-tracers tests ok (${n} sampled cells with flow, ${moving} moving)`);

// Scale menu wiring: shared menu, core helpers, notes snapped into the scale within C2..C5.
{
  const { PLEASANT, scaleFreqs, snapToScale, noteHz, LOW_SEMIS, HIGH_SEMIS } = await import('../../core/scales.js');
  for (const id of PLEASANT) {
    const ts = scaleFreqs(id, noteHz(LOW_SEMIS), noteHz(HIGH_SEMIS));
    for (const f of [30, noteHz(LOW_SEMIS), 200, noteHz(7) * 2, 5000]) {
      const g = snapToScale(f, ts);
      assert.ok(ts.includes(g) && g >= noteHz(LOW_SEMIS) * 0.999 && g <= noteHz(HIGH_SEMIS) * 1.001);
    }
  }
  const src = readFileSync(join(here, 'main.js'), 'utf8');
  assert.match(src, /scaleControl\(panel/);
  assert.doesNotMatch(src, /world-orchestra\/|const getJson|fmtPos/);
}
console.log('flow-tracers scale wiring ok');

// Every dataset in the Data menu ships its own folder: flow layer frame-aligned with the value grid.
{
  const meta = JSON.parse(readFileSync(join(here, 'mode.json'), 'utf8'));
  assert.deepEqual(meta.datasets, ['4285', '5152', '5153', '5154']);
  for (const id of meta.datasets) {
    const dir = join(here, meta.datasetDirs[id]);
    const head = JSON.parse(readFileSync(join(dir, 'flow.json'), 'utf8'));
    const L = Object.entries(head.layers).find(([k]) => k.startsWith('flow_'))[1];
    const [W, H] = L.dims;
    const frames = readFileSync(join(dir, L.file)).length / (W * H * 2);
    const grid = JSON.parse(readFileSync(join(dir, id === '4285' ? 'field_256x128.json' : `${id}_256x128.json`), 'utf8'));
    assert.equal(frames, grid.frames, `${id} flow frames`);
    assert.deepEqual(head.times, grid.times, `${id} times`);
  }
}
// Value wording per dataset (core/fields.js)
{
  const { fieldOf } = await import('../../core/fields.js');
  const fake = (id) => ({ id, title: 'x', valueAt: () => 40, norm: (v) => (v - 5) / 55, format: (v) => `${v} ppbv`, percentile: (p) => 5 + 55 * p });
  const oz = fieldOf(fake('5152'));
  assert.equal(oz.name, 'ozone'); assert.ok(Math.abs(oz.threshold - 0.5) < 1e-9);
  assert.match(oz.text(0, 0, 0), /^ozone 40 ppbv, (high|moderate)/);
  assert.equal(oz.spread(oz.threshold), 0);
  const rain = fieldOf({ id: '4285', valueAt: () => 0.5 });
  assert.equal(rain.threshold, 0.02); assert.match(rain.text(0, 0, 0), /moderate rain/);
}
// listenWeights: Everything spreads worldwide, Near point concentrates
{
  const { listenWeights, listenAmps } = await import('./tracers.js');
  const trs = [];
  for (let k = 0; k < 10; k++) trs.push({ lat: 0, lon: k * 0.5, value: 0.5 });
  trs.push({ lat: 40, lon: -100, value: 0.9 }, { lat: -30, lon: 140, value: 0.4 }, { lat: 10, lon: 60, value: 0.01 });
  const ev = listenWeights(trs, { cap: 4 });
  assert.equal(ev.length, 4);
  assert.ok(ev.some((x) => x.i === 10) && ev.some((x) => x.i === 11) && ev.some((x) => x.i < 10));
  assert.ok(!ev.some((x) => x.i === 12));
  assert.equal(Math.max(...ev.map((x) => x.w)), 1);
  const nr = listenWeights(trs, { mode: 'near', point: { lat: 40, lon: -100 }, cap: 4 });
  assert.equal(nr[0].i, 10); assert.equal(nr.length, 1);
  assert.ok(listenAmps(ev).every((a) => a > 0 && a <= 0.6));
}
console.log('flow-tracers datasets ok');
