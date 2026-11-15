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
import { toneNotes, neighbor, NH, waveHarmonics, builderFromVoice, builderSynth, brightHz } from './tones.js';
import { onSpace } from '../../core/keys.js';
import '../../core/switcher.js';

const $ = (s) => document.querySelector(s);
const describe = createDescribe($('#live'));
const status = (t) => { $('#status').textContent = t; };
const sel = $('#instrument'), pitch = $('#pitch'), about = $('#about'), regionEl = $('#region'), canvas = $('#map');
const loopBox = $('#loop'), stopBtn = $('#stop');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const nowCard = $('#now'), nowInst = $('#now-inst'), nowTag = $('#now-tag');

// ---- map (plain land/ocean basemap, same as World orchestra's Instruments view)
loadBasemap(repoUrl('data/earth/'));   // cached: the viewer's own loadBasemap() call reuses it
const viewer = createViewer(canvas, { plain: true });

const sound = await createSound();
window.__gtSound = sound;   // test hook, as in core/host.js
let scale = 'pentatonic-major';   // null: the instrument's own scale (set by the control below)
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
// Stand-in: no real recording yet (synthesized, or a soundfont render); manifest `realism` via samples/index.json.
const isStandIn = (realism) => realism !== 'recorded';
const instStandIn = (id) => isStandIn(samples[instruments[id]?.sample]?.realism);
const SI = ' (stand-in)';
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
const maskOf = (c, col = colorOf.get(c.id)) => {
  const key = c.id + col;
  if (!masks.has(key)) { const k = centers.indexOf(c); masks.set(key, paint((j) => (j === k ? col : null))); }
  return masks.get(key);
};
// "Sounding": while notes play, the selected region pulses and the rest of the map dims further.
let soundingUntil = 0, raf = 0;
const sounding = () => performance.now() < soundingUntil;
function markSounding(sec) {
  soundingUntil = performance.now() + sec * 1000;
  nowCard.classList.add('playing');
  if (!raf) {
    const tick = () => {
      viewer.redraw();
      if (sounding()) raf = requestAnimationFrame(tick);
      else { raf = 0; nowCard.classList.remove('playing'); viewer.redraw(); }
    };
    raf = requestAnimationFrame(tick);
  }
}
function stopSounding() { soundingUntil = 0; }

