// tuning.js — maps integer steps to Hz. Pure (resolveTuning may fetch). OWNER: logic worker.
import { parseScl, parseKbm } from "./scala.js";

/** Built-in tuning names accepted as strings. "edo:N" is also accepted for any N >= 1. */
export const BUILTIN_TUNINGS = ["12tet", "just5", "shruti22"];

const JUST5 = ["16/15", "9/8", "6/5", "5/4", "4/3", "45/32", "3/2", "8/5", "5/3", "9/5", "15/8", "2/1"];
const SHRUTI22 = ["256/243", "16/15", "10/9", "9/8", "32/27", "6/5", "5/4", "81/64", "4/3", "27/20", "45/32",
  "729/512", "3/2", "128/81", "8/5", "5/3", "27/16", "16/9", "9/5", "15/8", "243/128", "2/1"];

const C4_FROM_A4 = Math.pow(2, -9 / 12);

/**
 * @typedef {Object} Tuning
 * @property {string} name
 * @property {number} size          steps per period (12 for 12tet, N for edo:N, scl count)
 * @property {number} periodCents   1200 unless the scl period differs
 * @property {number} refStep       the step that sounds at refFreq
 * @property {number} refFreq       Hz
 * @property {(step:number)=>number} freq   Hz for ANY integer step (negative, beyond one period).
 *   Non-integer steps interpolate in cents between neighbours. Returns NaN for unmapped kbm keys.
 * @property {(step:number)=>number} cents  cents above refStep
 * @property {(hz:number)=>number} stepOf   (float) step for a frequency: the inverse of freq, including
 *   non-linear .kbm maps. Next to unmapped keys (where freq is NaN) it returns the nearest mapped step.
 * @property {string[]} [labels]    optional per-degree labels (e.g. shruti names), length === size
 */

function sclTextFromTokens(desc, tokens) {
  return `${desc}\n${tokens.length}\n${tokens.join("\n")}\n`;
}

function ratiosToScl(ratios) {
  if (!Array.isArray(ratios) || !ratios.length) throw new Error("tuning: 'ratios' must be a non-empty array like [\"9/8\", 2]");
  const toks = ratios.map((r, i) => {
    if (typeof r === "number") {
      if (!(r > 0)) throw new Error(`tuning: ratios[${i}] must be positive, got ${r}`);
      return (1200 * Math.log2(r)).toFixed(9);
    }
    return String(r);
  });
  return sclTextFromTokens("ratios", toks);
}

function centsToScl(cents) {
  if (!Array.isArray(cents) || !cents.length) throw new Error("tuning: 'cents' must be a non-empty array like [100, 200, 1200]");
  return sclTextFromTokens("cents", cents.map((c, i) => {
    if (typeof c !== "number" || !isFinite(c)) throw new Error(`tuning: cents[${i}] must be a number, got ${JSON.stringify(c)}`);
    return c.toFixed(9);
  }));
}

function build({ name, degreeCents, period, refStep, refFreq, kbm, labels }) {
  const size = degreeCents.length;
  const degCents = (deg) => {
    const o = Math.floor(deg / size);
    return o * period + degreeCents[deg - o * size];
  };
  const octDeg = kbm ? kbm.octaveDegree || size : size;
  const stepToDegree = (step) => {
    if (!kbm) return step;
    const n = step + 60 - kbm.middle;
    if (kbm.size === 0) return n;
    const o = Math.floor(n / kbm.size);
    const m = kbm.mapping[n - o * kbm.size];
    return m === null ? NaN : o * octDeg + m;
  };
  const degRef = stepToDegree(refStep);
  if (Number.isNaN(degRef)) throw new Error(`tuning: reference step ${refStep} is an unmapped ('x') key in the .kbm`);
  const base = degCents(degRef);
  const centsInt = (step) => degCents(stepToDegree(step)) - base;
  const cents = (step) => {
    if (Number.isInteger(step)) return centsInt(step);
    const lo = Math.floor(step), a = centsInt(lo), b = centsInt(lo + 1);
    return a + (b - a) * (step - lo);
  };
  const freq = (step) => refFreq * Math.pow(2, cents(step) / 1200);
  const degFloatCents = (d) => {
    const lo = Math.floor(d);
    const a = degCents(lo), b = degCents(lo + 1);
    return a + (b - a) * (d - lo);
  };
  const stepOf = (hz) => {
    const c = base + 1200 * Math.log2(hz / refFreq);
    const n = Math.floor(c / period);
    let lo = (n - 1) * size, hi = (n + 2) * size;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (degFloatCents(mid) < c) lo = mid; else hi = mid;
    }
    const d = (lo + hi) / 2;
    if (!kbm) return d;
    if (kbm.size === 0) return refStep + (d - degRef); // linear map: key n = degree n
    // A .kbm map can be non-linear (keys skip degrees, some unmapped), so search the mapped steps
    // near a first guess and invert freq's own rule: linear in cents between adjacent mapped steps.
    const target = c - base; // cents above refStep
    const guess = Math.round(refStep + (d - degRef) * (kbm.size / octDeg));
    const span = 2 * kbm.size + 2;
    let best = null, bestErr = Infinity;
    for (let st = guess - span; st < guess + span; st++) {
      const a = centsInt(st), b = centsInt(st + 1);
      if (Number.isFinite(a) && Number.isFinite(b) && a !== b && (target - a) * (target - b) <= 0)
        return st + (target - a) / (b - a);
      if (Number.isFinite(a) && Math.abs(a - target) < bestErr) { best = st; bestErr = Math.abs(a - target); }
    }
    return best ?? NaN; // in a gap next to unmapped keys: nearest mapped step
  };
  const t = { name, size, periodCents: period, refStep, refFreq, freq, cents, stepOf };
  if (labels) t.labels = labels;
  return t;
}

