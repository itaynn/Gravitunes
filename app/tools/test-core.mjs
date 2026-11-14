// node app/tools/test-core.mjs  -- tests the pure parts of app/core (no browser needed).
import assert from 'node:assert/strict';
import { buildLut, decode } from '../core/colorbar.js';

// Synthetic color bar: 100x4, transparent margins, white -> purple from x=10..89 on row 2.
const W = 100, H = 4, rgba = new Uint8ClampedArray(W * H * 4);
const color = (f) => [255 - 160 * f, 255 - 210 * f, 255 - 60 * f];
for (let x = 10; x < 90; x++) {
  const [r, g, b] = color((x - 10) / 79);
  rgba.set([r, g, b, 255], (2 * W + x) * 4);
}
const lut = buildLut(rgba, W, H, { row: 2, range: [5, 60] });
const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
near(decode(lut, ...color(1)), 60);
near(decode(lut, ...color(0.5)), 32.5);
near(decode(lut, 30, 30, 30), 5);        // grey/black base map -> low
near(decode(lut, 255, 255, 255), 5);     // white -> low
console.log('core tests ok');

// ---- grids: log10 transform, norm, formatting, tick-based colour bars
import { parseGrid, makeNorm, formatValue } from '../core/grid.js';
import { tickValue } from '../core/colorbar.js';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const lg = parseGrid({ dims: [2, 1], frames: 1, scale: 0.5, offset: -3, transform: 'log10' }, new Uint8Array([0, 8]));
near(lg.valueAt(0, -90, 0), 0.001, 1e-9);
near(lg.valueAt(0, 90, 0), 10, 1e-9);
const nlog = makeNorm([0.001, 22], 'log10');
near(nlog.norm(0.001), 0, 1e-9); near(nlog.norm(22), 1, 1e-9);
near(nlog.norm(0.01), 1 / Math.log10(22000), 1e-9);
near(nlog.denorm(nlog.norm(0.3)), 0.3, 1e-9);
near(makeNorm([5, 60]).norm(32.5), 0.5, 1e-9);
assert.equal(formatValue(0.0134), '0.013'); assert.equal(formatValue(14.2), '14');
assert.equal(formatValue(2.63), '2.6'); assert.equal(formatValue(412.7), '413');
near(tickValue(358, [[68, 0.001], [176, 0.01], [279, 0.1], [358, 1]], 'log'), 1, 1e-9);
near(tickValue(318.5, [[279, 0.1], [358, 1]], 'log'), Math.sqrt(0.1), 1e-9);
near(tickValue(129.5, [[67, 40], [192, 100]]), 70, 1e-9);

// Real exports (worktree data/, GRID_ROOT, or the main checkout); skipped when absent.
const here = dirname(fileURLToPath(import.meta.url));
const roots = [process.env.GRID_ROOT, join(here, '../../data/nasa-svs'),
  '/Users/moranshapira/projects/personal/Gravitunes/data/nasa-svs'].filter(Boolean);
function loadGrid(id) {
  for (const r of roots) {
    const h = join(r, id, 'web', `${id}_256x128.json`), b = join(r, id, 'web', `${id}_256x128.bin`);
    if (existsSync(h) && existsSync(b)) return parseGrid(JSON.parse(readFileSync(h, 'utf8')), new Uint8Array(readFileSync(b)));
  }
  return null;
}
const meanOver = (g, lat, lon) => { let s = 0, n = 0; for (let t = 0; t < g.frames; t++) { const v = g.valueAt(lat, lon, t); if (v != null) { s += v; n++; } } return s / n; };
const BEIJING = [39.9, 116.4], SPAC = [-40, -130];
const g52 = loadGrid('5152'), g53 = loadGrid('5153'), g54 = loadGrid('5154');
if (!g52 || !g53 || !g54) console.log('skip real grid tests: exports not found');
else {
  const o3 = meanOver(g52, 0, -150);
  assert.ok(o3 > 5 && o3 < 60, `ozone ${o3}`);
  assert.equal(g53.transform, 'linear');
  const co = meanOver(g53, ...BEIJING);
  assert.ok(co > 200 && co <= 500, `Beijing CO ${co}`);
  assert.equal(g54.transform, 'log10');
  const nox = meanOver(g54, ...BEIJING), noxSea = meanOver(g54, ...SPAC);
  assert.ok(nox > 5 && nox <= 22.01, `Beijing NOx ${nox}`);
  assert.ok(noxSea > 0.001 && noxSea < 0.02, `South Pacific NOx ${noxSea}`);
  const p50 = g54.percentile(0.5);
  assert.ok(p50 > 0.001 && p50 < 1, `NOx median ${p50}`);
  // norm(): log space spreads NOx usefully; linear would squash the sea to ~0.
  const nn = makeNorm(g54.header.range, 'log10').norm, nl = makeNorm(g54.header.range).norm;
  assert.ok(nn(noxSea) > 0.05 && nn(noxSea) < 0.4, `norm sea ${nn(noxSea)}`);
  assert.ok(nn(nox) > 0.85 && nn(nox) <= 1, `norm Beijing ${nn(nox)}`);
  assert.ok(nl(noxSea) < 0.001);
  const nc = makeNorm(g53.header.range).norm(co);
  assert.ok(nc > 0.3 && nc <= 1, `norm CO ${nc}`);
  console.log(`real grids: Beijing CO ${formatValue(co)}, Beijing NOx ${formatValue(nox)}, S Pacific NOx ${formatValue(noxSea)}, NOx median ${formatValue(p50)}`);
}
console.log('grid tests ok');

