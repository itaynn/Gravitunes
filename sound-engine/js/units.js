// units.js — pure helpers, no AudioContext. OWNER: logic worker.
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Parse a note name like "A4", "C#3", "Bb-1" (scientific pitch, C4 = middle C = MIDI 60).
 * @param {string} name
 * @returns {number} MIDI note number (may be outside 0..127)
 * @throws {Error} message names the bad input and shows a valid example.
 */
export function noteToMidi(name) {
  const m = typeof name === "string" ? /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim()) : null;
  if (!m) throw new Error(`invalid note name ${JSON.stringify(name)}: use a letter A-G, optional # or b, then an octave, e.g. "A4", "C#3", "Bb2"`);
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return (parseInt(m[3], 10) + 1) * 12 + SEMI[m[1].toUpperCase()] + acc;
}

/**
 * @param {string} name note name, see noteToMidi
 * @param {number} [a4=440] reference frequency of A4 in Hz
 * @returns {number} Hz in 12-TET
 */
export function noteToFreq(name, a4 = 440) { return midiToFreq(noteToMidi(name), a4); }

/** @param {number} midi @param {number} [a4=440] @returns {number} Hz */
export function midiToFreq(midi, a4 = 440) { return a4 * Math.pow(2, (midi - 69) / 12); }

/** @param {number} db @returns {number} linear amplitude (0 dB = 1) */
export function dbToAmp(db) { return Math.pow(10, db / 20); }

/** @param {number} amp linear @returns {number} dB (-Infinity for 0) */
export function ampToDb(amp) { return amp === 0 ? -Infinity : 20 * Math.log10(amp); }

/** Cents between two frequencies. @param {number} f1 @param {number} f2 @returns {number} 1200*log2(f2/f1) */
export function centsBetween(f1, f2) { return 1200 * Math.log2(f2 / f1); }
