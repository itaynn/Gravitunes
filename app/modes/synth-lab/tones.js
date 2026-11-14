// Tone lab: pure logic (no DOM), tested by test.mjs. Builds the notes for note / scale / chord / phrase.
import { gestureNotes } from '../../core/gestures.js';
import { SCALES } from '../../core/scales.js';

const MAJOR = [0, 200, 400, 500, 700, 900, 1100];

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
    chord: { steps: [0, 2, 4], gap: 0, dur: Math.max(dur, 1.2) },
  }[kind];
  if (!spec) throw new Error(`unknown kind ${kind}`);
  const notes = gestureNotes({ ...plain, gesture: { scale, period, ...spec } }, baseHz, { phrase: true });
  if (kind === 'chord') for (const x of notes) x.amp = 0.6;
  return notes;
}
