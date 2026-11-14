// Tone lab: pick an instrument (world voices from data/earth/instruments.json, or recorded instruments from
// sound-engine/library) and hear a note, a scale, a chord or its phrase, between C2 and C5.
import { createSound } from '../../core/sound.js';
import { createDescribe, createPanel } from '../../core/ui.js';
import { scaleControl } from '../../core/scale-control.js';
import { loadEarth, getJson } from '../../core/data.js';
import { playNotes } from '../../core/gestures.js';
import { noteHz, noteName } from '../../core/scales.js';
import { toneNotes } from './tones.js';
import '../../core/switcher.js';

const $ = (s) => document.querySelector(s);
const describe = createDescribe($('#live'));
const status = (t) => { $('#status').textContent = t; };
const sel = $('#instrument'), pitch = $('#pitch'), about = $('#about');

const sound = await createSound();
let scale = 'pentatonic-major';
scaleControl(createPanel($('#tone-scale')), { value: scale, describe, onChange: (v) => { scale = v; },
  hint: 'Used by Scale and Chord. Phrase plays the instrument\'s own typical notes.' });
let instruments = {}, library = [], current = null;   // current: { label, voice, name? }

const syncPitch = () => pitch.setAttribute('aria-valuetext', noteName(+pitch.value));
syncPitch();
pitch.addEventListener('input', syncPitch);

$('#start-sound').addEventListener('click', async () => {
  await sound.start();
  const b = $('#start-sound');
  b.textContent = 'Sound on'; b.disabled = true;
  describe('Sound started. Choose an instrument, then press Note, Scale, Chord or Phrase.');
  play('note');
  sel.focus();
});

try {
  ({ instruments } = await loadEarth('instruments'));
} catch (e) { console.warn(e); }
try {
  library = await getJson('/sound-engine/library/presets/index.json');
} catch (e) { console.warn(e); }

sel.replaceChildren();
const group = (label, items) => {
  if (!items.length) return;
  const og = Object.assign(document.createElement('optgroup'), { label });
  og.append(...items.map(([v, t]) => new Option(t, v)));
  sel.append(og);
};
group('World instruments (as on the map)', Object.entries(instruments).map(([id, v]) => [`w:${id}`, `${cap(v.label)} (${v.inspiredBy})`]));
group('Recorded instruments', library.map((p) => [`l:${p.id}`, `${p.name}${p.pitched === false ? ' (unpitched)' : ''}`]));
if (!sel.options.length) { sel.append(new Option('No instruments found', '')); status('Could not load the instrument lists.'); }

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

async function choose(value) {
  const [kind, id] = [value.slice(0, 1), value.slice(2)];
  if (kind === 'w') {
    const v = instruments[id];
    current = { label: v.label, voice: v };
    about.textContent = `${cap(v.label)}, inspired by ${v.inspiredBy}. ${cap(v.family || '')}`.trim();
  } else if (kind === 'l') {
    const p = library.find((x) => x.id === id);
    current = null;
    about.textContent = `${p.name}: loading...`;
    try {
      const r = await sound.loadLibrary(id);
      current = { label: p.name, voice: { ...r.def, dur: 0.8 }, name: r.name };
      about.textContent = `${p.name}: ${p.title}. ${r.sample ? 'Recording' : 'Tone from its analysed overtones'}, ${p.license}.`;
    } catch (e) {
      about.textContent = `${p.name} could not be loaded (${e.message}).`;
    }
  }
}
sel.addEventListener('change', () => choose(sel.value));
if (sel.value) await choose(sel.value);

const KIND_TEXT = { note: 'one note', scale: 'a scale', chord: 'a chord', phrase: 'its phrase' };
function play(kind) {
  if (!current) return;
  if (!sound.started) { describe('Press "Start sound" first.'); return; }
  const notes = toneNotes(current.voice, noteHz(+pitch.value), kind, scale);
  sound.stopAll();
  if (current.name) {
    for (const n of notes) sound.play({ voice: current.name, freq: n.freq, t: n.t, dur: n.dur, amp: 0.45 * (n.amp ?? 1) });
  } else {
    playNotes(sound, current.voice, notes, { amp: 0.4 });
  }
  describe(`${cap(current.label)}: ${KIND_TEXT[kind]} from ${noteName(+pitch.value)}`);
}
for (const k of Object.keys(KIND_TEXT)) $(`#play-${k}`).addEventListener('click', () => play(k));

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || /^(SELECT|INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  const k = { n: 'note', s: 'scale', c: 'chord', p: 'phrase' }[e.key.toLowerCase()];
  if (k) { e.preventDefault(); play(k); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    pitch.value = Math.max(-24, Math.min(12, +pitch.value + (e.key === 'ArrowUp' ? 1 : -1)));
    syncPitch();
    describe(noteName(+pitch.value));
    play('note');
  }
});
status('');
