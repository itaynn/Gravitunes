// Explore: pure mapping logic (runs in node too). Each dataset has its own recorded instrument and register;
// one dataset plays at a time. `harmonics`/`envelope` are the synthesized fallback when samples can't load.
import { noteHz, scaleFreqs } from '../../core/scales.js';

// Registers in semitones from C4, all inside C2..A5. Gases don't overlap: CO low, ozone middle, NOx upper.
export const LAYERS = [
  { id: '5153', name: 'carbon monoxide', sample: 'cello', low: -24, high: -13,    // C2..B2: cello
    harmonics: [1, 0.5, 0.3, 0.15], envelope: { attack: 0.04, decay: 0.3, sustain: 0.5, release: 0.3 }, amp: 0.3 },
  { id: '5152', name: 'ozone', sample: 'flute', low: -12, high: -3,               // C3..A3: flute
    harmonics: [1, 0.12, 0.05], envelope: { attack: 0.06, decay: 0.2, sustain: 0.6, release: 0.3 }, amp: 0.26 },
  { id: '5154', name: 'nitrogen oxides', sample: 'koto', low: 0, high: 12,        // C4..C5: koto
    harmonics: [1, 0.4, 0.22, 0.12, 0.06], envelope: { attack: 0.005, decay: 0.25, sustain: 0.15, release: 0.2 },
    lowpass: 2200, amp: 0.22 },
  { id: '4285', name: 'rain', sample: 'marimba', low: -5, high: 14,               // G3..D5: marimba
    harmonics: [1, 0, 0.25, 0, 0.08], envelope: { attack: 0.003, decay: 0.35, sustain: 0.05, release: 0.25 },
    lowpass: 2400, amp: 0.26 },
];
export const SAMPLES = LAYERS.map((l) => l.sample);

// 0..1 -> frequency in the layer's register on `scale` (core/scales.js does the quantizing).
export function layerFreq(layer, x, scale = 'pentatonic-major') {
  const fs = scaleFreqs(scale, noteHz(layer.low), noteHz(layer.high));
  if (!fs.length) return noteHz(layer.low);
  return fs[Math.round(Math.max(0, Math.min(1, x ?? 0)) * (fs.length - 1))];
}

// The layer (voice + register) for a dataset id; unknown ids get the ozone voice.
export function layerFor(id) {
  return LAYERS.find((l) => l.id === String(id)) || LAYERS.find((l) => l.id === '5152');
}

// One note for a 0..1 value in the layer's register.
export function noteFor(layer, norm, pan = 0, scale = 'pentatonic-major') {
  return {
    id: layer.id, freq: layerFreq(layer, norm, scale), sample: layer.sample, harmonics: layer.harmonics, envelope: layer.envelope,
    ...(layer.lowpass && { lowpass: layer.lowpass }), amp: layer.amp, dur: 0.45, pan,
  };
}
