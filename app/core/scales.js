// Scales as cents within a period, and value -> quantized frequency. Pure, runs in node too.
// Gamelan values match the sound engine's SLENDRO_CENTS / PELOG_CENTS (representative, not one set).

export const SCALES = {
  'pentatonic-major': { label: 'Pentatonic (major)', cents: [0, 200, 400, 700, 900], period: 1200 },
  'pentatonic-minor': { label: 'Pentatonic (minor)', cents: [0, 300, 500, 700, 1000], period: 1200 },
  major: { label: 'Major', cents: [0, 200, 400, 500, 700, 900, 1100], period: 1200 },
  dorian: { label: 'Dorian', cents: [0, 200, 300, 500, 700, 900, 1000], period: 1200 },
  slendro: { label: 'Slendro (Javanese gamelan, 5 tones)', cents: [0, 238, 476, 715, 958], period: 1210 },
  pelog: { label: 'Pelog (Javanese gamelan, 7 tones)', cents: [0, 125, 265, 545, 680, 795, 950], period: 1220 },
};

export const C4 = 261.6256;
export const noteHz = (semisFromC4) => C4 * 2 ** (semisFromC4 / 12);
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
