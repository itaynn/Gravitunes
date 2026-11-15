// Tone lab: pure logic (no DOM), tested by test.mjs. Builds the notes for note / scale / chord / phrase.
import { gestureNotes } from '../../core/gestures.js';
import { SCALES } from '../../core/scales.js';

const MAJOR = [0, 200, 400, 500, 700, 900, 1100];

// Degrees of a root-3rd-5th chord in `scale` (cents within a period): the degree nearest a major or minor
// third, and the one nearest a fifth, so every scale gives a real triad-like chord.
export function chordSteps(scale) {
  const near = (targets, skip) => {
    let best = -1, bd = Infinity;
    scale.forEach((c, d) => {
      if (d === 0 || d === skip) return;
      const dist = Math.min(...targets.map((x) => Math.abs(c - x)));
      if (dist < bd) { bd = dist; best = d; }
    });
    return best;
  };
  if (scale.length < 3) return [0];
  const third = near([400, 300]), fifth = near([700], third);
  return [0, ...[third, fifth].filter((d) => d > 0).sort((a, b) => a - b)];
}

// kind: 'note' | 'scale' | 'chord' | 'phrase'. Scale and chord use `scale` (an app/core/scales.js id) if given,
// else the instrument's own scale (world instruments have gesture.scale) or major. Phrases keep the instrument's. Everything stays at or below C5 (gestureNotes shifts down by octaves).
export function toneNotes(voice, baseHz, kind, scaleId = null) {
  const g = voice.gesture || {};
  const sc = scaleId && SCALES[scaleId];
  const own = g.scale?.length >= 5 ? g.scale : null;   // drones (one or two notes) fall back to major
  const scale = sc ? sc.cents : own || MAJOR;
  const period = sc ? sc.period : own ? g.period ?? 1200 : 1200;
  const n = scale.length;
  const dur = Math.max(0.35, voice.dur ?? 0.5);
  const plain = { ...voice, octave: 0, slide: kind === 'phrase' ? voice.slide : undefined };
  if (kind === 'phrase') return gestureNotes({ ...voice, octave: 0 }, baseHz, { phrase: true });
  const spec = {
    note: { steps: [0], gap: 0, dur: Math.max(dur, 0.8) },
    scale: { steps: [...Array(n + 1).keys()], gap: 0.32, dur },
    chord: { steps: chordSteps(scale), gap: 0, dur: Math.max(dur, 1.2) },
  }[kind];
  if (!spec) throw new Error(`unknown kind ${kind}`);
  const notes = gestureNotes({ ...plain, gesture: { scale, period, ...spec } }, baseHz, { phrase: true });
  if (kind === 'chord') for (const x of notes) x.amp = 0.6;
  return notes;
}

// Arrow-key move on the map: the nearest region center in direction dir ('left' | 'right' | 'up' | 'down') from
// `from` ({lat, lon}), longitude wrapping. Centers far off the arrow's axis score worse.
export function neighbor(centers, from, dir) {
  const [ax, sign] = { left: ['x', -1], right: ['x', 1], up: ['y', 1], down: ['y', -1] }[dir];
  let best = null, bs = Infinity;
  for (const c of centers) {
    if (c.lat === from.lat && c.lon === from.lon) continue;
    const dx = ((((c.lon - from.lon) + 540) % 360) - 180) * Math.cos(((c.lat + from.lat) / 2) * Math.PI / 180);
    const dy = c.lat - from.lat;
    const along = (ax === 'x' ? dx : dy) * sign, across = Math.abs(ax === 'x' ? dy : dx);
    if (along <= 0) continue;
    const score = Math.hypot(along, across) + across + (across > along * 1.7 ? 1000 : 0);
    if (score < bs) { bs = score; best = c; }
  }
  return best;
}

// ---- Sound builder ("Build a sound" view): an editable voice, plain numbers so sliders map 1:1.
export const NH = 8;   // harmonic sliders
const r2 = (x) => Math.round(x * 100) / 100;
// Classic waveforms as harmonic amplitudes (first NH): sine, triangle (odd, 1/k^2), square (odd, 1/k), sawtooth (1/k).
export function waveHarmonics(name) {
  return Array.from({ length: NH }, (_, i) => {
    const k = i + 1;
    if (name === 'sine') return k === 1 ? 1 : 0;
    if (name === 'triangle') return k % 2 ? r2(1 / (k * k)) : 0;
    if (name === 'square') return k % 2 ? r2(1 / k) : 0;
    return r2(1 / k);
  });
}
// Brightness: 0..1 <-> low-pass cutoff 600..12000 Hz (log scale; 12 kHz is the app's ceiling).
export const brightHz = (b) => Math.round(600 * 20 ** Math.max(0, Math.min(1, b)));
// A builder state from an instrument voice (instruments.json entry, or {} for a plain default).
export function builderFromVoice(v = {}) {
  const h = Array.isArray(v.harmonics) ? v.harmonics : waveHarmonics(v.harmonics > 1 ? 'saw' : 'sine');
  const e = { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.3, ...(v.envelope || {}) };
  const mix = v.samples || (v.sample ? [{ id: v.sample, w: 1 }] : []);
  return {
    harmonics: Array.from({ length: NH }, (_, i) => r2(Math.max(0, Math.min(1, h[i] ?? 0)))),
    attack: r2(Math.min(2, e.attack)), decay: r2(Math.min(3, e.decay)), sustain: r2(Math.min(1, e.sustain)), release: r2(Math.min(3, e.release)),
    bright: r2(v.brightness ?? 0.6), noise: r2(Math.min(1, v.noise?.amount ?? 0)), vibrato: Math.round(Math.min(50, v.vibrato?.depth ?? 0)),
    sample: mix[0]?.id || '', mix: mix[0] ? r2(mix[0].w) : 0,
  };
}
// sound.play() options for one note of builder state b (synth part; the recording part is played separately).
export function builderSynth(b) {
  return {
    harmonics: b.harmonics.some((x) => x > 0) ? b.harmonics : [1],
    envelope: { attack: Math.max(0.002, b.attack), decay: Math.max(0.01, b.decay), sustain: b.sustain, release: Math.max(0.02, b.release) },
    lowpass: brightHz(b.bright),
    noise: b.noise > 0 ? { amount: b.noise, attack: 0.001, decay: 0.05, cutoff: 3000 } : undefined,
    vibrato: b.vibrato > 0 ? { rate: 5.5, depth: b.vibrato, delay: 0.15 } : undefined,
  };
}
