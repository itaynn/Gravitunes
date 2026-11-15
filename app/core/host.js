// Mode host for app/mode.html?mode=<name>[&dataset=<id>]: builds ctx and starts modes/<name>/main.js.
import { loadDataset, listDatasets } from './datasets.js';
import { createViewer, createInput } from './viewer.js';
import { createTime } from './time.js';
import { createPanel, createDescribe, volumeSlider } from './ui.js';
import { createSound } from './sound.js';
import './switcher.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
// Timbre atlas became World orchestra's Instruments view: old links land there.
const redirected = params.get('mode') === 'timbre-atlas';
if (redirected) location.replace(`?mode=world-orchestra&instruments=1`);
const modeName = params.get('mode') || '_template';

function pickDataset(meta) {
  const d = params.get('dataset') || meta.datasets;
  if (Array.isArray(d)) return String(d[0]);
  if (d == null || d === 'any' || d === 'none') return '5152';
  return String(d);
}

// Stand-in dataset for "data": false modes: one empty frame, nothing to fetch.
const NO_DATASET = { id: 'none', title: '', units: '', range: [0, 1], count: 1, colorbarUrl: '', format: (v) => String(v),
  load: async () => ({ im: null }), timeOf: () => new Date(0), valueAt: () => null };

async function main() {
  if (!/^[\w-]+$/.test(modeName)) throw new Error('Bad mode name');
  const base = new URL(`modes/${modeName}/`, location.href);
  const meta = await (await fetch(new URL('mode.json', base))).json();
  document.title = `${meta.name} - Gravitunes`;
  $('#mode-title').textContent = meta.name;
  // One or two sentences: mode.json "summary", else the first sentence of "description".
  $('#mode-desc').textContent = meta.summary || (meta.description || '').match(/^.*?[.!?](\s|$)/)?.[0]?.trim() || meta.description || '';

  // "More" drawer: mode controls and view options; it overlays the map and never squeezes it.
  const drawer = $('#drawer'), moreBtn = $('#more-toggle');
  const setDrawer = (open, focus = true) => {
    drawer.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open));
    if (open && focus) drawer.querySelector('button, select, input, summary')?.focus();
    else if (!open && focus) moreBtn.focus();
  };
  moreBtn.addEventListener('click', () => setDrawer(drawer.hidden));
  $('#drawer-close').addEventListener('click', () => setDrawer(false));
  drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setDrawer(false); } });

  const describe = createDescribe($('#live'));
  const status = (msg) => { $('#status').textContent = msg; };

  const sound = await createSound();
  // Sound on/off toggle (the first press also starts the audio engine); off = muted.
  const startBtn = $('#start-sound');
  let soundOn = false, vol = 0.7;
  const showSound = () => {
    startBtn.innerHTML = soundOn ? '&#128266; Sound' : '&#128263; Sound';
    startBtn.setAttribute('aria-pressed', String(soundOn));
    startBtn.setAttribute('aria-label', 'Sound');
    startBtn.classList.toggle('primary', !soundOn);
  };
  startBtn.addEventListener('click', async () => {
    if (!sound.started) {
      await sound.start();
      soundOn = true; sound.setVolume?.(vol);
      describe(`Sound on (${sound.engine}). Use the arrow keys on the map to explore.`);
      $('#map').focus();
    } else {
      soundOn = !soundOn;
      sound.setVolume?.(soundOn ? vol : 0);
      describe(soundOn ? 'Sound on' : 'Sound off');
    }
    showSound();
  });
  showSound();

  // Shared bar controls: Scale (added by modes through scaleControl) and Volume.
  const shared = $('#shared-controls');
  const scaleBox = document.createElement('div'), volBox = document.createElement('div');
  shared.append(scaleBox, volBox);
  const bar = createPanel(scaleBox);
  bar.volume = volumeSlider(createPanel(volBox), { setVolume: (v) => { vol = v; if (!sound.started || soundOn) sound.setVolume?.(v); } }, vol);
  bar.volume.closest('.control').querySelector('label').textContent = 'Vol';
  bar.volume.setAttribute('aria-label', 'Volume');

  // Dataset picker (?dataset=<id>): lists known descriptors; changing it reloads the mode.
  const current = pickDataset(meta);
  // mode.json "data": false: the mode ignores the dataset, so its picker, title, colour bar and timeline are hidden.
  const noData = meta.data === false;
  if (noData) for (const sel of ['#dataset-picker', '#dataset-title', '#colorbar', '#time-label']) $(sel).hidden = true;
  // Offer only datasets this mode lists (mode.json "datasets") that are actually available here; hide the
  // picker when there is nothing to switch to. Mouse picks switch at once; keyboard users browse with the
  // arrow keys and switch with Enter or the Load button (arrows fire change on a closed select).
  if (!noData) listDatasets().then((list) => {
    const wanted = Array.isArray(meta.datasets) ? meta.datasets.map(String) : null;
    if (wanted) list = wanted.map((id) => list.find((d) => d.id === id)).filter(Boolean);
    if (!list.some((d) => d.id === current) || list.length < 2) return;
    const dp = createPanel($('#dataset-picker'));
    const load = () => { if (sel.value === current) return; params.set('dataset', sel.value); location.search = params.toString(); };
    let byKey = false;
    const sel = dp.select('Data', list.map((d) => [d.id, d.title]), () => { if (!byKey) load(); },
      { value: current, hint: 'Choosing a dataset reloads this demo with it. With the keyboard, pick with the arrow keys, then press Enter.' });
    sel.setAttribute('aria-label', 'Dataset');
    sel.addEventListener('pointerdown', () => { byKey = false; });
    sel.addEventListener('keydown', (e) => { byKey = true; if (e.key === 'Enter') { e.preventDefault(); load(); } });
  }).catch(() => {});

  status('Loading data...');
  let dataset;
  try {
    // mode.json "datasetDirs": {"<id>": "data/<id>/"} lets a mode ship its own copy of a dataset.
    const own = meta.datasetDirs?.[current];
    // "data": false modes get a stub (no download) and the plain basemap.
    dataset = noData ? NO_DATASET : await loadDataset(current, own ? { dir: new URL(own, base).pathname } : {});
  } catch (e) {
    status(`Could not load the dataset (${e.message}). Run: sh app/tools/fetch-sample.sh`);
    throw e;
  }
  $('#dataset-title').textContent = `${dataset.title} (${dataset.units}, ${dataset.format(dataset.range[0], false)} to ${dataset.format(dataset.range[1], false)}${dataset.transform === 'log10' ? ', log scale' : ''})`;
  $('#colorbar').alt = `Color bar: ${$('#dataset-title').textContent}`;
  $('#colorbar').onerror = () => { $('#colorbar').hidden = true; };
  if (!noData) $('#colorbar').src = dataset.colorbarUrl;

  const viewer = createViewer($('#map'), { basemap: params.get('basemap') !== '0', plain: noData, imageCanvas: $('#map-image') });
  const input = createInput(viewer);
  const time = createTime(dataset, viewer);
  const panel = createPanel($('#mode-controls'));
  await time.seek(0);
  status('');

  // Built-in timeline controls.
  const tl = createPanel($('#timeline'));
  const playBtn = tl.button('Play', () => {
    if (time.playing) time.pause(); else time.play();
    describe(time.playing ? 'Playing' : `Stopped at ${time.label()}`);
  });
  const showPlay = (p) => { playBtn.innerHTML = p ? '&#9632; Stop' : '&#9654; Play'; playBtn.setAttribute('aria-label', p ? 'Stop' : 'Play'); };
  time.onPlayState(showPlay); showPlay(false);
  const slider = tl.slider('Time', { min: 0, max: time.count - 1, step: 1, value: 0, format: (n) => time.label(n) },
    (n) => time.seek(n));
  const timeText = $('#time-label');
  time.onFrame((t) => { slider.update(t); timeText.textContent = time.label(t); });
  timeText.textContent = time.label(0);
  if (noData) for (const c of [playBtn, slider]) c.closest('.control').hidden = true;
  createPanel($('#view-controls')).checkbox('Coastlines', viewer.basemap, (on) => viewer.setBasemap(on),
    { hint: 'Natural Earth coastlines and borders drawn faintly over the map (visual only).' });

  panel.bar = bar;
  const ctx = { dataset, viewer, time, input, panel, describe, sound, meta };
  const mod = await import(new URL('main.js', base));
  const stop = mod.default(ctx);
  window.addEventListener('pagehide', () => { time.pause(); stop?.(); });
}

if (!redirected) main().catch((e) => {
  console.error(e);
  const s = $('#status');
  if (!s.textContent) s.textContent = `Error: ${e.message}`;
});
