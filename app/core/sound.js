// ctx.sound adapter. Uses the real engine (/sound-engine/js/index.js) when it exists,
// otherwise a tiny built-in Web Audio synth with the same play() shape.
// Browsers only allow audio after a user gesture: call start() from a click/keypress.

const PENTA = [0, 2, 4, 7, 9];  // major pentatonic, semitones

// value in [lo, hi] -> frequency on a pentatonic scale over `octaves` octaves from `base` Hz.
export function valueToFreq(value, [lo, hi], base = 220, octaves = 3) {
  const f = Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1)));
  const step = Math.round(f * (PENTA.length * octaves));
  const semis = 12 * Math.floor(step / PENTA.length) + PENTA[step % PENTA.length];
  return base * 2 ** (semis / 12);
}

function fallbackEngine() {
  let ac = null;
  return {
    name: 'built-in',
    async start() { ac = ac || new AudioContext(); await ac.resume(); },
    get started() { return !!ac && ac.state === 'running'; },
    play({ freq, value, range = [0, 1], duration = 0.3, amplitude = 0.2, pan = 0, harmonics = 1 } = {}) {
      if (!ac) return { stop() {}, set() {} };
      const f0 = freq ?? valueToFreq(value ?? 0, range);
      const t = ac.currentTime, out = ac.createGain(), panner = ac.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(amplitude, t + 0.01);
      out.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      out.connect(panner).connect(ac.destination);
      const n = Math.max(1, Math.min(8, Math.round(harmonics))), oscs = [];
      for (let k = 1; k <= n; k++) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = f0 * k; g.gain.value = 1 / (k * k ** 0.5);
        o.connect(g).connect(out); o.start(t); o.stop(t + duration + 0.05); oscs.push(o);
      }
      return { stop() { oscs.forEach((o) => { try { o.stop(); } catch {} }); }, set() {} };
    },
    stopAll() {},
  };
}

export async function createSound() {
  let engine = null, name = 'built-in';
  try {
    const mod = await import('/sound-engine/js/index.js');
    engine = mod.createEngine(); name = 'sound-engine';
  } catch (e) {
    console.info('[sound] sound-engine not available, using built-in synth:', e.message);
    engine = fallbackEngine();
  }
  let started = false;
  return {
    engine: name,
    get started() { return started; },
    async start() { await engine.start(); started = true; },
    play(opts) {
      if (!started) return null;
      // The real engine maps value+range itself; the fallback uses valueToFreq.
      return engine.play(opts);
    },
    valueToFreq,
  };
}
