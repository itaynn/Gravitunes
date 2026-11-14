// node app/modes/layered-maps/test.mjs -- pure mapping logic; uses real grids if present (GRID_ROOT or data/).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYERS, layerFreq, audible, frameAtDate, notesFor, describeReadings } from './layers.js';
import { parseGrid, makeNorm, formatValue } from '../../core/grid.js';

// Registers: all within C2..C5, distinct, ordered CO < ozone < NOx.
const C2 = 65.406, C5 = 523.251;
for (const l of LAYERS) {
  for (const x of [0, 0.25, 0.5, 0.75, 1]) {
    const f = layerFreq(l, x);
    assert.ok(f >= C2 - 0.01 && f <= C5 + 0.01, `${l.name} ${f} Hz out of C2..C5`);
  }
  assert.ok(layerFreq(l, 1) > layerFreq(l, 0), `${l.name} rises with value`);
}
const [co, oz, nox] = ['5153', '5152', '5154'].map((id) => LAYERS.find((l) => l.id === id));
assert.ok(layerFreq(co, 0.5) < layerFreq(oz, 0.5) && layerFreq(oz, 0.5) < layerFreq(nox, 0.5));
const mid = (layerFreq(oz, 0) * layerFreq(oz, 1)) ** 0.5;
assert.ok(mid > 130 && mid < 262, 'ozone centred C3-C4');
// registers never overlap, whatever the scale
for (const sc of ['pentatonic-major', 'pentatonic-minor', 'hirajoshi'])
  assert.ok(layerFreq(co, 1, sc) < layerFreq(oz, 0, sc) && layerFreq(oz, 1, sc) < layerFreq(nox, 0, sc), sc);
assert.ok(Math.abs(layerFreq(oz, 0) - 130.81) < 0.1 && Math.abs(layerFreq(oz, null) - 130.81) < 0.1);

// Mute / solo.
assert.deepEqual([...audible(LAYERS, {})].sort(), ['5152', '5153', '5154']);
assert.deepEqual([...audible(LAYERS, { 5152: 'mute' })].sort(), ['5153', '5154']);
assert.deepEqual([...audible(LAYERS, { 5154: 'solo', 5152: 'mute' })], ['5154']);
assert.deepEqual([...audible(LAYERS, { 5154: 'solo', 5153: 'solo' })].sort(), ['5153', '5154']);

// Time alignment.
const t0 = Date.parse('2026-10-29T09:00:00Z'), timeOf = (i) => new Date(t0 + i * 3 * 3600e3);
assert.equal(frameAtDate(10, timeOf, new Date(t0)), 0);
assert.equal(frameAtDate(10, timeOf, new Date(t0 + 6 * 3600e3)), 2);
assert.equal(frameAtDate(10, timeOf, new Date(t0 + 4 * 3600e3)), 1);
assert.equal(frameAtDate(10, timeOf, new Date(t0 + 999 * 3600e3)), 9);
assert.equal(frameAtDate(10, timeOf, new Date(t0 - 3600e3)), 0);

// Notes and descriptions.
const readings = LAYERS.map((layer, i) => ({ layer, value: i === 2 ? null : 10, norm: 0.5 }));
const notes = notesFor(readings, {}, 0.3);
assert.equal(notes.length, 2, 'no-data layer is silent');
assert.ok(notes.every((n) => n.pan === 0.3 && n.freq <= C5));
assert.equal(new Set(notes.map((n) => n.t)).size, 2, 'layers are staggered');
assert.equal(notesFor(readings, { 5153: 'mute' }).length, 1);
assert.equal(describeReadings(readings, (r) => (r.value == null ? 'no data' : `${r.value} ppbv`)),
  'carbon monoxide 10 ppbv, ozone 10 ppbv, nitrogen oxides no data');

// Real grids (optional): values at a point map into 0..1 and format.
const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.GRID_ROOT || join(here, '../../../data');
let real = 0;
for (const l of LAYERS) {
  const dir = join(root, 'nasa-svs', l.id, 'web');
  const h = join(dir, `${l.id}_256x128.json`);
  if (!existsSync(h)) continue;
  const header = JSON.parse(readFileSync(h, 'utf8'));
  const g = parseGrid(header, new Uint8Array(readFileSync(join(dir, `${l.id}_256x128.bin`))));
  const { norm } = makeNorm(header.range, header.transform);
  const v = g.valueAt(40, -75, 0);   // US east coast
  if (v == null) continue;
  const x = norm(v);
  assert.ok(x >= 0 && x <= 1);
  assert.ok(layerFreq(l, x) <= C5);
  assert.notEqual(formatValue(v), 'no data');
  real++;
}
console.log(`layered-maps tests ok${real ? ` (${real} real grids)` : ' (no grids found; set GRID_ROOT)'}`);
