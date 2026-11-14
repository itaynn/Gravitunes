// score.js — score validation and event normalization. Pure. OWNER: logic worker.
import { noteToFreq } from "./units.js";
import { createScale } from "./scale.js";

/**
 * Canonical event produced by normalizeEvent (all aliases resolved, times in SECONDS).
 * @typedef {Object} NormalizedEvent
 * @property {"note"|"set"|"stop"} type
 * @property {number} t          seconds (0 if absent)
 * @property {string|number} [id]
 * @property {number} [freq] @property {string} [note] @property {number} [step]
 * @property {number} [value] @property {[number,number]} [range]
 * @property {"up"|"down"} [direction] scale set used for `value` (normalizeScore fills it in)
 * @property {string} [voice]
 * @property {number} [amp]  (from amp | amplitude)   @property {number} [dur] (from dur | duration)
 * @property {number} [pan] @property {number[]} [harmonics] @property {{ratio:number,amp?:number,decay?:number}[]} [partials]
 * @property {{attack?:number,decay?:number,sustain?:number,release?:number}} [envelope]
 * @property {{to:number|Object, time?:number, at?:number}} [glide]
 * @property {number} [ramp]
 * Unspecified fields stay undefined (defaults are applied by the engine from the voice).
 */

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const show = (x) => (typeof x === "string" ? JSON.stringify(x) : JSON.stringify(x) ?? String(x));
const NOTE_RE = /^[A-Ga-g][#b]?-?[0-9]+$/;

function checkRange(errs, path, v, lo, hi, hint) {
  if (!isNum(v)) errs.push(`${path}: must be a number${lo !== undefined ? ` in ${lo}..${hi}` : ""}, got ${show(v)}${hint ? ` (${hint})` : ""}`);
  else if ((lo !== undefined && v < lo) || (hi !== undefined && v > hi)) errs.push(`${path}: must be ${lo}..${hi}, got ${v}${hint ? ` (${hint})` : ""}`);
}
function checkMin(errs, path, v, min, hint) {
  if (!isNum(v)) errs.push(`${path}: must be a number >= ${min}, got ${show(v)}`);
  else if (v < min) errs.push(`${path}: must be >= ${min}, got ${v}${hint ? ` (${hint})` : ""}`);
}

// Limits shared with schema/score.schema.json and js/voices.js (validateVoiceDef).
export const LIMITS = { envelopeTime: 60, partialAmp: 10, detune: 1200 };

function checkEnvelope(errs, path, env) {
  if (!isObj(env)) return errs.push(`${path}: must be an object like {attack, decay, sustain, release}, got ${show(env)}`);
  for (const [k, v] of Object.entries(env)) {
    if (k === "sustain") checkRange(errs, `${path}.sustain`, v, 0, 1);
    else if (["attack", "decay", "release"].includes(k)) checkRange(errs, `${path}.${k}`, v, 0, LIMITS.envelopeTime, "seconds");
    else errs.push(`${path}.${k}: unknown envelope field; use attack, decay, sustain or release`);
  }
}
function checkPartials(errs, path, p) {
  if (!Array.isArray(p)) return errs.push(`${path}: must be an array of {ratio, amp?, decay?}, got ${show(p)}`);
  p.forEach((x, i) => {
    if (!isObj(x) || !(isNum(x.ratio) && x.ratio > 0)) errs.push(`${path}[${i}].ratio: required, must be a number > 0, got ${show(x?.ratio)}`);
    else {
      for (const k of Object.keys(x)) if (!["ratio", "amp", "decay"].includes(k)) errs.push(`${path}[${i}].${k}: unknown partial field; use ratio, amp or decay`);
      if (x.amp !== undefined) checkRange(errs, `${path}[${i}].amp`, x.amp, 0, LIMITS.partialAmp);
      if (x.decay !== undefined && !(isNum(x.decay) && x.decay > 0)) errs.push(`${path}[${i}].decay: must be a number > 0, got ${show(x.decay)}`);
    }
  });
}
function checkHarmonics(errs, path, h) {
  if (!Array.isArray(h) || !h.length || !h.every(isNum)) errs.push(`${path}: must be a non-empty array of numbers, got ${show(h)}`);
}
function checkVoiceFields(errs, p, v) {
  if (v.harmonics !== undefined) checkHarmonics(errs, `${p}.harmonics`, v.harmonics);
  if (v.partials !== undefined) checkPartials(errs, `${p}.partials`, v.partials);
  if (v.envelope !== undefined) checkEnvelope(errs, `${p}.envelope`, v.envelope);
}
function checkPitchObj(errs, path, o) {
  if (o.freq !== undefined && !(isNum(o.freq) && o.freq > 0)) errs.push(`${path}.freq: must be a number > 0 (Hz), got ${show(o.freq)}`);
  if (o.note !== undefined && !(typeof o.note === "string" && NOTE_RE.test(o.note))) errs.push(`${path}.note: must look like "A4", "C#3" or "Bb2", got ${show(o.note)}`);
  if (o.step !== undefined && !isNum(o.step)) errs.push(`${path}.step: must be a number, got ${show(o.step)}`);
  if (o.value !== undefined && !isNum(o.value)) errs.push(`${path}.value: must be a number, got ${show(o.value)}`);
}
function checkRangePair(errs, path, r) {
  if (!Array.isArray(r) || r.length !== 2 || !r.every(isNum)) errs.push(`${path}: must be [min, max] (two numbers), got ${show(r)}`);
}

function checkEvent(ev, path) {
  const errs = [];
  if (!isObj(ev)) return [`${path}: must be an object like {t: 0, note: "A4", dur: 1}, got ${show(ev)}`];
  const type = ev.type ?? "note";
  if (!["note", "set", "stop"].includes(type)) errs.push(`${path}.type: must be "note", "set" or "stop", got ${show(ev.type)}`);
  if (ev.t !== undefined) checkMin(errs, `${path}.t`, ev.t, 0, "times cannot be negative; use t >= 0");
  if (ev.id !== undefined && !(typeof ev.id === "string" || isNum(ev.id))) errs.push(`${path}.id: must be a string or number, got ${show(ev.id)}`);
  if ((type === "set" || type === "stop") && ev.id === undefined) errs.push(`${path}.id: ${type} events need an id (the id of the note to ${type}); add id to the note and to this event`);
  if (type === "note") {
    if (ev.freq === undefined && ev.note === undefined && ev.step === undefined && ev.value === undefined) {
      errs.push(`${path}: needs a pitch — give one of freq (Hz), note ("A4"), step, or value`);
    }
  }
  checkPitchObj(errs, path, ev);
  if (ev.direction !== undefined && ev.direction !== "up" && ev.direction !== "down") errs.push(`${path}.direction: must be "up" or "down", got ${show(ev.direction)}`);
  if (ev.range !== undefined) checkRangePair(errs, `${path}.range`, ev.range);
  if (ev.voice !== undefined && typeof ev.voice !== "string") errs.push(`${path}.voice: must be a voice name string, got ${show(ev.voice)}`);
  for (const k of ["amp", "amplitude"]) if (ev[k] !== undefined) checkRange(errs, `${path}.${k}`, ev[k], 0, 1, "amp is linear 0..1; use dbToAmp() for dB");
  for (const k of ["dur", "duration"]) if (ev[k] !== undefined) checkMin(errs, `${path}.${k}`, ev[k], 0);
  if (ev.pan !== undefined) checkRange(errs, `${path}.pan`, ev.pan, -1, 1);
  if (ev.lowpass !== undefined) checkRange(errs, `${path}.lowpass`, ev.lowpass, 20, 20000, "a low-pass cutoff in Hz");
  checkVoiceFields(errs, path, ev);
  if (ev.ramp !== undefined) checkMin(errs, `${path}.ramp`, ev.ramp, 0);
  if (ev.glide !== undefined) {
    const g = ev.glide, gp = `${path}.glide`;
    if (!isObj(g) || g.to === undefined) errs.push(`${gp}.to: required — a target in Hz, or {freq|note|step|value}`);
    else {
      if (isNum(g.to)) { if (!(g.to > 0)) errs.push(`${gp}.to: must be > 0 Hz, got ${g.to}`); }
      else if (isObj(g.to)) {
        if (g.to.freq === undefined && g.to.note === undefined && g.to.step === undefined && g.to.value === undefined) errs.push(`${gp}.to: object needs one of freq, note, step, value`);
        checkPitchObj(errs, `${gp}.to`, g.to);
      } else errs.push(`${gp}.to: must be Hz (number) or {freq|note|step|value}, got ${show(g.to)}`);
      if (g.time !== undefined) checkMin(errs, `${gp}.time`, g.time, 0);
      if (g.at !== undefined) checkMin(errs, `${gp}.at`, g.at, 0);
    }
  }
  return errs;
}

const TUNING_TYPES = ["12tet", "edo", "just5", "shruti22"];
const TUNING_FIELDS = ["type", "n", "scl", "kbm", "ratios", "cents", "refStep", "refFreq", "a4"];
function checkTuning(errs, t) {
  if (typeof t === "string") { if (!t.length) errs.push("tuning: must not be an empty string"); return; }
  if (!isObj(t)) return errs.push(`tuning: must be a name, scl text or object, got ${show(t)}`);
  for (const k of Object.keys(t)) if (!TUNING_FIELDS.includes(k)) errs.push(`tuning.${k}: unknown tuning field; allowed: ${TUNING_FIELDS.join(", ")}`);
  if (t.type === undefined && t.scl === undefined && t.ratios === undefined && t.cents === undefined)
    errs.push('tuning: object needs one of type, scl, ratios or cents, e.g. {"type": "edo", "n": 19}');
  if (t.type !== undefined && !TUNING_TYPES.includes(t.type)) errs.push(`tuning.type: must be one of ${TUNING_TYPES.join(", ")}, got ${show(t.type)}`);
  if (t.type === "edo" && t.n === undefined) errs.push('tuning.n: required when type is "edo" (steps per octave)');
  if (t.n !== undefined && !(Number.isInteger(t.n) && t.n >= 1)) errs.push(`tuning.n: must be an integer >= 1, got ${show(t.n)}`);
  for (const k of ["scl", "kbm"]) if (t[k] !== undefined && typeof t[k] !== "string") errs.push(`tuning.${k}: must be a string (file text or URL), got ${show(t[k])}`);
  if (t.ratios !== undefined && !(Array.isArray(t.ratios) && t.ratios.length && t.ratios.every((r) => isNum(r) || typeof r === "string")))
    errs.push(`tuning.ratios: must be a non-empty array of numbers or "a/b" strings, got ${show(t.ratios)}`);
  if (t.cents !== undefined && !(Array.isArray(t.cents) && t.cents.length && t.cents.every(isNum)))
    errs.push(`tuning.cents: must be a non-empty array of numbers, got ${show(t.cents)}`);
  if (t.refStep !== undefined && !Number.isInteger(t.refStep)) errs.push(`tuning.refStep: must be an integer, got ${show(t.refStep)}`);
  for (const k of ["refFreq", "a4"]) if (t[k] !== undefined && !(isNum(t[k]) && t[k] > 0)) errs.push(`tuning.${k}: must be a number > 0 (Hz), got ${show(t[k])}`);
}

/**
 * Up/down for `value` events, used to pick a raga's up or down set.
 * Returns a function ev → "up"|"down" that remembers values: an event with an `id` is compared with
 * the previous value for that id (or, for an id's first value, the previous value event overall);
 * without an id, with the previous value event overall. Equal or higher (or no previous) → "up".
 * An explicit ev.direction wins but its value is still remembered. Events without `value` → ev.direction.
 */
export function directionTracker() {
  const last = new Map();
  let lastAny;
  return (ev) => {
    if (ev.value === undefined) return ev.direction;
    const prev = ev.id !== undefined && last.has(ev.id) ? last.get(ev.id) : lastAny;
    const dir = ev.direction ?? (prev === undefined || ev.value >= prev ? "up" : "down");
    if (ev.id !== undefined) last.set(ev.id, ev.value);
    lastAny = ev.value;
    return dir;
  };
}

/**
 * Validate a full score against schema/score.schema.json rules (hand-written, no deps).
 * @param {any} score
 * @returns {{valid:boolean, errors:string[]}} errors look like "events[3].amp: must be 0..1, got 1.5"
 */
export function validateScore(score) {
  const errors = [];
  if (!isObj(score)) return { valid: false, errors: [`score: must be an object like {version: 1, events: [...]}, got ${show(score)}`] };
  const known = ["version", "title", "tempo", "tuning", "scale", "valueRange", "voices", "events"];
  for (const k of Object.keys(score)) if (!known.includes(k)) errors.push(`${k}: unknown top-level field; allowed: ${known.join(", ")}`);
  if (score.version !== 1) errors.push(`version: must be 1, got ${show(score.version)}; add "version": 1`);
  if (score.title !== undefined && typeof score.title !== "string") errors.push(`title: must be a string, got ${show(score.title)}`);
  if (score.tempo !== undefined && score.tempo !== null && !(isNum(score.tempo) && score.tempo > 0)) errors.push(`tempo: must be a number > 0 (beats per minute) or null, got ${show(score.tempo)}`);
  if (score.valueRange !== undefined) checkRangePair(errors, "valueRange", score.valueRange);
  if (score.tuning !== undefined) checkTuning(errors, score.tuning);
  if (score.scale !== undefined && score.scale !== null) {
    const s = score.scale;
    if (typeof s === "string") { if (!s.length) errors.push("scale: must not be an empty string"); }
    else if (isObj(s)) {
      if (!Array.isArray(s.up) || !s.up.length || !s.up.every(Number.isInteger)) errors.push(`scale.up: required, must be a non-empty array of integers, got ${show(s.up)}`);
      if (s.down !== undefined && (!Array.isArray(s.down) || !s.down.length || !s.down.every(Number.isInteger))) errors.push(`scale.down: must be a non-empty array of integers, got ${show(s.down)}`);
      if (s.name !== undefined && typeof s.name !== "string") errors.push(`scale.name: must be a string, got ${show(s.name)}`);
      if (s.period !== undefined && !(Number.isInteger(s.period) && s.period >= 1)) errors.push(`scale.period: must be an integer >= 1, got ${show(s.period)}`);
      for (const k of ["vadi", "samvadi"]) if (s[k] !== undefined && !Number.isInteger(s[k])) errors.push(`scale.${k}: must be an integer degree, got ${show(s[k])}`);
    } else errors.push(`scale: must be a name, null or {up, down?}, got ${show(s)}`);
  }
  if (score.voices !== undefined) {
    if (!isObj(score.voices)) errors.push(`voices: must be an object mapping names to voice definitions, got ${show(score.voices)}`);
    else for (const [n, v] of Object.entries(score.voices)) {
      const p = `voices.${n}`;
      if (!isObj(v)) { errors.push(`${p}: must be an object, got ${show(v)}`); continue; }
      if (v.extends !== undefined && typeof v.extends !== "string") errors.push(`${p}.extends: must be a voice name, got ${show(v.extends)}`);
      checkVoiceFields(errors, p, v);
      if (v.amp !== undefined) checkRange(errors, `${p}.amp`, v.amp, 0, 1);
      if (v.pan !== undefined) checkRange(errors, `${p}.pan`, v.pan, -1, 1);
      if (v.detune !== undefined) checkRange(errors, `${p}.detune`, v.detune, -LIMITS.detune, LIMITS.detune, "cents");
    }
  }
  if (!Array.isArray(score.events)) errors.push(`events: required, must be an array of events, got ${show(score.events)}`);
  else score.events.forEach((ev, i) => errors.push(...checkEvent(ev, `events[${i}]`)));
  return { valid: errors.length === 0, errors };
}

/** Like validateScore but throws an Error listing (up to 10) errors. @returns {void} */
export function assertScore(score) {
  const { valid, errors } = validateScore(score);
  if (valid) return;
  const more = errors.length > 10 ? `\n...and ${errors.length - 10} more` : "";
  throw new Error(`invalid score (${errors.length} error${errors.length === 1 ? "" : "s"}):\n` + errors.slice(0, 10).join("\n") + more);
}

/**
 * Validate one event and resolve aliases (amplitude→amp, duration→dur). Default type "note".
 * Pitch priority for notes: freq > note > step > value (others are kept but ignored by the engine).
 * @param {Object} ev
 * @param {{tempo?:number|null, path?:string}} [ctx] tempo converts t, dur, glide.time/at from beats to seconds
 * @returns {NormalizedEvent}
 * @throws {Error} e.g. "event: needs a pitch — give one of freq (Hz), note (\"A4\"), step, or value"
 */
export function normalizeEvent(ev, ctx = {}) {
  const errs = checkEvent(ev, ctx.path ?? "event");
  if (errs.length) throw new Error(errs.join("; "));
  const k = ctx.tempo ? 60 / ctx.tempo : 1;
  const { amplitude, duration, ...rest } = ev;
  const out = { ...rest, type: ev.type ?? "note", t: (ev.t ?? 0) * k };
  const amp = ev.amp ?? amplitude;
  if (amp !== undefined) out.amp = amp;
  const dur = ev.dur ?? duration;
  if (dur !== undefined) out.dur = dur * k;
  if (ev.glide) {
    out.glide = { ...ev.glide };
    if (ev.glide.time !== undefined) out.glide.time = ev.glide.time * k;
    if (ev.glide.at !== undefined) out.glide.at = ev.glide.at * k;
  }
  return out;
}

/**
 * Validate (assertScore) and normalize a score: events normalized, sorted by t (stable),
 * valueRange filled in (explicit, else min/max of all event `value`s incl. glide.to.value, else [0,1]).
 * Notes without `dur` and without `id` get the default length: 1 beat with `tempo`, else 1 s.
 * Notes with an `id` and no `dur` hold until a `stop` event for that id.
 * Every note/set event with a `value` gets a `direction` (see directionTracker), unless given.
 * @param {Object} score
 * @returns {{version:1,title?:string,tuning?:any,scale?:any,voices:Object,valueRange:[number,number],events:NormalizedEvent[],duration:number}}
 *   duration = max over events of t (+ dur for notes) in seconds; excludes release tails
 */
export function normalizeScore(score) {
  assertScore(score);
  const defaultDur = score.tempo ? 60 / score.tempo : 1;
  const dirOf = directionTracker();
  const events = score.events
    .map((e, i) => normalizeEvent(e, { tempo: score.tempo, path: `events[${i}]` }))
    .sort((a, b) => a.t - b.t)
    .map((e) => {
      const out = { ...e };
      if (out.type === "note" && out.dur === undefined && out.id === undefined) out.dur = defaultDur;
      if (out.value !== undefined && out.type !== "stop") out.direction = dirOf(out);
      return out;
    });
  let valueRange = score.valueRange;
  if (!valueRange) {
    const vals = [];
    for (const e of events) {
      if (isNum(e.value)) vals.push(e.value);
      if (isObj(e.glide?.to) && isNum(e.glide.to.value)) vals.push(e.glide.to.value);
    }
    valueRange = vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
  }
  let duration = 0;
  for (const e of events) duration = Math.max(duration, e.t + (e.type === "note" ? e.dur ?? 0 : 0));
  const out = { version: 1 };
  if (score.title !== undefined) out.title = score.title;
  if (score.tuning !== undefined) out.tuning = score.tuning;
  if (score.scale !== undefined) out.scale = score.scale;
  out.voices = score.voices ?? {};
  out.valueRange = [valueRange[0], valueRange[1]];
  out.events = events;
  out.duration = duration;
  return out;
}

/**
 * Resolve a pitch spec to Hz. Priority freq > note > step > value.
 * value: uses ev.range ?? ctx.valueRange ?? [0,1] → scale.fromValue (p.direction picks up/down set, default up) → tuning.freq.
 * step: tuning.freq(step) (NOT quantized by the scale; callers asked for that step explicitly).
 * @param {{freq?:number,note?:string,step?:number,value?:number,range?:[number,number],direction?:"up"|"down"}} p
 * @param {{tuning:import("./tuning.js").Tuning, scale?:import("./scale.js").Scale|null, valueRange?:[number,number], a4?:number}} ctx
 * @returns {number} Hz
 * @throws {Error} if no pitch field, or the result is not a finite positive number.
 */
export function resolvePitch(p, ctx = {}) {
  let hz;
  if (p.freq !== undefined) hz = p.freq;
  else if (p.note !== undefined) hz = noteToFreq(p.note, ctx.a4 ?? 440);
  else if (p.step !== undefined) hz = ctx.tuning.freq(p.step);
  else if (p.value !== undefined) {
    const [min, max] = p.range ?? ctx.valueRange ?? [0, 1];
    const scale = ctx.scale ?? createScale(null, ctx.tuning);
    hz = ctx.tuning.freq(scale.fromValue(p.value, { min, max, direction: p.direction }));
  } else throw new Error("pitch: needs one of freq (Hz), note (\"A4\"), step, or value");
  if (!(typeof hz === "number" && Number.isFinite(hz) && hz > 0)) {
    throw new Error(`pitch: resolved to ${hz}, expected a finite positive Hz (is the step mapped in the .kbm?)`);
  }
  return hz;
}
