// Tone lab: pick an instrument (world voices from data/earth/instruments.json, sampled instruments from
// sound-engine/library/samples, or analysed recordings from sound-engine/library) and hear a note, a scale, a chord or its phrase, between C2 and E6.
import { createSound, loadSampleIndex } from '../../core/sound.js';
import { createDescribe, createPanel } from '../../core/ui.js';
import { scaleControl } from '../../core/scale-control.js';
import { loadEarth, getJson, repoUrl } from '../../core/data.js';
import { playNotes } from '../../core/gestures.js';
import { noteHz, noteName, C4, LOW_SEMIS, HIGH_SEMIS } from '../../core/scales.js';
import { toneNotes } from './tones.js';
import '../../core/switcher.js';

const $ = (s) => document.querySelector(s);
const describe = createDescribe($('#live'));
const status = (t) => { $('#status').textContent = t; };
const sel = $('#instrument'), pitch = $('#pitch'), about = $('#about');

const sound = await createSound();
let scale = null;   // null: the instrument's own scale
scaleControl(createPanel($('#tone-scale')), { value: 'pentatonic-major', own: 'Instrument\'s own', describe,
  onChange: (v) => { scale = v; },
  hint: 'Used by Scale and Chord. Phrase plays the instrument\'s own typical notes.' });
let instruments = {}, library = [], samples = {}, current = null;   // current: { label, voice, name? }

const syncPitch = () => pitch.setAttribute('aria-valuetext', noteName(+pitch.value));
syncPitch();
pitch.addEventListener('input', syncPitch);
// Moving the slider (mouse or its own arrow keys) plays the new note, like the global Up/Down keys.
let pitchTimer = null;
pitch.addEventListener('change', () => { clearTimeout(pitchTimer); pitchTimer = setTimeout(() => play('note'), 150); });

// No "start sound" step: the first click or key starts the audio (notes also start it themselves).
const wake = () => { if (!sound.started) sound.start().catch(() => {}); };
addEventListener('pointerdown', wake, { capture: true, once: true });
addEventListener('keydown', wake, { capture: true, once: true });

try {
  ({ instruments } = await loadEarth('instruments'));
} catch (e) { console.warn(e); }
try {
  library = await getJson(repoUrl('sound-engine/library/presets/index.json'));
} catch (e) { console.warn(e); }
samples = await loadSampleIndex();
// Load every recording now (decoding needs no user gesture); voices without one stay synthesized.
const sampleLoad = sound.loadSamples?.(Object.keys(samples)).then((r) => {
  console.info(`[tone-lab] samples loaded: ${r.loaded.join(', ') || 'none'}; fallback: ${r.fallback.join(', ') || 'none'}`);
  return r;
});

sel.replaceChildren();
const group = (label, items) => {
  if (!items.length) return;
  const og = Object.assign(document.createElement('optgroup'), { label });
  og.append(...items.map(([v, t]) => new Option(t, v)));
  sel.append(og);
};
group('World instruments (as on the map)', Object.entries(instruments).map(([id, v]) => [`w:${id}`, `${cap(v.label)} (${v.inspiredBy})`]));
group('Sampled instruments', Object.entries(samples).map(([id, v]) => [`s:${id}`, `${v.label}${v.kind === 'hit' ? ' (drum)' : ''}`]));
group('Analysed recordings', library.map((p) => [`l:${p.id}`, `${p.name}${p.pitched === false ? ' (unpitched)' : ''}`]));
if (!sel.options.length) { sel.append(new Option('No instruments found', '')); status('Could not load the instrument lists.'); }

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

let chooseSeq = 0; // a later choice wins over a slow-loading earlier one
async function choose(value) {
  const token = ++chooseSeq;
  const [kind, id] = [value.slice(0, 1), value.slice(2)];
  if (kind === 'w') {
    const v = instruments[id];
    current = { label: v.label, voice: v };
    await sampleLoad;
    if (token !== chooseSeq) return;
    const rec = v.sample && sound.hasSample?.(v.sample) ? ` Recorded: ${samples[v.sample].label}.` : ' Synthesized.';
    about.textContent = `${cap(v.label)}, ${v.inspiredBy}. ${cap(v.family || '')}.${rec}`.replace('..', '.');
  } else if (kind === 's') {
    const v = samples[id];
    await sampleLoad;
    if (token !== chooseSeq) return;
    const ok = sound.hasSample?.(id);
    // A sampled instrument without its file (or on the built-in synth) plays a plain tone.
    current = { label: v.label, voice: { sample: id, harmonics: [1, 0.5, 0.25], dur: v.kind === 'hit' ? 0.3 : 0.7 } };
    about.textContent = `${v.label}: ${ok ? 'recording' : 'recording not loaded, plain tone'}. ${v.source}, ${v.license}.`;
  } else if (kind === 'l') {
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
  // Recorded instruments have no typical phrase: Phrase would only repeat Note.
  const hasPhrase = !!current?.voice?.gesture;
  $('#play-phrase').disabled = !hasPhrase;
  if (current && !hasPhrase) about.textContent += ' No typical phrase for this instrument.';
}
sel.addEventListener('change', async () => { await choose(sel.value); describe(about.textContent); });
if (sel.value) await choose(sel.value);

const KIND_TEXT = { note: 'one note', scale: 'a scale', chord: 'a chord', phrase: 'its phrase' };
const nameOf = (hz) => noteName(Math.round(12 * Math.log2(hz / C4)));
function play(kind) {
  if (!current) { describe('This instrument is still loading or could not be loaded.'); return; }
  if (kind === 'phrase' && !current.voice.gesture) { describe('No typical phrase for this instrument. Try Note, Scale or Chord.'); return; }
  const notes = toneNotes(current.voice, noteHz(+pitch.value), kind, scale);
  sound.stopAll();
  if (current.name) {
    for (const n of notes) sound.play({ voice: current.name, freq: n.freq, t: n.t, dur: n.dur, amp: 0.45 * (n.amp ?? 1) });
  } else {
    playNotes(sound, current.voice, notes, { amp: 0.4 });
  }
  // Scales and chords that would pass E6 start an octave lower: announce the note actually played.
  describe(`${cap(current.label)}: ${KIND_TEXT[kind]} from ${notes.length ? nameOf(notes[0].freq) : noteName(+pitch.value)}`);
}
for (const k of Object.keys(KIND_TEXT)) $(`#play-${k}`).addEventListener('click', () => play(k));

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target.tagName, text = /^(INPUT|TEXTAREA)$/.test(tag) && e.target.type !== 'range';
  const k = { n: 'note', s: 'scale', c: 'chord', p: 'phrase' }[e.key.toLowerCase()];
  // Letter keys work everywhere except text fields (also on the lists); arrows only outside form controls.
  if (k && !text) { e.preventDefault(); play(k); return; }
  if (/^(SELECT|INPUT|TEXTAREA)$/.test(tag)) return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    pitch.value = Math.max(LOW_SEMIS, Math.min(HIGH_SEMIS, +pitch.value + (e.key === 'ArrowUp' ? 1 : -1)));
    syncPitch();
    describe(noteName(+pitch.value));
    play('note');
  }
});
status('');
