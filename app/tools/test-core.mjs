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
  const { noteHz, scaleFreqs, LOW_SEMIS, HIGH_SEMIS } = await import('../core/scales.js');
  const v = { harmonics: [1, 0.5], octave: 1, dur: 0.3 };
  const hi = voiceNote(v, noteHz(20));                     // shifted an octave up, folded back an octave under E6
  assert.ok(Math.abs(hi.note.freq - noteHz(20)) < 1e-9 && hi.dur === 0.3);
  const lo = voiceNote({ harmonics: [1], octave: -1 }, noteHz(-17));   // G2 an octave down -> folded to G2, not C2
  assert.ok(Math.abs(lo.note.freq - noteHz(-17)) < 1e-9);
  const tones = scaleFreqs('pentatonic-major', noteHz(LOW_SEMIS), noteHz(HIGH_SEMIS));
  assert.ok(tones.includes(voiceNote({ harmonics: [1] }, 300, { tones }).note.freq));
  assert.equal(pickVoice(['a', 'b', 'c'], 0), 'a');
  assert.equal(pickVoice(['a', 'b', 'c'], 1), 'c');
  let t = 0; const ready = throttle(150, () => t);
  assert.ok(ready()); t = 100; assert.ok(!ready()); assert.ok(ready(true)); t = 260; assert.ok(ready());
  // A dropped move with a retry runs it after the window; a later call replaces it.
  let queued = null; const r2 = throttle(150, () => t, (fn, ms) => (queued = { fn, ms }), () => (queued = null));
  t = 1000; assert.ok(r2()); t = 1050; let ran = 0;
  assert.ok(!r2(false, () => ran++)); assert.equal(queued.ms, 100);
  t = 1100; assert.ok(!r2(false, () => (ran += 10))); queued.fn(); assert.equal(ran, 10);

  // Regression: a play-state listener that calls setSpeed (world orchestra, mapping lab) must not loop.
  {
    const { createTime } = await import('../core/time.js');
    const tm = createTime({ count: 3, load: async () => ({ im: null }), timeOf: () => new Date(0) }, { setImage() {} });
    let events = 0;
    tm.onPlayState((p) => { events++; if (p) tm.setSpeed(tm.fps + 1); });
    tm.play();
    assert.equal(events, 1); assert.ok(tm.playing); assert.equal(tm.fps, 3);
    tm.setSpeed(10); assert.equal(events, 1); assert.ok(tm.playing);
    tm.pause(); assert.equal(events, 2); assert.ok(!tm.playing);
  }

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

