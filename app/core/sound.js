// ctx.sound adapter. Uses the real engine (/sound-engine/js/index.js) when it exists,
// otherwise a small built-in Web Audio synth with the same play() shape. Value-only notes map to C2..C5 on
// the current scale (major pentatonic until setScale) in both. Also: setOutput/setBalance/setWidth (stereo default),
// setScale/setTuning (the built-in synth follows setScale with app/core/scales.js ids).
// Browsers only allow audio after a user gesture: call start() from a click/keypress.
//
// play(opts): pitch from freq | value+range (pentatonic); amplitude/amp, duration/dur, pan, t (s from now),
// voice (engine preset name), harmonics (number of harmonics, or an amplitude array),
// partials [{ratio, amp, decay}], envelope {attack, decay, sustain, release},
// noise {amount 0..1, attack, decay, cutoff Hz} (breath/pick noise, added by the adapter for both engines),
// glide {to Hz, time, at} (pitch slide; engine-native, emulated in the built-in synth),
// vibrato {rate Hz, depth cents, delay s} and wah {rate Hz, harmonics} (alternates the timbre to `harmonics` and
// back, a formant-like sweep): the engine has neither yet, so the adapter drives them with handle.set() ramps;
// the built-in synth uses an LFO on detune for vibrato and the same set() path for wah.
// lowpass (Hz, needs freq): per-note low-pass. The engine has no per-note filter yet, so the adapter
// approximates it by attenuating harmonics/partials with a 2nd-order (12 dB/oct) response (applyLowpass).

import { quantize, SCALES } from './scales.js';
import { repoUrl } from './data.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Turn `harmonics: n` into an amplitude array (1/k^1.5 roll-off), keep arrays as given.
export function harmonicArray(h) {
  if (Array.isArray(h)) return h.length ? h : [1];
  const n = clamp(Math.round(h ?? 1), 1, 16);
  return Array.from({ length: n }, (_, i) => 1 / (i + 1) ** 1.5);
}

// Keep an event inside the engine's validated limits.
export function sanitizeTimbre({ harmonics, partials, envelope }) {
  const out = {};
  if (harmonics != null) out.harmonics = harmonicArray(harmonics).map((x) => (Number.isFinite(x) ? x : 0));
  if (partials?.length) out.partials = partials.filter((p) => p.ratio > 0)
    .map((p) => ({ ratio: p.ratio, amp: clamp(p.amp ?? 1, 0, 10), ...(p.decay != null ? { decay: clamp(p.decay, 0.001, 60) } : {}) }));
  if (envelope) {
    out.envelope = {};
    for (const k of ['attack', 'decay', 'release']) if (envelope[k] != null) out.envelope[k] = clamp(envelope[k], 0, 60);
    if (envelope.sustain != null) out.envelope.sustain = clamp(envelope.sustain, 0, 1);
  }
  return out;
}

// Approximate a 2nd-order low-pass at `cutoff` Hz on a note at `freq` Hz by scaling each partial's amplitude.
export function lowpassGain(f, cutoff) { return 1 / Math.sqrt(1 + (f / Math.max(1, cutoff)) ** 4); }
export function applyLowpass({ harmonics, partials, noise } = {}, freq, cutoff) {
  const out = {};
  if (harmonics != null) out.harmonics = harmonicArray(harmonics).map((a, k) => a * lowpassGain(freq * (k + 1), cutoff));
  if (partials) out.partials = partials.map((p) => ({ ...p, amp: (p.amp ?? 1) * lowpassGain(freq * p.ratio, cutoff) }));
  if (noise) out.noise = { ...noise, cutoff: Math.min(noise.cutoff ?? 2000, cutoff),
    amount: (noise.amount ?? 0) * lowpassGain(noise.cutoff ?? 2000, cutoff) };
  return out;
}

