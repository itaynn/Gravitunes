// voices.js — voice presets and resolution. OWNER: engine fork.

const DEFAULT_ENVELOPE = { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.3 };

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));

/** Built-in voices. Mirrors presets/*.json (the JSON files are generated from this table). */
export const PRESETS = {
  sine: { harmonics: [1], envelope: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.3 } },
  organ: {
    harmonics: [1, 0.8, 0.6, 0.5, 0, 0.3, 0, 0.25],
    envelope: { attack: 0.02, decay: 0.05, sustain: 0.9, release: 0.15 },
  },
  bell: {
    harmonics: [1],
    partials: [
      { ratio: 2.0, amp: 0.5, decay: 1.5 }, { ratio: 2.76, amp: 0.4, decay: 1.2 },
      { ratio: 5.4, amp: 0.25, decay: 0.6 }, { ratio: 8.93, amp: 0.15, decay: 0.35 },
    ],
    envelope: { attack: 0.002, decay: 1.8, sustain: 0, release: 1.2 },
  },
  hollow: {
    harmonics: range(15, (k) => (k % 2 ? 1 / k : 0)),
    envelope: { attack: 0.03, decay: 0.15, sustain: 0.7, release: 0.3 },
  },
  bright: {
    harmonics: range(16, (k) => 1 / k),
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.25 },
    amp: 0.4,
  },
  pad: {
    harmonics: [1, 0.4, 0.25, 0.15, 0.1, 0.05],
    envelope: { attack: 0.6, decay: 0.5, sustain: 0.8, release: 1.5 },
    detune: 4,
  },
  pluck: {
    harmonics: range(12, (k) => 1 / (k * k) + 0.02),
    envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.2 },
  },
  // Gamelan metallophone (saron-like bronze bar): a strong fundamental, a few inharmonic upper modes
  // that die away quickly, and a long ring. The second partial at ratio 1.004 beats against the
  // fundamental (about 1 Hz near middle C), a simple stand-in for "ombak", the slow beating of
  // paired instruments. (detune moves every oscillator together, so it cannot make beats.)
  saron: {
    harmonics: [1],
    partials: [
      { ratio: 1.004, amp: 0.6, decay: 3 }, { ratio: 2.72, amp: 0.3, decay: 0.8 },
      { ratio: 4.95, amp: 0.12, decay: 0.35 }, { ratio: 7.6, amp: 0.05, decay: 0.2 },
    ],
    envelope: { attack: 0.003, decay: 2.5, sustain: 0, release: 1.5 },
  },
  // Gong: soft attack, a slow beating pair at the fundamental and a cluster of low inharmonic modes.
  gong: {
    harmonics: [1, 0.25],
    partials: [
      { ratio: 1.003, amp: 0.8, decay: 6 }, { ratio: 1.49, amp: 0.25, decay: 3 },
      { ratio: 2.03, amp: 0.2, decay: 2.5 }, { ratio: 2.41, amp: 0.12, decay: 1.5 }, { ratio: 3.32, amp: 0.06, decay: 0.8 },
    ],
    envelope: { attack: 0.02, decay: 6, sustain: 0, release: 4 },
  },
};

function checkNum(v, name, lo, hi) {
  if (v === undefined) return;
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi)
    throw new Error(`voice: ${name} must be a number in ${lo}..${hi}, got ${JSON.stringify(v)}`);
}

/** Throws a helpful error if a voice definition is malformed. */
export function validateVoiceDef(def, label = "voice") {
  if (def == null || typeof def !== "object" || Array.isArray(def))
    throw new Error(`${label}: expected an object like { harmonics: [1, 0.5], envelope: { attack: 0.01 } }`);
  if (def.harmonics !== undefined) {
    if (!Array.isArray(def.harmonics) || !def.harmonics.length || def.harmonics.some((h) => typeof h !== "number" || !Number.isFinite(h)))
      throw new Error(`${label}: harmonics must be a non-empty array of numbers (fundamental first), e.g. [1, 0.5, 0.33]`);
  }
  if (def.partials !== undefined) {
    if (!Array.isArray(def.partials)) throw new Error(`${label}: partials must be an array like [{ ratio: 2.76, amp: 0.4 }]`);
    def.partials.forEach((p, i) => {
      if (!p || typeof p.ratio !== "number" || !(p.ratio > 0))
        throw new Error(`${label}: partials[${i}].ratio must be a positive number (multiple of the fundamental)`);
      checkNum(p.amp, `partials[${i}].amp`, 0, 10);
    });
  }
  if (def.envelope !== undefined) {
    const e = def.envelope;
    if (!e || typeof e !== "object") throw new Error(`${label}: envelope must be an object { attack, decay, sustain, release }`);
    for (const k of Object.keys(e))
      if (!["attack", "decay", "sustain", "release"].includes(k))
        throw new Error(`${label}: unknown envelope field "${k}" (use attack, decay, sustain, release)`);
    checkNum(e.attack, "envelope.attack", 0, 60); checkNum(e.decay, "envelope.decay", 0, 60);
    checkNum(e.sustain, "envelope.sustain", 0, 1); checkNum(e.release, "envelope.release", 0, 60);
  }
  checkNum(def.amp, "amp", 0, 1); checkNum(def.pan, "pan", -1, 1); checkNum(def.detune, "detune", -1200, 1200);
}

