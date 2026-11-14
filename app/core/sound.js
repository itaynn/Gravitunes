// ctx.sound adapter. Uses the real engine (/sound-engine/js/index.js) when it exists,
// otherwise a small built-in Web Audio synth with the same play() shape.
// Browsers only allow audio after a user gesture: call start() from a click/keypress.
//
// play(opts): pitch from freq | value+range (pentatonic); amplitude/amp, duration/dur, pan, t (s from now),
// voice (engine preset name), harmonics (number of harmonics, or an amplitude array),
// partials [{ratio, amp, decay}], envelope {attack, decay, sustain, release},
// noise {amount 0..1, attack, decay, cutoff Hz} (breath/pick noise, added by the adapter for both engines).

const PENTA = [0, 2, 4, 7, 9];  // major pentatonic, semitones

// value in [lo, hi] -> frequency on a pentatonic scale over `octaves` octaves from `base` Hz.
export function valueToFreq(value, [lo, hi], base = 220, octaves = 3) {
  const f = Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1)));
  const step = Math.round(f * (PENTA.length * octaves));
  const semis = 12 * Math.floor(step / PENTA.length) + PENTA[step % PENTA.length];
  return base * 2 ** (semis / 12);
}

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

function fallbackEngine() {
  let ac = null, master = null;
  return {
    name: 'built-in',
    get context() { return ac; },
    get master() { return master; },
    async start() {
      if (!ac) {
        ac = new AudioContext();
        master = ac.createGain(); master.gain.value = 0.8;
        const lim = ac.createDynamicsCompressor();
        lim.threshold.value = -6; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.1;
        master.connect(lim).connect(ac.destination);
      }
      await ac.resume();
    },
    play({ freq, value, range = [0, 1], dur = 0.3, amp = 0.2, pan = 0, t: dt = 0, harmonics = 1, partials, envelope } = {}) {
      if (!ac) return { stop() {}, set() {} };
      const f0 = freq ?? valueToFreq(value ?? 0, range);
      const env = { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.3, ...(envelope || {}) };
      const t = ac.currentTime + Math.max(0, dt), out = ac.createGain(), panner = ac.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
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
      const oscs = [];
      const add = (f, a, decay) => {
        if (f > ac.sampleRate / 2 || !a) return;
        const o = ac.createOscillator(), gg = ac.createGain();
        o.frequency.value = f; gg.gain.value = a;
        if (decay) gg.gain.setTargetAtTime(0.0001, t, decay / 3);
        o.connect(gg).connect(out); o.start(t); o.stop(end + 0.1); oscs.push(o);
      };
      hs.forEach((a, k) => add(f0 * (k + 1), a));
      ps.forEach((p) => add(f0 * p.ratio, p.amp ?? 1, p.decay));
      return { stop() { oscs.forEach((o) => { try { o.stop(); } catch {} }); }, set() {} };
    },
    stopAll() {},
  };
}

// Short filtered noise burst (breath, bow or pick), routed into the engine's master.
function playNoise(ac, dest, { amount = 0.2, attack = 0.01, decay = 0.15, cutoff = 2000 } = {}, { amp, pan, t: dt = 0, dur }) {
  if (!ac || !dest || !(amount > 0)) return;
  const len = Math.ceil(ac.sampleRate * Math.min(2, attack + decay + (dur || 0) * 0.5 + 0.1));
  const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(); src.buffer = buf;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = cutoff; bp.Q.value = 0.8;
  const g = ac.createGain(), p = ac.createStereoPanner(), t = ac.currentTime + Math.max(0, dt);
  p.pan.value = clamp(pan ?? 0, -1, 1);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amount * (amp ?? 0.3), t + Math.max(0.002, attack));
  g.gain.setTargetAtTime(0.0001, t + attack, Math.max(0.01, decay) / 3);
  src.connect(bp).connect(g).connect(p).connect(dest);
  src.start(t); src.stop(t + len / ac.sampleRate);
}

export async function createSound() {
  let engine = null, name = 'built-in';
  try {
    const mod = await import('/sound-engine/js/index.js');
    engine = mod.createEngine({ polyphony: 32 }); name = 'sound-engine';
  } catch (e) {
    console.info('[sound] sound-engine not available, using built-in synth:', e.message);
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
      const { amplitude, duration, noise, harmonics, partials, envelope, ...rest } = opts;
      const ev = { ...rest, ...sanitizeTimbre({ harmonics, partials, envelope }) };
      if (amplitude != null && ev.amp == null) ev.amp = amplitude;
      if (duration != null && ev.dur == null) ev.dur = duration;
      if (ev.dur == null) ev.dur = 0.3;
      if (ev.pan != null) ev.pan = clamp(ev.pan, -1, 1);
      if (ev.amp != null) ev.amp = clamp(ev.amp, 0, 1);
      // The real engine maps value+range itself; the fallback uses valueToFreq.
      let h = null;
      try { h = engine.play(ev); } catch (e) { console.warn('[sound]', e.message); }
      if (noise) try { playNoise(engine.context, engine.master, noise, ev); } catch {}
      return h;
    },
    stopAll() { try { engine.stopAll(); } catch {} },
    valueToFreq,
  };
}
