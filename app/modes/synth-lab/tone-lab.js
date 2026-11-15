// Tone lab: a world map of instruments (the World orchestra regions, data/earth/musical-centers.json + instruments.json).
// Click/tap a region, or arrow keys + Enter on the map, to hear its note, scale, chord or phrase, once or on a loop.
// The Instrument list also offers sampled instruments and analysed recordings (sound-engine/library). Pitches stay C2..A5.
import { createSound, loadSampleIndex } from '../../core/sound.js';
import { createDescribe, createPanel } from '../../core/ui.js';
import { scaleControl } from '../../core/scale-control.js';
import { loadEarth, getJson, repoUrl } from '../../core/data.js';
import { playNotes, gestureLength } from '../../core/gestures.js';
import { nearestCenters } from '../../core/geo.js';
import { createViewer, loadBasemap } from '../../core/viewer.js';
import { noteHz, noteName, C4 } from '../../core/scales.js';
import { toneNotes, neighbor } from './tones.js';
import '../../core/switcher.js';

const $ = (s) => document.querySelector(s);
const describe = createDescribe($('#live'));
const status = (t) => { $('#status').textContent = t; };
const sel = $('#instrument'), pitch = $('#pitch'), about = $('#about'), regionEl = $('#region'), canvas = $('#map');
const loopBox = $('#loop'), stopBtn = $('#stop');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---- map (plain land/ocean basemap, same as World orchestra's Instruments view)
loadBasemap(repoUrl('data/earth/'));   // cached: the viewer's own loadBasemap() call reuses it
const viewer = createViewer(canvas, { plain: true });

const sound = await createSound();
let scale = null;   // null: the instrument's own scale
scaleControl(createPanel($('#tone-scale')), { value: 'pentatonic-major', own: 'Instrument\'s own', describe,
  onChange: (v) => { scale = v; }, hint: 'For Scale and Chord.' });

let instruments = {}, centers = [], library = [], samples = {};
let current = null;   // { label, voice, name? }
let region = null;    // the selected musical center, or null when a non-map instrument is chosen
let kind = 'scale', loopTimer = 0;

try {
  const [ij, mj] = await Promise.all([loadEarth('instruments'), loadEarth('musical-centers')]);
  instruments = ij.instruments; centers = mj.centers;
} catch (e) { console.warn(e); status('Could not load the map regions.'); }
try { library = await getJson(repoUrl('sound-engine/library/presets/index.json')); } catch (e) { console.warn(e); }
samples = await loadSampleIndex();
// Decode every recording now (no user gesture needed); voices without one stay synthesized.
const sampleLoad = sound.loadSamples?.(Object.keys(samples)).then((r) => {
  console.info(`[tone-lab] samples loaded: ${r.loaded.join(', ') || 'none'}; fallback: ${r.fallback.join(', ') || 'none'}`);
  return r;
});

// ---- region colours, ownership grid (2-degree cells) and the selected region's highlight mask
const colorOf = new Map(centers.map((c, i) => [c.id, `hsl(${Math.round((i * 360) / centers.length)} 70% 55%)`]));
const owner = new Int16Array(180 * 90);
for (let y = 0; y < 90; y++) for (let x = 0; x < 180; x++) {
  owner[y * 180 + x] = centers.indexOf(nearestCenters(89 - 2 * y, 2 * x - 179, centers)[0]?.center);
}
function paint(fn) {
  const c = document.createElement('canvas'); c.width = 180; c.height = 90;
  const g = c.getContext('2d');
  for (let i = 0; i < owner.length; i++) { const col = fn(owner[i]); if (col) { g.fillStyle = col; g.fillRect(i % 180, (i / 180) | 0, 1, 1); } }
  return c;
}
const tint = centers.length ? paint((k) => colorOf.get(centers[k]?.id)) : null;
const masks = new Map();
const maskOf = (c) => { if (!masks.has(c.id)) { const k = centers.indexOf(c); masks.set(c.id, paint((j) => (j === k ? colorOf.get(c.id) : null))); } return masks.get(c.id); };

viewer.addOverlay((g, v) => {
  const W = v.canvas.width, H = v.canvas.height;
  g.save();
  g.imageSmoothingEnabled = false;
  if (tint) { g.globalAlpha = 0.14; g.drawImage(tint, 0, 0, W, H); }
  if (region) { g.globalAlpha = 0.55; g.drawImage(maskOf(region), 0, 0, W, H); }
  g.globalAlpha = 1;
  // Instrument labels on dark boxes (no overlaps); the selected region's on top, outlined.
  g.font = `600 ${Math.round(W / 110)}px system-ui, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
  const h = Math.round(W / 85), placed = [];
  const hit = (a) => placed.some((b) => a.bx < b.bx + b.w + 2 && b.bx < a.bx + a.w + 2 && a.by < b.by + b.h + 2 && b.by < a.by + a.h + 2);
  for (const c of centers) {
    if (c.instrument === 'ocean' && c !== region) continue;
    const [x, y0] = v.toPixel(c.lat, c.lon), text = instruments[c.instrument]?.label || c.instrument;
    const w = g.measureText(text).width + h * 1.3;
    const box = { c, text, w, h, bx: Math.min(W - w, Math.max(0, x - w / 2)), by: y0 - h / 2 };
    for (let k = 1; hit(box) && k < 12; k++) box.by = y0 - h / 2 + Math.ceil(k / 2) * (h + 2) * (k % 2 ? 1 : -1);
    placed.push(box);
  }
  placed.sort((a, b) => (a.c === region) - (b.c === region));
  for (const { c, text, w, bx, by } of placed) {
    const y = by + h / 2, on = c === region;
    g.fillStyle = on ? 'rgba(0,0,0,.95)' : 'rgba(0,0,0,.7)';
    g.beginPath(); g.roundRect ? g.roundRect(bx, by, w, h, h / 3) : g.rect(bx, by, w, h); g.fill();
    if (on) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
    g.fillStyle = colorOf.get(c.id); g.beginPath(); g.arc(bx + h / 2, y, h / 4, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.fillText(text, bx + h * 0.9, y + 0.5);
  }
  g.restore();
});

// ---- instrument list: map instruments, sampled instruments, analysed recordings
sel.replaceChildren();
const group = (label, items) => {
  if (!items.length) return;
  const og = Object.assign(document.createElement('optgroup'), { label });
  og.append(...items.map(([v, t]) => new Option(t, v)));
  sel.append(og);
};
group('On the map', Object.entries(instruments).map(([id, v]) => [`w:${id}`, `${cap(v.label)} (${v.inspiredBy})`]));
group('Sampled', Object.entries(samples).map(([id, v]) => [`s:${id}`, `${v.label}${v.kind === 'hit' ? ' (drum)' : ''}`]));
group('Analysed', library.map((p) => [`l:${p.id}`, `${p.name}${p.pitched === false ? ' (unpitched)' : ''}`]));
if (!sel.options.length) { sel.append(new Option('No instruments found', '')); status('Could not load the instrument lists.'); }

let chooseSeq = 0; // a later choice wins over a slow-loading earlier one
async function choose(value) {
  const token = ++chooseSeq;
  const [k, id] = [value.slice(0, 1), value.slice(2)];
  if (k === 'w') {
    const v = instruments[id];
    current = { label: v.label, voice: v };
    await sampleLoad;
    if (token !== chooseSeq) return;
    const rec = v.sample && sound.hasSample?.(v.sample) ? 'Recorded.' : 'Synthesized.';
    about.textContent = `${cap(v.label)}, ${v.inspiredBy}. ${rec}`;
  } else if (k === 's') {
    const v = samples[id];
    await sampleLoad;
    if (token !== chooseSeq) return;
    const ok = sound.hasSample?.(id);
    current = { label: v.label, voice: { sample: id, harmonics: [1, 0.5, 0.25], dur: v.kind === 'hit' ? 0.3 : 0.7 } };
    about.textContent = `${v.label}: ${ok ? 'recording' : 'recording not loaded, plain tone'}. ${v.source}, ${v.license}.`;
  } else if (k === 'l') {
    const p = library.find((x) => x.id === id);
    current = null;
    about.textContent = `${p.name}: loading...`;
    try {
      const r = await sound.loadLibrary(id);
      if (token !== chooseSeq) return;
      current = { label: p.name, voice: { ...r.def, dur: 0.8 }, name: r.name };
      about.textContent = `${p.name}: ${p.title}. ${r.sample ? 'Recording' : 'Tone from its analysed overtones'}, ${p.license}.`;
    } catch (e) {
      if (token !== chooseSeq) return;
      about.textContent = `${p.name} could not be loaded (${e.message}).`;
    }
  }
  const hasPhrase = !!current?.voice?.gesture;
  $('#play-phrase').disabled = !hasPhrase;
  if (current && !hasPhrase) about.textContent += ' No phrase.';
}

// ---- selecting a region (click, tap, arrows) and playing
function setRegion(c) {
  region = c;
  const inst = instruments[c.instrument];
  regionEl.textContent = `${c.label}: ${inst?.label || c.instrument}`;
  viewer.redraw();
  sel.value = `w:${c.instrument}`;
  return choose(sel.value);
}

const KIND_TEXT = { note: 'note', scale: 'scale', chord: 'chord', phrase: 'phrase' };
const nameOf = (hz) => noteName(Math.round(12 * Math.log2(hz / C4)));
function stop() { clearTimeout(loopTimer); loopTimer = 0; sound.stopAll(); }
async function play() {
  clearTimeout(loopTimer); loopTimer = 0;
  if (!sound.started) await sound.start();   // the first click starts audio
  if (!current) { describe('This instrument is still loading or could not be loaded.'); return; }
  const k = kind === 'phrase' && !current.voice.gesture ? 'note' : kind;
  const notes = toneNotes(current.voice, noteHz(+pitch.value), k, scale);
  sound.stopAll();
  const pan = region ? Math.max(-0.8, Math.min(0.8, region.lon / 180)) : 0;
  if (current.name) {
    for (const n of notes) sound.play({ voice: current.name, freq: n.freq, t: n.t, dur: n.dur, amp: 0.45 * (n.amp ?? 1), pan });
  } else {
    playNotes(sound, current.voice, notes, { amp: 0.4, pan });
  }
  status(`${cap(current.label)}: ${KIND_TEXT[k]} from ${notes.length ? nameOf(notes[0].freq) : noteName(+pitch.value)}${loopBox.checked ? ', looping' : ''}`);
  if (loopBox.checked) loopTimer = setTimeout(play, (gestureLength(notes) + 0.6) * 1000);
}

for (const k of Object.keys(KIND_TEXT)) {
  $(`#play-${k}`).addEventListener('click', () => {
    kind = k;
    for (const j of Object.keys(KIND_TEXT)) $(`#play-${j}`).setAttribute('aria-pressed', String(j === k));
    play();
  });
}
loopBox.addEventListener('change', () => {
  stopBtn.hidden = !loopBox.checked;
  if (loopBox.checked) { describe('Loop on.'); play(); } else { clearTimeout(loopTimer); loopTimer = 0; describe('Loop off.'); }
});
stopBtn.addEventListener('click', () => { loopBox.checked = false; stopBtn.hidden = true; stop(); status('Stopped.'); describe('Stopped.'); loopBox.focus(); });
sel.addEventListener('change', async () => {
  const v = sel.value;
  // A map instrument highlights its first region; other instruments have no region.
  const c = v.startsWith('w:') && centers.find((x) => x.instrument === v.slice(2));
  if (c) { await setRegion(c); } else {
    region = null; viewer.redraw(); await choose(v); regionEl.textContent = current ? cap(current.label) : '';
  }
  if (loopBox.checked) play();
});
pitch.addEventListener('input', () => pitch.setAttribute('aria-valuetext', noteName(+pitch.value)));
pitch.setAttribute('aria-valuetext', noteName(+pitch.value));
let pitchTimer = 0;
pitch.addEventListener('change', () => { clearTimeout(pitchTimer); pitchTimer = setTimeout(play, 150); });

// Map input: a click or tap selects and plays; hovering is silent.
const at = (e) => {
  const r = canvas.getBoundingClientRect();
  const { lat, lon } = viewer.toLatLon(((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height);
  return nearestCenters(lat, lon, centers)[0]?.center;
};
canvas.addEventListener('pointerdown', async (e) => {
  const c = at(e);
  if (!c) return;
  canvas.focus();
  await setRegion(c);
  play();
});
canvas.addEventListener('keydown', async (e) => {
  const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
  if (dir) {
    e.preventDefault();
    const c = region ? neighbor(centers, region, dir) : centers[0];
    if (!c) { describe(`No region further ${dir}.`); return; }
    await setRegion(c);
    if (loopBox.checked) play();   // looping follows the selection; otherwise Enter plays
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!region && centers[0]) await setRegion(centers[0]);
    play();
  }
});

// Start on the first region (no sound until a click or key).
if (centers.length) await setRegion(centers[0]); else if (sel.value) await choose(sel.value);
status('');