// Basemap: date-line splitting + shipped Natural Earth files.
{
  const { basemapPaths } = await import('../core/viewer.js');
  const toPixel = (lat, lon) => [((lon + 180) / 360) * 720, ((90 - lat) / 180) * 360];
  const paths = basemapPaths([[170, 0, 179, 1, -179, 2, -170, 3]], toPixel);
  assert.equal(paths.length, 2);
  assert.deepEqual(paths[0][0], [700, 180]);
  const fs = await import('node:fs');
  const dir = new URL('../../data/earth/', import.meta.url);
  for (const n of ['coastlines', 'borders']) {
    const f = new URL(`${n}.json`, dir);
    if (!fs.existsSync(f)) continue;
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.ok(d.lines.length > 100 && d.lines.every((l) => l.length >= 4 && l.length % 2 === 0), n);
    assert.ok(d.lines.flat().every((v) => Math.abs(v) <= 180));
  }
  console.log('basemap tests ok');
}

// ---- shared helpers: voiceNote, pickVoice, throttle; scaleControl follows the chosen scale on `sound`
{
  const { voiceNote, pickVoice } = await import('../core/voices.js');
  const { throttle } = await import('../core/ui.js');
  const { noteHz, scaleFreqs } = await import('../core/scales.js');
  const v = { harmonics: [1, 0.5], octave: 1, dur: 0.3 };
  const hi = voiceNote(v, noteHz(6));                      // shifted an octave up, folded back an octave under C5
  assert.ok(Math.abs(hi.note.freq - noteHz(6)) < 1e-9 && hi.dur === 0.3);
  const lo = voiceNote({ harmonics: [1], octave: -1 }, noteHz(-17));   // G2 an octave down -> folded to G2, not C2
  assert.ok(Math.abs(lo.note.freq - noteHz(-17)) < 1e-9);
  const tones = scaleFreqs('pentatonic-major', noteHz(-24), noteHz(12));
  assert.ok(tones.includes(voiceNote({ harmonics: [1] }, 300, { tones }).note.freq));
  assert.equal(pickVoice(['a', 'b', 'c'], 0), 'a');
  assert.equal(pickVoice(['a', 'b', 'c'], 1), 'c');
  let t = 0; const ready = throttle(150, () => t);
  assert.ok(ready()); t = 100; assert.ok(!ready()); assert.ok(ready(true)); t = 260; assert.ok(ready());

  globalThis.location = new URL('http://x/mode.html?mode=a');
  globalThis.history = { state: null, replaceState() {} };
  const { scaleControl } = await import('../core/scale-control.js');
  const used = [];
  const sound = { useScale: async (id) => { used.push(id); } };
  let onSel;
  const panel = { select: (l, o, cb) => { onSel = cb; return {}; } };
  scaleControl(panel, { value: 'pentatonic-minor', sound });
  onSel('pentatonic-major');
  assert.deepEqual(used, ['pentatonic-minor', 'pentatonic-major']);

  // Every mode that shows the Scale menu hands it `sound`, so value-only notes follow the chosen scale.
  const { readdirSync } = await import('node:fs');
  const modesDir = new URL('../modes/', import.meta.url);
  for (const m of readdirSync(modesDir)) {
    const p = new URL(`${m}/main.js`, modesDir);
    if (!existsSync(p)) continue;
    for (const call of readFileSync(p, 'utf8').match(/scaleControl\(panel, \{[^}]*\}/g) || []) {
      assert.match(call, /\bsound\b/, `${m}: scaleControl without sound`);
    }
  }
  console.log('shared helper tests ok');
}

// ---- switching tuning families on the real engine (same order as sound.js useScale: clear scale, tuning, scale)
{
  const { createEngine } = await import('../../sound-engine/js/engine.js');
  const { SCALES } = await import('../core/scales.js');
  const e = createEngine({ scale: 'pentatonic-major' });
  for (const id of ['slendro', 'pentatonic-major', 'pelog-lima', 'major']) {
    e.setScale(null); await e.setTuning(SCALES[id].tuning); e.setScale(id);
  }
  console.log('tuning switch tests ok');
}
