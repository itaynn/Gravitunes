// Mode host for app/mode.html?mode=<name>[&dataset=<id>]: builds ctx and starts modes/<name>/main.js.
import { loadDataset, listDatasets } from './datasets.js';
import { createViewer, createInput } from './viewer.js';
import { createTime } from './time.js';
import { createPanel, createDescribe } from './ui.js';
import { createSound } from './sound.js';
import './switcher.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const modeName = params.get('mode') || '_template';

function pickDataset(meta) {
  const d = params.get('dataset') || meta.datasets;
  if (Array.isArray(d)) return String(d[0]);
  if (d == null || d === 'any' || d === 'none') return '5152';
  return String(d);
}

async function main() {
  if (!/^[\w-]+$/.test(modeName)) throw new Error('Bad mode name');
  const base = new URL(`modes/${modeName}/`, location.href);
  const meta = await (await fetch(new URL('mode.json', base))).json();
  document.title = `${meta.name} - Gravitunes`;
  $('#mode-title').textContent = meta.name;
  $('#mode-desc').textContent = meta.description || '';

  const describe = createDescribe($('#live'));
  const status = (msg) => { $('#status').textContent = msg; };

  const sound = await createSound();
  const startBtn = $('#start-sound');
  startBtn.addEventListener('click', async () => {
    await sound.start();
    startBtn.textContent = 'Sound on';
    startBtn.disabled = true;
    describe(`Sound started (${sound.engine}). Use the arrow keys on the map to explore.`);
    $('#map').focus();
  });

  // Dataset picker (?dataset=<id>): lists known descriptors; changing it reloads the mode.
  const current = pickDataset(meta);
  // mode.json "data": false: the mode ignores the dataset, so its picker, title, colour bar and timeline are hidden.
  const noData = meta.data === false;
  if (noData) for (const sel of ['#dataset-picker', '#dataset-title', '#colorbar', '#time-heading', '#time-label']) $(sel).hidden = true;
  if (!noData) listDatasets().then((list) => {
    if (!list.some((d) => d.id === current)) list.push({ id: current, title: current });
    const dp = createPanel($('#dataset-picker'));
    // Choosing only previews (arrow keys fire change on a closed select); Load or Enter reloads the mode.
    const load = () => { if (sel.value === current) return; params.set('dataset', sel.value); location.search = params.toString(); };
    const sel = dp.select('Dataset', list.map((d) => [d.id, `${d.title} (${d.id})`]), () => { btn.disabled = sel.value === current; },
      { value: current, hint: 'Pick a dataset, then press Load (or Enter). Loading reloads this mode.' });
    sel.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); load(); } });
    const btn = dp.button('Load dataset', load);
    btn.disabled = true;
  }).catch(() => {});

  status('Loading data...');
  let dataset;
  try {
    // mode.json "datasetDirs": {"<id>": "data/<id>/"} lets a mode ship its own copy of a dataset.
    const own = meta.datasetDirs?.[current];
    dataset = await loadDataset(current, own ? { dir: new URL(own, base).pathname } : {});
  } catch (e) {
    status(`Could not load the dataset (${e.message}). Run: sh app/tools/fetch-sample.sh`);
    throw e;
  }
  $('#dataset-title').textContent = `${dataset.title} (${dataset.units}, ${dataset.format(dataset.range[0], false)} to ${dataset.format(dataset.range[1], false)}${dataset.transform === 'log10' ? ', log scale' : ''})`;
  $('#colorbar').onerror = () => { $('#colorbar').hidden = true; };
  if (!noData) $('#colorbar').src = dataset.colorbarUrl;

  const viewer = createViewer($('#map'), { basemap: params.get('basemap') !== '0' });
  const input = createInput(viewer);
  const time = createTime(dataset, viewer);
  const panel = createPanel($('#mode-controls'));
  await time.seek(0);
  status('');

  // Built-in timeline controls.
  const tl = createPanel($('#timeline'));
  const playBtn = tl.button('Play', () => {
    if (time.playing) time.pause(); else time.play();
    describe(time.playing ? 'Playing' : `Paused at ${time.label()}`);
  });
  time.onPlayState((p) => { playBtn.textContent = p ? 'Pause' : 'Play'; });
  const slider = tl.slider('Time', { min: 0, max: time.count - 1, step: 1, value: 0, format: (n) => time.label(n) },
    (n) => time.seek(n));
  const timeText = $('#time-label');
  time.onFrame((t) => { slider.update(t); timeText.textContent = time.label(t); });
  timeText.textContent = time.label(0);
  if (noData) for (const c of [playBtn, slider]) c.closest('.control').hidden = true;
  tl.checkbox('Coastlines and borders', viewer.basemap, (on) => viewer.setBasemap(on),
    { hint: 'Natural Earth outlines drawn faintly over the map (visual only).' });

  const ctx = { dataset, viewer, time, input, panel, describe, sound, meta };
  const mod = await import(new URL('main.js', base));
  const stop = mod.default(ctx);
  window.addEventListener('pagehide', () => { time.pause(); stop?.(); });
}

main().catch((e) => {
  console.error(e);
  const s = $('#status');
  if (!s.textContent) s.textContent = `Error: ${e.message}`;
});
