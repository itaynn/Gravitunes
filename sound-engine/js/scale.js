// scale.js — which steps of a tuning the data may use. Pure. OWNER: logic worker.

const MODE = (rot) => {
  const major = [0, 2, 4, 5, 7, 9, 11];
  return major.map((_, i) => (major[(i + rot) % 7] - major[rot] + 12) % 12);
};

// Every built-in except chromatic has an explicit period and only works with a tuning of that size.
const DEFS = {
  chromatic: null, // all steps, period from tuning
  major: { up: [0, 2, 4, 5, 7, 9, 11], period: 12 },
  minor: { up: [0, 2, 3, 5, 7, 8, 10], period: 12 },
  ionian: { up: MODE(0), period: 12 },
  dorian: { up: MODE(1), period: 12 },
  phrygian: { up: MODE(2), period: 12 },
  lydian: { up: MODE(3), period: 12 },
  mixolydian: { up: MODE(4), period: 12 },
  aeolian: { up: MODE(5), period: 12 },
  locrian: { up: MODE(6), period: 12 },
  "pentatonic-major": { up: [0, 2, 4, 7, 9], period: 12 },
  "pentatonic-minor": { up: [0, 3, 5, 7, 10], period: 12 },
  "harmonic-minor": { up: [0, 2, 3, 5, 7, 8, 11], period: 12 },
  // Ragas. Yaman: tivra Ma, ascent skips Pa. Vadi Ga, samvadi Ni.
  yaman: { up: [0, 2, 4, 6, 9, 11], down: [0, 2, 4, 6, 7, 9, 11], vadi: 4, samvadi: 11, period: 12 },
  // Bhairav: komal Re and Dha. Vadi Dha, samvadi komal Re.
  bhairav: { up: [0, 1, 4, 5, 7, 8, 11], down: [0, 1, 4, 5, 7, 8, 11], vadi: 8, samvadi: 1, period: 12 },
  // 22-shruti degrees: Re 9/8=4, Ga 5/4=7, Ma' 45/32=11, Pa=13, Dha 5/3=16, Ni 15/8=20, Re komal 16/15=2, Dha komal 8/5=15, Ma 4/3=9
  "yaman-22": { up: [0, 4, 7, 11, 16, 20], down: [0, 4, 7, 11, 13, 16, 20], vadi: 7, samvadi: 20, period: 22 },
  "bhairav-22": { up: [0, 2, 7, 9, 13, 15, 20], down: [0, 2, 7, 9, 13, 15, 20], vadi: 15, samvadi: 2, period: 22 },
  // Javanese gamelan (tunings "slendro", 5 steps, and "pelog", 7 steps). Degrees are 0-based: slendro
  // tones 1 2 3 5 6 are degrees 0..4; pelog tones 1..7 are degrees 0..6. A pathet (mode) is as much
  // about which tones are emphasized and where phrases end as about the note set, so the slendro
  // pathets share all 5 notes and differ only in vadi/samvadi (the commonly described emphasized
  // tones, used here as "emphasis" metadata). Practice varies between regions and ensembles.
  slendro: { up: [0, 1, 2, 3, 4], period: 5 },
  "slendro-nem": { up: [0, 1, 2, 3, 4], vadi: 1, samvadi: 4, period: 5 },     // tones 2 and 6
  "slendro-sanga": { up: [0, 1, 2, 3, 4], vadi: 3, samvadi: 0, period: 5 },   // tones 5 and 1
  "slendro-manyura": { up: [0, 1, 2, 3, 4], vadi: 4, samvadi: 2, period: 5 }, // tones 6 and 3
  pelog: { up: [0, 1, 2, 3, 4, 5, 6], period: 7 },
  "pelog-lima": { up: [0, 1, 2, 4, 5], vadi: 0, samvadi: 4, period: 7 },      // tones 1 2 3 5 6; 1 and 5
  "pelog-nem": { up: [0, 1, 2, 4, 5], vadi: 5, samvadi: 1, period: 7 },       // tones 1 2 3 5 6; 6 and 2
  "pelog-barang": { up: [1, 2, 4, 5, 6], vadi: 5, samvadi: 1, period: 7 },    // tones 2 3 5 6 7; 6 and 2
};

/**
 * Built-in scales. 12-TET: "chromatic", "major", "minor", "ionian", "dorian", "phrygian", "lydian",
 * "mixolydian", "aeolian", "locrian", "pentatonic-major", "pentatonic-minor", "harmonic-minor".
 * Ragas: "yaman", "bhairav" (12-TET degrees), "yaman-22", "bhairav-22" (22-shruti degrees).
 * Gamelan: "slendro", "slendro-nem", "slendro-sanga", "slendro-manyura" (5-step "slendro" tuning),
 * "pelog", "pelog-lima", "pelog-nem", "pelog-barang" (7-step "pelog" tuning).
 */
export const BUILTIN_SCALES = Object.keys(DEFS);

/**
 * @typedef {Object} ScaleDef
 * @property {string} [name]
 * @property {number[]} up        allowed degrees (0..period-1) when ascending
 * @property {number[]} [down]    allowed degrees when descending (defaults to up)
 * @property {number} [period]    steps per period (defaults to tuning.size, else 12)
 * @property {number} [vadi]      emphasized degree (metadata)
 * @property {number} [samvadi]   second emphasized degree (metadata)
 * @property {number} [root]      step offset added to every degree (default 0)
 */