// ---- storm tracks (core/storms.js) and IMERG helpers (core/imerg.js), on the real track file
{
  const S = await import('../core/storms.js');
  const I = await import('../core/imerg.js');
  const sq = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
  const a = { id: 1, lineageIds: [1], coreX: 100, coreY: 50, area: 400, polygons: [{ outer: sq(100, 50, 10), holes: [sq(100, 50, 3)] }] };
  const b = { id: 2, lineageIds: [2, 7], coreX: 300, coreY: 200, area: 900, polygons: [{ outer: sq(300, 200, 15) }],
    lineageAnchors: [{ id: 7, x: 305, y: 201 }] };
  assert.equal(S.stormAt([a, b], 95, 50), a);
  assert.equal(S.stormAt([a, b], 100, 50), null);        // in the hole
  assert.equal(S.stepStorm([a, b], null, 1), b);         // largest first
  assert.equal(S.stepStorm([a, b], 7, 1), a);            // 7 is in b's family
  assert.deepEqual(S.anchorOf(b, 7), { x: 305, y: 201 });
  const f = { components: [a, b], missingSources: [{ id: 7, lineageIds: [7] }, { id: 9, lineageIds: [9, 7] }] };
  assert.deepEqual(S.familyParts(f, 7).parts, [b]);
  assert.deepEqual(S.familyParts(f, 7).remembered.map((s) => s.id), [9]);
  assert.match(S.stormPlace({ coreX: 450, coreY: 225 }, 900, 450), /tropical Europe and Africa, near 0°N 0°E/);
  const c = S.stormColor(3);
  assert.ok(c.css.startsWith('hsl(') && [c.r, c.g, c.b].every((v) => v >= 0 && v <= 255));
  const p = S.latLonToGrid(10, 20, 900, 450), q = S.gridToLatLon(p.x, p.y, 900, 450);
  near(q.lat, 10, 1e-9); near(q.lon, 20, 1e-9);
  const file = join(dirname(fileURLToPath(import.meta.url)), '../modes/storm-watch/data/4285/storms.json');
  const data = S.checkStormTracks(JSON.parse(readFileSync(file, 'utf8')), { frames: 48 });
  assert.ok(data.frames.every((fr) => fr.components.every((x) => x.polygons.length)));
  assert.throws(() => S.checkStormTracks({ version: 2 }));

  assert.equal(I.rainFromColor(20, 20, 20), 0);
  assert.ok(I.rainFromColor(200, 0, 0) > I.rainFromColor(120, 90, 90));
  assert.equal(I.rainStrength(255, 0, 0, 0), 0);
  assert.equal(I.rainLevel(0.7), 'heavy rain');
  const major = I.scaleMidi([0, 2, 4, 5, 7, 9, 11], 36, 22);
  assert.equal(major[0], 36); assert.equal(major.at(-1), 72);
  assert.ok(I.scaleMidi([0, 2, 4, 7, 9], 48, 30).every((m) => m >= I.MIDI_C2 && m <= I.MIDI_C5));
  near(I.midiHz(69), 440, 1e-3); assert.equal(I.midiName(60), 'C4');
  console.log('storm and imerg helper tests ok');
}

// Compressed grids (delta-gzip, chunked): round trip against a synthetic grid.
{
  const { gzipSync } = await import('node:zlib');
  const { unpackGrid, chunkedGrid, parseGrid } = await import('../core/grid.js');
  const w = 4, h = 2, T = 5, n = w * h;
  const raw = Uint8Array.from({ length: T * n }, (_, i) => (i * 37 + (i % 3) * 200) % 256);
  const pack = (a) => { const d = a.slice(); for (let i = d.length - 1; i >= n; i--) d[i] = (a[i] - a[i - n]) & 255; return gzipSync(d); };
  const files = { a: pack(raw.subarray(0, 3 * n)), b: pack(raw.subarray(3 * n)) };
  const header = { dims: [w, h], frames: T, scale: 1, offset: 0, nodata: 255, encoding: 'delta-gzip',
    chunks: [{ file: 'a', start: 0, frames: 3 }, { file: 'b', start: 3, frames: 2 }] };
  const get = async (f) => new Uint8Array(files[f]);
  assert.deepEqual(await unpackGrid(header, get), raw);
  const fine = chunkedGrid(header, get), g = parseGrid(header, raw);
  assert.equal(fine.valueAt(10, 10, 4), undefined);   // chunk not loaded yet
  await fine.loadAll(4);
  for (let t = 0; t < T; t++) for (const [la, lo] of [[60, -170], [-60, 100], [0, 0]]) assert.equal(fine.valueAt(la, lo, t), g.valueAt(la, lo, t));
  console.log('compressed grid tests ok');
}