// Comfort caps for every mode: fundamentals stay at or below ~C5, and no harmonic/partial above ~5 kHz
// (faded from FADE_HZ to PARTIAL_CAP_HZ, dropped above).
export const MAX_FUND_HZ = 523.25, FADE_HZ = 4000, PARTIAL_CAP_HZ = 5000;
export const capGain = (f) => (f >= PARTIAL_CAP_HZ ? 0 : f <= FADE_HZ ? 1 : (PARTIAL_CAP_HZ - f) / (PARTIAL_CAP_HZ - FADE_HZ));
export function capTimbre({ freq, harmonics, partials } = {}) {
  const f0 = Math.min(MAX_FUND_HZ, freq);
  const hs = harmonicArray(harmonics ?? 1).map((a, k) => a * capGain(f0 * (k + 1)));
  const ps = (partials || []).map((p) => ({ ...p, amp: (p.amp ?? 1) * capGain(f0 * p.ratio) })).filter((p) => p.amp > 0);
  return { freq: f0, harmonics: hs.some((a) => a > 0) ? hs : [1], partials: ps };
}

const C2_HZ = 65.4064;

function fallbackEngine() {
  let ac = null, master = null, bal = null;
  let output = 'stereo', balance = 0, width = 0, scaleId = 'pentatonic-major';
  const live = new Set();   // sounding notes: { oscs, out }
  const silence = (note, now) => {
    note.out.gain.cancelScheduledValues(now);
    note.out.gain.setValueAtTime(note.out.gain.value, now);
    note.out.gain.linearRampToValueAtTime(0, now + 0.02);
    for (const { o } of note.oscs) { try { o.stop(now + 0.03); } catch {} }
    live.delete(note);
  };
  return {
    name: 'built-in',
    get output() { return output; }, get balance() { return balance; }, get width() { return width; },
    setOutput(m) { output = m === 'mono' ? 'mono' : 'stereo'; if (bal) bal.pan.value = output === 'mono' ? 0 : balance; },
    setBalance(x) { balance = clamp(+x || 0, -1, 1); if (bal) bal.pan.value = output === 'mono' ? 0 : balance; },
    setWidth(x) { width = clamp(+x || 0, 0, 1); },
    get context() { return ac; },
    get master() { return master; },
    async start() {
      if (!ac) {
        ac = new AudioContext();
        master = ac.createGain(); master.gain.value = 0.8;
        const lim = ac.createDynamicsCompressor();
        lim.threshold.value = -6; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.1;
        bal = ac.createStereoPanner(); bal.pan.value = output === 'mono' ? 0 : balance;
        master.connect(bal).connect(lim).connect(ac.destination);
      }
      await ac.resume();
    },
    play({ freq, value, range = [0, 1], dur = 0.3, amp = 0.2, pan = 0, t: dt = 0, harmonics = 1, partials, envelope, glide, vibrato } = {}) {
      if (!ac) return { stop() {}, set() {} };
      const f0 = freq ?? quantize(value ?? 0, range, scaleId, C2_HZ, MAX_FUND_HZ).freq;   // C2..C5, like the engine
      const env = { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.3, ...(envelope || {}) };
      const t = ac.currentTime + Math.max(0, dt), out = ac.createGain(), panner = ac.createStereoPanner();
      panner.pan.value = output === 'mono' ? 0 : clamp(pan + width * clamp(Math.log2(f0 / 261.6256) / 2, -1, 1), -1, 1);
      const hs = harmonicArray(harmonics), ps = partials || [];
      const norm = 1 / Math.sqrt(hs.reduce((a, x) => a + x * x, 0) + ps.reduce((a, p) => a + (p.amp ?? 1) ** 2, 0) || 1);
      const peak = amp * norm, sus = Math.max(0.0001, peak * env.sustain);
      const relAt = t + Math.max(dur, env.attack + 0.01), end = relAt + env.release;
      const g = out.gain;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(peak, t + Math.max(0.002, env.attack));
      g.setTargetAtTime(sus, t + env.attack, Math.max(0.01, env.decay) / 3);
      g.cancelScheduledValues(relAt); g.setTargetAtTime(0.0001, relAt, Math.max(0.01, env.release) / 4);
      out.connect(panner).connect(master);
      const oscs = [];   // { o, gg, mult, k }  (k = harmonic index, -1 for partials)
      let lfoGain = null;
      if (vibrato?.rate > 0 && vibrato.depth > 0) {
        const lfo = ac.createOscillator(); lfo.frequency.value = vibrato.rate;
        lfoGain = ac.createGain(); lfoGain.gain.setValueAtTime(0, t);
        const d0 = t + Math.max(0, vibrato.delay ?? 0.2);
        lfoGain.gain.setValueAtTime(0, d0); lfoGain.gain.linearRampToValueAtTime(vibrato.depth, d0 + 0.25);
        lfo.connect(lfoGain); lfo.start(t); lfo.stop(end + 0.1);
      }
      const add = (mult, a, decay, k) => {
        a *= capGain(f0 * mult);   // no overtone above ~5 kHz, also for value-only notes
        if (f0 * mult > ac.sampleRate / 2 || !a) return;
        const o = ac.createOscillator(), gg = ac.createGain();
        o.frequency.value = f0 * mult; gg.gain.value = a;
        if (decay) gg.gain.setTargetAtTime(0.0001, t, decay / 3);
        if (glide?.to > 0) {
          const at = t + Math.max(0, glide.at ?? 0);
          o.frequency.setValueAtTime(f0 * mult, at);
          o.frequency.exponentialRampToValueAtTime(glide.to * mult, at + Math.max(0.01, glide.time ?? 0.1));
        }
        lfoGain?.connect(o.detune);
        o.connect(gg).connect(out); o.start(t); o.stop(end + 0.1); oscs.push({ o, gg, mult, k });
      };
      hs.forEach((a, k) => add(k + 1, a, 0, k));
      ps.forEach((p) => add(p.ratio, p.amp ?? 1, p.decay, -1));
      const note = { oscs, out };
      live.add(note);
      if (oscs.length) oscs[0].o.onended = () => live.delete(note);
      return {
        stop() { silence(note, ac.currentTime); },   // short fade, no click
        // Live changes (subset of the engine's handle.set): freq and harmonics, ramped.
        set({ freq: nf, harmonics: nh } = {}, ramp = 0.05) {
          const now = ac.currentTime, r = Math.max(0.005, ramp);
          for (const { o, gg, mult, k } of oscs) {
            if (nf > 0) { o.frequency.setValueAtTime(o.frequency.value, now); o.frequency.linearRampToValueAtTime(nf * mult, now + r); }
            if (nh && k >= 0) { gg.gain.setValueAtTime(gg.gain.value, now); gg.gain.linearRampToValueAtTime(harmonicArray(nh)[k] ?? 0, now + r); }
          }
        },
      };
    },
    stopAll() {
      if (!ac) return;
      const now = ac.currentTime;
      [...live].forEach((n) => silence(n, now));
    },
    setScale(spec) { if (typeof spec === 'string' && SCALES[spec]) scaleId = spec; },
  };
}