viewer.addOverlay((g, v) => {
  const W = v.canvas.width, H = v.canvas.height;
  g.save();
  g.imageSmoothingEnabled = false;
  if (tint) { g.globalAlpha = 0.14; g.drawImage(tint, 0, 0, W, H); }
  if (region) {
    // Dim everything else, then the selected region in a bold white outline and its own colour (pulsing while it sounds).
    const on = sounding(), pulse = on ? 0.5 + 0.5 * Math.sin(performance.now() / 110) : 1;
    g.globalAlpha = on ? 0.55 : 0.4; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const o = Math.max(3, W / 320), white = maskOf(region, '#fff');
    g.globalAlpha = 1;
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, o], [-o, o], [o, -o]]) g.drawImage(white, dx, dy, W, H);
    g.globalAlpha = on ? 0.7 + 0.25 * pulse : 0.85;
    g.drawImage(maskOf(region), 0, 0, W, H);
  }
  g.globalAlpha = 1;
  // Instrument labels on dark boxes (no overlaps); the selected region's on top, outlined.
  g.font = `600 ${Math.round(W / 110)}px system-ui, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
  const h = Math.round(W / 85), placed = [];
  const hit = (a) => placed.some((b) => a.bx < b.bx + b.w + 2 && b.bx < a.bx + a.w + 2 && a.by < b.by + b.h + 2 && b.by < a.by + a.h + 2);
  for (const c of centers) {
    if (c.instrument === 'ocean' && c !== region) continue;
    const [x, y0] = v.toPixel(c.lat, c.lon), text = (instruments[c.instrument]?.label || c.instrument) + (instStandIn(c.instrument) ? SI : '');
    const w = g.measureText(text).width + h * 1.3;
    const box = { c, text, w, h, bx: Math.min(W - w, Math.max(0, x - w / 2)), by: y0 - h / 2 };
    for (let k = 1; hit(box) && k < 12; k++) box.by = y0 - h / 2 + Math.ceil(k / 2) * (h + 2) * (k % 2 ? 1 : -1);
    placed.push(box);
  }
  placed.sort((a, b) => (a.c === region) - (b.c === region));
  for (const { c, text, w, bx, by } of placed) {
    const y = by + h / 2, on = c === region;
    g.globalAlpha = region && !on ? 0.45 : 1;
    g.fillStyle = on ? 'rgba(0,0,0,.95)' : 'rgba(0,0,0,.7)';
    g.beginPath(); g.roundRect ? g.roundRect(bx, by, w, h, h / 3) : g.rect(bx, by, w, h); g.fill();
    if (on) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
    g.fillStyle = colorOf.get(c.id); g.beginPath(); g.arc(bx + h / 2, y, h / 4, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.fillText(text, bx + h * 0.9, y + 0.5);
  }
  g.globalAlpha = 1;
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
group('On the map', Object.entries(instruments).map(([id, v]) => [`w:${id}`, `${cap(v.label)} (${v.inspiredBy})${instStandIn(id) ? SI : ''}`]));
group('Sampled', Object.entries(samples).map(([id, v]) => [`s:${id}`, `${v.label}${v.kind === 'hit' ? ' (drum)' : ''}${isStandIn(v.realism) ? SI : ''}`]));
group('Analysed', library.map((p) => [`l:${p.id}`, `${p.name}${p.pitched === false ? ' (unpitched)' : ''}`]));
if (!sel.options.length) { sel.append(new Option('No instruments found', '')); status('Could not load the instrument lists.'); }

let chooseSeq = 0; // a later choice wins over a slow-loading earlier one
async function choose(value) {
  const token = ++chooseSeq;
  const [k, id] = [value.slice(0, 1), value.slice(2)];
  if (k === 'w') {
    const v = instruments[id];
    current = { label: v.label, voice: v, standIn: instStandIn(id) };
    await sampleLoad;
    if (token !== chooseSeq) return;
    const rec = v.sample && sound.hasSample?.(v.sample) ? 'Recorded.' : 'Synthesized.';
    about.textContent = `${cap(v.label)}, ${v.inspiredBy}. ${rec}`;
  } else if (k === 's') {
    const v = samples[id];
    await sampleLoad;
    if (token !== chooseSeq) return;
    const ok = sound.hasSample?.(id);
    current = { label: v.label, voice: { sample: id, harmonics: [1, 0.5, 0.25], dur: v.kind === 'hit' ? 0.3 : 0.7 }, standIn: isStandIn(v.realism) };
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
// The "now" card: big instrument name, region, recorded / stand-in, in the region's colour (also outlines the list).
function showNow(name, where, standIn, col = '#888') {
  nowCard.style.setProperty('--now', col); sel.style.setProperty('--now', col); sel.classList.add('on');
  nowInst.textContent = cap(name);
  regionEl.textContent = where;
  nowTag.textContent = standIn == null ? '' : standIn ? 'Stand-in' : 'Recorded';
  nowTag.hidden = standIn == null;
}
function setRegion(c) {
  region = c;
  const inst = instruments[c.instrument];
  showNow(inst?.label || c.instrument, `${c.label}: ${inst?.label || c.instrument}${instStandIn(c.instrument) ? SI : ', recorded'}`, instStandIn(c.instrument), colorOf.get(c.id));
  viewer.redraw();
  sel.value = `w:${c.instrument}`;
  return choose(sel.value);
}

const KIND_TEXT = { note: 'note', scale: 'scale', chord: 'chord', phrase: 'phrase' };
const nameOf = (hz) => noteName(Math.round(12 * Math.log2(hz / C4)));
function stop() { clearTimeout(loopTimer); loopTimer = 0; sound.stopAll(); stopSounding(); }
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
  status(`${cap(current.label)}: ${KIND_TEXT[k]} from ${notes.length ? nameOf(notes[0].freq) : noteName(+pitch.value)}${current.standIn ? ', a stand-in sound until a real recording is added' : ''}${loopBox.checked ? ', looping' : ''}`);
  markSounding(gestureLength(notes) + 0.3);
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
    region = null; viewer.redraw(); await choose(v);
    if (current) showNow(current.label, 'Not on the map', current.standIn ?? null);
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
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (!region && centers[0]) await setRegion(centers[0]);
    play();
  }
});

// Space anywhere (not in fields or on buttons): stop a running loop, otherwise play the current selection.
onSpace(async () => {
  if (!$('#builder').hidden) { if (bLoop.checked) bStop(); else bPlay(); return; }
  if (loopBox.checked) { stopBtn.click(); return; }
  if (!region && centers[0]) await setRegion(centers[0]);
  play(); describe('Playing');
});

// Start on the first region (no sound until a click or key).
if (centers.length) await setRegion(centers[0]); else if (sel.value) await choose(sel.value);
status('');

// ---- "Build a sound": a second view to shape the engine's voice (harmonics, envelope, brightness, recording mix).
const builder = $('#builder'), mapView = $('#map-view'), toBuilder = $('#to-builder'), bLoop = $('#b-loop');
let b = builderFromVoice({ harmonics: waveHarmonics('saw').map((x, i) => (i < 4 ? x : 0)) }), bKind = 'note', bTimer = 0;
const bInputs = {};
function slider(parent, key, label, min, max, step, fmt, get = () => b[key], set = (v) => { b[key] = v; }) {
  const id = `b-${key}`, wrap = document.createElement('div');
  wrap.className = 'control';
  wrap.innerHTML = `<label for="${id}">${label}</label><output for="${id}"></output><input id="${id}" type="range" min="${min}" max="${max}" step="${step}">`;
  const inp = wrap.querySelector('input'), out = wrap.querySelector('output');
  const show = () => { inp.value = get(); out.textContent = fmt(+inp.value); inp.setAttribute('aria-valuetext', fmt(+inp.value)); };
  inp.addEventListener('input', () => { set(+inp.value); show(); });
  inp.addEventListener('change', () => { if (!bLoop.checked) bPlay(); });
  bInputs[key] = show; show(); parent.append(wrap);
}
const HN = ['fundamental', 'octave', 'fifth above', '2 octaves', 'major third', 'fifth', 'flat seventh', '3 octaves'];
const pct = (v) => `${Math.round(v * 100)}%`, secs = (v) => `${v.toFixed(2)} s`;
for (let i = 0; i < NH; i++) slider($('#b-harm'), `h${i}`, `${i + 1}: ${HN[i]}`, 0, 1, 0.01, pct, () => b.harmonics[i], (v) => { b.harmonics[i] = v; });
slider($('#b-env'), 'attack', 'Attack', 0, 2, 0.01, secs);
slider($('#b-env'), 'decay', 'Decay', 0, 3, 0.01, secs);
slider($('#b-env'), 'sustain', 'Sustain', 0, 1, 0.01, pct);
slider($('#b-env'), 'release', 'Release', 0, 3, 0.01, secs);
let bPitch = -12;
slider($('#b-col'), 'pitch', 'Pitch', -24, 21, 1, (v) => noteName(v), () => bPitch, (v) => { bPitch = v; });
slider($('#b-col'), 'bright', 'Brightness', 0, 1, 0.01, (v) => `${brightHz(v)} Hz`);
slider($('#b-col'), 'noise', 'Breath / pick noise', 0, 1, 0.01, pct);
slider($('#b-col'), 'vibrato', 'Vibrato', 0, 50, 1, (v) => `${v} cents`);
slider($('#b-col'), 'mix', 'Recording mix', 0, 1, 0.01, pct);
const bSample = $('#b-sample');
for (const [id, v] of Object.entries(samples)) bSample.append(new Option(`${v.label}${isStandIn(v.realism) ? SI : ''}`, id));
bSample.addEventListener('change', () => { b.sample = bSample.value; if (b.sample && b.mix === 0) { b.mix = 0.5; bInputs.mix(); } });
const refresh = () => { for (const f of Object.values(bInputs)) f(); bSample.value = b.sample; };

function bStop() { clearTimeout(bTimer); bTimer = 0; bLoop.checked = false; sound.stopAll(); status('Stopped.'); describe('Stopped.'); }
function bPlay() {
  clearTimeout(bTimer); bTimer = 0;
  const notes = toneNotes({ dur: Math.max(0.4, b.attack + b.decay) }, noteHz(bPitch), bKind, scale);
  sound.stopAll();
  const syn = builderSynth(b), mix = b.sample && sound.hasSample?.(b.sample) ? b.mix : 0;
  for (const n of notes) {
    if (mix > 0) sound.play({ sample: b.sample, freq: n.freq, t: n.t, dur: n.dur, amp: 0.64 * mix });
    if (mix < 1) sound.play({ ...syn, freq: n.freq, t: n.t, dur: n.dur, amp: 0.4 * (1 - mix) });
  }
  status(`Built sound: ${bKind} from ${noteName(bPitch)}${bLoop.checked ? ', looping' : ''}`);
  if (bLoop.checked) bTimer = setTimeout(bPlay, (gestureLength(notes) + b.release + 0.4) * 1000);
}
$('#b-note').addEventListener('click', () => { bKind = 'note'; bPlay(); });
$('#b-scale').addEventListener('click', () => { bKind = 'scale'; bPlay(); });
$('#b-stop').addEventListener('click', bStop);
bLoop.addEventListener('change', () => { if (bLoop.checked) bPlay(); else { clearTimeout(bTimer); bTimer = 0; describe('Loop off.'); } });
for (const btn of builder.querySelectorAll('[data-wave]')) {
  btn.addEventListener('click', () => { b.harmonics = waveHarmonics(btn.dataset.wave); refresh(); describe(`${btn.textContent} harmonics.`); bPlay(); });
}
const fromBtn = $('#b-from');
const fromVoice = () => (current?.voice && !current.name ? current : null);
function updateFrom() {
  const c = fromVoice();
  fromBtn.textContent = c ? `Start from ${cap(c.label)}` : 'Start from the selected instrument';
  fromBtn.disabled = !c;
}
fromBtn.addEventListener('click', () => {
  const c = fromVoice(); if (!c) return;
  b = builderFromVoice(c.voice); bPitch = +pitch.value; refresh();
  describe(`Starting from ${c.label}.`); bPlay();
});
function showView(build) {
  stop(); clearTimeout(bTimer); bTimer = 0; bLoop.checked = false; loopBox.checked = false; stopBtn.hidden = true;
  builder.hidden = !build; mapView.hidden = build;
  toBuilder.textContent = build ? 'Back to map' : 'Build a sound';
  if (build) { updateFrom(); $('#b-title').focus(); } else canvas.focus();
  describe(build ? 'Sound builder.' : 'Instrument map.');
}
toBuilder.addEventListener('click', () => showView(builder.hidden));
refresh();
if (location.hash === '#build') showView(true);