/**
 * @typedef {Object} Scale
 * @property {string} name
 * @property {number[]} up  @property {number[]} down  @property {number} period  @property {number} root
 * @property {number} [vadi]  @property {number} [samvadi]
 * @property {(x:number, opts?:{direction?:"up"|"down"})=>number} quantize
 *   nearest allowed integer step to float step x (ties go up). direction picks the up/down set.
 * @property {(v:number, opts?:{min?:number,max?:number,low?:number,high?:number,direction?:"up"|"down"})=>number} fromValue
 *   linear map v from [min,max] (default [0,1], clamped) to steps [low,high] (default [0, 2*period]),
 *   then quantize. Returns an integer step.
 * @property {(n:number, opts?:{direction?:"up"|"down"})=>number} degree
 *   n-th scale note across periods: degree(0)=root+set[0], degree(len)=that + period, negatives ok.
 */

function checkSet(arr, label, period, name) {
  if (!Array.isArray(arr) || !arr.length) throw new Error(`scale ${name}: '${label}' must be a non-empty array of integer degrees`);
  for (const d of arr) {
    if (!Number.isInteger(d)) throw new Error(`scale ${name}: ${label} degree ${JSON.stringify(d)} is not an integer`);
    if (d < 0 || d >= period) throw new Error(`scale ${name}: ${label} degree ${d} is outside 0..${period - 1} (period ${period})`);
  }
  return [...new Set(arr)].sort((a, b) => a - b);
}

function make(def, tuning) {
  const name = def.name ?? "custom";
  const period = def.period ?? tuning?.size ?? 12;
  if (!Number.isInteger(period) || period < 1) throw new Error(`scale ${name}: period must be a positive integer, got ${period}`);
  const up = checkSet(def.up, "up", period, name);
  const down = def.down ? checkSet(def.down, "down", period, name) : up;
  const root = def.root ?? 0;
  const set = (dir) => (dir === "down" ? down : up);
  const s = { name, up, down, period, root };
  if (def.vadi !== undefined) s.vadi = def.vadi;
  if (def.samvadi !== undefined) s.samvadi = def.samvadi;
  s.quantize = (x, o = {}) => {
    const degs = set(o.direction);
    const p0 = Math.floor((x - root) / period);
    let best = null;
    for (let p = p0 - 1; p <= p0 + 1; p++) {
      for (const d of degs) {
        const c = root + p * period + d;
        if (best === null || Math.abs(c - x) < Math.abs(best - x) || (Math.abs(c - x) === Math.abs(best - x) && c > best)) best = c;
      }
    }
    return best;
  };
  s.fromValue = (v, o = {}) => {
    const min = o.min ?? 0, max = o.max ?? 1, low = o.low ?? 0, high = o.high ?? 2 * period;
    let t = max === min ? 0 : (v - min) / (max - min);
    t = Math.min(1, Math.max(0, t));
    return s.quantize(low + t * (high - low), { direction: o.direction });
  };
  s.degree = (n, o = {}) => {
    const degs = set(o.direction);
    const oct = Math.floor(n / degs.length);
    return root + oct * period + degs[n - oct * degs.length];
  };
  return s;
}

/**
 * spec: built-in name | ScaleDef | null/"chromatic" (all steps) | existing Scale (returned as-is).
 * @param {string|ScaleDef|null} spec
 * @param {{size:number}} [tuning]  used for the default period
 * @returns {Scale}
 * @throws {Error} unknown name → lists BUILTIN_SCALES; degrees outside 0..period-1 → says which;
 *   a built-in scale (other than chromatic) used with a tuning whose size differs from its period.
 */
export function createScale(spec, tuning) {
  if (spec && typeof spec === "object" && typeof spec.quantize === "function") return spec;
  if (spec === null || spec === undefined) spec = "chromatic";
  if (typeof spec === "string") {
    const key = spec.trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(DEFS, key)) {
      throw new Error(`unknown scale ${JSON.stringify(spec)}: use one of ${BUILTIN_SCALES.join(", ")}, or an object like {up:[0,2,4,5,7,9,11]}`);
    }
    if (key === "chromatic") {
      const period = tuning?.size ?? 12;
      return make({ name: "chromatic", up: Array.from({ length: period }, (_, i) => i), period }, tuning);
    }
    const def = DEFS[key];
    if (tuning?.size !== undefined && tuning.size !== def.period) {
      const fits = Object.keys(DEFS).filter((k) => DEFS[k]?.period === tuning.size);
      throw new Error(`scale '${key}' is defined for ${def.period}-step tunings; tuning ${tuning.name ?? "(unnamed)"} has ${tuning.size} steps — use 'chromatic'` +
        (fits.length ? ` or a scale defined for ${tuning.size} steps (${fits.join(", ")})` : ` or a scale defined for ${tuning.size} steps (an object like {up: [...], period: ${tuning.size}})`));
    }
    return make({ ...def, name: key }, tuning);
  }
  if (typeof spec !== "object") throw new Error(`scale: expected a name or object, got ${typeof spec}`);
  return make(spec, tuning);
}