// Default trigger threshold: 70th percentile, but never the bottom of the range (mostly-dry rain).
{
  const { defaultThreshold } = await import('../core/triggers.js');
  assert.equal(defaultThreshold({ values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], range: [0, 10] }), 7);
  const dry = [...Array(90).fill(0), ...Array(10).fill(0.5)];
  assert.equal(defaultThreshold({ values: dry, range: [0, 1] }), 0.5);
  assert.equal(defaultThreshold({ values: Array(10).fill(0), range: [0, 1] }), 0.2);
  assert.equal(defaultThreshold({ pct: (p) => (p > 0.9 ? 0.4 : 0), range: [0, 1] }), 0.4);
  // The committed rain grid (data/nasa-svs/4285/web, delta-gzip) unpacks and is mostly dry with some rain.
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const dir = join(root, 'data/nasa-svs/4285/web');
  const h = JSON.parse(readFileSync(join(dir, 'field_256x128.json'), 'utf8'));
  const { unpackGrid } = await import('../core/grid.js');
  const g = parseGrid(h, await unpackGrid(h, async (f) => new Uint8Array(readFileSync(join(dir, f)))));
  assert.equal(g.frames, 48);
  const thr = defaultThreshold({ pct: g.percentile, range: [0, 1] });
  assert.ok(thr > 0 && thr < 1, `rain threshold ${thr}`);
  console.log('trigger threshold tests ok');
}

// ---- gallery: modes marked "hidden" in mode.json stay out of app/modes/index.json (and so out of dist/)
{
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const modesDir = new URL('../modes/', import.meta.url);
  const listed = new Set(JSON.parse(readFileSync(new URL('index.json', modesDir), 'utf8')).modes.map((m) => m.id));
  for (const d of readdirSync(modesDir)) {
    const f = new URL(`${d}/mode.json`, modesDir);
    if (d.startsWith('_') || !existsSync(f)) continue;
    assert.equal(listed.has(d), !JSON.parse(readFileSync(f, 'utf8')).hidden, `index.json and "hidden" disagree for ${d}`);
  }
  assert.ok(!listed.has('mapping-lab'), 'mapping-lab is hidden');
  console.log('gallery tests ok');
}

// ---- viewer zoom & pan: clamping, zoom around a point, screen <-> map hit-testing
{
  const { clampView, zoomAt, screenToMap, mapToScreen, createViewer, MAX_ZOOM } = await import('../core/viewer.js');
  const W = 1024, H = 512;
  assert.deepEqual(clampView({ z: 0.5, x: 50, y: 50 }, W, H), { z: 1, x: 0, y: 0 });
  assert.deepEqual(clampView({ z: 20, x: 2000, y: -5 }, W, H), { z: MAX_ZOOM, x: W - W / 8, y: 0 });
  // The map point under the cursor stays put while zooming.
  const v = zoomAt({ z: 1, x: 0, y: 0 }, 4, 300, 200, W, H);
  assert.equal(v.z, 4);
  assert.deepEqual(screenToMap(v, 300, 200), [300, 200]);
  assert.deepEqual(mapToScreen(v, ...screenToMap(v, 17, 33)), [17, 33]);
  assert.deepEqual(zoomAt(v, 0.1, 10, 10, W, H), { z: 1, x: 0, y: 0 });  // zooming out past 1x resets
  // Hit-test through a viewer: the screen centre of a 2x view centred on (lat 30, lon 90) is that place.
  const fake = { width: W, height: H, getContext: () => new Proxy({}, { get: () => () => {} }) };
  const vw = createViewer(fake, { basemap: false });
  const [mx, my] = vw.toPixel(30, 90);
  vw.setView({ z: 2, x: mx - W / 4, y: my - H / 4 });
  const ll = vw.screenToLatLon(W / 2, H / 2);
  near(ll.lat, 30, 1e-9); near(ll.lon, 90, 1e-9);
  assert.deepEqual(vw.latLonToScreen(30, 90), [W / 2, H / 2]);
  let heard = null; vw.onView((view, zoomed) => { heard = zoomed; });
  vw.panBy(-100, 0); assert.equal(heard, null);  // already at the east edge: clamped, no change
  vw.panBy(100, 0); assert.equal(heard, false); assert.equal(vw.view.x, 512 - 50);
  vw.resetView(); assert.equal(heard, true); assert.equal(vw.zoom, 1);
  console.log('zoom tests ok');
}