/**
 * Merge preset(s) + overrides into a full VoiceDef.
 * @param {string} [name="sine"]
 * @param {Object} [overrides] event or def fields: harmonics, partials, envelope, amp, pan, detune
 * @param {Object<string,Object>} [registry] user voices (engine.voice / score.voices); may use `extends`
 * @returns {{name:string,harmonics:number[],partials:Object[],envelope:{attack:number,decay:number,sustain:number,release:number},amp:number,pan:number,detune:number}}
 */
export function resolveVoice(name = "sine", overrides = {}, registry = {}) {
  // Build the inheritance chain, base first. A user voice named like a preset (and without
  // `extends`) implicitly extends that preset, so engine.voice("bell", {envelope}) tweaks the bell.
  const chain = [];
  let cur = name, fromPresetOnly = false;
  for (let guard = 0; cur; guard++) {
    if (guard > 16) throw new Error(`voice "${name}": "extends" chain is too deep or circular`);
    const user = fromPresetOnly ? undefined : registry[cur];
    const def = user ?? PRESETS[cur];
    if (!def) {
      const known = [...new Set([...Object.keys(PRESETS), ...registryNames(registry)])].join(", ");
      throw new Error(`unknown voice "${cur}". Known voices: ${known}. Define it with engine.voice("${cur}", { harmonics: [...] })`);
    }
    chain.unshift(def);
    if (def.extends) { fromPresetOnly = def.extends === cur; cur = def.extends; }
    else if (user && PRESETS[cur]) fromPresetOnly = true; // continue to the same-named preset
    else cur = null;
  }
  const out = { name, harmonics: [1], partials: [], envelope: { ...DEFAULT_ENVELOPE }, amp: 0.5, pan: 0, detune: 0 };
  for (const d of [...chain, overrides]) {
    if (!d) continue;
    if (d.harmonics !== undefined) out.harmonics = d.harmonics.slice();
    if (d.partials !== undefined) out.partials = d.partials.map((p) => ({ ...p }));
    if (d.envelope !== undefined) out.envelope = { ...out.envelope, ...d.envelope };
    if (d.amp !== undefined) out.amp = d.amp;
    if (d.pan !== undefined) out.pan = d.pan;
    if (d.detune !== undefined) out.detune = d.detune;
  }
  return out;
}

// for..in also lists inherited names (a score's registry layers over the engine's).
function registryNames(r) { const out = []; for (const k in r) out.push(k); return out; }

const waveCache = new WeakMap();
/**
 * Build (and cache per context) a PeriodicWave from a harmonic amplitude list.
 * Normalization is disabled; the engine scales gain by 1/sum(|harmonics|) itself so voices stay level-matched.
 * @param {BaseAudioContext} ctx @param {number[]} harmonics @returns {PeriodicWave}
 */
export function harmonicsToWave(ctx, harmonics) {
  let m = waveCache.get(ctx);
  if (!m) waveCache.set(ctx, (m = new Map()));
  const key = harmonics.join(",");
  let w = m.get(key);
  if (!w) {
    const n = harmonics.length + 1;
    const real = new Float32Array(n), imag = new Float32Array(n);
    harmonics.forEach((a, i) => { imag[i + 1] = a; });
    w = ctx.createPeriodicWave(real, imag, { disableNormalization: true });
    if (m.size > 256) m.clear();
    m.set(key, w);
  }
  return w;
}

/** Sum of absolute amplitudes, used to keep loudness consistent across timbres. */
export function voiceLevel(v) {
  const h = v.harmonics.reduce((s, a) => s + Math.abs(a), 0);
  const p = v.partials.reduce((s, q) => s + Math.abs(q.amp ?? 1), 0);
  return Math.max(1e-6, h + p);
}
