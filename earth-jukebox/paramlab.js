(() => {
  "use strict";

  /* =========================================================================
   * Parameter lab: every Sound lab parameter, heard on its own (solo) and in
   * combination (the mix), with the Sound lab's own instruments. Settings can
   * be saved as candidates, compared A/B, and sent back to the Sound lab.
   * ====================================================================== */

  const SOUNDLAB_KEY = "gravitunes-sound-lab-v1"; // the Sound lab's saved settings (soundlab.js)
  const STORAGE_KEY = "gravitunes-param-lab-v1";
  const SOUNDLAB_VERSION = 4;
  const LOOKAHEAD = 0.12;
  const TICK_MS = 25;
  const SWEEP_SECONDS = 8; // one trip From → To → From
  const CYCLE_STEPS = 32; // "Cycle all" moves on every 2 bars
  const MAX_CANDIDATES = 30;

  // ---------- Copied from soundlab.js: keep these lists in the same order ----------
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const SCALES = [
    { name: "Pentatonic major", steps: [0, 2, 4, 7, 9] },
    { name: "Pentatonic minor", steps: [0, 3, 5, 7, 10] },
    { name: "Major", steps: [0, 2, 4, 5, 7, 9, 11] },
    { name: "Natural minor", steps: [0, 2, 3, 5, 7, 8, 10] },
    { name: "Dorian", steps: [0, 2, 3, 5, 7, 9, 10] },
    { name: "Lydian", steps: [0, 2, 4, 6, 7, 9, 11] },
    { name: "Whole tone", steps: [0, 2, 4, 6, 8, 10] },
    { name: "Chromatic", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  ];
  const CHORDS = [
    { name: "Single note", steps: [0], semis: [0] },
    { name: "Octave", steps: [0, "8va"], semis: [0, 12] },
    { name: "Power (5th)", steps: [0, 4], semis: [0, 7] },
    { name: "Triad", steps: [0, 2, 4], semis: [0, 4, 7] },
    { name: "Sus4", steps: [0, 3, 4], semis: [0, 5, 7] },
    { name: "Seventh", steps: [0, 2, 4, 6], semis: [0, 4, 7, 11] },
    { name: "Ninth", steps: [0, 2, 4, 6, 8], semis: [0, 4, 7, 11, 14] },
    { name: "Wide (10th)", steps: [0, 4, 9], semis: [0, 7, 16] },
  ];
  const RHYTHMS = [
    { name: "Flowing", steps: 0, flow: true },
    { name: "Every 2 bars", steps: 32 },
    { name: "Whole", steps: 16 },
    { name: "Half", steps: 8 },
    { name: "Quarter", steps: 4 },
    { name: "Eighth", steps: 2 },
    { name: "Sixteenth", steps: 1 },
  ];
  const INSTRUMENT_NAMES = [
    "Soft pad", "Choir", "Strings", "Organ", "Pluck", "Marimba", "Bell", "Pure tone", "Glockenspiel", "Harp",
    "Flute", "Clarinet", "Cello", "Brass", "Synth lead", "Glass harmonica", "Wind", "Vibraphone", "Kalimba",
    "Electric piano", "Music box",
  ];
  const INST = Object.fromEntries(INSTRUMENT_NAMES.map((name, i) => [name, i]));
  const PROFILE_KEYS = ["rain", "snow"];
  const PROFILE_INFO = {
    rain: { label: "Rain", color: "#9be15d" },
    snow: { label: "Snow", color: "#6fd3ff" },
  };
  const INPUT_LABELS = {
    manual: "Manual", x: "X (west → east)", y: "Y (south → north)", vx: "X speed", vy: "Y speed",
    spin: "Spin", color: "Color (light → heavy)", size: "Size", snow: "Rain/Snow",
  };
  const CURVE_KEYS = ["up", "down", "size", "calm"];

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const panFormat = (v) => (Math.abs(v) < 0.05 ? "center" : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function midiName(m) {
    const n = Math.round(m);
    return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
  }
  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const OUTPUTS = [
    { key: "pitch", label: "Pitch", hint: "low → high", kind: "range", min: 24, max: 96, step: 1, format: (v) => midiName(v) },
    { key: "amp", label: "Amplitude", hint: "quiet → loud", kind: "range", min: 0, max: 1, step: 0.01, format: pct },
    { key: "overtones", label: "Overtones", hint: "dark → bright", kind: "range", min: 0, max: 1, step: 0.01, format: pct },
    { key: "instrument", label: "Instrument", hint: "sound source", kind: "list", items: INSTRUMENT_NAMES },
    { key: "chord", label: "Chord", hint: "notes stacked", kind: "list", items: CHORDS.map((c) => c.name) },
    { key: "rhythm", label: "Notes", hint: "how often they strike", kind: "list", items: RHYTHMS.map((r) => r.name) },
    { key: "length", label: "Note length", hint: "short → long", kind: "range", min: 0, max: 1, step: 0.01, format: pct },
    { key: "pan", label: "Pan", hint: "left ↔ right", kind: "range", min: -1, max: 1, step: 0.01, format: panFormat },
    { key: "vibrato", label: "Vibrato", hint: "steady → wobbly", kind: "range", min: 0, max: 1, step: 0.01, format: pct },
  ];
  for (const output of OUTPUTS) {
    if (output.kind === "list") {
      output.min = 0;
      output.max = output.items.length - 1;
      output.step = 1;
      output.format = (v) => output.items[Math.round(v)];
    }
  }
  const OUTPUT_BY_KEY = Object.fromEntries(OUTPUTS.map((o) => [o.key, o]));

  const DEFAULT_ROWS = {
    pitch: { src: "y", curve: "up", lo: 45, hi: 81 },
    amp: { src: "color", curve: "up", lo: 0.25, hi: 1 },
    overtones: { src: "spin", curve: "size", lo: 0.1, hi: 0.9 },
    instrument: { src: "manual", curve: "up", lo: 1, hi: 6 },
    chord: { src: "manual", curve: "up", lo: 3, hi: 6 },
    rhythm: { src: "manual", curve: "up", lo: 0, hi: 6 },
    length: { src: "manual", curve: "up", lo: 0.75, hi: 1 },
    pan: { src: "x", curve: "up", lo: -0.8, hi: 0.8 },
    vibrato: { src: "manual", curve: "up", lo: 0.2, hi: 0.8 },
  };

  function defaultProfile(kind) {
    const rows = clone(DEFAULT_ROWS);
    if (kind === "snow") {
      Object.assign(rows.pitch, { lo: 62, hi: 91 });
      Object.assign(rows.instrument, { lo: INST.Glockenspiel });
      Object.assign(rows.chord, { lo: 1 });
      Object.assign(rows.length, { lo: 0.45 });
      Object.assign(rows.vibrato, { lo: 0 });
      return { key: 0, scale: 5, snap: true, rows };
    }
    Object.assign(rows.instrument, { lo: INST.Organ });
    return { key: 0, scale: 0, snap: true, rows };
  }

  // Global sound (the Sound lab's map-only globals, like map speed, aren't sounds and stay there).
  const GLOBALS = [
    { key: "voices", label: "Voices", hint: "how many play at once", min: 1, max: 8, step: 1, value: 4, format: (v) => `${v}` },
    { key: "bpm", label: "Tempo", hint: "slow → fast", min: 40, max: 180, step: 1, value: 88, format: (v) => `${v} BPM` },
    { key: "glide", label: "Pitch glide", hint: "steps → slides", min: 0, max: 1, step: 0.01, value: 0.4, format: pct },
    { key: "reverb", label: "Reverb", hint: "dry → hall", min: 0, max: 1, step: 0.01, value: 0.35, format: pct },
    { key: "blend", label: "Rain ↔ snow blend", hint: "switch → gradual", min: 0, max: 1, step: 0.01, value: 0.75, format: pct },
    { key: "volume", label: "Volume", hint: "", min: 0, max: 1, step: 0.01, value: 0.7, format: pct },
  ];
  const GLOBAL_BY_KEY = Object.fromEntries(GLOBALS.map((g) => [g.key, g]));
  const MIX_GLOBALS = ["voices", "bpm", "glide", "reverb"]; // globals with a solo + "in the mix" switch

  // ---------- The plain reference sound everything else is heard against ----------
  const BASE = {
    pitch: 60, amp: 0.6, overtones: 0.4, instrument: INST["Pure tone"], chord: 0, rhythm: 4,
    length: 0.6, pan: 0, vibrato: 0, voices: 1, bpm: 88, glide: 0.4, reverb: 0.25,
  };
  const BASE_TONAL = { key: 0, scale: 2, snap: true };
  // A few parameters can't be heard on the plain reference, so their solo changes the setting around them.
  const SOLO_CONTEXT = {
    glide: { rhythm: 0, instrument: INST["Soft pad"], tune: true }, // glide only exists on flowing sustained notes
    vibrato: { rhythm: 3, instrument: INST.Flute, tune: true },
    reverb: { length: 0.05, instrument: INST.Pluck },
    tonal: { run: true },
    voices: { tune: true },
  };
  const MOTIF = [0, 2, 4, 2, 0, 4, 7, 4]; // the "little tune", in scale steps above the pitch
  const RUN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1]; // scale run for the Key & scale solo
  const VOICE_SPREAD = [0, 4, -3, 2, 7, -5, 9, -1]; // scale steps between voices, as if on different storms

  // =========================================================================
  // State
  // =========================================================================
  const ROW_KEYS = OUTPUTS.map((o) => o.key);
  const MIX_KEYS = [...ROW_KEYS, "tonal", ...MIX_GLOBALS];
  const mixOptions = (key) => (ROW_KEYS.includes(key) ? ["off", "from", "to", "sweep"] : ["off", "on"]);

  function soundlabMix(profile) {
    const mix = {};
    for (const key of ROW_KEYS) mix[key] = profile.rows[key].src === "manual" ? "from" : "sweep";
    mix.tonal = "on";
    for (const key of MIX_GLOBALS) mix[key] = "on";
    return mix;
  }

  function defaultState() {
    const profiles = { rain: defaultProfile("rain"), snow: defaultProfile("snow") };
    return {
      version: 1,
      edit: "rain",
      material: "motif",
      strict: true,
      globals: Object.fromEntries(GLOBALS.map((g) => [g.key, g.value])),
      profiles,
      mix: soundlabMix(profiles.rain),
      candidates: [],
    };
  }

  function sanitizeProfile(raw, base, legacy) {
    if (!raw || typeof raw !== "object") return base;
    if (Number.isInteger(raw.key) && raw.key >= 0 && raw.key < 12) base.key = raw.key;
    if (Number.isInteger(raw.scale) && raw.scale >= 0 && raw.scale < SCALES.length) base.scale = raw.scale;
    if (typeof raw.snap === "boolean") base.snap = raw.snap;
    for (const o of OUTPUTS) {
      const r = raw.rows && raw.rows[o.key];
      if (!r) continue;
      const row = base.rows[o.key];
      if (Object.hasOwn(INPUT_LABELS, r.src)) row.src = r.src;
      if (CURVE_KEYS.includes(r.curve)) row.curve = r.curve;
      if (Number.isFinite(Number(r.lo))) row.lo = clamp(Number(r.lo), o.min, o.max);
      if (Number.isFinite(Number(r.hi))) row.hi = clamp(Number(r.hi), o.min, o.max);
      if (legacy && o.key === "rhythm") {
        // Sound lab saves before v2 had no "Flowing" option (same fix-up as soundlab.js).
        if (row.src === "manual") row.lo = 0;
        else {
          row.lo = Math.min(o.max, row.lo + 1);
          row.hi = Math.min(o.max, row.hi + 1);
        }
      }
    }
    return base;
  }

  function sanitizeGlobals(raw, base) {
    for (const g of GLOBALS) {
      const v = raw && Number(raw[g.key]);
      if (Number.isFinite(v)) base[g.key] = clamp(v, g.min, g.max);
    }
    return base;
  }

  function sanitizeMix(raw, base) {
    if (!raw || typeof raw !== "object") return base;
    for (const key of MIX_KEYS) if (mixOptions(key).includes(raw[key])) base[key] = raw[key];
    return base;
  }

  // A full snapshot (state or candidate): profiles, globals, mix, strict.
  function sanitizeSnapshot(raw, base) {
    if (!raw || typeof raw !== "object") return base;
    for (const kind of PROFILE_KEYS) base.profiles[kind] = sanitizeProfile(raw.profiles && raw.profiles[kind], defaultProfile(kind));
    base.globals = sanitizeGlobals(raw.globals, base.globals);
    base.mix = sanitizeMix(raw.mix, base.mix);
    if (typeof raw.strict === "boolean") base.strict = raw.strict;
    return base;
  }

  function readSoundLab() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(SOUNDLAB_KEY));
      return raw && typeof raw === "object" ? raw : null;
    } catch (error) {
      return null;
    }
  }

  // The Sound lab's current settings → our profiles, globals and strict tuning.
  function importSoundLab(target) {
    const raw = readSoundLab();
    if (!raw) return false;
    const legacy = !(Number(raw.version) >= 2);
    if (raw.profiles) {
      for (const kind of PROFILE_KEYS) target.profiles[kind] = sanitizeProfile(raw.profiles[kind], defaultProfile(kind), legacy);
    } else if (raw.rows) {
      target.profiles.rain = sanitizeProfile(raw, defaultProfile("rain"), legacy);
    }
    target.globals = sanitizeGlobals(raw.globals, target.globals);
    if (typeof raw.strict === "boolean" && Number(raw.version) >= 3) target.strict = raw.strict;
    target.mix = soundlabMix(target.profiles.rain);
    return true;
  }

  function loadState() {
    const base = defaultState();
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === "object") {
        sanitizeSnapshot(saved, base);
        if (PROFILE_KEYS.includes(saved.edit)) base.edit = saved.edit;
        if (saved.material === "motif" || saved.material === "note") base.material = saved.material;
        if (Array.isArray(saved.candidates)) {
          base.candidates = saved.candidates.slice(0, MAX_CANDIDATES).map((c) => ({
            name: String(c.name || "Untitled").slice(0, 60),
            savedAt: Number(c.savedAt) || Date.now(),
            ...sanitizeSnapshot(c, { profiles: {}, globals: defaultState().globals, mix: soundlabMix(defaultProfile("rain")), strict: true }),
          }));
        }
        return base;
      }
    } catch (error) {
      /* storage unavailable or unreadable: fall through */
    }
    importSoundLab(base); // first visit: start from whatever the Sound lab is set to
    return base;
  }

  let state = loadState();
  let saveTimer = 0;
  function saveState() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (error) {
        /* storage unavailable: settings just aren't remembered */
      }
    }, 250);
  }

  // =========================================================================
  // Music theory (same as soundlab.js)
  // =========================================================================
  const ladders = new Map();
  function getLadder(profile) {
    const id = `${profile.key}:${profile.scale}`;
    if (!ladders.has(id)) {
      const steps = SCALES[profile.scale].steps;
      const notes = [];
      for (let m = 0; m < 128; m += 1) if (steps.includes((((m - profile.key) % 12) + 12) % 12)) notes.push(m);
      ladders.set(id, notes);
    }
    return ladders.get(id);
  }

  function nearestLadderIndex(lad, midi) {
    let index = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < lad.length; i += 1) {
      const d = Math.abs(lad[i] - midi);
      if (d < bestDistance) {
        bestDistance = d;
        index = i;
      }
    }
    return index;
  }

  function chordMidis(root, chordIndex, profile) {
    const chord = CHORDS[chordIndex];
    const steps = SCALES[profile.scale].steps;
    if (!profile.snap) return chord.semis.map((s) => root + s);
    if (steps.length === 12) return chord.semis.map((s) => Math.round(root) + s);
    const lad = getLadder(profile);
    const index = nearestLadderIndex(lad, root);
    if (steps.length !== 7) {
      const out = [];
      for (const s of chord.semis) {
        const note = lad[nearestLadderIndex(lad, lad[index] + s - 0.01)];
        if (!out.includes(note)) out.push(note);
      }
      return out;
    }
    return chord.steps.map((s) => lad[Math.min(lad.length - 1, index + (s === "8va" ? steps.length : s))]);
  }

  // Scale steps → semitones in a major scale (used when "snap to scale" is off).
  const majorSemis = (step) => Math.floor(step / 7) * 12 + [0, 2, 4, 5, 7, 9, 11][((step % 7) + 7) % 7];

  // =========================================================================
  // Synth engine (copied from soundlab.js so every instrument sounds the same)
  // =========================================================================
  let ac = null;
  let master = null;
  let bus = null;
  let dryGain = null;
  let reverbSend = null;
  let convolver = null;
  let activeNotes = 0;
  let appliedMix = "";
  const waveCache = new Map();

  function makeImpulse(seconds) {
    const length = Math.floor(ac.sampleRate * seconds);
    const buffer = ac.createBuffer(2, length, ac.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
    }
    return buffer;
  }

  function makeBus() {
    bus = ac.createGain();
    dryGain = ac.createGain();
    reverbSend = ac.createGain();
    bus.connect(dryGain).connect(master);
    bus.connect(reverbSend).connect(convolver);
    appliedMix = "";
    applyMix();
  }

  function applyMix() {
    if (!ac) return;
    const mix = play ? globalValue("reverb") : state.globals.reverb;
    const id = `${mix}:${state.globals.volume}`;
    if (id === appliedMix) return;
    appliedMix = id;
    const now = ac.currentTime;
    dryGain.gain.setTargetAtTime(1 - mix * 0.45, now, 0.05);
    reverbSend.gain.setTargetAtTime(mix * 0.9, now, 0.05);
    master.gain.setTargetAtTime(state.globals.volume * 0.9, now, 0.05);
  }

  function ensureAudio() {
    if (ac) return;
    ac = new AudioContext();
    const compressor = ac.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    master = ac.createGain();
    master.connect(compressor).connect(ac.destination);
    convolver = ac.createConvolver();
    convolver.buffer = makeImpulse(2.8);
    convolver.connect(master);
    makeBus();
  }

  function wave(shape, bright) {
    const b = Math.round(clamp(bright, 0, 1) * 10) / 10;
    const id = `${shape}:${b}`;
    if (waveCache.has(id)) return waveCache.get(id);
    const N = 32;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    const power = 3 - 2.4 * b;
    const drawbars = { 1: 1, 2: 0.8, 3: 0.55, 4: 0.5, 6: 0.35, 8: 0.3, 10: 0.18, 12: 0.15, 16: 0.1 };
    const flute = { 1: 1, 2: 0.2 + 0.25 * b, 3: 0.06 + 0.12 * b, 4: 0.04 * b };
    const glass = { 1: 1, 2: 0.06 + 0.16 * b, 3: 0.1 * b, 5: 0.05 * b };
    for (let n = 1; n < N; n += 1) {
      if (shape === "organ") imag[n] = (drawbars[n] || 0) * (n > 2 ? b * 1.2 + 0.05 : 1);
      else if (shape === "odd") imag[n] = n % 2 ? 1 / Math.pow(n, power * 0.8) : 0.04 / n;
      else if (shape === "flute") imag[n] = flute[n] || 0;
      else if (shape === "glass") imag[n] = glass[n] || 0;
      else imag[n] = 1 / Math.pow(n, power);
    }
    const periodic = ac.createPeriodicWave(real, imag);
    waveCache.set(id, periodic);
    return periodic;
  }

  function osc(type, freq, t, end, detune = 0) {
    const o = ac.createOscillator();
    if (typeof type === "string") o.type = type;
    else o.setPeriodicWave(type);
    o.frequency.setValueAtTime(freq, t);
    o.detune.setValueAtTime(detune, t);
    o.start(t);
    o.stop(end);
    return o;
  }

  function gainNode(value) {
    const g = ac.createGain();
    g.gain.value = value;
    return g;
  }

  function sustainEnvelope(g, t, attack, hold, release, peak) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.linearRampToValueAtTime(0, t + attack + hold + release);
    return t + attack + hold + release + 0.02;
  }

  function percussiveEnvelope(g, t, decay, peak) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    g.gain.linearRampToValueAtTime(0, t + decay + 0.02);
    return t + decay + 0.03;
  }

  function addVibrato(oscillators, t, end, depth) {
    if (depth < 0.02) return;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 5.2;
    const lfoGain = ac.createGain();
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.linearRampToValueAtTime(depth * 35, t + 0.3);
    lfo.connect(lfoGain);
    for (const o of oscillators) lfoGain.connect(o.detune);
    lfo.start(t);
    lfo.stop(end);
  }

  const SUSTAIN = {
    pad: { shape: "all", tone: (b) => b * 0.8, detunes: [-6, 6], cut: [1.5, 9], attack: 0.6, release: 0.9 },
    choir: { shape: "all", tone: (b) => 0.3 + b * 0.5, detunes: [-11, 0, 11], cut: [2, 6], formants: [[720, 3, 9], [1150, 4, 7]], vibMin: 0.3, attack: 0.5, release: 0.8 },
    strings: { shape: "all", tone: (b) => 0.55 + b * 0.45, detunes: [-9, 2, 10], cut: [2, 10], q: 0.8, attack: 0.3, release: 0.5 },
    organ: { shape: "organ", tone: (b) => b, detunes: [0], cut: [8, 30], attack: 0.012, release: 0.12 },
    pure: { shape: "all", tone: (b) => b * 0.5, detunes: [0], cut: [3, 12], attack: 0.02, release: 0.25 },
    flute: { shape: "flute", tone: (b) => b, detunes: [0], cut: [3, 6], breath: 0.5, vibMin: 0.12, attack: 0.09, release: 0.3 },
    clarinet: { shape: "odd", tone: (b) => 0.35 + b * 0.5, detunes: [0, 3], cut: [2, 8], attack: 0.05, release: 0.2 },
    cello: { shape: "all", tone: (b) => 0.7 + b * 0.3, detunes: [-5, 5], cut: [1.5, 6], q: 1.1, formants: [[280, 2, 5], [1200, 2, 3]], vibMin: 0.25, attack: 0.18, release: 0.6 },
    brass: { shape: "all", tone: () => 1, detunes: [-4, 4], cut: [1, 7], ampTrack: true, attack: 0.06, release: 0.25 },
    lead: { type: "sawtooth", detunes: [-12, 12], cut: [2, 16], q: 3, attack: 0.02, release: 0.2 },
    glass: { shape: "glass", tone: (b) => b, detunes: [0, 1.5], cut: [4, 10], tremolo: 3.6, attack: 0.6, release: 1.4 },
    wind: { noise: true, detunes: [], cut: [3, 8], attack: 0.5, release: 1.2 },
  };

  const midiFreq = (m) => 440 * 2 ** ((m - 69) / 12);
  const cutoff = (spec, freq, bright, loud) =>
    Math.min(18000, freq * (spec.cut[0] + spec.cut[1] * bright * (spec.ampTrack ? 0.3 + loud * 1.4 : 1)));

  const noiseBuffers = new WeakMap();
  function noiseSource() {
    if (!noiseBuffers.has(ac)) {
      const length = ac.sampleRate * 2;
      const buffer = ac.createBuffer(1, length, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      noiseBuffers.set(ac, buffer);
    }
    const source = ac.createBufferSource();
    source.buffer = noiseBuffers.get(ac);
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = source.buffer.duration;
    return source;
  }

  function buildLayer(spec, strandCount, bright, out, t) {
    const sources = [];
    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    let tail = env;
    if (spec.tremolo) {
      const trem = gainNode(0.82);
      const lfo = ac.createOscillator();
      lfo.frequency.value = spec.tremolo;
      lfo.connect(gainNode(0.18)).connect(trem.gain);
      sources.push(lfo);
      env.connect(trem);
      tail = trem;
    }
    tail.connect(out);
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = spec.q ?? 0.5;
    filter.connect(env);
    const mix = ac.createGain();
    let node = mix;
    for (const [frequency, q, db] of spec.formants || []) {
      const peak = ac.createBiquadFilter();
      peak.type = "peaking";
      peak.frequency.value = frequency;
      peak.Q.value = q;
      peak.gain.value = db;
      node.connect(peak);
      node = peak;
    }
    node.connect(filter);
    const lfo = ac.createOscillator();
    lfo.frequency.value = 5.2;
    const vib = ac.createGain();
    vib.gain.setValueAtTime(0, t);
    lfo.connect(vib);
    sources.push(lfo);
    const strands = [];
    for (let s = 0; s < strandCount; s += 1) {
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.connect(mix);
      const freqs = [];
      const detunes = state.strict && spec.detunes.length ? [0] : spec.detunes;
      if (detunes.length) {
        const share = gainNode(1 / detunes.length);
        share.connect(gain);
        for (const d of detunes) {
          const o = ac.createOscillator();
          if (spec.type) o.type = spec.type;
          else o.setPeriodicWave(wave(spec.shape, spec.tone(bright)));
          o.detune.setValueAtTime(d, t);
          vib.connect(o.detune);
          o.connect(share);
          sources.push(o);
          freqs.push([o.frequency, 1]);
        }
      }
      if (spec.noise) {
        const source = noiseSource();
        const a = ac.createBiquadFilter();
        const b = ac.createBiquadFilter();
        a.type = b.type = "bandpass";
        a.Q.value = b.Q.value = 14;
        source.connect(a).connect(b).connect(gainNode(9)).connect(gain);
        freqs.push([a.frequency, 1], [b.frequency, 1]);
        sources.push(source);
      } else if (spec.breath) {
        const source = noiseSource();
        const band = ac.createBiquadFilter();
        band.type = "bandpass";
        band.Q.value = 1.4;
        source.connect(band).connect(gainNode(spec.breath)).connect(gain);
        freqs.push([band.frequency, 2]);
        sources.push(source);
      }
      strands.push({ gain, freqs });
    }
    sources.forEach((source, i) => {
      if (source.buffer) source.start(t, (i * 0.37) % 1.9);
      else source.start(t);
    });
    return { spec, env, filter, vib, strands, sources, instrument: -1, lastTarget: 0, lastLoud: t };
  }

  function playSustained(spec, n) {
    const layer = buildLayer(spec, 1, n.bright, n.out, n.t);
    const strand = layer.strands[0];
    strand.gain.gain.setValueAtTime(1, n.t);
    for (const [param, mult] of strand.freqs) param.setValueAtTime(n.freq * mult, n.t);
    layer.filter.frequency.setValueAtTime(cutoff(spec, n.freq, n.bright, n.loud ?? 0.6), n.t);
    const attack = Math.min(spec.attack, n.dur * 0.4) + 0.01;
    const end = sustainEnvelope(layer.env, n.t, attack, Math.max(0, n.dur - attack), spec.release, n.amp);
    const depth = state.strict ? 0 : Math.max(spec.vibMin || 0, n.vib) * 35;
    if (depth > 0.5) layer.vib.gain.linearRampToValueAtTime(depth, n.t + 0.3);
    for (const source of layer.sources) source.stop(end);
    return layer.sources[layer.sources.length - 1];
  }

  const sustained = (name, spec, level) => ({ name, level, sustain: spec, play: (n) => playSustained(spec, n) });

  const INSTRUMENTS = [
    sustained("Soft pad", SUSTAIN.pad, 0.9),
    sustained("Choir", SUSTAIN.choir, 0.75),
    sustained("Strings", SUSTAIN.strings, 0.6),
    sustained("Organ", SUSTAIN.organ, 0.45),
    { name: "Pluck", level: 0.9, play(n) {
      const decay = Math.min(2.4, 0.35 + n.dur * 0.9);
      const env = ac.createGain();
      const end = percussiveEnvelope(env, n.t, decay, n.amp);
      const filter = ac.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 1.2;
      filter.frequency.setValueAtTime(Math.min(18000, n.freq * (2 + n.bright * 16)), n.t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(60, n.freq * 1.1), n.t + 0.35);
      const o = osc(wave("all", 0.6 + n.bright * 0.4), n.freq, n.t, end);
      o.connect(filter).connect(env).connect(n.out);
      addVibrato([o], n.t, end, n.vib);
      return o;
    } },
    { name: "Marimba", level: 1, play(n) {
      const decay = Math.min(1.4, 0.3 + n.dur * 0.5);
      const env = ac.createGain();
      const end = percussiveEnvelope(env, n.t, decay, n.amp);
      const o = osc("sine", n.freq, n.t, end);
      o.connect(env).connect(n.out);
      const partialEnv = ac.createGain();
      percussiveEnvelope(partialEnv, n.t, decay * 0.35, n.amp * n.bright * 0.6 + 0.0001);
      const partial = osc("sine", n.freq * (state.strict ? 4 : 3.93), n.t, end);
      partial.connect(partialEnv).connect(n.out);
      addVibrato([o, partial], n.t, end, n.vib);
      return o;
    } },
    { name: "Bell", level: 0.7, play(n) {
      const decay = Math.min(4.5, 1.6 + n.dur * 0.6);
      const env = ac.createGain();
      const end = percussiveEnvelope(env, n.t, decay, n.amp);
      const carrier = osc("sine", n.freq, n.t, end);
      const modulator = osc("sine", n.freq * (state.strict ? 3 : 3.5), n.t, end);
      const modGain = ac.createGain();
      modGain.gain.setValueAtTime(n.freq * (0.6 + n.bright * 4), n.t);
      modGain.gain.exponentialRampToValueAtTime(n.freq * 0.05 + 0.01, n.t + decay);
      modulator.connect(modGain).connect(carrier.frequency);
      carrier.connect(env).connect(n.out);
      addVibrato([carrier], n.t, end, n.vib);
      return carrier;
    } },
    sustained("Pure tone", SUSTAIN.pure, 0.8),
    { name: "Glockenspiel", level: 0.55, play(n) {
      const decay = Math.min(3.2, 1.2 + n.dur * 0.4);
      const end = n.t + decay + 0.05;
      const ratios = state.strict ? [1, 3, 6, 9] : [1, 2.76, 5.4, 8.93];
      const partials = [[ratios[0], 1], [ratios[1], 0.3 + n.bright * 0.4], [ratios[2], 0.08 + n.bright * 0.35], [ratios[3], n.bright * 0.22]];
      const oscillators = [];
      partials.forEach(([ratio, level], i) => {
        if (level < 0.01 || n.freq * ratio > 18000) return;
        const env = ac.createGain();
        percussiveEnvelope(env, n.t, decay / (1 + i * 1.6), n.amp * level);
        const o = osc("sine", n.freq * ratio, n.t, end);
        o.connect(env).connect(n.out);
        oscillators.push(o);
      });
      addVibrato(oscillators, n.t, end, n.vib * 0.4);
      return oscillators[0];
    } },
    { name: "Harp", level: 0.85, play(n) {
      const decay = Math.min(3.8, 1.3 + n.dur * 0.8);
      const env = ac.createGain();
      env.gain.setValueAtTime(0, n.t);
      env.gain.linearRampToValueAtTime(n.amp, n.t + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0005, n.t + decay);
      env.gain.linearRampToValueAtTime(0, n.t + decay + 0.02);
      const end = n.t + decay + 0.03;
      const filter = ac.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.3;
      filter.frequency.setValueAtTime(Math.min(16000, n.freq * (3 + n.bright * 10)), n.t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(80, n.freq * 1.4), n.t + decay * 0.6);
      const spread = state.strict ? 0 : 3;
      const a = osc(wave("all", 0.25 + n.bright * 0.45), n.freq, n.t, end, -spread);
      const b = osc("triangle", n.freq, n.t, end, spread);
      const mix = gainNode(0.5);
      a.connect(mix);
      b.connect(mix);
      mix.connect(filter).connect(env).connect(n.out);
      addVibrato([a, b], n.t, end, n.vib * 0.5);
      return a;
    } },
    sustained("Flute", SUSTAIN.flute, 0.55),
    sustained("Clarinet", SUSTAIN.clarinet, 0.55),
    sustained("Cello", SUSTAIN.cello, 0.8),
    sustained("Brass", SUSTAIN.brass, 1.4),
    sustained("Synth lead", SUSTAIN.lead, 0.6),
    sustained("Glass harmonica", SUSTAIN.glass, 0.8),
    sustained("Wind", SUSTAIN.wind, 1.7),
    { name: "Vibraphone", level: 0.7, play(n) {
      const decay = Math.min(4.5, 1.6 + n.dur * 0.8);
      const end = n.t + decay + 0.05;
      const trem = gainNode(0.75);
      const lfo = osc("sine", 5.5, n.t, end);
      lfo.connect(gainNode(0.25)).connect(trem.gain);
      trem.connect(n.out);
      const oscillators = [];
      [[1, 1], [4, 0.12 + n.bright * 0.3], [10, n.bright * 0.08]].forEach(([ratio, level], i) => {
        if (level < 0.01 || n.freq * ratio > 16000) return;
        const env = ac.createGain();
        percussiveEnvelope(env, n.t, decay / (1 + i * 2.5), n.amp * level);
        const o = osc("sine", n.freq * ratio, n.t, end);
        o.connect(env).connect(trem);
        oscillators.push(o);
      });
      addVibrato(oscillators, n.t, end, n.vib * 0.3);
      return oscillators[0];
    } },
    { name: "Kalimba", level: 0.9, play(n) {
      const decay = Math.min(2.2, 0.8 + n.dur * 0.4);
      const env = ac.createGain();
      const end = percussiveEnvelope(env, n.t, decay, n.amp);
      const o = osc("sine", n.freq, n.t, end);
      o.connect(env).connect(n.out);
      const tineRatio = state.strict ? 6 : 5.95;
      if (n.freq * tineRatio < 16000) {
        const tineEnv = ac.createGain();
        percussiveEnvelope(tineEnv, n.t, 0.1 + n.bright * 0.15, n.amp * (0.2 + n.bright * 0.4));
        const tine = osc("sine", n.freq * tineRatio, n.t, end);
        tine.connect(tineEnv).connect(n.out);
      }
      addVibrato([o], n.t, end, n.vib * 0.3);
      return o;
    } },
    { name: "Electric piano", level: 0.75, play(n) {
      const decay = Math.min(3.5, 1.2 + n.dur * 0.7);
      const env = ac.createGain();
      const end = percussiveEnvelope(env, n.t, decay, n.amp);
      const carrier = osc("sine", n.freq, n.t, end);
      const modulator = osc("sine", n.freq, n.t, end);
      const modGain = ac.createGain();
      modGain.gain.setValueAtTime(n.freq * (0.4 + n.bright * 2.2), n.t);
      modGain.gain.exponentialRampToValueAtTime(n.freq * 0.08 + 0.01, n.t + Math.min(decay, 1.2));
      modulator.connect(modGain).connect(carrier.frequency);
      carrier.connect(env).connect(n.out);
      if (n.freq * 14 < 16000) {
        const tineEnv = ac.createGain();
        percussiveEnvelope(tineEnv, n.t, 0.08, n.amp * 0.12 * (0.3 + n.bright));
        const tine = osc("sine", n.freq * 14, n.t, end);
        tine.connect(tineEnv).connect(n.out);
      }
      addVibrato([carrier], n.t, end, n.vib * 0.4);
      return carrier;
    } },
    { name: "Music box", level: 0.6, play(n) {
      const decay = Math.min(2.6, 0.9 + n.dur * 0.4);
      const end = n.t + decay + 0.05;
      const oscillators = [];
      [[2, 1], [4, 0.2 + n.bright * 0.3], [6, n.bright * 0.15]].forEach(([ratio, level], i) => {
        if (level < 0.01 || n.freq * ratio > 16000) return;
        const env = ac.createGain();
        percussiveEnvelope(env, n.t, decay / (1 + i * 2), n.amp * level);
        const o = osc("sine", n.freq * ratio, n.t, end);
        o.connect(env).connect(n.out);
        oscillators.push(o);
      });
      addVibrato(oscillators, n.t, end, n.vib * 0.3);
      return oscillators[0];
    } },
  ];
  if (INSTRUMENTS.some((inst, i) => inst.name !== INSTRUMENT_NAMES[i])) console.error("Parameter lab: instrument list out of sync");

  function makePanner(pan, t) {
    const panner = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
    if (panner.pan) panner.pan.setValueAtTime(clamp(pan, -1, 1), t);
    panner.connect(bus);
    return panner;
  }

  function playNote(instrumentIndex, t, midi, dur, amp, bright, vib, pan, loud) {
    if (activeNotes > 96) return;
    if (state.strict) vib = 0;
    const panner = makePanner(pan, t);
    const main = INSTRUMENTS[instrumentIndex].play({ t, dur, freq: midiFreq(midi), amp, bright, vib, loud, out: panner });
    activeNotes += 1;
    main.onended = () => {
      activeNotes -= 1;
      panner.disconnect();
    };
  }

  // =========================================================================
  // What's playing: a solo, the mix, or rain → snow
  // =========================================================================
  // play = { target: "solo" | "mix" | "duo", key, variant, t0, startStep, cycleIndex }
  let play = null;
  let schedulerTimer = 0;
  let nextStepTime = 0;
  let stepIndex = 0;
  const memory = new Map(); // `${voice}:${kind}` → what that voice last played
  const drones = new Map(); // `${voice}:${kind}` → continuous layer

  // How a parameter behaves right now: "off" (reference), "from", "to", "sweep", "on" or "cycle".
  function modeOf(key) {
    if (!play) return "off";
    if (play.target === "solo") return key === play.key ? play.variant : "off";
    return state.mix[key] || "off";
  }

  function referenceValue(key) {
    const context = play && play.target === "solo" && SOLO_CONTEXT[play.key];
    return context && key in context ? context[key] : BASE[key];
  }

  function globalValue(key) {
    return modeOf(key) === "on" ? state.globals[key] : referenceValue(key);
  }

  const voiceCount = () => Math.round(globalValue("voices"));
  const bpmNow = () => globalValue("bpm");
  const triangle = (phase) => {
    const f = ((phase % 1) + 1) % 1;
    return f < 0.5 ? f * 2 : 2 - f * 2;
  };

  function sweepAt(now, voice, count) {
    if (!play) return 0;
    return triangle((now - play.t0) / SWEEP_SECONDS + (count > 1 ? voice / count / 2 : 0));
  }

  function rowValue(key, profile, s) {
    const mode = modeOf(key);
    const row = profile.rows[key];
    const output = OUTPUT_BY_KEY[key];
    let value;
    if (mode === "from" || mode === "on") value = row.lo;
    else if (mode === "to") value = row.hi;
    else if (mode === "sweep") value = lerp(row.lo, row.hi, s);
    else if (mode === "cycle") value = play.cycleIndex;
    else value = referenceValue(key);
    return output.kind === "list" ? clamp(Math.round(value), output.min, output.max) : value;
  }

  function paramsAt(kind, voice, now) {
    const profile = state.profiles[kind];
    const s = sweepAt(now, voice, voiceCount());
    const p = { s };
    for (const key of ROW_KEYS) p[key] = rowValue(key, profile, s);
    if (modeOf("tonal") === "cycle") p.tonal = { ...profile, scale: play.cycleIndex }; // "Cycle scales" solo
    else p.tonal = modeOf("tonal") === "on" ? profile : BASE_TONAL;
    return p;
  }

  function notesFor(p, voice, step) {
    const context = play.target === "solo" ? SOLO_CONTEXT[play.key] || {} : {};
    const rhythm = RHYTHMS[p.rhythm];
    const every = rhythm.flow ? 4 : rhythm.steps;
    const index = Math.floor(step / every);
    let offset = 0;
    if (context.run) offset = RUN[index % RUN.length];
    else if (state.material === "motif" || context.tune) offset = MOTIF[(index + voice * 3) % MOTIF.length];
    offset += VOICE_SPREAD[voice % VOICE_SPREAD.length];
    const tonal = p.tonal;
    let root;
    if (tonal.snap) {
      const lad = getLadder(tonal);
      root = lad[clamp(nearestLadderIndex(lad, p.pitch) + offset, 0, lad.length - 1)];
    } else root = p.pitch + majorSemis(offset);
    return chordMidis(root, p.chord, tonal).filter((m) => m >= 12 && m <= 120);
  }

  // Rain ↔ snow (same crossfade as the Sound lab): the snow share sweeps 0 → 1 → 0.
  function blendShare(snow) {
    const width = lerp(0.04, 1, state.globals.blend);
    const t = clamp((snow - 0.5) / width + 0.5, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function kindWeights(now) {
    if (play.target !== "duo") return { [state.edit]: 1 };
    const share = blendShare(triangle((now - play.t0) / (SWEEP_SECONDS * 1.5)));
    return { rain: Math.cos((share * Math.PI) / 2), snow: Math.sin((share * Math.PI) / 2) };
  }

  const voicePan = (p, voice, count) => clamp(p.pan + (count > 1 ? ((voice / (count - 1)) * 2 - 1) * 0.5 : 0), -1, 1);

  function cycleLength() {
    if (!play || play.variant !== "cycle") return 1;
    if (play.key === "tonal") return SCALES.length;
    return OUTPUT_BY_KEY[play.key].items.length;
  }

  function scheduleStep(step, t) {
    if (play.variant === "cycle") {
      const next = Math.floor((step - play.startStep) / CYCLE_STEPS) % cycleLength();
      play.cycleIndex = next;
    }
    const count = voiceCount();
    const norm = 1 / Math.sqrt(count);
    const stepDuration = 60 / bpmNow() / 4;
    const weights = kindWeights(t);
    for (let v = 0; v < count; v += 1) {
      for (const kind of PROFILE_KEYS) {
        const w = weights[kind];
        if (w === undefined) continue;
        const id = `${v}:${kind}`;
        let mem = memory.get(id);
        if (!mem) {
          mem = { strikeKey: "", strikeT: -99, midis: [], when: 0 };
          memory.set(id, mem);
        }
        const p = paramsAt(kind, v, t);
        const midis = notesFor(p, v, step - play.startStep);
        const key = midis.join(",");
        if (key !== mem.midis.join(",")) {
          mem.midis = midis;
          mem.when = t;
        }
        if (w < 0.04 || !midis.length) continue;
        const instrument = INSTRUMENTS[p.instrument];
        const rhythm = RHYTHMS[p.rhythm];
        let dur;
        if (rhythm.flow) {
          if (instrument.sustain) continue; // the continuous engine plays this one
          if (state.strict && step % 2) continue;
          const ring = 0.6 + p.length * 3;
          if (key === mem.strikeKey && t - mem.strikeT < ring) continue;
          dur = ring;
        } else {
          if ((step - play.startStep) % rhythm.steps !== 0) continue;
          dur = rhythm.steps * stepDuration * (0.15 + p.length * 1.65);
        }
        const amp = (p.amp * w * norm * instrument.level * 0.55) / Math.sqrt(midis.length);
        if (amp < 0.002) continue;
        for (const m of midis) playNote(p.instrument, t, m, dur, amp, p.overtones, p.vibrato, voicePan(p, v, count), p.amp);
        mem.strikeKey = key;
        mem.strikeT = t;
      }
    }
  }

  // ---------- Continuous voices ("Flowing" + a sustained instrument), as in the Sound lab ----------
  function glideParam(param, value, when, timeConstant) {
    const last = param._target;
    if (last !== undefined && Math.abs(value - last) <= Math.abs(last) * 0.002 + 1e-5) return;
    param._target = value;
    param.setTargetAtTime(value, when, timeConstant);
  }

  function retireLayer(layer, now) {
    layer.env.gain.cancelScheduledValues(now);
    layer.env.gain.setTargetAtTime(0, now, 0.12);
    for (const source of layer.sources) source.stop(now + 1);
    layer.sources[0].onended = () => layer.panner.disconnect();
  }

  function updateDrones() {
    const now = ac.currentTime;
    const glide = state.strict ? 0.01 : 0.004 + globalValue("glide") ** 2 * 0.9;
    const count = voiceCount();
    const norm = 1 / Math.sqrt(count);
    const weights = play ? kindWeights(now) : {};
    const touched = new Set();
    for (const [id, mem] of memory) {
      const [vText, kind] = id.split(":");
      const v = Number(vText);
      const w = weights[kind];
      if (!play || w === undefined || v >= count) continue;
      const p = paramsAt(kind, v, now);
      const midis = mem.midis;
      const instrument = INSTRUMENTS[p.instrument];
      const flowing = RHYTHMS[p.rhythm].flow && instrument.sustain;
      const target = flowing && midis.length ? p.amp * w * norm * instrument.level * 0.4 : 0;
      let layer = drones.get(id);
      if (!layer && target < 0.0005) continue;
      touched.add(id);
      if (target >= 0.0005 && (!layer || layer.instrument !== p.instrument || layer.strands.length < midis.length)) {
        if (layer) retireLayer(layer, now);
        const panner = makePanner(voicePan(p, v, count), now);
        layer = buildLayer(instrument.sustain, Math.max(1, midis.length), p.overtones, panner, now);
        layer.panner = panner;
        layer.instrument = p.instrument;
        layer.fresh = true;
        drones.set(id, layer);
      }
      const when = state.strict ? Math.max(now, mem.when) : now;
      layer.strands.forEach((strand, i) => {
        const m = midis[i];
        if (m !== undefined) {
          const freq = midiFreq(m);
          for (const [param, mult] of strand.freqs) {
            if (layer.fresh) {
              param.setValueAtTime(freq * mult, now);
              param._target = freq * mult;
            } else glideParam(param, freq * mult, Math.max(now, mem.when), glide);
          }
        }
        glideParam(strand.gain.gain, m !== undefined ? 1 / Math.sqrt(midis.length) : 0, now, 0.08);
      });
      const spec = layer.spec;
      const root = midis.length ? midiFreq(midis[0]) : 220;
      glideParam(layer.filter.frequency, cutoff(spec, root, p.overtones, p.amp), now, layer.fresh ? 0.002 : 0.15);
      glideParam(layer.vib.gain, state.strict ? 0 : Math.max(spec.vibMin || 0, p.vibrato) * 35, now, 0.3);
      if (layer.panner.pan) glideParam(layer.panner.pan, voicePan(p, v, count), now, 0.2);
      const rising = target > layer.lastTarget;
      glideParam(layer.env.gain, target, when, rising ? Math.max(0.04, spec.attack / 3) : Math.max(0.06, spec.release / 3));
      layer.lastTarget = target;
      layer.fresh = false;
      if (target > 0.0005) layer.lastLoud = now;
    }
    for (const [id, layer] of drones) {
      if (!touched.has(id) && layer.lastTarget > 0) {
        glideParam(layer.env.gain, 0, now, Math.max(0.08, layer.spec.release / 3));
        layer.lastTarget = 0;
      }
      if (layer.lastTarget === 0 && now - layer.lastLoud > 4) {
        retireLayer(layer, now);
        drones.delete(id);
      }
    }
  }

  let lastReadout = 0;
  function tick() {
    if (!play) return;
    while (nextStepTime < ac.currentTime + LOOKAHEAD) {
      scheduleStep(stepIndex, nextStepTime);
      nextStepTime += 60 / bpmNow() / 4;
      stepIndex += 1;
    }
    updateDrones();
    applyMix();
    if (performance.now() - lastReadout > 90) {
      lastReadout = performance.now();
      updateReadouts();
    }
  }

  async function startPlay(next) {
    try {
      ensureAudio();
      await ac.resume();
    } catch (error) {
      setStatus("Could not start audio. Check the browser's sound permissions and try again.");
      console.error("Parameter lab could not start audio:", error);
      return;
    }
    const now = ac.currentTime;
    const wasPlaying = Boolean(play);
    // Switching between mix-style plays (A/B candidates) keeps the sweep where it is.
    const keepClock = wasPlaying && play.target === "mix" && next.target === "mix";
    play = { ...next, t0: keepClock ? play.t0 : now, startStep: stepIndex, cycleIndex: 0 };
    for (const mem of memory.values()) mem.strikeKey = "";
    if (!wasPlaying) {
      nextStepTime = now + 0.06;
      stepIndex = 0;
      play.startStep = 0;
      window.clearInterval(schedulerTimer);
      schedulerTimer = window.setInterval(tick, TICK_MS);
    } else if (!keepClock) {
      // Start the new solo on a fresh bar so its rhythm and sweep begin at the top.
      play.startStep = stepIndex;
    }
    appliedMix = "";
    tick();
    syncPlaying();
  }

  function stopPlay() {
    play = null;
    window.clearInterval(schedulerTimer);
    if (ac) {
      for (const layer of drones.values()) retireLayer(layer, ac.currentTime);
      drones.clear();
      memory.clear();
      const old = bus;
      old.gain.setTargetAtTime(0, ac.currentTime, 0.04);
      window.setTimeout(() => old.disconnect(), 500);
      makeBus();
    }
    syncPlaying();
  }

  function toggle(next) {
    const same = play && play.target === next.target && play.key === next.key && play.variant === next.variant && play.candidate === next.candidate;
    if (same) stopPlay();
    else startPlay(next);
  }

  // =========================================================================
  // UI
  // =========================================================================
  const $ = (selector, root = document) => root.querySelector(selector);
  const cardsEl = $("#pl-cards");
  const togetherEl = $("#pl-cards-together");
  const statusEl = $("#pl-status");
  const stopButton = $("#pl-stop");
  const playMixButton = $("#pl-play-mix");
  const nowWhat = $("#pl-now-what");
  const nowNotes = $("#pl-now-notes");
  const mixSummary = $("#pl-mix-summary");
  const candidatesEl = $("#pl-candidates");
  const transport = $("#pl-transport");

  function setStatus(message) {
    statusEl.textContent = message;
  }

  const editing = () => state.profiles[state.edit];
  const MODE_LABELS = { off: "Off", from: "From", to: "To", sweep: "Sweep", on: "On" };

  function mixMarkup(key) {
    const options = mixOptions(key)
      .map((mode) => `<label><input type="radio" name="mix-${key}" value="${mode}" data-mix="${key}"${state.mix[key] === mode ? " checked" : ""}><span>${MODE_LABELS[mode]}</span></label>`)
      .join("");
    return `<div class="pl-mix"><span class="pl-mix-label">In the mix</span><fieldset class="lab-segment pl-mix-seg"><legend class="visually-hidden">In the mix</legend>${options}</fieldset></div>`;
  }

  function sliderMarkup(id, label, def, value, data) {
    return `<label class="slider-control mini" for="${id}">
      <span class="slider-heading"><span>${label}</span><output for="${id}">${escapeHtml(def.format(value))}</output></span>
      <input id="${id}" type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${value}" ${data}>
    </label>`;
  }

  function sourceTag(key) {
    const row = editing().rows[key];
    if (row.src === "manual") return `<span class="pl-tag">Sound lab: fixed at From</span>`;
    const curve = { up: "", down: ", inverted", size: ", strength", calm: ", calmness" }[row.curve] || "";
    return `<span class="pl-tag is-mapped">Sound lab: ${escapeHtml(INPUT_LABELS[row.src])}${curve}</span>`;
  }

  function soloButton(key, variant, label) {
    return `<button class="button button-secondary pl-solo-btn" type="button" data-solo="${key}" data-variant="${variant}" aria-pressed="false"><span class="pl-solo-icon" aria-hidden="true">▶</span> ${label}</button>`;
  }

  const STRICT_NOTE = {
    vibrato: "Strict tuning is on, so vibrato is silenced.",
    glide: "Strict tuning is on, so notes step instead of sliding.",
  };

  function cardShell(key, title, hint, tag, body, solos, extra = "") {
    const strict = STRICT_NOTE[key]
      ? `<p class="pl-warn" data-strict-note>${STRICT_NOTE[key]} <button type="button" class="pl-link" data-strict-off>Turn strict tuning off</button></p>`
      : "";
    return `<article class="pl-card" data-card="${key}">
      <header class="pl-card-head">
        <div><h3>${title}</h3><p>${hint}</p></div>
        ${tag}
      </header>
      <div class="pl-card-body">${body}</div>
      ${strict}
      <div class="pl-solos">${solos}</div>
      <p class="pl-readout" data-readout="${key}" aria-live="off"></p>
      ${extra}
    </article>`;
  }

  function rangeCard(output) {
    const row = editing().rows[output.key];
    const body = `<div class="lab-range">
      ${sliderMarkup(`pl-${output.key}-lo`, "From", output, row.lo, `data-row="${output.key}" data-end="lo"`)}
      ${sliderMarkup(`pl-${output.key}-hi`, "To", output, row.hi, `data-row="${output.key}" data-end="hi"`)}
    </div>`;
    const solos = soloButton(output.key, "sweep", "Sweep") + soloButton(output.key, "from", "From") + soloButton(output.key, "to", "To");
    return cardShell(output.key, output.label, output.hint, sourceTag(output.key), body, solos, mixMarkup(output.key));
  }

  function listCard(output) {
    const row = editing().rows[output.key];
    const chips = output.items
      .map((name, i) => `<button type="button" class="pl-chip${i === row.lo ? " is-chosen" : ""}" data-chip="${output.key}" data-index="${i}" aria-pressed="${i === row.lo}">${escapeHtml(name)}</button>`)
      .join("");
    const toOptions = output.items.map((name, i) => `<option value="${i}"${i === row.hi ? " selected" : ""}>${escapeHtml(name)}</option>`).join("");
    const body = `<p class="pl-card-note">Click one to choose it as <em>From</em> and hear it.</p>
      <div class="pl-chips">${chips}</div>
      <label class="pl-to">To <select class="lab-select" data-list-to="${output.key}">${toOptions}</select></label>`;
    const solos = soloButton(output.key, "on", "Chosen") + soloButton(output.key, "cycle", "Cycle all") + soloButton(output.key, "sweep", "Sweep From → To");
    return cardShell(output.key, output.label, output.hint, sourceTag(output.key), body, solos, mixMarkup(output.key));
  }

  function tonalCard() {
    const profile = editing();
    const keys = NOTE_NAMES.map((name, i) => `<button type="button" class="pl-chip pl-chip-key${i === profile.key ? " is-chosen" : ""}" data-key-chip="${i}" aria-pressed="${i === profile.key}">${name}</button>`).join("");
    const scales = SCALES.map((scale, i) => `<button type="button" class="pl-chip${i === profile.scale ? " is-chosen" : ""}" data-scale-chip="${i}" aria-pressed="${i === profile.scale}">${scale.name}</button>`).join("");
    const body = `<p class="pl-card-note">Key</p><div class="pl-chips">${keys}</div>
      <p class="pl-card-note">Scale</p><div class="pl-chips">${scales}</div>
      <label class="lab-check"><input type="checkbox" data-snap${profile.snap ? " checked" : ""}> Snap notes to the scale</label>`;
    const solos = soloButton("tonal", "on", "Scale run") + soloButton("tonal", "cycle", "Cycle scales");
    return cardShell("tonal", "Key &amp; scale", "which notes are allowed", `<span class="pl-tag">${PROFILE_INFO[state.edit].label} sound</span>`, body, solos, mixMarkup("tonal"));
  }

  function globalCard(key) {
    const def = GLOBAL_BY_KEY[key];
    const body = sliderMarkup(`pl-g-${key}`, def.label, def, state.globals[key], `data-global="${key}"`);
    return cardShell(key, def.label, def.hint, `<span class="pl-tag">Global, both sounds</span>`, body, soloButton(key, "on", "Hear it"), mixMarkup(key));
  }

  function blendCard() {
    const def = GLOBAL_BY_KEY.blend;
    const body = sliderMarkup("pl-g-blend", def.label, def, state.globals.blend, `data-global="blend"`);
    return cardShell(
      "blend",
      "Rain ↔ snow",
      "both sounds, fading into each other",
      `<span class="pl-tag">Uses the mix</span>`,
      `<p class="pl-card-note">Plays the rain and snow sounds together with their <em>In the mix</em> settings while a voice drifts from rain into snow and back over 12 seconds. The blend sets how gradual the fade is.</p>${body}`,
      `<button class="button button-secondary pl-solo-btn" type="button" data-duo aria-pressed="false"><span class="pl-solo-icon" aria-hidden="true">▶</span> Rain → snow → rain</button>`,
    );
  }

  function render() {
    const html = [];
    for (const output of OUTPUTS) {
      html.push(output.kind === "range" ? rangeCard(output) : listCard(output));
      if (output.key === "pitch") html.push(tonalCard());
    }
    for (const key of MIX_GLOBALS) html.push(globalCard(key));
    cardsEl.innerHTML = html.join("");
    cardsEl.style.setProperty("--profile", PROFILE_INFO[state.edit].color);
    togetherEl.innerHTML = blendCard();
    for (const input of document.querySelectorAll('input[name="pl-profile"]')) input.checked = input.value === state.edit;
    for (const input of document.querySelectorAll('input[name="pl-material"]')) input.checked = input.value === state.material;
    $("#pl-strict").checked = state.strict;
    $("#pl-volume").value = state.globals.volume;
    $("#pl-volume-out").textContent = pct(state.globals.volume);
    syncStrict();
    renderMixSummary();
    renderCandidates();
    syncPlaying();
  }

  function syncStrict() {
    for (const note of document.querySelectorAll("[data-strict-note]")) note.hidden = !state.strict;
  }

  function describeMode(key, mode) {
    if (mode === "off") return null;
    if (ROW_KEYS.includes(key)) {
      const output = OUTPUT_BY_KEY[key];
      const row = editing().rows[key];
      if (mode === "sweep") return `${output.label}: ${output.format(row.lo)} ↔ ${output.format(row.hi)}`;
      return `${output.label}: ${output.format(mode === "to" ? row.hi : row.lo)}`;
    }
    if (key === "tonal") return `${NOTE_NAMES[editing().key]} ${SCALES[editing().scale].name}`;
    const def = GLOBAL_BY_KEY[key];
    return `${def.label}: ${def.format(state.globals[key])}`;
  }

  function renderMixSummary() {
    const on = [];
    const off = [];
    for (const key of MIX_KEYS) {
      const text = describeMode(key, state.mix[key]);
      if (text) on.push(`<li class="${state.mix[key] === "sweep" ? "is-sweep" : ""}">${escapeHtml(text)}</li>`);
      else off.push(ROW_KEYS.includes(key) ? OUTPUT_BY_KEY[key].label : key === "tonal" ? "Key & scale" : GLOBAL_BY_KEY[key].label);
    }
    mixSummary.innerHTML = `<p class="pl-mix-title">In the mix (${PROFILE_INFO[state.edit].label.toLowerCase()} sound)</p>
      <ul class="pl-mix-list">${on.join("") || "<li>Nothing yet: everything is the plain reference.</li>"}</ul>
      ${off.length ? `<p class="pl-mix-off">Reference: ${escapeHtml(off.join(", "))}</p>` : ""}`;
  }

  function summarizeProfile(profile) {
    const r = profile.rows;
    return `${INSTRUMENT_NAMES[r.instrument.lo]} · ${CHORDS[r.chord.lo].name} · ${RHYTHMS[r.rhythm.lo].name} · ${NOTE_NAMES[profile.key]} ${SCALES[profile.scale].name} · ${midiName(r.pitch.lo)}–${midiName(r.pitch.hi)}`;
  }

  let activeCandidate = -1;
  function renderCandidates() {
    if (!state.candidates.length) {
      candidatesEl.innerHTML = `<li class="pl-empty">No candidates yet. Shape a sound you like, name it, and save it.</li>`;
      return;
    }
    candidatesEl.innerHTML = state.candidates
      .map((c, i) => `<li class="pl-candidate${i === activeCandidate ? " is-active" : ""}">
        <button class="button button-secondary pl-solo-btn" type="button" data-cand-play="${i}" aria-pressed="false"><span class="pl-solo-icon" aria-hidden="true">▶</span> <span class="visually-hidden">Play</span></button>
        <div class="pl-candidate-text">
          <b>${String.fromCharCode(65 + (i % 26))} · ${escapeHtml(c.name)}</b>
          <span><i class="lab-profile-dot" style="--profile:${PROFILE_INFO.rain.color}"></i>${escapeHtml(summarizeProfile(c.profiles.rain))}</span>
          <span><i class="lab-profile-dot" style="--profile:${PROFILE_INFO.snow.color}"></i>${escapeHtml(summarizeProfile(c.profiles.snow))}</span>
        </div>
        <div class="pl-candidate-tools">
          <button class="button button-secondary" type="button" data-cand-load="${i}">Load</button>
          <button class="button button-secondary" type="button" data-cand-update="${i}" title="Replace this candidate with the current settings">Overwrite</button>
          <button class="button button-secondary" type="button" data-cand-delete="${i}" aria-label="Delete ${escapeHtml(c.name)}">✕</button>
        </div>
      </li>`)
      .join("");
  }

  const snapshot = () => clone({ profiles: state.profiles, globals: state.globals, mix: state.mix, strict: state.strict });

  function loadSnapshot(snap) {
    state.profiles = clone(snap.profiles);
    state.globals = { ...clone(snap.globals), volume: state.globals.volume };
    state.mix = clone(snap.mix);
    state.strict = snap.strict;
  }

  // Which play button is lit, the card highlights and the "now playing" line.
  function syncPlaying() {
    stopButton.disabled = !play;
    transport.classList.toggle("is-playing", Boolean(play));
    for (const button of document.querySelectorAll("[data-solo]")) {
      const on = Boolean(play && play.target === "solo" && play.key === button.dataset.solo && play.variant === button.dataset.variant);
      button.setAttribute("aria-pressed", String(on));
      button.querySelector(".pl-solo-icon").textContent = on ? "■" : "▶";
    }
    const duo = document.querySelector("[data-duo]");
    if (duo) {
      const on = Boolean(play && play.target === "duo");
      duo.setAttribute("aria-pressed", String(on));
      duo.querySelector(".pl-solo-icon").textContent = on ? "■" : "▶";
    }
    for (const button of document.querySelectorAll("[data-cand-play]")) {
      const on = Boolean(play && play.target === "mix" && play.candidate === Number(button.dataset.candPlay));
      button.setAttribute("aria-pressed", String(on));
      button.querySelector(".pl-solo-icon").textContent = on ? "■" : "▶";
    }
    const mixOn = Boolean(play && play.target === "mix" && play.candidate === undefined);
    playMixButton.querySelector(".button-icon").textContent = mixOn ? "■" : "▶";
    playMixButton.querySelector(".button-icon + span").textContent = mixOn ? "Stop the mix" : "Play all together";
    for (const card of document.querySelectorAll(".pl-card")) {
      const key = card.dataset.card;
      const soloed = Boolean(play && play.target === "solo" && play.key === key);
      const live = Boolean(play && play.target !== "solo" && (key === "blend" ? play.target === "duo" : modeOf(key) !== "off"));
      card.classList.toggle("is-solo", soloed);
      card.classList.toggle("is-live", live);
    }
    if (!play) {
      nowWhat.textContent = "Nothing playing";
      nowNotes.textContent = "";
      for (const el of document.querySelectorAll("[data-readout]")) el.textContent = "";
      for (const chip of document.querySelectorAll(".pl-chip.is-sounding")) chip.classList.remove("is-sounding");
      setStatus("Stopped. Press any ▶ to listen.");
      return;
    }
    nowWhat.textContent = describePlay();
    setStatus(play.target === "solo"
      ? "Solo: only this parameter changes; everything else is the plain reference. Press ■ or another ▶ to switch."
      : "Playing the mix: change any card's In the mix switch, value or chip and hear it right away.");
  }

  function cardTitle(key) {
    if (ROW_KEYS.includes(key)) return OUTPUT_BY_KEY[key].label;
    if (key === "tonal") return "Key & scale";
    return GLOBAL_BY_KEY[key].label;
  }

  function describePlay() {
    if (play.target === "duo") return "Rain → snow → rain, with the mix";
    if (play.target === "mix") {
      const c = state.candidates[play.candidate];
      return c ? `Candidate ${String.fromCharCode(65 + (play.candidate % 26))}: ${c.name}` : `All together · ${PROFILE_INFO[state.edit].label.toLowerCase()} sound`;
    }
    const variant = { sweep: "sweeping From ↔ To", from: "at From", to: "at To", on: "", cycle: "cycling through all" }[play.variant];
    return `Solo · ${cardTitle(play.key)}${variant ? ` ${variant}` : ""} · ${PROFILE_INFO[state.edit].label.toLowerCase()} sound`;
  }

  // Live values: what each audible parameter is set to this moment (voice 1).
  function updateReadouts() {
    if (!play || !ac) return;
    const now = ac.currentTime;
    const weights = kindWeights(now);
    const kind = play.target === "duo" ? (weights.snow > weights.rain ? "snow" : "rain") : state.edit;
    const p = paramsAt(kind, 0, now);
    for (const el of document.querySelectorAll("[data-readout]")) {
      const key = el.dataset.readout;
      const audible = play.target === "solo" ? play.key === key : modeOf(key) !== "off";
      let text = "";
      if (audible && ROW_KEYS.includes(key)) text = `Now: ${OUTPUT_BY_KEY[key].format(p[key])}`;
      else if (audible && key === "tonal") text = `Now: ${NOTE_NAMES[p.tonal.key]} ${SCALES[p.tonal.scale].name}`;
      else if (audible && GLOBAL_BY_KEY[key]) text = `Now: ${GLOBAL_BY_KEY[key].format(globalValue(key))}`;
      if (key === "blend" && play.target === "duo") text = `Now: rain ${pct(weights.rain ** 2)} · snow ${pct(weights.snow ** 2)}`;
      el.textContent = text;
    }
    // Light the chip that's sounding while cycling or sweeping a list.
    for (const chip of document.querySelectorAll(".pl-chip.is-sounding")) chip.classList.remove("is-sounding");
    if (play.target === "solo" && OUTPUT_BY_KEY[play.key] && OUTPUT_BY_KEY[play.key].kind === "list") {
      const chip = document.querySelector(`[data-chip="${play.key}"][data-index="${p[play.key]}"]`);
      if (chip) chip.classList.add("is-sounding");
    }
    if (play.target === "solo" && play.key === "tonal" && play.variant === "cycle") {
      const chip = document.querySelector(`[data-scale-chip="${play.cycleIndex}"]`);
      if (chip) chip.classList.add("is-sounding");
    }
    const mem = memory.get(`0:${kind}`);
    nowNotes.textContent = mem && mem.midis.length
      ? `${mem.midis.map((m) => midiName(m)).join(" ")} · ${INSTRUMENT_NAMES[p.instrument]}${play.target === "duo" ? ` · ${PROFILE_INFO[kind].label}` : ""}`
      : "";
  }

  // ---------- Events ----------
  function changed({ summary = true } = {}) {
    saveState();
    if (summary) renderMixSummary();
    if (play) nowWhat.textContent = describePlay();
  }

  cardsEl.addEventListener("input", onInput);
  togetherEl.addEventListener("input", onInput);
  cardsEl.addEventListener("change", onChange);
  togetherEl.addEventListener("change", onChange);
  cardsEl.addEventListener("click", onClick);
  togetherEl.addEventListener("click", onClick);

  function onInput(event) {
    const input = event.target;
    const output = input.closest(".slider-control") && input.closest(".slider-control").querySelector("output");
    if (input.dataset.row) {
      const def = OUTPUT_BY_KEY[input.dataset.row];
      editing().rows[input.dataset.row][input.dataset.end] = Number(input.value);
      if (output) output.textContent = def.format(Number(input.value));
      changed();
    } else if (input.dataset.global) {
      const def = GLOBAL_BY_KEY[input.dataset.global];
      state.globals[input.dataset.global] = Number(input.value);
      if (output) output.textContent = def.format(Number(input.value));
      changed();
    }
  }

  function onChange(event) {
    const input = event.target;
    if (input.dataset.mix) {
      state.mix[input.dataset.mix] = input.value;
      changed();
      syncPlaying();
    } else if (input.dataset.listTo) {
      editing().rows[input.dataset.listTo].hi = Number(input.value);
      changed();
    } else if (input.hasAttribute("data-snap")) {
      editing().snap = input.checked;
      changed();
    }
  }

  function selectChip(selector, value) {
    for (const chip of document.querySelectorAll(selector)) {
      const on = chip === value;
      chip.classList.toggle("is-chosen", on);
      chip.setAttribute("aria-pressed", String(on));
    }
  }

  function onClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.solo) {
      toggle({ target: "solo", key: button.dataset.solo, variant: button.dataset.variant });
    } else if (button.hasAttribute("data-duo")) {
      toggle({ target: "duo" });
    } else if (button.dataset.chip) {
      const key = button.dataset.chip;
      editing().rows[key].lo = Number(button.dataset.index);
      selectChip(`[data-chip="${key}"]`, button);
      changed();
      // Hear it: solo the chosen one (or keep playing the mix, which now uses it).
      if (!play || play.target === "solo") startPlay({ target: "solo", key, variant: "on" });
    } else if (button.dataset.keyChip !== undefined) {
      editing().key = Number(button.dataset.keyChip);
      selectChip("[data-key-chip]", button);
      changed();
      if (!play || play.target === "solo") startPlay({ target: "solo", key: "tonal", variant: "on" });
    } else if (button.dataset.scaleChip !== undefined) {
      editing().scale = Number(button.dataset.scaleChip);
      selectChip("[data-scale-chip]", button);
      changed();
      if (!play || play.target === "solo") startPlay({ target: "solo", key: "tonal", variant: "on" });
    } else if (button.hasAttribute("data-strict-off")) {
      setStrict(false);
    }
  }

  function setStrict(on) {
    state.strict = on;
    $("#pl-strict").checked = on;
    syncStrict();
    // Layers are built with or without the detuned chorus, so rebuild them.
    if (ac) {
      for (const layer of drones.values()) retireLayer(layer, ac.currentTime);
      drones.clear();
    }
    changed();
  }

  $("#pl-strict").addEventListener("change", (event) => setStrict(event.target.checked));
  $("#pl-volume").addEventListener("input", (event) => {
    state.globals.volume = Number(event.target.value);
    $("#pl-volume-out").textContent = pct(state.globals.volume);
    applyMix();
    changed({ summary: false });
  });
  $("#pl-profile").addEventListener("change", (event) => {
    state.edit = event.target.value;
    saveState();
    render();
    if (play && ac) for (const mem of memory.values()) mem.strikeKey = "";
  });
  $("#pl-material").addEventListener("change", (event) => {
    state.material = event.target.value;
    saveState();
  });
  stopButton.addEventListener("click", stopPlay);
  playMixButton.addEventListener("click", () => toggle({ target: "mix" }));

  $("#pl-mix-soundlab").addEventListener("click", () => {
    state.mix = soundlabMix(editing());
    render();
    changed();
  });
  $("#pl-mix-none").addEventListener("click", () => {
    for (const key of MIX_KEYS) state.mix[key] = "off";
    render();
    changed();
  });

  // ---------- Candidates ----------
  $("#pl-save").addEventListener("submit", (event) => {
    event.preventDefault();
    const nameInput = $("#pl-save-name");
    const name = nameInput.value.trim() || `Candidate ${String.fromCharCode(65 + (state.candidates.length % 26))}`;
    if (state.candidates.length >= MAX_CANDIDATES) {
      setStatus(`You have ${MAX_CANDIDATES} candidates; delete one to save another.`);
      return;
    }
    state.candidates.push({ name, savedAt: Date.now(), ...snapshot() });
    activeCandidate = state.candidates.length - 1;
    nameInput.value = "";
    saveState();
    renderCandidates();
    syncPlaying();
    setStatus(`Saved “${name}”.`);
  });

  candidatesEl.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.candPlay !== undefined) {
      const i = Number(button.dataset.candPlay);
      if (play && play.target === "mix" && play.candidate === i) {
        stopPlay();
        return;
      }
      loadSnapshot(state.candidates[i]);
      activeCandidate = i;
      saveState();
      render();
      startPlay({ target: "mix", candidate: i });
    } else if (button.dataset.candLoad !== undefined) {
      const i = Number(button.dataset.candLoad);
      loadSnapshot(state.candidates[i]);
      activeCandidate = i;
      saveState();
      render();
      setStatus(`Loaded “${state.candidates[i].name}” into the cards.`);
    } else if (button.dataset.candUpdate !== undefined) {
      const i = Number(button.dataset.candUpdate);
      const c = state.candidates[i];
      state.candidates[i] = { name: c.name, savedAt: Date.now(), ...snapshot() };
      saveState();
      renderCandidates();
      syncPlaying();
      setStatus(`“${c.name}” now holds the current settings.`);
    } else if (button.dataset.candDelete !== undefined) {
      const i = Number(button.dataset.candDelete);
      const [removed] = state.candidates.splice(i, 1);
      if (play && play.candidate !== undefined) {
        if (play.candidate === i) play.candidate = undefined;
        else if (play.candidate > i) play.candidate -= 1;
      }
      if (activeCandidate === i) activeCandidate = -1;
      else if (activeCandidate > i) activeCandidate -= 1;
      saveState();
      renderCandidates();
      syncPlaying();
      setStatus(`Deleted “${removed.name}”.`);
    }
  });

  // ---------- Export ----------
  function choicesText() {
    const lines = ["Gravitunes · Parameter lab choices", ""];
    for (const kind of PROFILE_KEYS) {
      const profile = state.profiles[kind];
      lines.push(`${PROFILE_INFO[kind].label}: ${NOTE_NAMES[profile.key]} ${SCALES[profile.scale].name}${profile.snap ? "" : " (not snapped)"}`);
      for (const output of OUTPUTS) {
        const row = profile.rows[output.key];
        const driver = row.src === "manual" ? "manual" : `${INPUT_LABELS[row.src]}`;
        const range = row.src === "manual" ? output.format(row.lo) : `${output.format(row.lo)} → ${output.format(row.hi)}`;
        lines.push(`  ${output.label}: ${range} (${driver})`);
      }
    }
    lines.push(`Global: ${GLOBALS.map((g) => `${g.label} ${g.format(state.globals[g.key])}`).join(", ")}, strict tuning ${state.strict ? "on" : "off"}`);
    lines.push("", "JSON:", JSON.stringify({ profiles: state.profiles, globals: state.globals, strict: state.strict, mix: state.mix }));
    return lines.join("\n");
  }

  $("#pl-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(choicesText());
      setStatus("Copied a readable summary plus JSON to the clipboard.");
    } catch (error) {
      setStatus("The clipboard isn't available here; the choices are printed in the browser console instead.");
      console.log(choicesText());
    }
  });

  $("#pl-apply").addEventListener("click", () => {
    if (!window.confirm("Replace the Sound lab's rain and snow sounds and global sound with these settings? (What drives each row is kept.)")) return;
    const raw = readSoundLab() || { mode: "storms" };
    raw.version = SOUNDLAB_VERSION;
    raw.profiles = clone(state.profiles);
    raw.globals = { ...(raw.globals || {}), ...clone(state.globals) };
    raw.strict = state.strict;
    try {
      window.localStorage.setItem(SOUNDLAB_KEY, JSON.stringify(raw));
      setStatus("Sent. Reload the Sound lab page (close it first if it's open in another tab) to hear it there.");
    } catch (error) {
      setStatus("Couldn't write to this browser's storage, so the Sound lab wasn't changed.");
    }
  });

  $("#pl-import").addEventListener("click", () => {
    if (!readSoundLab()) {
      setStatus("The Sound lab has no saved settings in this browser yet. Open it once, change something, then try again.");
      return;
    }
    if (!window.confirm("Replace the settings on this page with the Sound lab's current ones? Candidates are kept.")) return;
    importSoundLab(state);
    activeCandidate = -1;
    saveState();
    render();
    setStatus("Loaded the Sound lab's current settings.");
  });

  $("#pl-reset").addEventListener("click", () => {
    if (!window.confirm("Reset every card to the defaults? Candidates are kept.")) return;
    const fresh = defaultState();
    fresh.candidates = state.candidates;
    fresh.edit = state.edit;
    state = fresh;
    activeCandidate = -1;
    saveState();
    render();
    setStatus("Reset to the defaults.");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && play) stopPlay();
  });

  render();

  // Read-only peek for debugging in the browser console.
  window.gravitunesParamLab = {
    get state() { return state; },
    get play() { return play; },
    get memory() { return memory; },
  };
})();