// Short filtered noise burst (breath, bow or pick), routed into the engine's master.
function playNoise(ac, dest, { amount = 0.2, attack = 0.01, decay = 0.15, cutoff = 2000 } = {}, { amp, pan, t: dt = 0, dur }) {
  if (!ac || !dest || !(amount > 0)) return;
  const len = Math.min(2, attack + decay + (dur || 0) * 0.5 + 0.1);
  const src = ac.createBufferSource(); src.buffer = noiseBuffer(ac);
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = cutoff; bp.Q.value = 0.8;
  const g = ac.createGain(), p = ac.createStereoPanner(), t = ac.currentTime + Math.max(0, dt);
  p.pan.value = clamp(pan ?? 0, -1, 1);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amount * (amp ?? 0.3), t + Math.max(0.002, attack));
  g.gain.setTargetAtTime(0.0001, t + attack, Math.max(0.01, decay) / 3);
  src.connect(bp).connect(g).connect(p).connect(dest);
  src.start(t, Math.random() * (NOISE_S - len), len);
}

// One shared 2.5 s white-noise buffer per AudioContext (no new buffer per note, so no GC pauses).
const NOISE_S = 2.5, noiseBufs = new WeakMap();
function noiseBuffer(ac) {
  let b = noiseBufs.get(ac);
  if (!b) {
    b = ac.createBuffer(1, Math.ceil(ac.sampleRate * NOISE_S), ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBufs.set(ac, b);
  }
  return b;
}

// Drive a periodic change on a sounding note with handle.set ramps: make(i) gives the i-th target.
function modulate(h, startS, endS, rate, make) {
  if (!h?.set || !(rate > 0)) return;
  const half = 1 / (2 * rate), t0 = performance.now();
  let i = 0;
  const tick = () => {
    if (performance.now() - t0 > endS * 1000) return;
    try { h.set(make(i++), half); } catch { return; }
    setTimeout(tick, half * 1000);
  };
  setTimeout(tick, Math.max(0, startS) * 1000);
}

export async function createSound() {
  let engine = null, name = 'built-in';
  try {
    const mod = await import('../../sound-engine/js/index.js');
    // Explicit bases: the engine's import.meta.url defaults fail when modules are blob: URLs (standalone
    // builds); repoUrl handles that and sub-path hosting. The C5 / 5 kHz comfort caps live in the engine too.
    engine = mod.createEngine({ polyphony: 32, output: 'stereo', scale: 'pentatonic-major',
      maxNoteFreq: MAX_FUND_HZ, noteLimit: 'clamp', maxFreq: PARTIAL_CAP_HZ,
      libraryBase: repoUrl('sound-engine/library/presets/'), sampleBase: repoUrl('data/earth/instruments/') });
    name = 'sound-engine';
  } catch (e) {
    console.warn('[sound] sound-engine not available, using the simple built-in synth:', e.message);
    engine = fallbackEngine();
  }
  let started = false, volume = 0.8;
  return {
    engine: name,
    get started() { return started; },
    async start() { await engine.start(); started = true; this.setVolume(volume); },
    setVolume(v) {
      volume = clamp(v, 0, 1);
      try { if (started && engine.master) engine.master.gain.value = volume; } catch {}
    },
    play(opts = {}) {
      if (!started) return null;
      let { amplitude, duration, noise, harmonics, partials, envelope, lowpass, glide, vibrato, wah, ...rest } = opts;
      const builtIn = name === 'built-in';
      if (lowpass > 0 && rest.freq > 0 && !rest.voice) {
        ({ harmonics, partials, noise } = { harmonics: harmonics ?? 1, partials, noise,
          ...applyLowpass({ harmonics: harmonics ?? 1, partials, noise }, rest.freq, lowpass) });
      }
      if (rest.freq > 0) ({ freq: rest.freq, harmonics, partials } = capTimbre({ freq: rest.freq, harmonics, partials }));
      if (noise) noise = { ...noise, cutoff: Math.min(noise.cutoff ?? 2000, FADE_HZ) };
      const ev = { ...rest, ...sanitizeTimbre({ harmonics, partials, envelope }) };
      if (amplitude != null && ev.amp == null) ev.amp = amplitude;
      if (duration != null && ev.dur == null) ev.dur = duration;
      if (ev.dur == null) ev.dur = 0.3;
      if (ev.pan != null) ev.pan = clamp(ev.pan, -1, 1);
      if (ev.amp != null) ev.amp = clamp(ev.amp, 0, 1);
      // Preset/recorded voices keep their own timbre: cap them with the engine's per-note low-pass instead.
      if (rest.voice && !builtIn) ev.lowpass = Math.min(lowpass > 0 ? lowpass : Infinity, 4500);
      if (glide?.to > 0) ev.glide = { ...glide, to: Math.min(MAX_FUND_HZ, glide.to) };
      if (builtIn && vibrato) ev.vibrato = vibrato;
      // The real engine maps value+range itself; the fallback quantizes with scales.js.
      let h = null;
      try { h = engine.play(ev); } catch (e) { console.warn('[sound]', e.message); }
      const t0 = ev.t || 0, end = t0 + ev.dur;
      if (h && vibrato?.rate > 0 && vibrato.depth > 0 && !builtIn && ev.freq > 0) {
        const c = ev.glide?.to || ev.freq;
        modulate(h, t0 + (vibrato.delay ?? 0.2), end, vibrato.rate,
          (i) => ({ freq: Math.min(MAX_FUND_HZ, c * 2 ** (((i % 2) ? -1 : 1) * vibrato.depth / 1200)) }));
      }
      if (h && wah?.rate > 0 && wah.harmonics && ev.freq > 0) {
        const alt = capTimbre({ freq: ev.glide?.to || ev.freq, harmonics: wah.harmonics }).harmonics, base = ev.harmonics || [1];
        modulate(h, t0 + 0.1, end, wah.rate, (i) => ({ harmonics: i % 2 ? base : alt }));
      }
      if (noise) try { playNoise(engine.context, engine.master, noise, ev); } catch {}
      return h;
    },
    stopAll() { try { engine.stopAll(); } catch {} },
    // A recorded instrument from sound-engine/library: { name, def, sample }. With the engine, play it with
    // { voice: name } (uses the recording when downloaded, else its analysed overtones); the built-in synth
    // only gets def (overtones and envelope) to pass inline.
    async loadLibrary(id) {
      if (engine.loadLibrary) return engine.loadLibrary(id, { name: `library-${id}` });
      const r = await fetch(repoUrl(`sound-engine/library/presets/${encodeURIComponent(id)}.json`));
      if (!r.ok) throw new Error(`no library preset ${id}`);
      const { source, sample, id: _i, title, kind, ...def } = await r.json();
      return { name: null, def, sample: false };
    },
    // Output: 'stereo' (app default) | 'mono'; balance -1..1 shifts everything; width 0..1 spreads by pitch.
    setOutput(m) { try { engine.setOutput?.(m === 'mono' ? 'mono' : 'stereo'); } catch (e) { console.warn('[sound]', e.message); } },
    setBalance(x) { try { engine.setBalance?.(clamp(+x || 0, -1, 1)); } catch (e) { console.warn('[sound]', e.message); } },
    setWidth(x) { try { engine.setWidth?.(clamp(+x || 0, 0, 1)); } catch (e) { console.warn('[sound]', e.message); } },
    get output() { return engine.output ?? 'stereo'; },
    get balance() { return engine.balance ?? 0; },
    get width() { return engine.width ?? 0; },
    // Tuning/scale for value-only notes (maps value -> C2..C5 on the scale). The built-in synth follows setScale
    // with app/core/scales.js ids. Modes that pass freq (quantized in app/core/scales.js) don't need them.
    // useScale(id): sets the engine tuning first (gamelan scales need it), then the scale.
    async useScale(id) {
      const sc = SCALES[id];
      if (!sc) return false;
      // Clear the scale first: the engine rebuilds the current scale on a new tuning and throws when the
      // step counts differ (e.g. pentatonic-major on 5-step slendro).
      if (engine.setTuning) { this.setScale(null); await this.setTuning(sc.tuning); }
      return this.setScale(id);
    },
    async setTuning(spec) { try { await engine.setTuning?.(spec); return !!engine.setTuning; } catch (e) { console.warn('[sound]', e.message); return false; } },
    setScale(spec) { try { engine.setScale?.(spec); return !!engine.setScale; } catch (e) { console.warn('[sound]', e.message); return false; } },
  };
}
