// Scales as cents within a period, and value -> quantized frequency. Pure, runs in node too.
// Degrees come from the sound engine's built-in scales (SCALE_DEFS) and gamelan cents from its tunings,
// so the app and the engine always agree.
import { SCALE_DEFS } from '../../sound-engine/js/scale.js';
import { SLENDRO_CENTS, PELOG_CENTS } from '../../sound-engine/js/tuning.js';

const TUNING_CENTS = {
  '12tet': { cents: [...Array(12).keys()].map((k) => k * 100), period: 1200 },
  slendro: { cents: [0, ...SLENDRO_CENTS.slice(0, -1)], period: SLENDRO_CENTS.at(-1) },
  pelog: { cents: [0, ...PELOG_CENTS.slice(0, -1)], period: PELOG_CENTS.at(-1) },
};

// id -> [plain label, engine tuning]. PLEASANT: the scales offered in every mode's Scale menu; all of them
// still sound fine when random notes overlap (pentatonic or hexatonic, few semitones).
const META = {
  'pentatonic-major': ['Major pentatonic', '12tet'],
  'pentatonic-minor': ['Minor pentatonic', '12tet'],
  yo: ['Japanese yo', '12tet'],
  hirajoshi: ['Japanese hirajoshi', '12tet'],
  // bhupali / durga have the same notes as major pentatonic / yo: kept for old links, not in the menu.
  bhupali: ['Raga Bhupali (Indian, same notes as major pentatonic)', '12tet'],
  durga: ['Raga Durga (Indian, same notes as Japanese yo)', '12tet'],
  malkauns: ['Raga Malkauns (Indian, late night)', '12tet'],
  slendro: ['Slendro (Javanese gamelan, 5 tones)', 'slendro'],
  'pelog-lima': ['Pelog lima (Javanese gamelan, 5 of 7 tones)', 'pelog'],
  'dorian-hexatonic': ['Dorian hexatonic (good over a drone)', '12tet'],
  'whole-tone': ['Whole tone (dreamy)', '12tet'],
  major: ['Major', '12tet'],
  dorian: ['Dorian', '12tet'],
  pelog: ['Pelog (Javanese gamelan, all 7 tones)', 'pelog'],
};
export const PLEASANT = ['pentatonic-major', 'pentatonic-minor', 'yo', 'hirajoshi', 'malkauns',
  'slendro', 'pelog-lima', 'dorian-hexatonic', 'whole-tone'];

function build(id) {
  const [label, tuning] = META[id], t = TUNING_CENTS[tuning];
  return { label, tuning, cents: SCALE_DEFS[id].up.map((d) => t.cents[d]), period: t.period };
}
export const SCALES = Object.fromEntries(Object.keys(META).map((id) => [id, build(id)]));

export const C4 = 261.6256;
export const noteHz = (semisFromC4) => C4 * 2 ** (semisFromC4 / 12);
// The app's global pitch range, in semitones from C4 and in Hz: C2 (65 Hz) to A5 (880 Hz). Every mode reads these.
export const LOW_SEMIS = -24, HIGH_SEMIS = 21;
export const MIN_FUND_HZ = noteHz(LOW_SEMIS), MAX_FUND_HZ = noteHz(HIGH_SEMIS);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (semisFromC4) => NAMES[((semisFromC4 % 12) + 12) % 12] + (4 + Math.floor(semisFromC4 / 12));

// All frequencies of `scale` between lowHz and highHz (inclusive), ascending. Degree 0 sits on C.
export function scaleFreqs(scale, lowHz, highHz) {
  const s = typeof scale === 'string' ? SCALES[scale] : scale;
  if (!s) throw new Error(`unknown scale ${scale}`);
  const out = [];
  for (let p = -6; p <= 6; p++) for (const c of s.cents) {
    const f = C4 * 2 ** ((p * s.period + c) / 1200);
    if (f >= lowHz * 0.999 && f <= highHz * 1.001) out.push(f);
  }
  return out.sort((a, b) => a - b);
}

// value in range -> nearest scale tone, spread evenly over the tones between lowHz and highHz.
export function quantize(value, [lo, hi], scale, lowHz = 98, highHz = 392) {
  const fs = scaleFreqs(scale, lowHz, highHz);
  if (!fs.length) return { freq: lowHz, index: 0, count: 1 };
  const f = Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1)));
  const index = Math.round(f * (fs.length - 1));
  return { freq: fs[index], index, count: fs.length };
}

// Nearest of `tones` (ascending Hz, e.g. from scaleFreqs) to freq: keeps octave-shifted notes in scale and range.
export function snapToScale(freq, tones) {
  let best = tones[0];
  for (const f of tones) if (Math.abs(Math.log(f / freq)) < Math.abs(Math.log(best / freq))) best = f;
  return best;
}
