// scala.js — Scala .scl/.kbm parsers. Pure. OWNER: logic worker.

/**
 * @typedef {Object} SclPitch
 * @property {number} cents  pitch above 1/1 in cents
 * @property {string} text   original token, e.g. "3/2", "701.955", "2"
 * @property {number|null} ratio  numeric ratio if given as ratio/integer, else null
 */
/**
 * @typedef {Object} Scl
 * @property {string} description
 * @property {number} count          number of pitches (excluding implicit 1/1)
 * @property {SclPitch[]} pitches    length === count; last one is the period
 * @property {number} periodCents    === pitches[count-1].cents
 */

// Returns [{line, text}] for non-comment lines (line numbers are 1-based).
function contentLines(text) {
  const out = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    if (raw.trimStart().startsWith("!")) return;
    out.push({ line: i + 1, text: raw });
  });
  return out;
}

/**
 * Parse Scala .scl text. Lines starting with "!" are comments. First non-comment line is the
 * description (may be empty), second is the count, then `count` pitch lines. A token containing
 * "." is cents; "a/b" or a bare integer is a ratio. Anything after the first token is ignored.
 * @param {string} text
 * @returns {Scl}
 * @throws {Error} with line number and what was expected (e.g. "line 5: expected a pitch like 3/2 or 701.955, got 'foo'").
 */
export function parseScl(text) {
  if (typeof text !== "string") throw new Error("scl: expected text, got " + typeof text);
  const lines = contentLines(text);
  if (lines.length < 2) throw new Error("scl: file needs a description line and a count line (e.g. 'My scale' then '12')");
  const description = lines[0].text.trim();
  // blank lines after the description are tolerated
  const rest = lines.slice(1).filter((l) => l.text.trim() !== "");
  if (!rest.length) throw new Error(`line ${lines[1].line}: expected the number of notes (an integer), got an empty line`);
  const cl = rest[0];
  const ctok = cl.text.trim().split(/\s+/)[0];
  if (!/^\d+$/.test(ctok)) throw new Error(`line ${cl.line}: expected the number of notes (an integer), got '${ctok}'`);
  const count = parseInt(ctok, 10);
  if (count < 1) throw new Error(`line ${cl.line}: note count must be at least 1 (the last note is the period, e.g. 2/1)`);
  const body = rest.slice(1);
  const pitches = [];
  for (const l of body) {
    if (pitches.length >= count) {
      throw new Error(`line ${l.line}: found more pitch lines than the declared count of ${count}; fix the count or remove the extra line`);
    }
    const tok = l.text.trim().split(/\s+/)[0];
    pitches.push(parsePitch(tok, l.line));
  }
  if (pitches.length < count) {
    throw new Error(`scl: count says ${count} pitches but only ${pitches.length} found; fix the count or add the missing lines`);
  }
  return { description, count, pitches, periodCents: pitches[count - 1].cents };
}

function parsePitch(tok, line) {
  const bad = () => new Error(`line ${line}: expected a pitch like 3/2 or 701.955, got '${tok}'`);
  if (tok.includes(".")) {
    if (!/^[+-]?(\d+\.\d*|\.\d+)$/.test(tok)) throw bad();
    return { cents: parseFloat(tok), text: tok, ratio: null };
  }
  const m = /^(\d+)(?:\/(\d+))?$/.exec(tok);
  if (!m) throw bad();
  const num = parseInt(m[1], 10), den = m[2] === undefined ? 1 : parseInt(m[2], 10);
  if (num <= 0 || den <= 0) throw new Error(`line ${line}: ratio '${tok}' must have positive numerator and denominator`);
  const ratio = num / den;
  return { cents: 1200 * Math.log2(ratio), text: tok, ratio };
}

/**
 * @typedef {Object} Kbm
 * @property {number} size          map size (0 = linear mapping, every key maps to consecutive degrees)
 * @property {number} first         first MIDI note to retune
 * @property {number} last          last MIDI note to retune
 * @property {number} middle        MIDI note where degree 0 of the mapping sits
 * @property {number} refNote       MIDI note whose frequency is given
 * @property {number} refFreq       Hz
 * @property {number} octaveDegree  scale degree that is the formal octave (0 = use the scl period)
 * @property {(number|null)[]} mapping  length === size; null for "x" (unmapped)
 */
/**
 * Parse Scala .kbm keyboard mapping text ("!" comments allowed).
 * @param {string} text
 * @returns {Kbm}
 * @throws {Error} with line number and the field that was expected.
 */
export function parseKbm(text) {
  if (typeof text !== "string") throw new Error("kbm: expected text, got " + typeof text);
  const lines = contentLines(text).filter((l) => l.text.trim() !== "");
  const fields = ["map size", "first MIDI note", "last MIDI note", "middle note", "reference note", "reference frequency", "octave degree"];
  const vals = [];
  for (let i = 0; i < fields.length; i++) {
    const l = lines[i];
    if (!l) throw new Error(`kbm: missing field '${fields[i]}' (line ${i + 1} of the data); a .kbm needs 7 header numbers`);
    const tok = l.text.trim().split(/\s+/)[0];
    const isFreq = i === 5;
    const ok = isFreq ? /^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok) : /^[+-]?\d+$/.test(tok);
    if (!ok) throw new Error(`line ${l.line}: expected ${isFreq ? "a number" : "an integer"} for ${fields[i]}, got '${tok}'`);
    vals.push(Number(tok));
  }
  const [size, first, last, middle, refNote, refFreq, octaveDegree] = vals;
  if (size < 0) throw new Error(`line ${lines[0].line}: map size must be >= 0, got ${size}`);
  if (refFreq <= 0) throw new Error(`line ${lines[5].line}: reference frequency must be positive, got ${refFreq}`);
  const entries = lines.slice(7);
  if (entries.length < size) throw new Error(`kbm: map size is ${size} but only ${entries.length} mapping entries found; add entries (a degree number or 'x')`);
  if (entries.length > size) throw new Error(`line ${entries[size].line}: more mapping entries than the declared map size ${size}`);
  const mapping = entries.map((l) => {
    const tok = l.text.trim().split(/\s+/)[0];
    if (/^x$/i.test(tok)) return null;
    if (!/^[+-]?\d+$/.test(tok)) throw new Error(`line ${l.line}: expected a scale degree integer or 'x', got '${tok}'`);
    return parseInt(tok, 10);
  });
  return { size, first, last, middle, refNote, refFreq, octaveDegree, mapping };
}
