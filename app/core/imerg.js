// IMERG precipitation image helpers shared by itay's demos: colour -> rain amount, wording,
// and MIDI note helpers for pitches kept inside C2..C5. Pure; runs in node.
import { noteHz, noteName } from './scales.js';

export const MIDI_C2 = 36, MIDI_C5 = 72;

// Rain 0..1 from an IMERG palette colour (saturated red/blue = heavy; grey/dark = none).
export function rainFromColor(red, green, blue) {
  const max = Math.max(red, green, blue);
  if (max < 32) return 0;
  const saturation = (max - Math.min(red, green, blue)) / max;
  if (saturation < 0.22) return 0;
  return Math.min(1, (red + blue) / 255) * saturation;
}

// Colour strength 0..1 of an RGBA pixel (alpha-weighted saturation and brightness); 0 for empty.
export function rainStrength(red, green, blue, alpha255) {
  const alpha = alpha255 / 255;
  const max = Math.max(red, green, blue);
  if (alpha === 0 || max < 30) return 0;
  const saturation = (max - Math.min(red, green, blue)) / max;
  return alpha * (0.25 + saturation * 0.75) * (0.5 + (max / 255) * 0.5);
}

export function rainLevel(rain, none = 0.02) {
  if (rain <= none) return 'no rain';
  if (rain < 0.25) return 'light rain';
  if (rain < 0.6) return 'moderate rain';
  return 'heavy rain';
}

// `count` MIDI notes of a scale (semitone steps in one octave) upward from `from`, clamped to C2..C5.
export function scaleMidi(steps, from, count) {
  const out = Array.from({ length: count }, (_, i) => from + 12 * Math.floor(i / steps.length) + steps[i % steps.length]);
  return out.map((m) => Math.max(MIDI_C2, Math.min(MIDI_C5, m)));
}

export const midiHz = (m) => noteHz(m - 60);
export const midiName = (m) => noteName(m - 60);