function fromScl(sclText, kbmText, name, o) {
  const scl = parseScl(sclText);
  const kbm = kbmText ? parseKbm(kbmText) : null;
  const degreeCents = [0, ...scl.pitches.slice(0, -1).map((p) => p.cents)];
  let refStep = o.refStep ?? 0, refFreq = o.refFreq ?? o.a4 * C4_FROM_A4;
  if (kbm) { refStep = kbm.refNote - 60; refFreq = kbm.refFreq; }
  return build({ name: name || scl.description || "scl", degreeCents, period: scl.periodCents, refStep, refFreq, kbm });
}

function edo(n, name, o) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`tuning: edo needs an integer n >= 1, got ${JSON.stringify(n)}`);
  const degreeCents = Array.from({ length: n }, (_, i) => (i * 1200) / n);
  return build({ name, degreeCents, period: 1200, refStep: o.refStep ?? 0, refFreq: o.refFreq ?? o.a4 * C4_FROM_A4 });
}

function builtin(name, o) {
  const key = name.trim().toLowerCase();
  if (key === "12tet" || key === "12edo") return edo(12, "12tet", o);
  let m = /^edo:(\d+)$/.exec(key);
  if (m) return edo(parseInt(m[1], 10), `edo:${m[1]}`, o);
  if (key === "just5" || key === "just-5limit") return fromScl(sclTextFromTokens("5-limit just", JUST5), null, "just5", o);
  if (key === "shruti22" || key === "shruti-22") {
    const t = fromScl(sclTextFromTokens("22 shruti", SHRUTI22), null, "shruti22", o);
    return t;
  }
  throw new Error(`unknown tuning ${JSON.stringify(name)}: use one of ${BUILTIN_TUNINGS.map((s) => `"${s}"`).join(", ")}, "edo:N" (e.g. "edo:19"), Scala .scl text, or an object like {scl, kbm}`);
}

/**
 * Step convention: by default step 0 = middle C (C4 = 261.6256 Hz with A4 = 440) for every tuning,
 * so in 12tet step 9 = A4 = 440 Hz and step 7 = G4. Override with refStep/refFreq, or a .kbm.
 * (If only refStep is given, refFreq stays middle C, i.e. refStep sounds at middle C.)
 *
 * spec forms:
 *  - "12tet" | "just5" | "shruti22" | "edo:19"
 *  - Scala text (string containing a newline)
 *  - { type:"12tet"|"edo"|"just5"|"shruti22", n?, a4?, refStep?, refFreq? }
 *  - { scl: string, kbm?: string, refStep?, refFreq? }   (kbm overrides refStep/refFreq)
 *  - { ratios: (number|"a/b")[] } | { cents: number[] }   (last entry is the period, like scl)
 *  - an existing Tuning object (returned as-is)
 * URLs are NOT accepted here (sync); use resolveTuning.
 * @param {string|Object} spec
 * @param {{a4?:number, refStep?:number, refFreq?:number}} [opts]
 * @returns {Tuning}
 * @throws {Error} unknown name → lists BUILTIN_TUNINGS; bad scl/kbm → parser message.
 */
export function createTuning(spec, opts = {}) {
  if (spec === undefined || spec === null) spec = "12tet";
  if (typeof spec === "object" && typeof spec.freq === "function") return spec;
  const so = typeof spec === "object" ? spec : {};
  const o = {
    a4: so.a4 ?? opts.a4 ?? 440,
    refStep: so.refStep ?? opts.refStep,
    refFreq: so.refFreq ?? opts.refFreq,
  };
  if (typeof spec === "string") {
    if (spec.includes("\n")) return fromScl(spec, null, null, o);
    return builtin(spec, o);
  }
  if (typeof spec !== "object") throw new Error(`tuning: expected a name, scl text or object, got ${typeof spec}`);
  if (typeof spec.scl === "string") return fromScl(spec.scl, spec.kbm, null, o);
  if (spec.ratios) return fromScl(ratiosToScl(spec.ratios), null, "ratios", o);
  if (spec.cents) return fromScl(centsToScl(spec.cents), null, "cents", o);
  if (spec.type === "edo") return edo(spec.n, `edo:${spec.n}`, o);
  if (spec.type === "12tet" || spec.type === "just5" || spec.type === "shruti22") return builtin(spec.type, o);
  throw new Error(`tuning: unrecognized object; give {type: ${BUILTIN_TUNINGS.map((s) => `"${s}"`).join("|")}|"edo", n}, {scl, kbm}, {ratios} or {cents}`);
}

const looksLikeUrl = (s) => typeof s === "string" && !s.includes("\n") && (/^https?:/i.test(s) || /^\.{0,2}\//.test(s) || /\.scl$/i.test(s) || /\.kbm$/i.test(s));

async function load(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch ${url}: HTTP ${res.status}`);
  return res.text();
}

/**
 * Async version of createTuning that also accepts a URL string (http(s):, ./, ../, /, or ending in
 * .scl) and { scl: url, kbm: url }. Fetches then calls createTuning.
 * @param {string|Object} spec
 * @returns {Promise<Tuning>}
 */
export async function resolveTuning(spec, opts) {
  if (looksLikeUrl(spec)) return createTuning(await load(spec), opts);
  if (spec && typeof spec === "object" && typeof spec.freq !== "function" && (looksLikeUrl(spec.scl) || looksLikeUrl(spec.kbm))) {
    const copy = { ...spec };
    if (looksLikeUrl(copy.scl)) copy.scl = await load(copy.scl);
    if (looksLikeUrl(copy.kbm)) copy.kbm = await load(copy.kbm);
    return createTuning(copy, opts);
  }
  return createTuning(spec, opts);
}
