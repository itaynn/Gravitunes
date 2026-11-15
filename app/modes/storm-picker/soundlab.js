(() => {
  "use strict";

  /* =========================================================================
   * Sound lab: map what the moving precipitation does (position, motion,
   * spin, colour) to what you hear (pitch, amplitude, overtones, instrument,
   * chord, note rate, ...). Everything is adjustable live.
   * ====================================================================== */

  // ---------- Source video geometry ----------
  const SRC_MAP_W = 1920;
  const SRC_MAP_H = 960; // the map is the top 1920 × 960 of the video; the legend sits below
  const CW = 480; // colour classification grid
  const CH = 240;
  const FW = 240; // precipitation field (1 px ≈ 1.5°)
  const FH = 120;
  const CELL = 8; // motion cell size in field pixels
  const GW = FW / CELL;
  const GH = FH / CELL;
  const FLOW_LAG = 4; // compare frames this many video frames apart (≈ 2 h of data)
  const BG_DIFF = 54; // min colour difference from the static map to count as precipitation
  const EIG_MIN = 0.0004; // min texture needed to trust a motion estimate
  const MAX_VOICES = 8;
  const LOOKAHEAD = 0.12;
  const TICK_MS = 25;
  const STORAGE_KEY = "gravitunes-storm-picker-lab-v1"; // this page keeps its own settings, apart from the Sound lab

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const VOICE_COLORS = ["#c9ef74", "#42c8ee", "#ff8a5c", "#c58bff", "#ffd84a", "#5cf0b0", "#ff5c9a", "#9fb4ff"];

  // Legend colours read from the NASA video (light → heavy).
  const LIQUID = [[0, 108, 24], [0, 119, 83], [0, 151, 52], [93, 185, 6], [184, 213, 12], [255, 235, 12], [254, 189, 5], [255, 148, 4], [255, 29, 0], [203, 21, 0]];
  const FROZEN = [[65, 235, 255], [67, 205, 252], [75, 180, 253], [76, 152, 252], [80, 124, 250], [81, 101, 247], [82, 84, 249], [88, 65, 212], [115, 52, 184], [143, 43, 154]];

  // ---------- Music theory ----------
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

  // steps = scale steps when snapping to a scale; semis = semitones otherwise.
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

  // "Flowing" = continuous: sustained instruments hold one gliding tone that follows the map;
  // struck instruments ring again whenever the voice moves onto a new note.
  const RHYTHMS = [
    { name: "Flowing", steps: 0, flow: true },
    { name: "Every 2 bars", steps: 32 },
    { name: "Whole", steps: 16 },
    { name: "Half", steps: 8 },
    { name: "Quarter", steps: 4 },
    { name: "Eighth", steps: 2 },
    { name: "Sixteenth", steps: 1 },
  ];
  const STATE_VERSION = 4; // v2 added "Flowing" as rhythm 0; v3 Storm Watch + strict tuning; v4 video is the default again

  const INSTRUMENT_NAMES = [
    "Soft pad", "Choir", "Strings", "Organ", "Pluck", "Marimba", "Bell", "Pure tone", "Glockenspiel", "Harp",
    "Flute", "Clarinet", "Cello", "Brass", "Synth lead", "Glass harmonica", "Wind", "Vibraphone", "Kalimba",
    "Electric piano", "Music box",
  ];
  const INST = Object.fromEntries(INSTRUMENT_NAMES.map((name, i) => [name, i]));
  const ORGAN = INST.Organ;
  const GLOCKENSPIEL = INST.Glockenspiel;
  const HARP = INST.Harp;

  // Rain and snow each get their own sound profile (scale, instrument, ranges...).
  // Colors follow the NASA legend: rain is green → red, snow is cyan → purple.
  const PROFILE_KEYS = ["rain", "snow"];
  const PROFILE_INFO = {
    rain: { label: "Rain", color: "#9be15d", rgb: [155, 225, 93] },
    snow: { label: "Snow", color: "#6fd3ff", rgb: [111, 211, 255] },
  };
  const BANDS = 24; // latitude bands in "Whole map" mode

  // Storm Watch: the tracked storms from Itay's storm tracker (storm-tracker/ on the "clustering"
  // branch): outlines, IDs, merges and splits for 48 half-hourly IMERG snapshots of 7 Nov 2026.
  // Copied to data/storm-watch with ":" → "-" in the snapshot names, because Windows can't store ":".
  const TRACK_DATA = "data/storm-watch/preprocessed-tracks.json";
  const trackSnapshotUrl = (time) => `data/storm-watch/snapshots/imergert_alpha.2026-11-07T${time.replace(":", "-")}-00Z.png`;
  const TW = 900; // Storm Watch analysis grid (its polygons and cores use these pixels)
  const TH = 450;
  // The 20 exact colors in the IMERG snapshots, light → heavy.
  const SNAP_RAIN = [[0, 129, 20], [0, 139, 82], [0, 179, 48], [96, 211, 0], [180, 231, 0], [255, 251, 0], [255, 196, 0], [255, 147, 0], [255, 0, 0], [200, 0, 0], [145, 0, 0]];
  const SNAP_SNOW = [[69, 255, 255], [73, 221, 255], [77, 187, 255], [79, 154, 255], [81, 122, 255], [82, 93, 255], [83, 70, 255], [90, 47, 217], [115, 33, 187]];

  // ---------- Inputs (what the map does) ----------
  const INPUTS = [
    { key: "manual", label: "Manual", detail: "your slider", signed: false },
    { key: "x", label: "X", detail: "west → east", signed: false },
    { key: "y", label: "Y", detail: "south → north", signed: false },
    { key: "vx", label: "X speed", detail: "← west · east →", signed: true },
    { key: "vy", label: "Y speed", detail: "↓ south · north ↑", signed: true },
    { key: "spin", label: "Spin (rotor)", detail: "↻ cw · ccw ↺", signed: true },
    { key: "div", label: "Spread (divergence)", detail: "→← gathering · spreading ←→", signed: true },
    { key: "color", label: "Color", detail: "light → heavy", signed: false },
    { key: "size", label: "Size", detail: "small → large", signed: false },
    { key: "snow", label: "Rain/Snow", detail: "rain → snow", signed: false },
  ];
  const INPUT_KEYS = INPUTS.map((input) => input.key);

  const CURVES = [
    { key: "up", label: "↗ Normal" },
    { key: "down", label: "↘ Inverted" },
    { key: "size", label: "⇔ Strength (ignore ±)" },
    { key: "calm", label: "⇄ Calmness" },
  ];

  const pct = (v) => `${Math.round(v * 100)}%`;
  const panFormat = (v) => (Math.abs(v) < 0.05 ? "center" : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`);

  // ---------- Outputs (what you hear) ----------
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
    pan: { src: "x", curve: "up", lo: -1, hi: 1 },
    vibrato: { src: "manual", curve: "up", lo: 0.2, hi: 0.8 },
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function defaultProfile(kind) {
    const rows = clone(DEFAULT_ROWS);
    if (kind === "snow") {
      // Snow: higher, sparkly, a brighter scale.
      Object.assign(rows.pitch, { lo: 62, hi: 91 });
      Object.assign(rows.instrument, { lo: GLOCKENSPIEL });
      Object.assign(rows.chord, { lo: 1 });
      Object.assign(rows.length, { lo: 0.45 });
      Object.assign(rows.vibrato, { lo: 0 });
      return { key: 0, scale: 5, snap: true, rows };
    }
    Object.assign(rows.instrument, { lo: ORGAN });
    return { key: 0, scale: 0, snap: true, rows };
  }

  const GLOBALS = [
    { key: "voices", label: "Voices", min: 1, max: 8, step: 1, value: 4, format: (v) => `${v}`, scale: ["1", "8"] },
    { key: "bpm", label: "Tempo", min: 40, max: 180, step: 1, value: 88, format: (v) => `${v} BPM`, scale: ["SLOW", "FAST"] },
    { key: "mapSpeed", label: "Map speed", min: 0.1, max: 2, step: 0.05, value: 0.5, format: (v) => `${v.toFixed(2)}×`, scale: ["0.1×", "2×"] },
    { key: "scanSeconds", label: "Scan line pass", min: 5, max: 120, step: 1, value: 30, format: (v) => `${v} s`, scale: ["5 S", "120 S"] },
    { key: "threshold", label: "Color threshold", min: 0.02, max: 0.6, step: 0.01, value: 0.12, format: pct, scale: ["ANY RAIN", "HEAVY ONLY"] },
    { key: "glide", label: "Pitch glide", min: 0, max: 1, step: 0.01, value: 0.4, format: pct, scale: ["STEPS", "SLIDES"] },
    { key: "blend", label: "Rain ↔ snow blend", min: 0, max: 1, step: 0.01, value: 0.75, format: pct, scale: ["SWITCH", "GRADUAL"] },
    { key: "reverb", label: "Reverb", min: 0, max: 1, step: 0.01, value: 0.35, format: pct, scale: ["DRY", "HALL"] },
    { key: "volume", label: "Volume", min: 0, max: 1, step: 0.01, value: 0.7, format: pct, scale: ["0", "MAX"] },
    { key: "spread", label: "Left ↔ right clarity", min: 0, max: 1, step: 0.01, value: 0.8, format: pct, scale: ["PLAIN STEREO", "VERY CLEAR"] },
    { key: "spinVib", label: "Spin → vibrato", min: 0, max: 1, step: 0.01, value: 1, format: pct, scale: ["OFF", "FULL"] },
    { key: "divTones", label: "Spread → over/undertones", min: 0, max: 1.5, step: 0.01, value: 1, format: pct, scale: ["OFF", "STRONG"] },
    { key: "weather", label: "Storm sounds while picking", min: 0, max: 1.5, step: 0.01, value: 1, format: pct, scale: ["OFF", "LOUD"] },
    { key: "guide", label: "Cursor tone while picking", min: 0, max: 1.5, step: 0.01, value: 1, format: pct, scale: ["OFF", "LOUD"] },
  ];

  const PRESETS = [
    // Storm Watch: each tracked storm is one voice. Where it is sets the note, how big it is sets
    // how loud and how full the chord is, how heavy it is sets the brightness.
    {
      name: "Storm Watch: organ rain, glockenspiel snow",
      mode: "tracked",
      profiles: {
        rain: { scale: 0, rows: {
          pitch: { src: "y", curve: "up", lo: 43, hi: 79 },
          amp: { src: "size", curve: "up", lo: 0.3, hi: 1 },
          overtones: { src: "color", curve: "up", lo: 0.1, hi: 0.8 },
          instrument: { src: "manual", lo: ORGAN },
          chord: { src: "size", curve: "up", lo: 0, hi: 3 },
          rhythm: { src: "manual", lo: 0 },
          length: { src: "manual", lo: 0.8 },
          pan: { src: "x", curve: "up", lo: -0.85, hi: 0.85 },
          vibrato: { src: "manual", lo: 0 },
        } },
        snow: { scale: 0, rows: {
          pitch: { src: "y", curve: "up", lo: 62, hi: 91 },
          amp: { src: "size", curve: "up", lo: 0.35, hi: 1 },
          overtones: { src: "color", curve: "up", lo: 0.2, hi: 0.9 },
          instrument: { src: "manual", lo: GLOCKENSPIEL },
          chord: { src: "size", curve: "up", lo: 0, hi: 1 },
          rhythm: { src: "manual", lo: 4 },
          length: { src: "manual", lo: 0.6 },
          pan: { src: "x", curve: "up", lo: -0.85, hi: 0.85 },
          vibrato: { src: "manual", lo: 0 },
        } },
      },
    },
    {
      name: "Storm Watch: harp rain, vibraphone snow",
      mode: "tracked",
      profiles: {
        rain: { scale: 2, rows: {
          pitch: { src: "y", curve: "up", lo: 40, hi: 76 },
          amp: { src: "size", curve: "up", lo: 0.35, hi: 1 },
          overtones: { src: "color", curve: "up", lo: 0.15, hi: 0.8 },
          instrument: { src: "manual", lo: HARP },
          chord: { src: "size", curve: "up", lo: 0, hi: 3 },
          rhythm: { src: "vx", curve: "size", lo: 3, hi: 5 },
          length: { src: "manual", lo: 0.7 },
          pan: { src: "x", curve: "up", lo: -0.85, hi: 0.85 },
          vibrato: { src: "manual", lo: 0 },
        } },
        snow: { scale: 2, rows: {
          pitch: { src: "y", curve: "up", lo: 60, hi: 88 },
          amp: { src: "size", curve: "up", lo: 0.35, hi: 1 },
          overtones: { src: "color", curve: "up", lo: 0.2, hi: 0.8 },
          instrument: { src: "manual", lo: INST.Vibraphone },
          chord: { src: "manual", lo: 0 },
          rhythm: { src: "manual", lo: 3 },
          length: { src: "manual", lo: 0.7 },
          pan: { src: "x", curve: "up", lo: -0.85, hi: 0.85 },
          vibrato: { src: "manual", lo: 0 },
        } },
      },
    },
    { name: "Storm choir", mode: "storms", rows: {} },
    {
      name: "Fast storms ring",
      mode: "storms",
      rows: {
        pitch: { src: "color", curve: "up", lo: 52, hi: 84 },
        overtones: { src: "vx", curve: "size", lo: 0.1, hi: 1 },
        instrument: { src: "manual", lo: 6, hi: 6 },
        chord: { src: "spin", curve: "size", lo: 0, hi: 4 },
        rhythm: { src: "vx", curve: "size", lo: 2, hi: 6 },
        length: { src: "manual", lo: 0.5, hi: 1 },
        vibrato: { src: "manual", lo: 0, hi: 0.5 },
      },
    },
    {
      name: "Scanning pluck",
      mode: "scan",
      rows: {
        pitch: { src: "y", curve: "up", lo: 40, hi: 88 },
        overtones: { src: "color", curve: "up", lo: 0.1, hi: 0.9 },
        instrument: { src: "manual", lo: 4, hi: 4 },
        chord: { src: "manual", lo: 0, hi: 3 },
        rhythm: { src: "manual", lo: 5, hi: 6 },
        length: { src: "manual", lo: 0.35, hi: 1 },
        pan: { src: "vx", curve: "up", lo: -0.9, hi: 0.9 },
        vibrato: { src: "manual", lo: 0, hi: 0.5 },
      },
    },
    {
      name: "Spiral organ",
      mode: "storms",
      rows: {
        pitch: { src: "spin", curve: "up", lo: 48, hi: 72 },
        overtones: { src: "vy", curve: "size", lo: 0.1, hi: 0.9 },
        instrument: { src: "manual", lo: 3, hi: 3 },
        chord: { src: "color", curve: "up", lo: 0, hi: 6 },
        rhythm: { src: "manual", lo: 0, hi: 6 },
        length: { src: "manual", lo: 0.8, hi: 1 },
        vibrato: { src: "spin", curve: "size", lo: 0, hi: 0.6 },
      },
    },
    {
      name: "Glockenspiel sparkle",
      mode: "storms",
      scale: 5,
      rows: {
        pitch: { src: "y", curve: "up", lo: 62, hi: 91 },
        overtones: { src: "color", curve: "up", lo: 0.2, hi: 1 },
        instrument: { src: "manual", lo: GLOCKENSPIEL, hi: GLOCKENSPIEL },
        chord: { src: "manual", lo: 1, hi: 3 },
        rhythm: { src: "vx", curve: "size", lo: 4, hi: 6 },
        length: { src: "manual", lo: 0.45, hi: 1 },
        vibrato: { src: "manual", lo: 0, hi: 0.5 },
      },
    },
    {
      name: "Harp arpeggios",
      mode: "scan",
      scale: 2,
      rows: {
        pitch: { src: "y", curve: "up", lo: 40, hi: 84 },
        overtones: { src: "color", curve: "up", lo: 0.15, hi: 0.8 },
        instrument: { src: "manual", lo: HARP, hi: HARP },
        chord: { src: "spin", curve: "size", lo: 3, hi: 6 },
        rhythm: { src: "manual", lo: 5, hi: 6 },
        length: { src: "manual", lo: 0.7, hi: 1 },
        vibrato: { src: "manual", lo: 0, hi: 0.5 },
      },
    },
    {
      name: "Slow organ chords",
      mode: "storms",
      rows: {
        pitch: { src: "y", curve: "up", lo: 40, hi: 72 },
        overtones: { src: "color", curve: "up", lo: 0.1, hi: 0.8 },
        instrument: { src: "manual", lo: ORGAN, hi: ORGAN },
        chord: { src: "manual", lo: 5, hi: 6 },
        rhythm: { src: "manual", lo: 2, hi: 6 },
        length: { src: "manual", lo: 0.95, hi: 1 },
        vibrato: { src: "manual", lo: 0.1, hi: 0.5 },
      },
    },
    // The presets below set BOTH sounds, so you can hear rain melt into snow.
    {
      name: "Whole map: organ rain, glass snow",
      mode: "map",
      profiles: {
        rain: { scale: 0, rows: {
          pitch: { src: "y", curve: "up", lo: 40, hi: 79 },
          amp: { src: "color", curve: "up", lo: 0.2, hi: 1 },
          overtones: { src: "color", curve: "up", lo: 0.05, hi: 0.7 },
          instrument: { src: "manual", lo: ORGAN },
          chord: { src: "manual", lo: 0 },
          pan: { src: "x", curve: "up", lo: -0.9, hi: 0.9 },
          vibrato: { src: "spin", curve: "size", lo: 0, hi: 0.5 },
        } },
        snow: { scale: 5, rows: {
          pitch: { src: "y", curve: "up", lo: 55, hi: 94 },
          amp: { src: "color", curve: "up", lo: 0.25, hi: 1 },
          overtones: { src: "color", curve: "up", lo: 0.2, hi: 0.9 },
          instrument: { src: "manual", lo: INST["Glass harmonica"] },
          chord: { src: "manual", lo: 0 },
          pan: { src: "x", curve: "up", lo: -0.9, hi: 0.9 },
          vibrato: { src: "manual", lo: 0 },
        } },
      },
    },
    {
      name: "Rain flute, snow glass",
      mode: "storms",
      profiles: {
        rain: { scale: 1, rows: {
          pitch: { src: "y", curve: "up", lo: 55, hi: 86 },
          instrument: { src: "manual", lo: INST.Flute },
          chord: { src: "manual", lo: 0 },
          vibrato: { src: "spin", curve: "size", lo: 0.1, hi: 0.7 },
        } },
        snow: { scale: 5, rows: {
          pitch: { src: "y", curve: "up", lo: 62, hi: 93 },
          instrument: { src: "manual", lo: INST["Glass harmonica"] },
          chord: { src: "manual", lo: 1 },
          vibrato: { src: "manual", lo: 0 },
        } },
      },
    },
    {
      name: "Cello rain, music-box snow",
      mode: "storms",
      profiles: {
        rain: { scale: 3, rows: {
          pitch: { src: "y", curve: "up", lo: 36, hi: 64 },
          instrument: { src: "manual", lo: INST.Cello },
          chord: { src: "manual", lo: 2 },
          overtones: { src: "vx", curve: "size", lo: 0.1, hi: 0.8 },
        } },
        snow: { scale: 3, rows: {
          pitch: { src: "y", curve: "up", lo: 67, hi: 96 },
          instrument: { src: "manual", lo: INST["Music box"] },
          chord: { src: "manual", lo: 0 },
          length: { src: "manual", lo: 0.5 },
        } },
      },
    },
    {
      name: "Wind rain, vibraphone snow",
      mode: "storms",
      profiles: {
        rain: { scale: 4, rows: {
          pitch: { src: "y", curve: "up", lo: 45, hi: 84 },
          amp: { src: "color", curve: "up", lo: 0.3, hi: 1 },
          instrument: { src: "manual", lo: INST.Wind },
          chord: { src: "manual", lo: 2 },
          overtones: { src: "spin", curve: "size", lo: 0.1, hi: 0.9 },
        } },
        snow: { scale: 4, rows: {
          pitch: { src: "y", curve: "up", lo: 60, hi: 90 },
          instrument: { src: "manual", lo: INST.Vibraphone },
          chord: { src: "manual", lo: 3 },
          length: { src: "manual", lo: 0.7 },
        } },
      },
    },
    {
      name: "Free play (all manual)",
      mode: "probes",
      rows: Object.fromEntries(OUTPUTS.map((o) => [o.key, { src: "manual" }])),
    },
  ];

  // ---------- Elements ----------
  const $ = (selector) => document.querySelector(selector);
  const video = $("#lab-video");
  const canvas = $("#lab-canvas");
  const ctx2d = canvas.getContext("2d");
  const playButton = $("#lab-play");
  const playLabel = $("#lab-play-label");
  const stopButton = $("#lab-stop");
  const statusEl = $("#lab-status");
  const presetSelect = $("#lab-preset");
  const randomButton = $("#lab-random");
  const copyButton = $("#lab-copy");
  const resetButton = $("#lab-reset");
  const clearProbesButton = $("#lab-clear-probes");
  const restartButton = $("#lab-restart");
  const matrixTable = $("#lab-matrix");
  const voicesBody = $("#lab-voices-body");
  const globalsPanel = $("#lab-globals");
  const profileBar = $("#lab-profile-bar");
  const tableWrap = $("#lab-matrix-wrap");
  const modeInputs = document.querySelectorAll('input[name="lab-mode"]');
  const timeLabel = $("#lab-time");
  const stage = $(".lab-stage");
  const sourceLabel = $("#lab-source");
  let videoReady = false; // the video's static background is learned and its frames are being analyzed

  // ---------- Small helpers ----------
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapX = (x) => ((x % FW) + FW) % FW;
  const wrapDx = (dx) => (dx > FW / 2 ? dx - FW : dx < -FW / 2 ? dx + FW : dx);
  const signedNorm = (value, scale) => 0.5 + 0.5 * Math.tanh(value / (scale * 1.5));

  function midiName(m) {
    const n = Math.round(m);
    return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
  }

  function setStatus(message) {
    statusEl.textContent = message;
  }

  // =========================================================================
  // State
  // =========================================================================
  const MODES = ["picker", "tracked", "storms", "scan", "probes", "map"];
  function defaultState() {
    return {
      version: STATE_VERSION,
      mode: "picker", // Storm picker: hover the first frame, pick spots, Space plays
      strict: true, // every note exactly on the scale, and note changes land on the beat
      drift: true,
      arrows: true,
      grid: true,
      labels: true,
      solo: 0,
      edit: "rain",
      globals: Object.fromEntries(GLOBALS.map((g) => [g.key, g.value])),
      profiles: { rain: defaultProfile("rain"), snow: defaultProfile("snow") },
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
      if (INPUT_KEYS.includes(r.src)) row.src = r.src;
      if (CURVES.some((c) => c.key === r.curve)) row.curve = r.curve;
      if (Number.isFinite(Number(r.lo))) row.lo = clamp(Number(r.lo), o.min, o.max);
      if (Number.isFinite(Number(r.hi))) row.hi = clamp(Number(r.hi), o.min, o.max);
      if (legacy && o.key === "rhythm") {
        // Older saves had no "Flowing" option: shift the indexes and make fixed rhythms flow.
        if (row.src === "manual") row.lo = 0;
        else {
          row.lo = Math.min(o.max, row.lo + 1);
          row.hi = Math.min(o.max, row.hi + 1);
        }
      }
    }
    return base;
  }

  function sanitizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    const legacy = !(Number(raw.version) >= 2);
    // Older saves keep their sounds but open on the moving video (Follow storms), in strict tuning.
    if (MODES.includes(raw.mode) && Number(raw.version) >= 4) base.mode = raw.mode;
    if (typeof raw.strict === "boolean" && Number(raw.version) >= 3) base.strict = raw.strict;
    if (PROFILE_KEYS.includes(raw.edit)) base.edit = raw.edit;
    if (typeof raw.drift === "boolean") base.drift = raw.drift;
    if (typeof raw.arrows === "boolean") base.arrows = raw.arrows;
    if (typeof raw.grid === "boolean") base.grid = raw.grid;
    if (typeof raw.labels === "boolean") base.labels = raw.labels;
    if (Number.isInteger(raw.solo) && raw.solo >= 0 && raw.solo <= MAX_VOICES) base.solo = raw.solo;
    for (const g of GLOBALS) {
      const v = raw.globals && Number(raw.globals[g.key]);
      if (Number.isFinite(v)) base.globals[g.key] = clamp(v, g.min, g.max);
    }
    if (raw.profiles) {
      for (const kind of PROFILE_KEYS) base.profiles[kind] = sanitizeProfile(raw.profiles[kind], base.profiles[kind], legacy);
    } else if (raw.rows) {
      // Settings saved before rain/snow profiles existed become the rain profile.
      base.profiles.rain = sanitizeProfile(raw, base.profiles.rain, legacy);
    }
    return base;
  }

  const editing = () => state.profiles[state.edit];

  function loadState() {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) return sanitizeState(JSON.parse(saved));
    } catch (error) {
      /* storage unavailable: use defaults */
    }
    return defaultState();
  }

  let saveTimer = 0;
  function saveState() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (error) {
        /* storage unavailable: settings simply aren't remembered */
      }
    }, 250);
  }

  let state = loadState();
  state.mode = "picker"; // this page is only the Storm picker (the other modes stay in the Sound lab)

  // =========================================================================
  // Precipitation field analysis
  // =========================================================================
  const LUT_LEVEL = new Uint8Array(32768);
  const LUT_SNOW = new Uint8Array(32768);
  (function buildColorLookup() {
    const entries = [];
    LIQUID.forEach((c, i) => entries.push({ c, level: 0.1 + (0.9 * i) / (LIQUID.length - 1), snow: 0 }));
    FROZEN.forEach((c, i) => entries.push({ c, level: 0.1 + (0.9 * i) / (FROZEN.length - 1), snow: 1 }));
    for (let r = 0; r < 32; r += 1) {
      for (let g = 0; g < 32; g += 1) {
        for (let b = 0; b < 32; b += 1) {
          const R = r * 8 + 4;
          const G = g * 8 + 4;
          const B = b * 8 + 4;
          let best = Infinity;
          let hit = null;
          for (const e of entries) {
            const d = (R - e.c[0]) ** 2 + (G - e.c[1]) ** 2 + (B - e.c[2]) ** 2;
            if (d < best) {
              best = d;
              hit = e;
            }
          }
          if (best < 52 * 52) {
            const index = (r << 10) | (g << 5) | b;
            LUT_LEVEL[index] = Math.max(1, Math.round(hit.level * 255));
            LUT_SNOW[index] = hit.snow;
          }
        }
      }
    }
  })();

  const classCanvas = document.createElement("canvas");
  classCanvas.width = CW;
  classCanvas.height = CH;
  const classCtx = classCanvas.getContext("2d", { willReadFrequently: true });

  let background = null;
  const fieldI = new Float32Array(FW * FH); // precipitation intensity 0..1
  const fieldS = new Float32Array(FW * FH); // snow fraction 0..1
  const blurScratch = new Float32Array(FW * FH);
  const blurA = new Float32Array(FW * FH);
  const ring = Array.from({ length: FLOW_LAG + 1 }, () => ({ t: 0, data: new Float32Array(FW * FH) }));
  let ringHead = 0;
  let ringCount = 0;
  let latestBlur = ring[0].data;
  let lastAnalyzedTime = -1;
  let fieldReady = false;

  const rawU = new Float32Array(GW * GH);
  const rawV = new Float32Array(GW * GH);
  const rawOK = new Uint8Array(GW * GH);
  const cellU = new Float32Array(GW * GH);
  const cellV = new Float32Array(GW * GH);
  const cellSpin = new Float32Array(GW * GH);
  const cellDiv = new Float32Array(GW * GH); // divergence: + spreading out, - gathering in
  const cellMass = new Float32Array(GW * GH);
  let speedScale = 0.5;
  let spinScale = 0.05;
  let divScale = 0.05;

  function seekTo(time) {
    return new Promise((resolve) => {
      const done = () => {
        video.removeEventListener("seeked", done);
        resolve();
      };
      video.addEventListener("seeked", done);
      video.currentTime = time;
    });
  }

  async function learnBackground() {
    const frames = 9;
    const stack = [];
    let missed = 0;
    for (let k = 0; k < frames; k += 1) {
      const target = ((k + 0.5) / frames) * video.duration;
      await seekTo(target);
      // A server that can't jump inside the video (no byte ranges) leaves it on the first frame. Learning the
      // "background" from copies of one frame would erase every storm on that frame, so notice it and skip it.
      if (Math.abs(video.currentTime - target) > 0.5) missed += 1;
      classCtx.drawImage(video, 0, 0, SRC_MAP_W, SRC_MAP_H, 0, 0, CW, CH);
      stack.push(classCtx.getImageData(0, 0, CW, CH).data.slice());
      setStatus(`Learning the static map so only rain and snow count… ${k + 1}/${frames}`);
    }
    // Also catch frames that came back identical (the seek "worked" but no new picture was decoded).
    let same = 0;
    for (let k = 1; k < frames; k += 1) {
      let diff = 0;
      for (let i = 0; i < stack[0].length; i += 64) diff += Math.abs(stack[k][i] - stack[0][i]);
      if (diff / (stack[0].length / 64) < 0.5) same += 1;
    }
    if (missed > frames / 3 || same > frames / 3) {
      background = null;
      console.warn(`Sound lab: the video could not be stepped through (missed ${missed}, identical ${same}); reading colors without a learned background.`);
      return;
    }
    const bg = new Uint8Array(CW * CH * 3);
    const values = new Uint8Array(frames);
    for (let i = 0; i < CW * CH; i += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        for (let k = 0; k < frames; k += 1) values[k] = stack[k][i * 4 + ch];
        values.sort();
        bg[i * 3 + ch] = values[frames >> 1];
      }
    }
    background = bg;
  }

  function sampleField() {
    classCtx.drawImage(video, 0, 0, SRC_MAP_W, SRC_MAP_H, 0, 0, CW, CH);
    const px = classCtx.getImageData(0, 0, CW, CH).data;
    fieldI.fill(0);
    fieldS.fill(0);
    for (let y = 0; y < CH; y += 1) {
      for (let x = 0; x < CW; x += 1) {
        const i = y * CW + x;
        const p = i * 4;
        const r = px[p];
        const g = px[p + 1];
        const b = px[p + 2];
        if (background) {
          const q = i * 3;
          if (Math.abs(r - background[q]) + Math.abs(g - background[q + 1]) + Math.abs(b - background[q + 2]) < BG_DIFF) continue;
        }
        const lut = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        const level = LUT_LEVEL[lut];
        if (!level) continue;
        const f = (y >> 1) * FW + (x >> 1);
        const value = (level / 255) * 0.25;
        fieldI[f] += value;
        if (LUT_SNOW[lut]) fieldS[f] += value;
      }
    }
    for (let f = 0; f < FW * FH; f += 1) {
      fieldS[f] = fieldI[f] > 0 ? fieldS[f] / fieldI[f] : 0;
    }
  }

  function blur(src, dst) {
    for (let y = 0; y < FH; y += 1) {
      const row = y * FW;
      for (let x = 0; x < FW; x += 1) {
        const xl = x === 0 ? FW - 1 : x - 1;
        const xr = x === FW - 1 ? 0 : x + 1;
        blurScratch[row + x] = (src[row + xl] + 2 * src[row + x] + src[row + xr]) * 0.25;
      }
    }
    for (let y = 0; y < FH; y += 1) {
      const yu = y === 0 ? 0 : y - 1;
      const yd = y === FH - 1 ? FH - 1 : y + 1;
      for (let x = 0; x < FW; x += 1) {
        dst[y * FW + x] = (blurScratch[yu * FW + x] + 2 * blurScratch[y * FW + x] + blurScratch[yd * FW + x]) * 0.25;
      }
    }
  }

  function computeFlow(prev, now, dt) {
    for (let gy = 0; gy < GH; gy += 1) {
      const y0 = Math.max(1, gy * CELL - 4);
      const y1 = Math.min(FH - 2, gy * CELL + CELL + 3);
      for (let gx = 0; gx < GW; gx += 1) {
        let sxx = 0;
        let sxy = 0;
        let syy = 0;
        let sxt = 0;
        let syt = 0;
        let mass = 0;
        let n = 0;
        for (let y = y0; y <= y1; y += 1) {
          const row = y * FW;
          for (let k = -4; k < CELL + 4; k += 1) {
            const x = wrapX(gx * CELL + k);
            const xl = x === 0 ? FW - 1 : x - 1;
            const xr = x === FW - 1 ? 0 : x + 1;
            const i = row + x;
            const ix = (prev[row + xr] + now[row + xr] - prev[row + xl] - now[row + xl]) * 0.25;
            const iy = (prev[i + FW] + now[i + FW] - prev[i - FW] - now[i - FW]) * 0.25;
            const it = now[i] - prev[i];
            sxx += ix * ix;
            sxy += ix * iy;
            syy += iy * iy;
            sxt += ix * it;
            syt += iy * it;
            mass += now[i];
            n += 1;
          }
        }
        const c = gy * GW + gx;
        cellMass[c] = mass / n;
        const trace = sxx + syy;
        const det = sxx * syy - sxy * sxy;
        const minEig = 0.5 * (trace - Math.sqrt(Math.max(0, trace * trace - 4 * det)));
        if (cellMass[c] < 0.012 || minEig < EIG_MIN || det <= 1e-12) {
          rawOK[c] = 0;
          continue;
        }
        const u = clamp((-syy * sxt + sxy * syt) / det, -3, 3);
        const v = clamp((sxy * sxt - sxx * syt) / det, -3, 3);
        rawU[c] = u / dt;
        rawV[c] = v / dt;
        rawOK[c] = 1;
      }
    }

    // Spatial smoothing + temporal easing.
    const alpha = 0.3;
    for (let gy = 0; gy < GH; gy += 1) {
      for (let gx = 0; gx < GW; gx += 1) {
        let su = 0;
        let sv = 0;
        let w = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          const yy = gy + oy;
          if (yy < 0 || yy >= GH) continue;
          for (let ox = -1; ox <= 1; ox += 1) {
            const xx = (gx + ox + GW) % GW;
            const c = yy * GW + xx;
            if (!rawOK[c]) continue;
            const weight = ox === 0 && oy === 0 ? 2 : 1;
            su += rawU[c] * weight;
            sv += rawV[c] * weight;
            w += weight;
          }
        }
        const c = gy * GW + gx;
        if (w > 0) {
          cellU[c] = lerp(cellU[c], su / w, alpha);
          cellV[c] = lerp(cellV[c], sv / w, alpha);
        } else {
          cellU[c] *= 0.9;
          cellV[c] *= 0.9;
        }
      }
    }

    // Spin (vorticity): positive = counter-clockwise on the map.
    for (let gy = 0; gy < GH; gy += 1) {
      const yu = Math.max(0, gy - 1);
      const yd = Math.min(GH - 1, gy + 1);
      for (let gx = 0; gx < GW; gx += 1) {
        const xl = (gx - 1 + GW) % GW;
        const xr = (gx + 1) % GW;
        const dvdx = (cellV[gy * GW + xr] - cellV[gy * GW + xl]) / 2;
        const dudy = (cellU[yd * GW + gx] - cellU[yu * GW + gx]) / (yd - yu || 1);
        cellSpin[gy * GW + gx] = -dvdx + dudy;
        // Divergence (spread): + where the motion spreads out from here, - where it gathers in.
        const dudx = (cellU[gy * GW + xr] - cellU[gy * GW + xl]) / 2;
        const dvdy = (cellV[yd * GW + gx] - cellV[yu * GW + gx]) / (yd - yu || 1);
        cellDiv[gy * GW + gx] = dudx + dvdy;
      }
    }

    // Adaptive scales so "fast", "spinning hard" and "spreading fast" stay meaningful.
    const speeds = [];
    const spins = [];
    const divs = [];
    for (let c = 0; c < GW * GH; c += 1) {
      if (cellMass[c] < 0.02) continue;
      speeds.push(Math.abs(cellU[c]), Math.abs(cellV[c]));
      spins.push(Math.abs(cellSpin[c]));
      divs.push(Math.abs(cellDiv[c]));
    }
    if (speeds.length > 8) {
      speeds.sort((a, b) => a - b);
      spins.sort((a, b) => a - b);
      divs.sort((a, b) => a - b);
      const p80 = speeds[Math.floor(speeds.length * 0.8)];
      const s80 = spins[Math.floor(spins.length * 0.8)];
      const d80 = divs[Math.floor(divs.length * 0.8)];
      speedScale = lerp(speedScale, Math.max(p80, 1e-3), 0.1);
      spinScale = lerp(spinScale, Math.max(s80, 1e-4), 0.1);
      divScale = lerp(divScale, Math.max(d80, 1e-4), 0.1);
    }
  }

  function analyzeFrame(mediaTime) {
    if (mediaTime === lastAnalyzedTime) return;
    if (mediaTime < lastAnalyzedTime) ringCount = 0; // looped back to the start
    lastAnalyzedTime = mediaTime;
    try {
      sampleField();
    } catch (error) {
      setStatus("The video pixels could not be read. Serve the site over localhost (see README) and reload.");
      console.error("Sound lab could not sample the video:", error);
      return;
    }
    const entry = ring[ringHead];
    blur(fieldI, blurA);
    blur(blurA, entry.data);
    entry.t = mediaTime;
    latestBlur = entry.data;
    if (ringCount >= FLOW_LAG) {
      const prev = ring[(ringHead - FLOW_LAG + ring.length) % ring.length];
      const dt = mediaTime - prev.t;
      if (dt > 0 && dt < 2) {
        computeFlow(prev.data, entry.data, dt);
        updateRingScales();
      }
    }
    ringHead = (ringHead + 1) % ring.length;
    ringCount = Math.min(ringCount + 1, ring.length);
    fieldReady = true;
  }

  // =========================================================================
  // Voices: the points on the map that make sound
  // =========================================================================
  let voices = [];
  let probes = [];
  let scanPhase = 0;
  const scanPool = [];

  let nextVoiceId = 1;
  function makeVoice(slot, fx, fy) {
    return {
      id: nextVoiceId++,
      slot,
      fx,
      fy,
      active: true,
      weight: 1, // extra loudness factor (whole-map bands: how much of the band is covered)
      inputs: null,
      params: null, // { rain: {...}, snow: {...} }
      midis: { rain: [], snow: [] },
      mix: { rain: 1, snow: 0 }, // equal-power crossfade weights
      snowShare: 0,
      snowSmooth: null,
      profile: "rain", // whichever sound is dominant
      strikes: { rain: { key: "", t: -99 }, snow: { key: "", t: -99 } },
      trail: [],
      trailClock: 0,
      glow: 0,
      lastHit: -1,
    };
  }

  // Snow share around a point, weighted by how much precipitation is there (null = nothing there).
  function areaSnow(fx, fy, r) {
    let sum = 0;
    let snow = 0;
    const cx = Math.round(fx);
    const cy = Math.round(fy);
    for (let dy = -r; dy <= r; dy += 1) {
      const y = cy + dy;
      if (y < 0 || y >= FH) continue;
      for (let dx = -r; dx <= r; dx += 1) {
        const i = y * FW + wrapX(cx + dx);
        sum += fieldI[i];
        snow += fieldI[i] * fieldS[i];
      }
    }
    return sum > 1e-4 ? snow / sum : null;
  }

  function maxNear(arr, fx, fy, r) {
    let best = 0;
    let bestIndex = -1;
    const cx = Math.round(fx);
    const cy = Math.round(fy);
    for (let dy = -r; dy <= r; dy += 1) {
      const y = cy + dy;
      if (y < 0 || y >= FH) continue;
      for (let dx = -r; dx <= r; dx += 1) {
        const i = y * FW + wrapX(cx + dx);
        if (arr[i] > best) {
          best = arr[i];
          bestIndex = i;
        }
      }
    }
    return { value: best, index: bestIndex };
  }

  function cellSample(arr, fx, fy) {
    const gx = fx / CELL - 0.5;
    const gy = clamp(fy / CELL - 0.5, 0, GH - 1);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    const xa = ((x0 % GW) + GW) % GW;
    const xb = (xa + 1) % GW;
    const yb = Math.min(GH - 1, y0 + 1);
    return lerp(lerp(arr[y0 * GW + xa], arr[y0 * GW + xb], tx), lerp(arr[yb * GW + xa], arr[yb * GW + xb], tx), ty);
  }

  function meanShift(voice, field) {
    const R = 7;
    let total = 0;
    for (let iter = 0; iter < 3; iter += 1) {
      const cx = Math.round(voice.fx);
      const cy = Math.round(voice.fy);
      let sw = 0;
      let sx = 0;
      let sy = 0;
      for (let dy = -R; dy <= R; dy += 1) {
        const y = cy + dy;
        if (y < 0 || y >= FH) continue;
        for (let dx = -R; dx <= R; dx += 1) {
          if (dx * dx + dy * dy > R * R) continue;
          const w = field[y * FW + wrapX(cx + dx)];
          if (w <= 0) continue;
          sw += w;
          sx += w * dx;
          sy += w * dy;
        }
      }
      total = sw;
      if (sw < 1e-6) return 0;
      voice.fx = wrapX(cx + sx / sw);
      voice.fy = clamp(cy + sy / sw, 0, FH - 1);
    }
    return total;
  }

  function freeSlot(used) {
    for (let s = 0; s < MAX_VOICES; s += 1) if (!used.has(s)) return s;
    return -1;
  }

  function updateStormVoices() {
    const threshold = state.globals.threshold;
    const want = state.globals.voices;
    const kept = [];
    const used = new Set();
    for (const voice of voices) {
      if (voice.kind !== "storm") continue;
      meanShift(voice, latestBlur);
      const peak = maxNear(fieldI, voice.fx, voice.fy, 3).value;
      const crowded = kept.some((k) => Math.hypot(wrapDx(k.fx - voice.fx), k.fy - voice.fy) < 8);
      if (peak >= threshold * 0.8 && !crowded && kept.length < want) {
        kept.push(voice);
        used.add(voice.slot);
      }
    }
    if (kept.length < want) {
      const cells = [];
      for (let gy = 0; gy < GH; gy += 1) {
        for (let gx = 0; gx < GW; gx += 1) {
          let sum = 0;
          let sx = 0;
          let sy = 0;
          for (let y = gy * CELL; y < gy * CELL + CELL; y += 1) {
            for (let x = gx * CELL; x < gx * CELL + CELL; x += 1) {
              const w = latestBlur[y * FW + x];
              sum += w;
              sx += w * x;
              sy += w * y;
            }
          }
          if (sum > 0.05) cells.push({ sum, fx: sx / sum, fy: sy / sum });
        }
      }
      cells.sort((a, b) => b.sum - a.sum);
      for (const cell of cells) {
        if (kept.length >= want) break;
        if (maxNear(fieldI, cell.fx, cell.fy, 3).value < threshold) continue;
        if (kept.some((k) => Math.hypot(wrapDx(k.fx - cell.fx), k.fy - cell.fy) < 18)) continue;
        const slot = freeSlot(used);
        if (slot < 0) break;
        const voice = makeVoice(slot, cell.fx, cell.fy);
        voice.kind = "storm";
        kept.push(voice);
        used.add(slot);
      }
    }
    voices = kept;
  }

  function updateScanVoices() {
    const threshold = state.globals.threshold;
    const want = state.globals.voices;
    const fx = scanPhase * FW;
    const sx = Math.floor(fx) % FW;
    const column = new Float32Array(FH);
    for (let y = 0; y < FH; y += 1) {
      column[y] = Math.max(latestBlur[y * FW + wrapX(sx - 1)], latestBlur[y * FW + sx], latestBlur[y * FW + wrapX(sx + 1)]);
    }
    const peaks = [];
    for (let y = 0; y < FH; y += 1) {
      const above = y > 0 ? column[y - 1] : -1;
      const below = y < FH - 1 ? column[y + 1] : -1;
      if (column[y] >= above && column[y] > below && column[y] > 0.01) {
        if (maxNear(fieldI, sx, y, 2).value >= threshold) peaks.push({ y, value: column[y] });
      }
    }
    peaks.sort((a, b) => b.value - a.value);
    const chosen = [];
    for (const peak of peaks) {
      if (chosen.length >= want) break;
      if (chosen.some((c) => Math.abs(c.y - peak.y) < 8)) continue;
      chosen.push(peak);
    }
    // Keep the same voices (and so the same continuous sounds) from frame to frame: each voice
    // takes the nearest free patch; a voice with no patch stays put and fades out quietly.
    const pool = Array.from({ length: want }, (_, slot) => {
      if (!scanPool[slot]) {
        scanPool[slot] = makeVoice(slot, fx, ((slot + 0.5) * FH) / want);
        scanPool[slot].kind = "scan";
      }
      return scanPool[slot];
    });
    const free = chosen.slice();
    for (const voice of pool.slice().sort((a, b) => a.fy - b.fy)) {
      voice.fx = fx;
      if (!free.length) continue;
      let best = 0;
      for (let k = 1; k < free.length; k += 1) if (Math.abs(free[k].y - voice.fy) < Math.abs(free[best].y - voice.fy)) best = k;
      voice.fy = free[best].y;
      free.splice(best, 1);
    }
    voices = pool;
  }

  function updateProbeVoices(dtVideo) {
    if (state.drift && dtVideo > 0 && dtVideo < 0.5) {
      for (const probe of probes) {
        probe.fx = wrapX(probe.fx + cellSample(cellU, probe.fx, probe.fy) * dtVideo);
        probe.fy = clamp(probe.fy + cellSample(cellV, probe.fx, probe.fy) * dtVideo, 0, FH - 1);
      }
    }
    voices = probes;
  }

  // =========================================================================
  // Storm picker: the video waits on its first frame. Hovering previews what that spot would play (through the
  // mapping below, so X = ear and Y = pitch by default) plus a rain or snowstorm sound. Clicks place picks.
  // Space plays the day: the picks drift with their storms and play through the mapping; storm sounds stop.
  // =========================================================================
  let pickerRunning = false;
  let hoverOver = false;
  const hoverVoice = makeVoice(MAX_VOICES - 1, FW / 2, FH / 2);
  hoverVoice.kind = "hover";

  // The measured motion is smoothed (storms move faster than it says), so a pick is also pulled toward the
  // middle of the rain or snow right around it: it stays on its storm instead of sliding off.
  function stayOnStorm(voice, dt) {
    const R = 4;
    const cx = Math.round(voice.fx);
    const cy = Math.round(voice.fy);
    let sw = 0;
    let sx = 0;
    let sy = 0;
    for (let dy = -R; dy <= R; dy += 1) {
      const y = cy + dy;
      if (y < 0 || y >= FH) continue;
      for (let dx = -R; dx <= R; dx += 1) {
        if (dx * dx + dy * dy > R * R) continue;
        const w = fieldI[y * FW + wrapX(cx + dx)] ** 2;
        sw += w;
        sx += w * dx;
        sy += w * dy;
      }
    }
    if (sw < 1e-4) return;
    const k = 1 - Math.exp(-dt / 0.06);
    voice.fx = wrapX(voice.fx + (sx / sw) * k);
    voice.fy = clamp(voice.fy + (sy / sw) * k, 0, FH - 1);
  }

  function updatePickerVoices(dtVideo) {
    if (pickerRunning && dtVideo > 0 && dtVideo < 0.5) {
      for (const probe of probes) {
        if (state.drift) {
          probe.fx = wrapX(probe.fx + cellSample(cellU, probe.fx, probe.fy) * dtVideo);
          probe.fy = clamp(probe.fy + cellSample(cellV, probe.fx, probe.fy) * dtVideo, 0, FH - 1);
        }
        stayOnStorm(probe, dtVideo);
      }
    }
    for (const probe of probes) probe.waiting = !pickerRunning; // picks are silent until Space
    voices = probes.slice();
    if (hoverOver) voices.push(hoverVoice); // the cursor is heard while picking and while the week plays
  }

  // Space (or the main button): start or stop the day.
  // The day plays once. Playing again after the end starts over from the first frame, picks back where you placed them.
  const atEnd = () => video.ended || (Number.isFinite(video.duration) && video.currentTime >= video.duration - 0.05);
  async function setPickerRunning(on) {
    if (on && atEnd()) await restartPicker();
    pickerRunning = on;
    // Either way the sound changes at once: the hover preview's ringing notes stop when the day starts, and the
    // day's music stops dead (no ringing tail) when it is stopped.
    hushMusic();
    if (on) {
      if (!playing) await startSound();
      if (!pickerRunning) return; // stopped again while the sound was starting
      video.play().catch(() => {});
      setStatus(probes.length
        ? `Playing the week · ${probes.length} picked spot${probes.length > 1 ? "s" : ""} drift with their storms. Space stops; change any sound control while it plays.`
        : "Playing the week · you have not picked any spots, so it is quiet. Space stops; click the map to pick spots.");
    } else {
      video.pause();
      setStatus("Stopped · hover to listen again, click to pick or drop spots, Space plays on. “First frame” (in the sound controls) starts over.");
    }
    syncPlayButton();
  }

  async function restartPicker() {
    pickerRunning = false;
    video.pause();
    hushMusic();
    await seekTo(0);
    analyzeFrame(video.currentTime);
    for (const probe of probes) {
      probe.fx = probe.fx0 ?? probe.fx;
      probe.fy = probe.fy0 ?? probe.fy;
      probe.trail = [];
    }
    syncPlayButton();
    setStatus("Back on the first frame · your picks are where you placed them. Space plays the week.");
  }

  // =========================================================================
  // Storm Watch: voices follow the storms Itay's tracker found (IDs, outlines, merges, splits)
  // =========================================================================
  const tracks = {
    ready: false,
    failed: false,
    frames: [], // { time, image, comps: Map(id → storm) }
    byId: new Map(), // track id → { mergedInto, parentId, firstFrame, lastFrame }
    clock: 0, // snapshot index + fraction
    pair: null, // the two snapshots we are between right now
    speedScale: 4,
    spinScale: 0.05,
    sizeRef: 60,
    events: [], // merges / splits to draw
  };
  let trackVoices = [];

  const SNAP_LOOKUP = new Map();
  SNAP_RAIN.forEach((c, i) => SNAP_LOOKUP.set((c[0] << 16) | (c[1] << 8) | c[2], { level: 0.1 + (0.9 * i) / (SNAP_RAIN.length - 1), snow: 0 }));
  SNAP_SNOW.forEach((c, i) => SNAP_LOOKUP.set((c[0] << 16) | (c[1] << 8) | c[2], { level: 0.1 + (0.9 * i) / (SNAP_SNOW.length - 1), snow: 1 }));
  function snapClass(r, g, b) {
    const exact = SNAP_LOOKUP.get((r << 16) | (g << 8) | b);
    if (exact) return exact;
    let best = Infinity;
    let hit = null;
    for (const [key, value] of SNAP_LOOKUP) {
      const d = (r - (key >> 16)) ** 2 + (g - ((key >> 8) & 255)) ** 2 + (b - (key & 255)) ** 2;
      if (d < best) {
        best = d;
        hit = value;
      }
    }
    return hit;
  }

  const wrapTX = (x) => ((x % TW) + TW) % TW;
  const wrapTDx = (dx) => (dx > TW / 2 ? dx - TW : dx < -TW / 2 ? dx + TW : dx);
  const stormHue = (id) => (id * 137.508) % 360; // the same colors Storm Watch gives each storm

  // Orientation and elongation of a storm outline (exact polygon moments), used to measure spin.
  function shapeOf(component) {
    let A = 0;
    let SX = 0;
    let SY = 0;
    let XX = 0;
    let YY = 0;
    let XY = 0;
    for (const polygon of component.polygons || []) {
      [polygon.outer, ...(polygon.holes || [])].forEach((ring, r) => {
        if (!ring || ring.length < 3) return;
        let a = 0;
        let sx = 0;
        let sy = 0;
        let xx = 0;
        let yy = 0;
        let xy = 0;
        for (let i = 0; i < ring.length; i += 1) {
          const [x0, y0] = ring[i];
          const [x1, y1] = ring[(i + 1) % ring.length];
          const c = x0 * y1 - x1 * y0;
          a += c;
          sx += (x0 + x1) * c;
          sy += (y0 + y1) * c;
          xx += (x0 * x0 + x0 * x1 + x1 * x1) * c;
          yy += (y0 * y0 + y0 * y1 + y1 * y1) * c;
          xy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c;
        }
        const s = (r === 0 ? 1 : -1) * (a < 0 ? -1 : 1); // outer rings add, holes subtract
        A += (s * a) / 2;
        SX += (s * sx) / 6;
        SY += (s * sy) / 6;
        XX += (s * xx) / 12;
        YY += (s * yy) / 12;
        XY += (s * xy) / 24;
      });
    }
    if (A <= 1) return { angle: 0, elong: 0 };
    const cx = SX / A;
    const cy = SY / A;
    const mxx = XX / A - cx * cx;
    const myy = YY / A - cy * cy;
    const mxy = XY / A - cx * cy;
    const diff = Math.hypot(mxx - myy, 2 * mxy);
    return { angle: 0.5 * Math.atan2(2 * mxy, mxx - myy), elong: mxx + myy > 0 ? diff / (mxx + myy) : 0 };
  }

  // How heavy and how snowy a storm is, read from the snapshot pixels around its core.
  function sampleStorm(px, component) {
    const r = Math.round(clamp(Math.sqrt(component.area) / 3, 3, 12));
    let n = 0;
    let sum = 0;
    let max = 0;
    let snow = 0;
    const cx = Math.round(component.coreX);
    const cy = Math.round(component.coreY);
    for (let dy = -r; dy <= r; dy += 1) {
      const y = cy + dy;
      if (y < 0 || y >= TH) continue;
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy > r * r) continue;
        const p = (y * TW + wrapTX(cx + dx)) * 4;
        if (px[p + 3] < 40) continue;
        const k = snapClass(px[p], px[p + 1], px[p + 2]);
        n += 1;
        sum += k.level;
        max = Math.max(max, k.level);
        snow += k.snow;
      }
    }
    if (!n) {
      const [r0, g0, b0] = (component.meanColor || [0, 150, 50]).map(Math.round);
      const k = snapClass(r0, g0, b0);
      return { level: k.level, snow: k.snow };
    }
    return { level: 0.5 * (sum / n) + 0.5 * max, snow: snow / n };
  }

  function halfTurn(d) {
    while (d > Math.PI / 2) d -= Math.PI;
    while (d <= -Math.PI / 2) d += Math.PI;
    return d;
  }

  // Spin = how fast the outline turns (counter-clockwise positive), trusted only for elongated shapes.
  const spinBetween = (a, b) => -halfTurn(b.angle - a.angle) * clamp(Math.min(a.elong, b.elong) * 3, 0, 1);

  const percentile = (values, q, fallback) => {
    if (values.length < 8) return fallback;
    values.sort((x, y) => x - y);
    return values[Math.floor(values.length * q)] || fallback;
  };

  async function loadTracks() {
    try {
      const response = await fetch(TRACK_DATA);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.width !== TW || data.height !== TH || !data.frames?.length) throw new Error("Unexpected Storm Watch data format");
      for (const track of data.tracks) tracks.byId.set(track.id, track);
      const scratch = document.createElement("canvas");
      scratch.width = TW;
      scratch.height = TH;
      const sctx = scratch.getContext("2d", { willReadFrequently: true });
      // Decode the snapshots in small batches, then read each one's pixels once.
      const images = new Array(data.frames.length);
      for (let start = 0; start < data.frames.length; start += 8) {
        await Promise.all(data.frames.slice(start, start + 8).map(async (frame, i) => {
          const img = new Image();
          img.src = trackSnapshotUrl(frame.time);
          await img.decode();
          images[start + i] = await createImageBitmap(img, { resizeWidth: TW, resizeHeight: TH, resizeQuality: "medium" }).catch(() => img);
        }));
        if (state.mode === "tracked") setStatus(`Loading Storm Watch snapshots… ${Math.min(start + 8, data.frames.length)}/${data.frames.length}`);
      }
      data.frames.forEach((frame, k) => {
        sctx.clearRect(0, 0, TW, TH);
        sctx.drawImage(images[k], 0, 0, TW, TH);
        const px = sctx.getImageData(0, 0, TW, TH).data;
        const comps = new Map();
        for (const c of frame.components) {
          const shape = shapeOf(c);
          const feature = sampleStorm(px, c);
          comps.set(c.id, {
            id: c.id,
            parentId: c.parentId,
            x: c.coreX,
            y: c.coreY,
            area: c.area,
            polygons: c.polygons || [],
            angle: shape.angle,
            elong: shape.elong,
            level: feature.level,
            snow: feature.snow,
          });
        }
        tracks.frames.push({ time: frame.time, image: images[k], comps });
      });
      // Scales so "fast", "spinning" and "big" mean something on this day's weather.
      const speeds = [];
      const spins = [];
      const sizes = [];
      tracks.frames.forEach((frame, k) => {
        const next = tracks.frames[k + 1];
        for (const a of frame.comps.values()) {
          sizes.push(Math.sqrt(a.area));
          const b = next && next.comps.get(a.id);
          if (!b) continue;
          speeds.push(Math.abs(wrapTDx(b.x - a.x)), Math.abs(b.y - a.y));
          spins.push(Math.abs(spinBetween(a, b)));
        }
      });
      tracks.speedScale = Math.max(0.5, percentile(speeds, 0.8, 4));
      tracks.spinScale = Math.max(0.005, percentile(spins, 0.8, 0.05));
      tracks.sizeRef = Math.max(10, percentile(sizes, 0.995, 60)); // ≈ the day's biggest storm = 100%
      tracks.ready = true;
      onSourceReady();
    } catch (error) {
      tracks.failed = true;
      console.warn("Sound lab could not load the Storm Watch tracks.", error);
      if (state.mode === "tracked") setStatus("Could not load the Storm Watch tracks (earth-jukebox/data/storm-watch). The other modes still work.");
    }
  }

  // Everything that happens between snapshot k and k + 1, worked out once per snapshot.
  function buildPair(k) {
    const count = tracks.frames.length;
    const A = tracks.frames[k];
    const B = tracks.frames[(k + 1) % count];
    const wrapped = k === count - 1; // the day loops: no storm continues from 23:30 to 00:00
    const entries = [];
    for (const a of A.comps.values()) {
      const b = wrapped ? null : B.comps.get(a.id);
      if (b) {
        entries.push({ id: a.id, own: [a, b], from: a, to: b, fadeIn: false, fadeOut: false, spin: spinBetween(a, b) });
        continue;
      }
      // Gone in the next snapshot: either it merges into another storm (glide there) or it fades.
      const track = tracks.byId.get(a.id);
      const target = !wrapped && track && track.mergedInto != null ? B.comps.get(track.mergedInto) : null;
      entries.push({ id: a.id, own: [a, a], from: a, to: target || a, succ: target ? target.id : null, fadeIn: false, fadeOut: !target, spin: 0 });
    }
    for (const b of B.comps.values()) {
      if (!wrapped && A.comps.has(b.id)) continue;
      // New in the next snapshot: split off a parent (grow out of it), formed by a merge, or brand new.
      const parent = !wrapped && b.parentId != null ? A.comps.get(b.parentId) : null;
      const source = parent || entries.find((e) => e.succ === b.id)?.from || null;
      entries.push({ id: b.id, own: [b, b], from: source || b, to: b, split: parent ? parent.id : null, fadeIn: !source, fadeOut: false, spin: 0 });
    }
    return { k, A, B, entries };
  }

  function stormAt(entry, u) {
    const [a, b] = entry.own;
    const x = wrapTX(entry.from.x + wrapTDx(entry.to.x - entry.from.x) * u);
    const y = entry.from.y + (entry.to.y - entry.from.y) * u;
    return {
      id: entry.id,
      x,
      y,
      vx: wrapTDx(entry.to.x - entry.from.x),
      vy: entry.to.y - entry.from.y,
      spin: entry.spin,
      area: lerp(a.area, b.area, u),
      level: lerp(a.level, b.level, u),
      snow: lerp(a.snow, b.snow, u),
      fade: entry.fadeIn ? u : entry.fadeOut ? 1 - u : 1,
      succ: entry.succ ?? null,
    };
  }

  // 2.5 s per half-hour snapshot at 1×: a day of weather in 2 minutes, slow enough to follow a storm's tune.
  const secondsPerSnapshot = () => 2.5 / state.globals.mapSpeed;
  const stormScore = (s) => Math.sqrt(s.area) * (0.5 + s.level);

  function addTrackEvent(type, storm, hue) {
    tracks.events.push({ type, x: storm.x, y: storm.y, hue, born: performance.now() / 1000 });
    if (tracks.events.length > 24) tracks.events.shift();
  }

  // Crossing into a new snapshot: hand voices over when their storm merged, and mark merges/splits.
  function onSnapshotChange(previous, next) {
    if (!previous) return;
    for (const voice of trackVoices.slice()) {
      if (next.A.comps.has(voice.trackId)) continue;
      const entry = previous.entries.find((e) => e.id === voice.trackId);
      const target = entry && entry.succ != null ? next.A.comps.get(entry.succ) : null;
      if (!target) {
        trackVoices = trackVoices.filter((v) => v !== voice);
        continue;
      }
      const owner = trackVoices.find((v) => v.trackId === target.id);
      addTrackEvent("merge", target, stormHue(target.id));
      if (owner) {
        owner.accent = true; // the two voices meet: the storm that remains plays a full chord
        trackVoices = trackVoices.filter((v) => v !== voice);
      } else {
        voice.trackId = target.id; // the melody carries on as the merged storm
        voice.hue = stormHue(target.id);
        voice.accent = true;
      }
    }
    for (const entry of previous.entries) {
      if (entry.split == null || !next.A.comps.has(entry.id)) continue;
      const parentVoice = trackVoices.find((v) => v.trackId === entry.split);
      if (!parentVoice) continue;
      addTrackEvent("split", next.A.comps.get(entry.id), parentVoice.hue);
      parentVoice.accent = true;
    }
  }

  function updateTrackedVoices(dtReal) {
    if (!tracks.ready) {
      voices = [];
      return;
    }
    const count = tracks.frames.length;
    tracks.clock = (tracks.clock + dtReal / secondsPerSnapshot()) % count;
    const k = Math.floor(tracks.clock);
    const u = tracks.clock - k;
    if (!tracks.pair || tracks.pair.k !== k) {
      const previous = tracks.pair;
      tracks.pair = buildPair(k);
      onSnapshotChange(previous, tracks.pair);
    }
    const storms = tracks.pair.entries.map((entry) => stormAt(entry, u));
    const byId = new Map(storms.map((s) => [s.id, s]));
    const want = state.globals.voices;

    // Keep the storms we already hear; let a much bigger storm take over the quietest voice.
    let kept = trackVoices.filter((v) => {
      const s = byId.get(v.trackId);
      return s && (s.fade > 0.02 || s.succ != null);
    });
    kept.sort((a, b) => stormScore(byId.get(b.trackId)) - stormScore(byId.get(a.trackId)));
    kept = kept.slice(0, want);
    const voiced = new Set(kept.map((v) => v.trackId));
    const candidates = storms
      .filter((s) => !voiced.has(s.id) && s.fade > 0.5 && s.succ == null && s.area >= 120)
      .sort((a, b) => stormScore(b) - stormScore(a));
    for (const s of candidates) {
      const weakest = kept.length >= want ? kept[kept.length - 1] : null;
      if (weakest && stormScore(byId.get(weakest.trackId)) > stormScore(s) * 0.45) break;
      if (weakest) kept.pop();
      const used = new Set(kept.map((v) => v.slot));
      const voice = makeVoice(freeSlot(used), (s.x / TW) * FW, (s.y / TH) * FH);
      voice.kind = "track";
      voice.trackId = s.id;
      voice.hue = stormHue(s.id);
      kept.push(voice);
      kept.sort((a, b) => stormScore(byId.get(b.trackId)) - stormScore(byId.get(a.trackId)));
    }
    trackVoices = kept;
    voices = kept.slice().sort((a, b) => a.slot - b.slot);

    for (const voice of voices) {
      const s = byId.get(voice.trackId);
      voice.fx = (s.x / TW) * FW;
      voice.fy = (s.y / TH) * FH;
      voice.active = true;
      voice.weight = s.succ != null ? 1 : s.fade; // fading storms fade out; merging ones keep singing
      finishVoice(voice, {
        x: s.x / TW,
        y: 1 - s.y / (TH - 1),
        vx: signedNorm(s.vx, tracks.speedScale),
        vy: signedNorm(-s.vy, tracks.speedScale),
        spin: signedNorm(s.spin, tracks.spinScale),
        div: 0.5, // Storm Watch tracks carry no flow field
        color: clamp(s.level, 0, 1),
        size: clamp(Math.sqrt(s.area) / tracks.sizeRef, 0, 1),
        snow: s.snow,
      }, dtReal);
    }
  }

  // Smoothed precipitation at a point (bilinear on the blurred field, wrapping around the globe).
  function blurAt(fx, fy, field = latestBlur) {
    const x = fx - 0.5;
    const y = clamp(fy - 0.5, 0, FH - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const xa = wrapX(x0);
    const xb = wrapX(x0 + 1);
    const yb = Math.min(FH - 1, y0 + 1);
    return lerp(lerp(field[y0 * FW + xa], field[y0 * FW + xb], tx), lerp(field[yb * FW + xa], field[yb * FW + xb], tx), ty);
  }

  // ---------- Storm-scale spin and spread ----------
  // One grid cell is mostly noise, so spin and spread are read on a ring around the point, as wide as the storm
  // is tall: rotor = how much the motion on that ring circles around it (counterclockwise +), divergence = how much
  // it flows outward (+, spreading) or inward (-, gathering). Both are then compared with the rest of the map.
  let ringRotScale = 0.05;
  let ringDivScale = 0.05;

  // The storm's vertical radius around a point (field pixels, 1 px ≈ 1.5°): how far up and down its color reaches.
  function stormRadius(fx, fy) {
    const at = (y) => Math.max(blurAt(fx, y), blurAt(fx, y, fieldI)); // smoothed or raw color, whichever is more
    const peak = Math.max(maxNear(latestBlur, fx, fy, 3).value, maxNear(fieldI, fx, fy, 3).value, 1e-3);
    const edge = Math.max(0.008, peak * 0.2);
    let up = 0;
    let down = 0;
    while (up < 25 && fy - up - 1 >= 0 && at(fy - up - 1) > edge) up += 1;
    while (down < 25 && fy + down + 1 <= FH - 1 && at(fy + down + 1) > edge) down += 1;
    return clamp((up + down) / 2 + 1, 2, 25);
  }

  function ringMotion(fx, fy, R) {
    let rot = 0;
    let div = 0;
    let n = 0;
    for (let k = 0; k < 16; k += 1) {
      const a = (k / 16) * Math.PI * 2;
      const rx = Math.cos(a);
      const ry = Math.sin(a);
      const y = fy + ry * R;
      if (y < 0 || y > FH - 1) continue;
      const x = wrapX(fx + rx * R);
      const u = cellSample(cellU, x, y);
      const v = cellSample(cellV, x, y);
      rot += rx * v - ry * u; // y points down on the map, so this is clockwise-positive…
      div += rx * u + ry * v;
      n += 1;
    }
    return n ? { rot: -rot / n / R, div: div / n / R } : { rot: 0, div: 0 }; // …and flipped to counterclockwise +
  }

  // How strong spin and spread are on this map right now (80th percentile over rainy spots), so "spinning hard"
  // and "spreading fast" mean something whatever the week looks like.
  function updateRingScales() {
    const rots = [];
    const divs = [];
    for (let k = 0; k < 400 && rots.length < 60; k += 1) {
      const i = Math.floor(Math.random() * FW * FH);
      if (latestBlur[i] < 0.08) continue;
      const ring = ringMotion(i % FW, Math.floor(i / FW), 6);
      rots.push(Math.abs(ring.rot));
      divs.push(Math.abs(ring.div));
    }
    if (rots.length < 10) return;
    rots.sort((a, b) => a - b);
    divs.sort((a, b) => a - b);
    ringRotScale = lerp(ringRotScale, Math.max(rots[Math.floor(rots.length * 0.8)], 1e-4), 0.15);
    ringDivScale = lerp(ringDivScale, Math.max(divs[Math.floor(divs.length * 0.8)], 1e-4), 0.15);
  }

  // Signed 0..1 (0.5 = none) with a strong, clearly audible range: the map's typical value lands near 0.12 / 0.88.
  const ringNorm = (value, scale) => 0.5 + 0.5 * Math.tanh((value / scale) * 1.4);

  function measureSpiral(voice) {
    const radius = stormRadius(voice.fx, voice.fy);
    const ring = ringMotion(voice.fx, voice.fy, clamp(radius, 3, 14));
    const s = (voice.spiral ||= { rot: ring.rot, div: ring.div, radius });
    // Smoothed, so a spiral's sound doesn't flutter from frame to frame.
    s.rot += (ring.rot - s.rot) * 0.15;
    s.div += (ring.div - s.div) * 0.15;
    s.radius += (radius - s.radius) * 0.15;
    return s;
  }

  function measurePoint(voice) {
    const u = cellSample(cellU, voice.fx, voice.fy);
    const v = cellSample(cellV, voice.fx, voice.fy);
    const spiral = measureSpiral(voice);
    const near = maxNear(fieldI, voice.fx, voice.fy, 2);
    // Presence: how much rain/snow color is right under the voice. As the color thins out toward
    // the edge of a patch the voice fades with it, and it is silent where the map has no color.
    const threshold = state.globals.threshold;
    // The color right under it (raw), or its smoothed surroundings, so speckled patches don't stutter.
    const local = Math.max(blurAt(voice.fx, voice.fy, fieldI), blurAt(voice.fx, voice.fy));
    const p = clamp((local - threshold * 0.25) / (threshold * 0.75 + 0.15), 0, 1);
    voice.presenceTarget = p * p * (3 - 2 * p);
    // How much storm is really here (for the storm sounds while picking): mostly how heavy the color is right
    // around the spot, partly how much of the area around it is covered; it fades to nothing at the storm's edge.
    const heavy = clamp((local - 0.03) / 0.6, 0, 1);
    const cover = clamp(cellSample(cellMass, voice.fx, voice.fy) / 0.12, 0, 1);
    voice.stormAmount = clamp(0.7 * heavy + 0.3 * cover, 0, 1) * Math.min(1, voice.presenceTarget * 3);
    voice.active = voice.kind === "hover" ? true
      : voice.waiting ? false // a pick waiting for Space: measured and labeled, but silent
        : state.mode === "probes" || state.mode === "picker" ? true
          : near.value >= threshold * 0.8 || (voice.presence ?? 0) > 0.02;
    return {
      x: voice.fx / FW,
      y: 1 - voice.fy / (FH - 1),
      vx: signedNorm(u, speedScale),
      vy: signedNorm(-v, speedScale),
      spin: ringNorm(spiral.rot, ringRotScale),
      div: ringNorm(spiral.div, ringDivScale),
      color: clamp(near.value, 0, 1),
      size: clamp(cellSample(cellMass, voice.fx, voice.fy) / 0.12, 0, 1), // how much precipitation surrounds it
      snow: areaSnow(voice.fx, voice.fy, 3),
    };
  }

  // "Whole map" mode: every latitude band is a voice. Its loudness is how much of the band is
  // covered, its pan is where along the band the precipitation sits, and so on.
  const bandVoices = Array.from({ length: BANDS }, (_, b) => {
    const voice = makeVoice(b, FW / 2, ((b + 0.5) * FH) / BANDS);
    voice.kind = "band";
    voice.y0 = Math.floor((b * FH) / BANDS);
    voice.y1 = Math.floor(((b + 1) * FH) / BANDS);
    return voice;
  });

  // The map wraps around the globe, so the "center" of a band is a circular mean of x.
  const COS_X = Float32Array.from({ length: FW }, (_, x) => Math.cos((x / FW) * Math.PI * 2));
  const SIN_X = Float32Array.from({ length: FW }, (_, x) => Math.sin((x / FW) * Math.PI * 2));

  function measureBand(voice) {
    const threshold = state.globals.threshold;
    let total = 0;
    let covered = 0;
    let sumI = 0;
    let sumS = 0;
    let cosX = 0;
    let sinX = 0;
    for (let y = voice.y0; y < voice.y1; y += 1) {
      for (let x = 0; x < FW; x += 1) {
        const i = y * FW + x;
        total += 1;
        const value = fieldI[i];
        if (value < threshold) continue;
        covered += 1;
        sumI += value;
        sumS += value * fieldS[i];
        cosX += value * COS_X[x];
        sinX += value * SIN_X[x];
      }
    }
    if (covered) voice.fx = wrapX((Math.atan2(sinX, cosX) / (Math.PI * 2)) * FW);
    let su = 0;
    let sv = 0;
    let ss = 0;
    let sd = 0;
    let sm = 0;
    for (let gy = Math.floor(voice.y0 / CELL); gy <= Math.floor((voice.y1 - 1) / CELL); gy += 1) {
      for (let gx = 0; gx < GW; gx += 1) {
        const c = gy * GW + gx;
        const m = cellMass[c];
        su += cellU[c] * m;
        sv += cellV[c] * m;
        ss += cellSpin[c] * m;
        sd += cellDiv[c] * m;
        sm += m;
      }
    }
    const coverage = covered / total;
    voice.active = coverage > 0.004;
    voice.weight = Math.min(1, Math.sqrt(coverage * 6));
    return {
      x: voice.fx / FW,
      y: 1 - voice.fy / (FH - 1),
      vx: signedNorm(sm ? su / sm : 0, speedScale),
      vy: signedNorm(sm ? -sv / sm : 0, speedScale),
      spin: signedNorm(sm ? ss / sm : 0, spinScale),
      div: signedNorm(sm ? sd / sm : 0, divScale),
      color: covered ? clamp(sumI / covered, 0, 1) : 0,
      size: voice.weight, // how much of the band is covered
      snow: sumI > 0 ? sumS / sumI : null,
    };
  }

  // Rain ↔ snow: "blend" sets how wide the crossfade is (narrow = switch, wide = gradual).
  function blendShare(snow) {
    const width = lerp(0.04, 1, state.globals.blend);
    const t = clamp((snow - 0.5) / width + 0.5, 0, 1);
    return t * t * (3 - 2 * t);
  }

  const isMuted = (voice) => state.mode !== "map" && state.solo > 0 && voice.slot !== state.solo - 1;

  function finishVoice(voice, inputs, dt) {
    // Point voices fade (over ~0.3 s) with the color under them; bands and Storm Watch set weight themselves.
    if (voice.presenceTarget !== undefined) {
      if (voice.presence === undefined) voice.presence = voice.presenceTarget;
      else voice.presence += (voice.presenceTarget - voice.presence) * (1 - Math.exp(-dt / 0.3));
      // The hover preview plays what a pick here would play: silent on dry spots, like a pick would be.
      // The cursor tone (updateGuide) is what always tells you where you are.
      voice.weight = voice.presence;
    }
    // Smooth the snow share over ~1 s so crossing a rain/snow edge is a fade, not a jump.
    if (inputs.snow !== null) {
      if (voice.snowSmooth === null) voice.snowSmooth = inputs.snow;
      // (the cursor answers quickly, so rain → snow is heard as soon as you get there)
      else voice.snowSmooth += (inputs.snow - voice.snowSmooth) * (1 - Math.exp(-dt / (voice.kind === "hover" ? 0.2 : 1.1)));
    }
    inputs.snow = voice.snowSmooth ?? 0;
    voice.inputs = inputs;
    const share = blendShare(inputs.snow);
    voice.snowShare = share;
    voice.mix = { rain: Math.cos((share * Math.PI) / 2), snow: Math.sin((share * Math.PI) / 2) };
    voice.profile = share >= 0.5 ? "snow" : "rain";
    voice.params = {};
    let level = 0;
    for (const kind of PROFILE_KEYS) {
      const profile = state.profiles[kind];
      const p = resolveAll(inputs, profile);
      voice.params[kind] = p;
      voice.midis[kind] = chordMidis(p.pitch, p.chord, profile).filter((m) => m >= 12 && m <= 120);
      level += p.amp * voice.mix[kind] ** 2;
    }
    // Glow = how loud this voice is. While paused it shows dimly what would play.
    const audible = voice.active && !isMuted(voice);
    const target = audible ? Math.sqrt(level) * voice.weight * (playing ? 1 : 0.45) : 0;
    voice.glow = lerp(voice.glow, target, 1 - Math.exp(-dt / 0.15));
    if (voice.kind === "storm" || voice.kind === "probe" || voice.kind === "track") {
      voice.trailClock += dt;
      if (voice.trailClock > 0.12) {
        voice.trailClock = 0;
        voice.trail.push([voice.fx, voice.fy]);
        if (voice.trail.length > 45) voice.trail.shift();
      }
    }
  }

  function updateVoices(dtVideo, dtReal) {
    if (state.mode === "tracked") {
      updateTrackedVoices(dtReal);
      return;
    }
    if (!fieldReady) return;
    if (state.mode === "map") {
      voices = bandVoices;
      for (const voice of voices) finishVoice(voice, measureBand(voice), dtReal);
      return;
    }
    if (state.mode === "storms") updateStormVoices();
    else if (state.mode === "scan") updateScanVoices();
    else if (state.mode === "picker") updatePickerVoices(dtVideo);
    else updateProbeVoices(dtVideo);
    for (const voice of voices) finishVoice(voice, measurePoint(voice), dtReal);
  }

  // =========================================================================
  // Mapping: inputs → sound parameters
  // =========================================================================
  function applyCurve(v, curve) {
    if (curve === "down") return 1 - v;
    if (curve === "size") return Math.min(1, Math.abs(v - 0.5) * 2);
    if (curve === "calm") return 1 - Math.min(1, Math.abs(v - 0.5) * 2);
    return v;
  }

  function resolve(key, inputs, profile) {
    const row = profile.rows[key];
    const output = OUTPUT_BY_KEY[key];
    let value;
    if (row.src === "manual" || !inputs) value = row.lo;
    else value = row.lo + applyCurve(clamp(inputs[row.src] ?? 0.5, 0, 1), row.curve) * (row.hi - row.lo);
    if (output.kind === "list") value = clamp(Math.round(value), output.min, output.max);
    return value;
  }

  function resolveAll(inputs, profile) {
    const out = {};
    for (const output of OUTPUTS) out[output.key] = resolve(output.key, inputs, profile);
    return out;
  }

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

  // The note actually played for a pitch value (after snapping to the profile's scale).
  function snappedRoot(midi, profile) {
    if (!profile.snap) return midi;
    if (SCALES[profile.scale].steps.length === 12) return Math.round(midi);
    const lad = getLadder(profile);
    return lad[nearestLadderIndex(lad, midi)];
  }

  function chordMidis(root, chordIndex, profile) {
    const chord = CHORDS[chordIndex];
    const steps = SCALES[profile.scale].steps;
    if (!profile.snap) return chord.semis.map((s) => root + s);
    if (steps.length === 12) return chord.semis.map((s) => Math.round(root) + s);
    const lad = getLadder(profile);
    const index = nearestLadderIndex(lad, root);
    if (steps.length !== 7) {
      // Stacking scale steps only makes real chords in 7-note scales (in a pentatonic scale "a 5th"
      // would land on a 7th). Elsewhere take the scale note nearest each chord interval instead.
      const out = [];
      for (const s of chord.semis) {
        const note = lad[nearestLadderIndex(lad, lad[index] + s - 0.01)]; // ties go to the lower note
        if (!out.includes(note)) out.push(note);
      }
      return out;
    }
    return chord.steps.map((s) => lad[Math.min(lad.length - 1, index + (s === "8va" ? steps.length : s))]);
  }

  // =========================================================================
  // Synth engine
  // =========================================================================
  let ac = null;
  let master = null;
  let bus = null;
  let dryGain = null;
  let reverbSend = null;
  let convolver = null;
  let schedulerTimer = 0;
  let nextStepTime = 0;
  let stepIndex = 0;
  let playing = false;
  let activeNotes = 0;
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
    applyMix();
  }

  function applyMix() {
    if (!ac) return;
    const mix = state.globals.reverb;
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

  // The vibrato speed of the note being played (spin sets it; 5.2 Hz otherwise). Set by playNote.
  let noteVibRate = 5.2;

  // ---------- Tones above and below the note ----------
  // Overtones (2f, 3f, 4f ...) come from the Overtones row and from spreading storms; undertones (f/2, f/3, f/4 ...)
  // from gathering storms. Higher amounts add more tones and make each one louder. One oscillator per side: a
  // custom wave holds all the tones, not normalized, so more tones really are louder.
  const haloWaves = new Map();
  function haloWave(kind, amount) {
    const q = Math.round(clamp(amount, 0, 1.5) * 10) / 10;
    const key = `${kind}:${q}`;
    if (haloWaves.has(key)) return haloWaves.get(key);
    const N = 32;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    const each = 0.07 + 0.2 * q; // louder tones as the amount grows
    if (kind === "up") {
      const count = Math.max(1, Math.round(q * 6)); // up to 9 overtones
      for (let h = 2; h <= count + 1 && h < N; h += 1) imag[h] = each / h ** 0.25;
    } else {
      // Played on a base of f/60, so harmonic 60/k is the undertone f/k.
      const count = Math.max(1, Math.min(5, Math.round(q * 4)));
      for (let k = 2; k <= count + 1; k += 1) imag[60 / k] = each * (1 + 0.15 * (k - 2));
    }
    const w = ac.createPeriodicWave(real, imag, { disableNormalization: true });
    haloWaves.set(key, w);
    return w;
  }
  const haloOn = (amount) => amount > 0.02;
  function setHalo(halo, freq, up, down, now, glide) {
    const uq = Math.round(clamp(up, 0, 1.5) * 10) / 10;
    const dq = Math.round(clamp(down, 0, 1.5) * 10) / 10;
    if (uq !== halo.upQ) {
      halo.up.setPeriodicWave(haloWave("up", uq));
      halo.upQ = uq;
    }
    if (dq !== halo.downQ) {
      halo.down.setPeriodicWave(haloWave("down", dq));
      halo.downQ = dq;
    }
    glideParam(halo.up.frequency, freq, now, glide);
    glideParam(halo.down.frequency, freq / 60, now, glide);
    glideParam(halo.upGain.gain, haloOn(uq) ? 1 : 0, now, 0.1);
    glideParam(halo.downGain.gain, haloOn(dq) ? lowBoost(freq / 3) : 0, now, 0.1);
  }
  // For a struck note: the same tones, ringing and fading with it.
  function addHaloNote(t, dur, freq, amp, fx, out) {
    const decay = Math.min(3, Math.max(0.3, dur * 1.1));
    const end = t + decay + 0.05;
    const oscillators = [];
    for (const [kind, amount, f] of [["up", fx.up, freq], ["down", fx.down, freq / 60]]) {
      if (!haloOn(amount)) continue;
      const o = ac.createOscillator();
      o.setPeriodicWave(haloWave(kind, amount));
      o.frequency.value = f;
      const g = ac.createGain();
      const peak = amp * (kind === "down" ? lowBoost(freq / 3) : 1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(end);
      oscillators.push(o);
    }
    if (fx.vibCents > 0.5) addVibrato(oscillators, t, end, fx.vibCents / 35);
  }

  function addVibrato(oscillators, t, end, depth) {
    if (depth < 0.02) return;
    const lfo = ac.createOscillator();
    lfo.frequency.value = noteVibRate;
    const lfoGain = ac.createGain();
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.linearRampToValueAtTime(depth * 35, t + 0.3);
    lfo.connect(lfoGain);
    for (const o of oscillators) lfoGain.connect(o.detune);
    lfo.start(t);
    lfo.stop(end);
  }

  function lowpass(freq, q = 0.5) {
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = Math.min(18000, freq);
    f.Q.value = q;
    return f;
  }

  // ---------- Sustained instruments ----------
  // One recipe per instrument, used two ways: as a single note (rhythm settings) and as a
  // continuous voice whose pitch, loudness and tone glide with the map ("Flowing").
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

  // Builds the node graph: strands (one per chord note) → formants → lowpass → envelope → out.
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
      // Strict tuning: one oscillator exactly on the note instead of a slightly detuned chorus.
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
        // Wind: noise squeezed through two narrow band-pass filters tuned to the note.
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
    // Tones above and below the root (setHalo), after the brightness filter so they are never muffled.
    const halo = { up: ac.createOscillator(), down: ac.createOscillator(), upGain: gainNode(0), downGain: gainNode(0), upQ: -1, downQ: -1 };
    halo.up.setPeriodicWave(haloWave("up", 0));
    halo.down.setPeriodicWave(haloWave("down", 0));
    vib.connect(halo.up.detune);
    vib.connect(halo.down.detune);
    halo.up.connect(halo.upGain).connect(env);
    halo.down.connect(halo.downGain).connect(env);
    sources.push(halo.up, halo.down);
    sources.forEach((source, i) => {
      if (source.buffer) source.start(t, (i * 0.37) % 1.9);
      else source.start(t);
    });
    return { spec, env, filter, vib, lfo, halo, strands, sources, instrument: -1, lastTarget: 0, lastLoud: t };
  }

  function playSustained(spec, n) {
    const layer = buildLayer(spec, 1, n.bright, n.out, n.t);
    const strand = layer.strands[0];
    strand.gain.gain.setValueAtTime(1, n.t);
    for (const [param, mult] of strand.freqs) param.setValueAtTime(n.freq * mult, n.t);
    layer.filter.frequency.setValueAtTime(cutoff(spec, n.freq, n.bright, n.loud ?? 0.6), n.t);
    const attack = Math.min(spec.attack, n.dur * 0.4) + 0.01;
    const end = sustainEnvelope(layer.env, n.t, attack, Math.max(0, n.dur - attack), spec.release, n.amp);
    // n.vib already holds the spin vibrato (allowed in strict tuning); the instrument's own wobble is not.
    const depth = (state.strict ? n.vib : Math.max(spec.vibMin || 0, n.vib)) * 35;
    layer.lfo.frequency.setValueAtTime(noteVibRate, n.t);
    if (depth > 0.5) layer.vib.gain.linearRampToValueAtTime(depth, n.t + 0.3);
    for (const source of layer.sources) source.stop(end);
    return layer.sources[layer.sources.length - 1];
  }

  const sustained = (name, spec, level) => ({ name, level, sustain: spec, play: (n) => playSustained(spec, n) });

  // Each instrument: play(n) where n = { t, dur, freq, amp, bright, vib, loud, out } → returns a node whose
  // onended marks the end of the note. Sustained ones also carry a recipe for continuous voices.
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
      // Metal bar: a few inharmonic partials that die away faster the higher they are.
      const decay = Math.min(3.2, 1.2 + n.dur * 0.4);
      const end = n.t + decay + 0.05;
      // Strict tuning swaps the real bar's out-of-tune partials for ones that sit on the note's harmonics.
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
      // Plucked string: soft attack, warm tone that darkens as it rings.
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
      // Metal bars with a slow motor tremolo.
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
      // Thumb piano: round tone plus a short metallic "tine" click.
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
      // FM tine piano: the bark fades into a soft sine.
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
      // Small steel comb: sounds an octave up, short and sweet.
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
  if (INSTRUMENTS.some((inst, i) => inst.name !== INSTRUMENT_NAMES[i])) console.error("Sound lab: instrument list out of sync");

  // Clearer ears: a curve that pushes positions outward (a spot a quarter of the way to the edge already sounds
  // mostly in that ear), set by the "Left ↔ right clarity" slider. 0 = plain stereo.
  const earPan = (pan) => {
    const p = clamp(pan, -1, 1);
    return Math.sign(p) * Math.abs(p) ** (1 - 0.6 * state.globals.spread);
  };
  // Equal-loudness help: low notes are boosted (up to 2.2x around C3) so they are as easy to hear as high ones.
  const lowBoost = (freq) => Math.min(2.2, Math.max(0.85, (520 / freq) ** 0.6));

  // ---------- Storm sounds for the picker's hover (rain, snowstorm); silent once the day plays ----------
  let weather = null; // the cursor's storm sound
  let weatherLoops = null;
  const pickWeather = new Map(); // pick id -> its own storm sound (while picking)
  function makeWeather() {
    const sr = ac.sampleRate;
    // Rain = thousands of tiny drops: bright noise ticks and little rising "plinks" over a soft hiss.
    // Two 4-second stereo loops: light rain, and a dense downpour with soft low splashes.
    function rainLoop(dropsPerSec, hiss, splashes) {
      const len = sr * 4;
      const buf = ac.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch += 1) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i += 1) {
          const w = Math.random() * 2 - 1;
          lp += 0.07 * (w - lp);
          d[i] = (w - lp) * hiss;
        }
        for (let k = 0; k < dropsPerSec * 4; k += 1) {
          const start = Math.floor(Math.random() * len);
          const amp = 0.12 + 0.88 * Math.random() ** 3;
          const n = Math.floor(sr * (0.0015 + 0.005 * Math.random()));
          let prev = 0;
          for (let j = 0; j < n; j += 1) {
            const w = Math.random() * 2 - 1;
            d[(start + j) % len] += amp * (w - prev) * 0.5 * Math.exp(-j / (n / 4));
            prev = w;
          }
          if (Math.random() < 0.3) {
            const f0 = 1300 + Math.random() * 3200;
            const m = Math.floor(sr * (0.006 + 0.018 * Math.random()));
            let ph = 0;
            for (let j = 0; j < m; j += 1) {
              ph += (2 * Math.PI * f0 * (1 + 0.6 * (j / m))) / sr;
              d[(start + j) % len] += amp * 0.35 * Math.sin(ph) * Math.exp(-j / (m / 3));
            }
          }
        }
        for (let k = 0; k < splashes * 4; k += 1) {
          const start = Math.floor(Math.random() * len);
          const n = Math.floor(sr * (0.02 + 0.03 * Math.random()));
          let l = 0;
          for (let j = 0; j < n; j += 1) {
            l += 0.12 * (Math.random() * 2 - 1 - l);
            d[(start + j) % len] += 0.5 * l * Math.exp(-j / (n / 3));
          }
        }
        let peak = 0;
        for (let i = 0; i < len; i += 1) peak = Math.max(peak, Math.abs(d[i]));
        for (let i = 0; i < len; i += 1) d[i] *= 0.9 / (peak || 1);
      }
      return buf;
    }
    const loop = (buffer) => {
      const s = ac.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.start();
      return s;
    };
    const pan = ac.createStereoPanner();
    pan.connect(master);
    // Easy on the ear: take the sharpest edge off the drop ticks.
    const soft = ac.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 7000;
    soft.Q.value = 0.5;
    soft.connect(pan);
    const rainL = gainNode(0);
    const rainH = gainNode(0);
    // The rain recordings are made once and shared by every storm sound.
    weatherLoops ||= { light: rainLoop(140, 0.05, 0), heavy: rainLoop(900, 0.16, 25) };
    loop(weatherLoops.light).connect(rainL).connect(soft);
    loop(weatherLoops.heavy).connect(rainH).connect(soft);
    // Snowstorm: a low howl and a high whistling wind, wandering and gusting; icy sparkles come from tick().
    const wind = gainNode(0);
    const howl = ac.createBiquadFilter();
    howl.type = "bandpass";
    howl.frequency.value = 600;
    howl.Q.value = 1.6;
    const whistle = ac.createBiquadFilter();
    whistle.type = "bandpass";
    whistle.frequency.value = 1900;
    whistle.Q.value = 9;
    const wander = (param, rate, depth) => {
      const o = ac.createOscillator();
      o.frequency.value = rate;
      o.connect(gainNode(depth)).connect(param);
      o.start();
    };
    wander(howl.frequency, 0.11, 300);
    wander(whistle.frequency, 0.07, 700);
    const gust = gainNode(0.7);
    wander(gust.gain, 0.27, 0.3);
    const n1 = noiseSource();
    const n2 = noiseSource();
    n1.connect(howl).connect(gust);
    n2.connect(whistle).connect(gainNode(1.6)).connect(gust);
    n1.start(0, 0.3);
    n2.start(0, 1.1);
    gust.connect(wind).connect(pan);
    return {
      rainL, rainH, wind, pan, snow: 0,
      // rain, snow = how much storm of each kind is here (0 = none, 1 = the heaviest, widest storms). The loudness
      // follows it smoothly from silence (no jump at the edge of a storm); a heavier storm also turns light rain
      // into a downpour. level scales the whole sound (the slider, and quieter for picks than for the cursor).
      set(rain, snow, panV, level = 1) {
        const now = ac.currentTime;
        const k = state.globals.weather * level;
        // ^0.7: our ears hear loudness roughly like this, so a storm twice the size sounds clearly bigger and an
        // ordinary storm is still plainly audible over the cursor tone.
        const r = rain ** 0.7;
        const heavy = clamp((rain - 0.3) / 0.5, 0, 1);
        const sn = snow ** 0.7;
        rainL.gain.setTargetAtTime(k * 0.5 * r * (1 - 0.65 * heavy), now, 0.15);
        rainH.gain.setTargetAtTime(k * 0.6 * r * heavy, now, 0.15);
        wind.gain.setTargetAtTime(k * 0.75 * sn, now, 0.2);
        pan.pan.setTargetAtTime(earPan(panV), now, 0.05);
        this.snow = k * sn;
      },
      // Icy sparkles while over snow, a few per second.
      tick(dt) {
        if (this.snow < 0.01 || Math.random() > (1.2 + 2.5 * this.snow) * dt) return;
        const t = ac.currentTime;
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.frequency.value = 2400 + Math.random() * 2600;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.04 + 0.04 * this.snow, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        o.connect(g).connect(pan);
        o.start(t);
        o.stop(t + 0.8);
      },
    };
  }
  // Called every animation frame. While picking: the cursor sounds the storm under it (rain for rain, a snowstorm
  // for snow). Once the day plays: it stops.
  function updateWeather(dt) {
    if (!ac || !playing) return;
    weather ||= makeWeather();
    const picking = state.mode === "picker" && !pickerRunning;
    // Rain or snowstorm by the spot's snow share, as loud as the storm is big and heavy; panned with the cursor tone.
    const stormOf = (w, voice, level) => {
      const amount = voice.stormAmount ?? 0;
      const snow = voice.snowShare ?? voice.inputs.snow; // the same rain ↔ snow balance the music uses
      w.set(amount * (1 - snow), amount * snow, voice.fx / FW * 2 - 1, level);
    };
    // Only the storm under the cursor sounds: it stops as soon as the cursor leaves it (picks stay quiet until Space).
    const onStorm = picking && hoverOver && hoverVoice.inputs && (hoverVoice.presenceTarget ?? 0) > 0.02;
    if (onStorm) stormOf(weather, hoverVoice, 1);
    else weather.set(0, 0, 0);
    weather.tick(dt);
    // The preview's music notes stop with it too (while picking, the cursor is the only thing playing music).
    if (picking && cursorWasOnStorm && !onStorm) hushMusic();
    cursorWasOnStorm = onStorm;
  }
  let cursorWasOnStorm = false;

  // ---------- Cursor tone: while picking, always tells you where the cursor is ----------
  // A soft, gently pulsing tone (pulses are much easier to place between the ears than a steady tone).
  // Left/right = which ear; up/down = pitch, one scale note per step so you can count your way up.
  // It plays on dry spots too, it skips the reverb so its place stays sharp, and it dips a little under a
  // storm so the rain or snowstorm stays clear. Silent once the day plays.
  let guide = null;
  const GUIDE_LOW = 48; // C3 at the bottom of the map
  const GUIDE_HIGH = 84; // C6 at the top
  function makeGuide() {
    const now = ac.currentTime;
    const pan = ac.createStereoPanner();
    pan.connect(master);
    const level = gainNode(0);
    const pulse = gainNode(0.68);
    const lfo = ac.createOscillator();
    lfo.frequency.value = 3;
    lfo.connect(gainNode(0.32)).connect(pulse.gain);
    lfo.start(now);
    const tone = ac.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2400;
    const main = ac.createOscillator();
    main.type = "triangle";
    const octave = ac.createOscillator();
    octave.type = "sine";
    main.frequency.value = 220;
    octave.frequency.value = 440;
    main.connect(tone);
    octave.connect(gainNode(0.18)).connect(tone);
    tone.connect(pulse).connect(level).connect(pan);
    main.start(now);
    octave.start(now);
    return { pan, level, main, octave, midi: null, gain: 0 };
  }
  function guideMidi(fy) {
    const y = clamp(1 - fy / (FH - 1), 0, 1);
    const profile = state.profiles.rain;
    // When the rain's pitch row follows up/down (the default), the tone is exactly the note a rain pick here plays,
    // moved by octaves into a comfortable range, so it never clashes with the preview.
    const row = profile.rows.pitch;
    if (row.src === "y" && row.curve === "up" && row.hi - row.lo >= 12) {
      let m = snappedRoot(resolve("pitch", { y }, profile), profile);
      while (m < GUIDE_LOW - 6) m += 12;
      while (m > GUIDE_HIGH + 6) m -= 12;
      return m;
    }
    const lad = getLadder(profile).filter((m) => m >= GUIDE_LOW && m <= GUIDE_HIGH);
    return lad[Math.min(lad.length - 1, Math.floor(y * lad.length))];
  }
  function updateGuide() {
    if (!ac || !playing) return;
    const on = state.mode === "picker" && !pickerRunning && hoverOver && state.globals.guide > 0;
    if (!guide && !on) return;
    guide ||= makeGuide();
    const now = ac.currentTime;
    let target = 0;
    if (on) {
      const midi = guideMidi(hoverVoice.fy);
      if (midi !== guide.midi) {
        const f = midiFreq(midi);
        guide.main.frequency.setTargetAtTime(f, now, guide.midi === null ? 0.001 : 0.02);
        guide.octave.frequency.setTargetAtTime(f * 2, now, guide.midi === null ? 0.001 : 0.02);
        guide.midi = midi;
      }
      const duck = 1 - 0.5 * Math.min(1, (hoverVoice.stormAmount ?? 0) * 2);
      target = 0.13 * state.globals.guide * lowBoost(midiFreq(midi)) * duck;
      guide.pan.pan.setTargetAtTime(earPan(hoverVoice.fx / FW * 2 - 1), now, 0.03);
    }
    if (Math.abs(target - guide.gain) > 1e-4) {
      guide.level.gain.setTargetAtTime(target, now, target > guide.gain ? 0.05 : 0.12);
      guide.gain = target;
    }
  }

  function makePanner(pan, t) {
    const panner = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
    if (panner.pan) panner.pan.setValueAtTime(earPan(pan), t);
    panner.connect(bus);
    return panner;
  }

  // What spin and spread do to a voice's sound right now (see voiceFx): vibrato speed and width, tones above/below.
  // - Spin (rotor): the amount of vibrato. Faster spin = faster vibrato; a taller spiral (its vertical radius) = wider.
  // - Overtones row + spreading (divergence > 0): tones above. Gathering (divergence < 0): tones below.
  function voiceFx(voice, p) {
    const inp = voice.inputs || {};
    const rot = (inp.spin ?? 0.5) * 2 - 1; // -1 clockwise .. +1 counterclockwise
    const div = (inp.div ?? 0.5) * 2 - 1; // -1 gathering .. +1 spreading
    const spin = Math.abs(rot);
    const radius = voice.spiral?.radius ?? 6; // field pixels, about 1.5° each
    const vibCents = state.globals.spinVib > 0 && spin > 0.06
      ? state.globals.spinVib * spin * (8 + 82 * clamp((radius - 2) / 18, 0, 1))
      : 0;
    return {
      vibCents,
      vibRate: 1.2 + 8.8 * spin, // a slow spiral wobbles slowly, a fast one quickly
      up: clamp(p.overtones * 0.9 + state.globals.divTones * Math.max(0, div), 0, 1.5),
      down: clamp(state.globals.divTones * Math.max(0, -div), 0, 1.5),
    };
  }

  function playNote(instrumentIndex, t, midi, dur, amp, bright, vib, pan, loud, fx = null) {
    if (activeNotes > 96) return;
    // Strict tuning removes the hand-set wobble, but the spin's vibrato is part of the map and stays.
    vib = Math.max(state.strict ? 0 : vib, (fx?.vibCents || 0) / 35);
    noteVibRate = fx?.vibCents > 0.5 ? fx.vibRate : 5.2;
    const panner = makePanner(pan, t);
    amp *= lowBoost(midiFreq(midi));
    if (fx?.halo) addHaloNote(t, dur, midiFreq(midi), amp * 0.9, fx, panner);
    const main = INSTRUMENTS[instrumentIndex].play({ t, dur, freq: midiFreq(midi), amp, bright, vib, loud, out: panner });
    activeNotes += 1;
    main.onended = () => {
      activeNotes -= 1;
      panner.disconnect();
    };
  }

  const loudnessNorm = (live) => 1 / Math.sqrt(Math.max(1, live.reduce((sum, v) => sum + v.weight, 0)));

  // The notes a voice sounds right now. In strict tuning they only change on the eighth-note grid.
  const soundingMidis = (voice, kind) => (state.strict && voice.held ? voice.held[kind] : voice.midis[kind]);

  // Struck notes and rhythmic notes. Both sounds play, each scaled by the rain/snow crossfade.
  function scheduleStep(step, t) {
    if (step % 2 === 0) {
      for (const voice of voices) {
        if (!voice.params) continue;
        voice.held = { rain: voice.midis.rain.slice(), snow: voice.midis.snow.slice() };
        voice.heldAt = t;
      }
    }
    const live = voices.filter((v) => v.active && v.params && !isMuted(v));
    if (!live.length) return;
    const norm = loudnessNorm(live);
    const stepDuration = 60 / state.globals.bpm / 4;
    // Flowing struck notes: at most a few per step, so many voices arriving at once become a ripple.
    let flowStrikes = 0;
    const start = step % live.length;
    for (let k = 0; k < live.length; k += 1) {
      const voice = live[(start + k) % live.length];
      for (const kind of PROFILE_KEYS) {
        const w = voice.mix[kind];
        if (w < 0.04) continue;
        const p = voice.params[kind];
        const midis = soundingMidis(voice, kind);
        if (!midis.length) continue;
        const instrument = INSTRUMENTS[p.instrument];
        const rhythm = RHYTHMS[p.rhythm];
        const memory = voice.strikes[kind];
        let dur;
        if (rhythm.flow) {
          if (instrument.sustain) continue; // the continuous engine plays this one
          if (state.strict && step % 2) continue; // strict: new notes land on eighth notes
          // Struck + flowing: ring when the voice reaches a new note, or when the last ring dies away.
          const key = midis.join(",");
          const ring = 0.6 + p.length * 3;
          if (key === memory.key && t - memory.t < ring) continue;
          if (flowStrikes >= 3) continue;
          flowStrikes += 1;
          memory.key = key;
          dur = ring;
        } else {
          if (step % rhythm.steps !== 0) continue;
          dur = rhythm.steps * stepDuration * (0.15 + p.length * 1.65);
        }
        const amp = (p.amp * w * voice.weight * norm * instrument.level * 0.55) / Math.sqrt(midis.length);
        if (amp < 0.002) continue;
        const fx = voiceFx(voice, p);
        // Every chord note gets the spin's vibrato; the tones above/below are added to the root note.
        midis.forEach((m, i) => playNote(p.instrument, t, m, dur, amp, p.overtones, p.vibrato, p.pan, p.amp, { ...fx, halo: i === 0 }));
        memory.t = t;
        voice.lastHit = t;
      }
      // Storm Watch merge or split: the storm that remains sounds a full chord on the next beat.
      if (voice.accent && step % 4 === 0) {
        voice.accent = false;
        const kind = voice.profile;
        const p = voice.params[kind];
        const chord = chordMidis(p.pitch, 3, state.profiles[kind]).filter((m) => m >= 12 && m <= 120);
        const instrument = INSTRUMENTS[p.instrument];
        const amp = (Math.max(0.5, p.amp) * norm * instrument.level * 0.5) / Math.sqrt(chord.length);
        for (const m of chord) playNote(p.instrument, t, m, stepDuration * 6, amp, p.overtones, 0, p.pan, p.amp);
        voice.lastHit = t;
      }
    }
  }

  // ---------- Continuous voices ("Flowing" + a sustained instrument) ----------
  const drones = new Map(); // `${voice.id}:${kind}` → layer
  let lastDroneUpdate = 0;

  // Only send a new target when it really changed (keeps the audio thread's schedule short).
  function glideParam(param, value, now, timeConstant) {
    const last = param._target;
    if (last !== undefined && Math.abs(value - last) <= Math.abs(last) * 0.002 + 1e-5) return;
    param._target = value;
    param.setTargetAtTime(value, now, timeConstant);
  }

  function retireLayer(layer, now) {
    layer.env.gain.cancelScheduledValues(now);
    layer.env.gain.setTargetAtTime(0, now, 0.12);
    for (const source of layer.sources) source.stop(now + 1);
    layer.sources[0].onended = () => layer.panner.disconnect();
  }

  function updateDrones() {
    if (!ac) return;
    const now = ac.currentTime;
    if (now - lastDroneUpdate < 0.04) return;
    lastDroneUpdate = now;
    // Strict tuning: notes step cleanly (no slide through the pitches in between), on the beat.
    const glide = state.strict ? 0.01 : 0.004 + state.globals.glide ** 2 * 0.9;
    const live = voices.filter((v) => v.active && v.params && !isMuted(v));
    const norm = loudnessNorm(live);
    const touched = new Set();
    for (const voice of voices) {
      if (!voice.params) continue;
      for (const kind of PROFILE_KEYS) {
        const id = `${voice.id}:${kind}`;
        const p = voice.params[kind];
        const midis = soundingMidis(voice, kind);
        const when = state.strict ? Math.max(now, voice.heldAt || 0) : now;
        let layer = drones.get(id);
        // If the instrument row flickers between two values, wait until the new one settles before swapping.
        let swap = false;
        if (layer && layer.instrument !== p.instrument) {
          if (layer.wanted !== p.instrument) {
            layer.wanted = p.instrument;
            layer.wantedSince = now;
          } else if (now - layer.wantedSince > 0.35) swap = true;
        } else if (layer) layer.wanted = layer.instrument;
        const index = layer && !swap ? layer.instrument : p.instrument;
        const instrument = INSTRUMENTS[index];
        const flowing = RHYTHMS[p.rhythm].flow && instrument.sustain;
        const audible = playing && flowing && voice.active && !isMuted(voice) && midis.length > 0;
        const target = audible ? p.amp * voice.mix[kind] * voice.weight * norm * instrument.level * 0.4 : 0;
        if (!layer && target < 0.0005) continue;
        touched.add(id);
        if (target >= 0.0005 && (!layer || swap || layer.strands.length < midis.length)) {
          if (layer) retireLayer(layer, now);
          const panner = makePanner(p.pan, now);
          layer = buildLayer(instrument.sustain, Math.max(1, midis.length), p.overtones, panner, now);
          layer.panner = panner;
          layer.instrument = index;
          layer.wanted = index;
          layer.fresh = true;
          drones.set(id, layer);
        }
        const spec = layer.spec;
        layer.strands.forEach((strand, i) => {
          const m = midis[i];
          if (m !== undefined) {
            const freq = midiFreq(m);
            for (const [param, mult] of strand.freqs) {
              if (layer.fresh) {
                param.setValueAtTime(freq * mult, now);
                param._target = freq * mult;
              } else glideParam(param, freq * mult, when, glide);
            }
          }
          glideParam(strand.gain.gain, m !== undefined ? lowBoost(midiFreq(m)) / Math.sqrt(midis.length) : 0, now, 0.08);
        });
        const root = midis.length ? midiFreq(midis[0]) : 220;
        glideParam(layer.filter.frequency, cutoff(spec, root, p.overtones, p.amp), now, layer.fresh ? 0.002 : 0.15);
        // Vibrato: the spin's (speed from how fast it spins, width from the spiral's height) or the row's, whichever is more.
        const fx = voiceFx(voice, p);
        const cents = Math.max(state.strict ? 0 : Math.max(spec.vibMin || 0, p.vibrato) * 35, fx.vibCents);
        glideParam(layer.vib.gain, cents, now, 0.3);
        glideParam(layer.lfo.frequency, fx.vibCents > 0.5 ? fx.vibRate : 5.2, now, 0.4);
        // Tones above (Overtones row, spreading) and below (gathering) the root.
        if (midis.length) setHalo(layer.halo, root, fx.up, fx.down, layer.fresh ? now : when, layer.fresh ? 0.002 : glide);
        if (layer.panner.pan) glideParam(layer.panner.pan, earPan(p.pan), now, 0.12);
        const rising = target > layer.lastTarget;
        glideParam(layer.env.gain, target, now, rising ? Math.max(0.04, spec.attack / 3) : Math.max(0.06, spec.release / 3));
        layer.lastTarget = target;
        layer.fresh = false;
        if (target > 0.0005) layer.lastLoud = now;
      }
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

  function clearDrones() {
    if (!ac) return;
    for (const layer of drones.values()) retireLayer(layer, ac.currentTime);
    drones.clear();
  }

  function schedulerTick() {
    if (!playing) return;
    const stepDuration = 60 / state.globals.bpm / 4;
    while (nextStepTime < ac.currentTime + LOOKAHEAD) {
      scheduleStep(stepIndex, nextStepTime);
      nextStepTime += stepDuration;
      stepIndex += 1;
    }
  }

  async function startSound() {
    try {
      ensureAudio();
      await ac.resume();
      const waiting = state.mode === "picker" && !pickerRunning; // the picker's freeze frame stays still
      if (video.paused && videoReady && state.mode !== "tracked" && !waiting) video.play().catch(() => {});
      playing = true;
      nextStepTime = ac.currentTime + 0.06;
      stepIndex = 0;
      window.clearInterval(schedulerTimer);
      schedulerTimer = window.setInterval(schedulerTick, TICK_MS);
      schedulerTick();
      syncPlayButton();
      stopButton.disabled = false;
      if (state.mode !== "picker") setStatus("Playing · change any row below and listen to the difference.");
    } catch (error) {
      setStatus("Could not start audio. Check the browser's sound permissions and try again.");
      console.error("Sound lab could not start audio:", error);
    }
  }

  function pauseSound() {
    playing = false;
    window.clearInterval(schedulerTimer);
    silencePickingSounds();
    syncPlayButton();
    setStatus("Paused · ringing notes fade out naturally.");
  }

  // The main button: in the picker it starts and stops the day (same as Space); elsewhere it plays the sound.
  function syncPlayButton() {
    const on = state.mode === "picker" ? pickerRunning : playing;
    playLabel.textContent = state.mode === "picker" ? (on ? "Stop the week (Space)" : "Play the week (Space)") : on ? "Pause sound" : "Play sound";
    playButton.querySelector(".button-icon").textContent = on ? "Ⅱ" : "▶";
  }

  // The storm sounds and the cursor tone skip the music bus, so they are silenced on their own.
  function silencePickingSounds() {
    if (!ac) return;
    weather?.set(0, 0, 0);
    for (const w of pickWeather.values()) w.set(0, 0, 0);
    if (guide) {
      guide.level.gain.setTargetAtTime(0, ac.currentTime, 0.05);
      guide.gain = 0;
    }
  }

  // Cut every music note right now, including ones still ringing or already scheduled a moment ahead: their bus
  // fades out in ~0.1 s and is dropped, and new notes go to a fresh one.
  function hushMusic() {
    if (!ac) return;
    clearDrones();
    const old = bus;
    old.gain.setTargetAtTime(0, ac.currentTime, 0.03);
    window.setTimeout(() => old.disconnect(), 500);
    makeBus();
    // Notes already queued for the next instant would land on the old bus; start the beat again from now.
    nextStepTime = ac.currentTime + 0.12;
  }

  function stopSound() {
    pauseSound();
    stopButton.disabled = true;
    hushMusic();
    setStatus(state.mode === "picker"
      ? "Stopped · all sound is off. Click the map or press a key to hear it again; Space plays the week."
      : "Stopped.");
  }

  // =========================================================================
  // Drawing the overlay
  // =========================================================================
  const SCALE = canvas.width / FW;
  const TSCALE = canvas.width / TW; // Storm Watch pixels → canvas

  // Storm Watch voices wear their storm's color (the same one Storm Watch uses); others their slot color.
  const voiceColor = (voice, alpha = 1) => (voice.hue !== undefined
    ? `hsla(${voice.hue.toFixed(1)}, 96%, 62%, ${alpha})`
    : alpha === 1 ? VOICE_COLORS[voice.slot % VOICE_COLORS.length] : rgba(hexRgb(VOICE_COLORS[voice.slot % VOICE_COLORS.length]), alpha));
  const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  function drawArrow(x, y, dx, dy, color) {
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    const ux = dx / len;
    const uy = dy / len;
    ctx2d.strokeStyle = color;
    ctx2d.beginPath();
    ctx2d.moveTo(x - dx / 2, y - dy / 2);
    ctx2d.lineTo(x + dx / 2, y + dy / 2);
    ctx2d.lineTo(x + dx / 2 - ux * 5 - uy * 3, y + dy / 2 - uy * 5 + ux * 3);
    ctx2d.moveTo(x + dx / 2, y + dy / 2);
    ctx2d.lineTo(x + dx / 2 - ux * 5 + uy * 3, y + dy / 2 - uy * 5 - ux * 3);
    ctx2d.stroke();
  }

  // Note grid: like the repo's scan-line demo (note bands with labels), but it follows the
  // current Pitch mapping of the profile being edited, so the map shows which note each place plays.
  function drawNoteGrid() {
    const profile = editing();
    const row = profile.rows.pitch;
    if (row.src !== "x" && row.src !== "y") return;
    const vertical = row.src === "y"; // y → horizontal bands stacked vertically
    const length = vertical ? canvas.height : canvas.width;
    const noteAt = (pos) => {
      const value = vertical ? 1 - pos / SCALE / (FH - 1) : pos / SCALE / FW;
      return Math.round(snappedRoot(resolve("pitch", { [row.src]: clamp(value, 0, 1) }, profile), profile));
    };
    const color = PROFILE_INFO[state.edit].color;
    const bands = [];
    let start = 0;
    let note = noteAt(0);
    for (let pos = 1; pos <= length; pos += 1) {
      const next = pos === length ? null : noteAt(pos);
      if (next !== note) {
        bands.push({ start, end: pos, note });
        start = pos;
        note = next;
      }
    }

    ctx2d.save();
    ctx2d.font = "500 10px 'DM Mono', monospace";
    ctx2d.textBaseline = "middle";
    for (const band of bands) {
      const tonic = (((band.note - profile.key) % 12) + 12) % 12 === 0;
      ctx2d.strokeStyle = tonic ? `${color}aa` : `${color}38`;
      ctx2d.lineWidth = tonic ? 1.5 : 1;
      ctx2d.beginPath();
      if (vertical) {
        ctx2d.moveTo(0, band.start);
        ctx2d.lineTo(canvas.width, band.start);
      } else {
        ctx2d.moveTo(band.start, 0);
        ctx2d.lineTo(band.start, canvas.height);
      }
      ctx2d.stroke();

      const size = band.end - band.start;
      if (size < 11 && !tonic) continue;
      const mid = (band.start + band.end) / 2;
      const label = midiName(band.note);
      ctx2d.fillStyle = "rgba(5, 10, 17, 0.8)";
      if (vertical) {
        ctx2d.fillRect(0, mid - 7, 36, 14);
        ctx2d.fillStyle = tonic ? color : "#f4f4ed";
        ctx2d.textAlign = "left";
        ctx2d.fillText(label, 5, mid + 0.5);
      } else {
        ctx2d.fillRect(mid - 18, canvas.height - 18, 36, 14);
        ctx2d.fillStyle = tonic ? color : "#f4f4ed";
        ctx2d.textAlign = "center";
        ctx2d.fillText(label, mid, canvas.height - 10.5);
      }
    }

    // Light up the band each voice of this sound is playing right now.
    for (const voice of voices) {
      if (!voice.inputs || !voice.active || voice.mix[state.edit] ** 2 < 0.08 || isMuted(voice)) continue;
      const pos = vertical ? voice.fy * SCALE : voice.fx * SCALE;
      const band = bands.find((b) => pos >= b.start && pos < b.end);
      if (!band) continue;
      const tint = voiceColor(voice);
      const mid = (band.start + band.end) / 2;
      ctx2d.globalAlpha = 0.08 + 0.3 * voice.glow * voice.mix[state.edit];
      ctx2d.fillStyle = tint;
      if (vertical) ctx2d.fillRect(0, band.start, canvas.width, band.end - band.start);
      else ctx2d.fillRect(band.start, 0, band.end - band.start, canvas.height);
      ctx2d.globalAlpha = 1;
      ctx2d.fillStyle = tint;
      if (vertical) ctx2d.fillRect(0, mid - 7, 36, 14);
      else ctx2d.fillRect(mid - 18, canvas.height - 18, 36, 14);
      ctx2d.fillStyle = "#0b0f18";
      ctx2d.textAlign = vertical ? "left" : "center";
      ctx2d.fillText(midiName(band.note), vertical ? 5 : mid, vertical ? mid + 0.5 : canvas.height - 10.5);
    }
    ctx2d.restore();
  }

  const mixRgb = (share) => PROFILE_INFO.rain.rgb.map((c, i) => Math.round(lerp(c, PROFILE_INFO.snow.rgb[i], share)));
  const rgba = (rgb, a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
  const noteList = (midis) => midis.map((m) => midiName(m)).join(" ");

  // What a voice is playing, in words: "C4 E4 · Organ", plus the other sound while they blend.
  function voiceLines(voice, withName = false) {
    const lines = [];
    if (withName && voice.kind === "track") lines.push({ color: voiceColor(voice), text: `STORM ${voice.trackId}` });
    const order = voice.profile === "snow" ? ["snow", "rain"] : ["rain", "snow"];
    for (const kind of order) {
      const share = voice.mix[kind] ** 2;
      const midis = soundingMidis(voice, kind);
      if (share < 0.08 || !midis.length) continue;
      const p = voice.params[kind];
      const percent = share < 0.92 ? ` ${Math.round(share * 100)}%` : "";
      lines.push({ kind, text: `${noteList(midis)} · ${INSTRUMENT_NAMES[p.instrument]}${percent}` });
    }
    return lines;
  }

  function drawLabel(lines, x, y, alpha) {
    if (!lines.length) return;
    ctx2d.font = "500 13px 'DM Mono', monospace";
    ctx2d.textBaseline = "middle";
    ctx2d.textAlign = "left";
    const width = Math.max(...lines.map((l) => ctx2d.measureText(l.text).width)) + 10;
    const height = lines.length * 16 + 4;
    let lx = x + 22;
    if (lx + width > canvas.width - 4) lx = x - 22 - width;
    const ly = clamp(y - height / 2, 2, canvas.height - height - 2);
    ctx2d.globalAlpha = alpha;
    ctx2d.fillStyle = "rgba(5, 10, 17, 0.82)";
    ctx2d.fillRect(lx, ly, width, height);
    lines.forEach((line, i) => {
      ctx2d.fillStyle = line.color || PROFILE_INFO[line.kind].color;
      ctx2d.fillText(line.text, lx + 5, ly + 10 + i * 16);
    });
    ctx2d.globalAlpha = 1;
  }

  // Circle for rain, diamond for snow, and every shape in between while the sound blends.
  function markerPath(x, y, radius, share) {
    ctx2d.beginPath();
    for (let k = 0; k <= 32; k += 1) {
      const a = (k / 32) * Math.PI * 2;
      const diamond = 1.2 / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
      const r = radius * lerp(1, diamond, share);
      const px = x + Math.sin(a) * r;
      const py = y - Math.cos(a) * r;
      if (k === 0) ctx2d.moveTo(px, py);
      else ctx2d.lineTo(px, py);
    }
    ctx2d.closePath();
  }

  // The picker's cursor: a ring and, next to it, what this spot plays (the same lines a pick would show) and its weather.
  function drawHover(voice) {
    const x = voice.fx * SCALE;
    const y = voice.fy * SCALE;
    ctx2d.lineWidth = 2;
    ctx2d.strokeStyle = "rgba(244, 244, 237, 0.9)";
    ctx2d.beginPath();
    ctx2d.arc(x, y, 9, 0, Math.PI * 2);
    ctx2d.stroke();
    const inp = voice.inputs;
    const wet = inp.color > 0.05;
    const weather = !wet ? "dry" : inp.snow >= 0.5 ? "SNOWSTORM" : "RAIN";
    const ear = inp.x < 0.42 ? "LEFT EAR" : inp.x > 0.58 ? "RIGHT EAR" : "BOTH EARS";
    drawLabel([{ color: "#f4f4ed", text: `${weather} · ${ear}` }, ...voiceLines(voice)], x, y, 1);
  }

  function drawVoices(now) {
    for (const voice of voices) {
      if (!voice.inputs) continue;
      if (voice.kind === "hover") {
        drawHover(voice);
        continue;
      }
      const x = voice.fx * SCALE;
      const y = voice.fy * SCALE;
      const color = voiceColor(voice);
      const tint = mixRgb(voice.snowShare);
      const muted = isMuted(voice);
      const alpha = (voice.active || voice.waiting) && !muted ? 1 : 0.4;

      // Where it has been (the path that made the melody).
      if (voice.trail.length > 1) {
        ctx2d.lineWidth = 2;
        ctx2d.strokeStyle = color;
        for (let i = 1; i < voice.trail.length; i += 1) {
          const [ax, ay] = voice.trail[i - 1];
          const [bx, by] = voice.trail[i];
          if (Math.hypot(bx - ax, by - ay) > 8) continue; // a jump to another storm, not a path
          ctx2d.globalAlpha = (i / voice.trail.length) * 0.5 * alpha;
          ctx2d.beginPath();
          ctx2d.moveTo(ax * SCALE, ay * SCALE);
          ctx2d.lineTo(bx * SCALE, by * SCALE);
          ctx2d.stroke();
        }
        ctx2d.globalAlpha = 1;
      }

      // Halo: size and brightness follow how loud the voice is right now.
      const struck = ac && now >= voice.lastHit && now - voice.lastHit < 0.25 ? 1 - (now - voice.lastHit) / 0.25 : 0;
      const glow = Math.min(1, voice.glow + struck * 0.6);
      if (glow > 0.02) {
        const r = 16 + glow * 30;
        const gradient = ctx2d.createRadialGradient(x, y, 4, x, y, r);
        gradient.addColorStop(0, rgba(tint, 0.55 * glow));
        gradient.addColorStop(1, rgba(tint, 0));
        ctx2d.fillStyle = gradient;
        ctx2d.beginPath();
        ctx2d.arc(x, y, r, 0, Math.PI * 2);
        ctx2d.fill();
      }

      ctx2d.globalAlpha = alpha;
      const picked = state.mode === "picker" && voice.kind === "probe";
      const radius = (picked ? 24 : 13) + struck * 5; // the picker's spots are bigger, easier to see and hit
      markerPath(x, y, radius, voice.snowShare);
      ctx2d.fillStyle = struck > 0.3 ? color : rgba(tint, picked ? 0.45 : 0.35);
      ctx2d.fill();
      ctx2d.lineWidth = picked ? 3.5 : 2;
      ctx2d.strokeStyle = color;
      ctx2d.stroke();
      ctx2d.fillStyle = struck > 0.3 ? "#0b0f18" : "#f4f4ed";
      ctx2d.font = `600 ${picked ? 18 : 13}px 'DM Mono', monospace`;
      ctx2d.textAlign = "center";
      ctx2d.textBaseline = "middle";
      ctx2d.fillText(String(voice.slot + 1), x, y + 1);
      ctx2d.globalAlpha = 1;
      if (state.labels && (voice.active || voice.waiting)) drawLabel(voiceLines(voice, true), x + (picked ? 6 : 0), y, muted ? 0.4 : 1);
    }
  }

  // ---------- Storm Watch view: the snapshots, every tracked outline, and the storms you hear ----------
  let basemap = null; // the static land/ocean map learned from the NASA video (drawn dimmed underneath)

  function makeBasemap() {
    if (!background) return;
    const c = document.createElement("canvas");
    c.width = CW;
    c.height = CH;
    const img = c.getContext("2d").createImageData(CW, CH);
    for (let y = 0; y < CH; y += 1) {
      for (let x = 0; x < CW; x += 1) {
        // The video's date stamp sits bottom-left; fill it with the ice just above so it can't
        // contradict the snapshot time.
        const sy = x < 100 && y > CH - 22 ? CH - 23 : y;
        const i = y * CW + x;
        const s = sy * CW + x;
        img.data[i * 4] = background[s * 3];
        img.data[i * 4 + 1] = background[s * 3 + 1];
        img.data[i * 4 + 2] = background[s * 3 + 2];
        img.data[i * 4 + 3] = 255;
      }
    }
    c.getContext("2d").putImageData(img, 0, 0);
    basemap = c;
  }

  function tracePolygons(storm) {
    ctx2d.beginPath();
    for (const polygon of storm.polygons) {
      for (const ring of [polygon.outer, ...(polygon.holes || [])]) {
        if (!ring || ring.length < 3) continue;
        ctx2d.moveTo(ring[0][0] * TSCALE, ring[0][1] * TSCALE);
        for (let i = 1; i < ring.length; i += 1) ctx2d.lineTo(ring[i][0] * TSCALE, ring[i][1] * TSCALE);
        ctx2d.closePath();
      }
    }
  }

  function drawTrackEvents() {
    const now = performance.now() / 1000;
    tracks.events = tracks.events.filter((e) => now - e.born < 1.8);
    ctx2d.save();
    ctx2d.font = "600 11px 'DM Mono', monospace";
    ctx2d.textAlign = "center";
    for (const e of tracks.events) {
      const age = (now - e.born) / 1.8;
      const x = e.x * TSCALE;
      const y = e.y * TSCALE;
      ctx2d.globalAlpha = 1 - age;
      ctx2d.strokeStyle = `hsl(${e.hue.toFixed(1)}, 96%, 70%)`;
      ctx2d.lineWidth = 2.5;
      ctx2d.beginPath();
      ctx2d.arc(x, y, 14 + age * 46, 0, Math.PI * 2);
      ctx2d.stroke();
      ctx2d.fillStyle = "#f4f4ed";
      ctx2d.fillText(e.type === "merge" ? "MERGE" : "SPLIT", x, y - 22 - age * 46);
    }
    ctx2d.restore();
  }

  function drawTracked(now) {
    ctx2d.fillStyle = "#070b13";
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    if (basemap) {
      ctx2d.globalAlpha = 0.5;
      ctx2d.drawImage(basemap, 0, 0, canvas.width, canvas.height);
      ctx2d.globalAlpha = 1;
    }
    if (!tracks.ready || !tracks.pair) {
      ctx2d.fillStyle = "#f4f4ed";
      ctx2d.font = "500 16px 'DM Mono', monospace";
      ctx2d.textAlign = "center";
      ctx2d.fillText(tracks.failed ? "Storm Watch tracks could not be loaded" : "Loading Storm Watch tracks…", canvas.width / 2, canvas.height / 2);
      return;
    }
    const { A, B, k } = tracks.pair;
    const u = clamp(tracks.clock - k, 0, 1);
    ctx2d.drawImage(A.image, 0, 0, canvas.width, canvas.height);
    if (u > 0.02) {
      ctx2d.globalAlpha = u;
      ctx2d.drawImage(B.image, 0, 0, canvas.width, canvas.height);
      ctx2d.globalAlpha = 1;
    }
    if (state.grid) drawNoteGrid();

    // Every storm the tracker found gets a faint outline; the ones you hear are filled in their color,
    // brighter while they are loud and flashing when they strike a note.
    const voiced = new Map(voices.map((v) => [v.trackId, v]));
    for (const [comps, alpha] of [[A.comps, 1 - u], [B.comps, u]]) {
      if (alpha < 0.04) continue;
      for (const storm of comps.values()) {
        tracePolygons(storm);
        const voice = voiced.get(storm.id);
        if (voice) {
          const struck = ac && now >= voice.lastHit && now - voice.lastHit < 0.3 ? 1 - (now - voice.lastHit) / 0.3 : 0;
          ctx2d.fillStyle = voiceColor(voice, alpha * (0.1 + 0.35 * voice.glow + 0.3 * struck));
          ctx2d.fill("evenodd");
          ctx2d.strokeStyle = voiceColor(voice, alpha);
          ctx2d.lineWidth = 2;
        } else {
          ctx2d.strokeStyle = `rgba(244, 244, 237, ${0.22 * alpha})`;
          ctx2d.lineWidth = 1;
        }
        ctx2d.stroke();
      }
    }
    drawTrackEvents();
    drawVoices(now);
  }

  // Whole-map mode: each latitude band glows as loud as it sounds, tinted rain → snow.
  function drawBands(now) {
    const height = (FH / BANDS) * SCALE;
    for (const voice of voices) {
      if (!voice.inputs) continue;
      const y0 = voice.y0 * SCALE;
      const yMid = voice.fy * SCALE;
      const tint = mixRgb(voice.snowShare);
      const struck = ac && now >= voice.lastHit && now - voice.lastHit < 0.3 ? 1 - (now - voice.lastHit) / 0.3 : 0;
      const glow = Math.min(1, voice.glow + struck * 0.5);
      ctx2d.strokeStyle = "rgba(244, 244, 237, 0.12)";
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.moveTo(0, y0);
      ctx2d.lineTo(canvas.width, y0);
      ctx2d.stroke();
      if (glow < 0.02 || !voice.active) continue;
      // Brightest where the precipitation sits (that is also where it pans).
      const cx = voice.fx * SCALE;
      const gradient = ctx2d.createLinearGradient(cx - canvas.width / 2, 0, cx + canvas.width / 2, 0);
      gradient.addColorStop(0, rgba(tint, 0));
      gradient.addColorStop(0.5, rgba(tint, 0.38 * glow));
      gradient.addColorStop(1, rgba(tint, 0));
      ctx2d.fillStyle = gradient;
      ctx2d.fillRect(0, y0, canvas.width, height);
      if (cx - canvas.width / 2 < 0 || cx + canvas.width / 2 > canvas.width) {
        // the band wraps around the globe: draw the other half too
        const shift = cx < canvas.width / 2 ? canvas.width : -canvas.width;
        const wrapped = ctx2d.createLinearGradient(cx + shift - canvas.width / 2, 0, cx + shift + canvas.width / 2, 0);
        wrapped.addColorStop(0, rgba(tint, 0));
        wrapped.addColorStop(0.5, rgba(tint, 0.38 * glow));
        wrapped.addColorStop(1, rgba(tint, 0));
        ctx2d.fillStyle = wrapped;
        ctx2d.fillRect(0, y0, canvas.width, height);
      }
      ctx2d.fillStyle = rgba(tint, Math.min(1, 0.4 + glow));
      ctx2d.fillRect(0, y0 + 1, 5, height - 2);
      ctx2d.beginPath();
      ctx2d.arc(cx, yMid, 3 + glow * 5, 0, Math.PI * 2);
      ctx2d.fill();
      if (state.labels && glow > 0.08) {
        const lines = voiceLines(voice);
        ctx2d.font = "500 12px 'DM Mono', monospace";
        ctx2d.textBaseline = "middle";
        ctx2d.textAlign = "left";
        const text = lines.map((l) => l.text).join("  ·  ");
        const width = ctx2d.measureText(text).width + 10;
        ctx2d.globalAlpha = Math.min(1, 0.35 + glow);
        ctx2d.fillStyle = "rgba(5, 10, 17, 0.78)";
        ctx2d.fillRect(8, yMid - 8, width, 16);
        ctx2d.fillStyle = PROFILE_INFO[voice.profile].color;
        ctx2d.fillText(text, 13, yMid + 0.5);
        ctx2d.globalAlpha = 1;
      }
    }
  }

  function drawOverlay() {
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    if (state.mode === "tracked") {
      drawTracked(ac ? ac.currentTime : 0);
      return;
    }
    if (state.grid && state.mode !== "map") drawNoteGrid();
    if (!fieldReady) return;

    if (state.arrows) {
      ctx2d.lineWidth = 1.4;
      for (let gy = 0; gy < GH; gy += 1) {
        for (let gx = 0; gx < GW; gx += 1) {
          const c = gy * GW + gx;
          if (cellMass[c] < 0.025) continue;
          const cx = (gx + 0.5) * CELL * SCALE;
          const cy = (gy + 0.5) * CELL * SCALE;
          const speed = Math.hypot(cellU[c], cellV[c]);
          if (speed > 1e-6) {
            const len = 26 * Math.tanh(speed / (speedScale * 1.5));
            drawArrow(cx, cy, (cellU[c] / speed) * len, (cellV[c] / speed) * len, "rgba(255, 255, 255, 0.55)");
          }
          const spin = Math.tanh(cellSpin[c] / (spinScale * 1.5));
          if (Math.abs(spin) > 0.6) {
            const ccw = spin > 0;
            ctx2d.strokeStyle = ccw ? "rgba(127, 227, 255, 0.85)" : "rgba(255, 127, 191, 0.85)";
            ctx2d.beginPath();
            const start = ccw ? 0.2 : Math.PI * 1.6;
            ctx2d.arc(cx, cy, 11, start, start + Math.PI * 1.4 * Math.abs(spin), false);
            ctx2d.stroke();
          }
        }
      }
    }

    if (state.mode === "scan") {
      const x = scanPhase * canvas.width;
      ctx2d.fillStyle = "rgba(201, 239, 116, 0.9)";
      ctx2d.shadowColor = "rgba(201, 239, 116, 0.8)";
      ctx2d.shadowBlur = 12;
      ctx2d.fillRect(x - 1, 0, 2, canvas.height);
      ctx2d.shadowBlur = 0;
    }

    const now = ac ? ac.currentTime : 0;
    if (state.mode === "map") drawBands(now);
    else drawVoices(now);
  }

  // =========================================================================
  // UI
  // =========================================================================
  function sliderMarkup({ id, label, min, max, step, value, scale, extraClass = "" }) {
    return `
      <label class="slider-control ${extraClass}" for="${id}">
        <span class="slider-heading"><span>${label}</span><output id="${id}-out" for="${id}"></output></span>
        <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
        ${scale ? `<span class="slider-scale"><span>${scale[0]}</span><span>${scale[1]}</span></span>` : ""}
      </label>`;
  }

  function buildGlobals() {
    const keyOptions = NOTE_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join("");
    const scaleOptions = SCALES.map((s, i) => `<option value="${i}">${s.name}</option>`).join("");
    const soloOptions = ['<option value="0">All voices</option>']
      .concat(Array.from({ length: MAX_VOICES }, (_, i) => `<option value="${i + 1}">Voice ${i + 1} only</option>`))
      .join("");
    profileBar.innerHTML = `
      <fieldset class="lab-segment lab-profile-tabs">
        <legend class="visually-hidden">Which sound to edit</legend>
        ${PROFILE_KEYS.map((kind) => `
          <label style="--profile:${PROFILE_INFO[kind].color}">
            <input type="radio" name="lab-edit" value="${kind}">
            <span><i class="lab-profile-dot"></i>${PROFILE_INFO[kind].label} sound</span>
          </label>`).join("")}
      </fieldset>
      <div class="lab-profile-tools">
        <label class="lab-curve-field">
          <span>Key</span>
          <select class="lab-select" id="lab-key">${keyOptions}</select>
        </label>
        <label class="lab-curve-field">
          <span>Scale</span>
          <select class="lab-select" id="lab-scale">${scaleOptions}</select>
        </label>
        <label class="lab-check"><input type="checkbox" id="lab-snap"> Snap pitch to the scale</label>
        <button class="button button-secondary" id="lab-copy-profile" type="button"></button>
      </div>`;

    globalsPanel.innerHTML = `
      ${GLOBALS.map((g) => sliderMarkup({ id: `lab-g-${g.key}`, label: g.label, min: g.min, max: g.max, step: g.step, value: state.globals[g.key], scale: g.scale })).join("")}
      <div class="lab-field">
        <span class="lab-field-label">Listen</span>
        <select class="lab-select" id="lab-solo" aria-label="Solo a voice">${soloOptions}</select>
        <label class="lab-check"><input type="checkbox" id="lab-drift"> Picks drift with the weather</label>
      </div>
      <div class="lab-field">
        <span class="lab-field-label">Tuning</span>
        <label class="lab-check"><input type="checkbox" id="lab-strict"> Strict: every note exactly on the scale, changing on the beat (no glide, wobble or detune)</label>
      </div>
      <div class="lab-field">
        <span class="lab-field-label">Show on the map</span>
        <label class="lab-check"><input type="checkbox" id="lab-grid"> Note grid (the pitch each place plays)</label>
        <label class="lab-check"><input type="checkbox" id="lab-labels"> What each voice is playing</label>
        <label class="lab-check"><input type="checkbox" id="lab-arrows"> Motion &amp; spin</label>
      </div>`;

    for (const g of GLOBALS) {
      const input = $(`#lab-g-${g.key}`);
      input.addEventListener("input", () => {
        state.globals[g.key] = Number(input.value);
        $(`#lab-g-${g.key}-out`).textContent = g.format(state.globals[g.key]);
        if (g.key === "mapSpeed") video.playbackRate = state.globals.mapSpeed;
        if (g.key === "reverb" || g.key === "volume") applyMix();
        saveState();
      });
    }
    $("#lab-key").addEventListener("change", (e) => { editing().key = Number(e.target.value); saveState(); });
    $("#lab-scale").addEventListener("change", (e) => { editing().scale = Number(e.target.value); saveState(); });
    $("#lab-snap").addEventListener("change", (e) => { editing().snap = e.target.checked; saveState(); });
    $("#lab-copy-profile").addEventListener("click", () => {
      const other = state.edit === "rain" ? "snow" : "rain";
      state.profiles[other] = clone(editing());
      saveState();
      setStatus(`${PROFILE_INFO[state.edit].label} settings copied to ${PROFILE_INFO[other].label.toLowerCase()}.`);
    });
    profileBar.querySelectorAll('input[name="lab-edit"]').forEach((input) => input.addEventListener("change", () => {
      state.edit = input.value;
      syncUI();
      saveState();
    }));
    $("#lab-solo").addEventListener("change", (e) => { state.solo = Number(e.target.value); saveState(); });
    $("#lab-drift").addEventListener("change", (e) => { state.drift = e.target.checked; saveState(); });
    $("#lab-strict").addEventListener("change", (e) => {
      state.strict = e.target.checked;
      clearDrones(); // rebuild the continuous voices with (or without) their chorus detune
      saveState();
      setStatus(state.strict
        ? "Strict tuning · every note sits exactly on the scale and changes on the beat."
        : "Expressive tuning · pitch glide, vibrato and chorus detune are back (notes can bend off the scale).");
    });
    $("#lab-grid").addEventListener("change", (e) => { state.grid = e.target.checked; saveState(); });
    $("#lab-labels").addEventListener("change", (e) => { state.labels = e.target.checked; saveState(); });
    $("#lab-arrows").addEventListener("change", (e) => { state.arrows = e.target.checked; saveState(); });
  }

  function buildMatrix() {
    const head = `
      <thead>
        <tr>
          <th scope="col" class="lab-col-sound">Sound <small>gets its value from →</small></th>
          ${INPUTS.map((input) => `
            <th scope="col" class="lab-col-input">${input.label}<small>${input.detail}</small>
              ${input.key === "manual" ? '<span class="lab-meter is-empty"></span>' : `<span class="lab-meter${input.signed ? " is-signed" : ""}" data-meter="${input.key}"><i></i></span>`}
            </th>`).join("")}
        </tr>
      </thead>`;
    const body = OUTPUTS.map((output) => `
      <tbody data-row="${output.key}">
        <tr class="lab-row-main">
          <th scope="row" rowspan="2">${output.label}<small>${output.hint}</small></th>
          ${INPUTS.map((input) => `
            <td class="lab-radio-cell" data-input="${input.key}">
              <input type="radio" name="lab-src-${output.key}" value="${input.key}" aria-label="${output.label} from ${input.label}">
            </td>`).join("")}
        </tr>
        <tr class="lab-row-controls">
          <td colspan="${INPUTS.length}">
            <div class="lab-controls">
              <label class="lab-curve-field lab-src-field">
                <span>Driven by</span>
                <select class="lab-select lab-src" aria-label="${output.label} driven by">
                  ${INPUTS.map((input) => `<option value="${input.key}">${input.label}</option>`).join("")}
                </select>
              </label>
              <label class="lab-curve-field">
                <span>Shape</span>
                <select class="lab-select lab-curve" aria-label="${output.label} response shape">
                  ${CURVES.map((c) => `<option value="${c.key}">${c.label}</option>`).join("")}
                </select>
              </label>
              <div class="lab-range">
                ${sliderMarkup({ id: `lab-${output.key}-lo`, label: "From", min: output.min, max: output.max, step: output.step, value: 0, extraClass: "mini lo" })}
                ${sliderMarkup({ id: `lab-${output.key}-hi`, label: "To", min: output.min, max: output.max, step: output.step, value: 0, extraClass: "mini hi" })}
              </div>
              <span class="lab-now"><span>Now</span><b data-now="${output.key}">–</b></span>
            </div>
          </td>
        </tr>
      </tbody>`).join("");
    matrixTable.innerHTML = head + body;

    for (const output of OUTPUTS) {
      const row = matrixTable.querySelector(`tbody[data-row="${output.key}"]`);
      row.querySelectorAll('input[type="radio"]').forEach((radio) => {
        radio.addEventListener("change", () => {
          editing().rows[output.key].src = radio.value;
          syncRow(output.key);
          saveState();
        });
      });
      row.querySelector(".lab-src").addEventListener("change", (e) => {
        editing().rows[output.key].src = e.target.value;
        syncRow(output.key);
        saveState();
      });
      row.querySelector(".lab-curve").addEventListener("change", (e) => {
        editing().rows[output.key].curve = e.target.value;
        saveState();
      });
      for (const end of ["lo", "hi"]) {
        const input = $(`#lab-${output.key}-${end}`);
        input.addEventListener("input", () => {
          editing().rows[output.key][end] = Number(input.value);
          $(`#lab-${output.key}-${end}-out`).textContent = output.format(Number(input.value));
          saveState();
        });
      }
    }
  }

  function syncRow(key) {
    const output = OUTPUT_BY_KEY[key];
    const rowState = editing().rows[key];
    const row = matrixTable.querySelector(`tbody[data-row="${key}"]`);
    const manual = rowState.src === "manual";
    row.querySelectorAll(".lab-radio-cell").forEach((cell) => {
      const selected = cell.dataset.input === rowState.src;
      cell.classList.toggle("is-selected", selected);
      cell.querySelector("input").checked = selected;
    });
    row.querySelector(".lab-src").value = rowState.src;
    const curve = row.querySelector(".lab-curve");
    curve.value = rowState.curve;
    curve.disabled = manual;
    row.querySelector(".lab-range").classList.toggle("is-manual", manual);
    row.querySelector(".lo .slider-heading span").textContent = manual ? "Value" : "From";
    for (const end of ["lo", "hi"]) {
      $(`#lab-${key}-${end}`).value = rowState[end];
      $(`#lab-${key}-${end}-out`).textContent = output.format(rowState[end]);
    }
  }

  function syncUI() {
    for (const g of GLOBALS) {
      $(`#lab-g-${g.key}`).value = state.globals[g.key];
      $(`#lab-g-${g.key}-out`).textContent = g.format(state.globals[g.key]);
    }
    const profile = editing();
    const other = state.edit === "rain" ? "snow" : "rain";
    profileBar.querySelectorAll('input[name="lab-edit"]').forEach((input) => { input.checked = input.value === state.edit; });
    $("#lab-key").value = profile.key;
    $("#lab-scale").value = profile.scale;
    $("#lab-snap").checked = profile.snap;
    $("#lab-copy-profile").textContent = `Copy ${PROFILE_INFO[state.edit].label.toLowerCase()} → ${PROFILE_INFO[other].label.toLowerCase()}`;
    tableWrap.dataset.profile = state.edit;
    tableWrap.style.setProperty("--profile", PROFILE_INFO[state.edit].color);
    $("#lab-solo").value = state.solo;
    $("#lab-drift").checked = state.drift;
    $("#lab-strict").checked = state.strict;
    $("#lab-grid").checked = state.grid;
    $("#lab-labels").checked = state.labels;
    $("#lab-arrows").checked = state.arrows;
    modeInputs.forEach((input) => { input.checked = input.value === state.mode; });
    for (const output of OUTPUTS) syncRow(output.key);
    video.playbackRate = state.globals.mapSpeed;
    clearProbesButton.hidden = state.mode !== "probes" && state.mode !== "picker";
    syncSourceForMode();
    applyMix();
  }

  // Storm Watch draws Itay's snapshots itself, so the NASA video pauses (and hides) in that mode.
  const STAGE_LABELS = {
    tracked: {
      source: "STORM WATCH TRACKS / IMERG · 7 NOV 2026",
      aria: "NASA IMERG precipitation on 7 November 2026 with the storms Storm Watch tracked. Filled, labeled outlines are the storms you hear; each label names the storm and the notes it plays. Rings mark merges and splits.",
    },
    other: {
      source: "IMERG / 7 DAYS OF RAIN & SNOW",
      aria: "Moving NASA precipitation map. Numbered circles are the voices that make sound. Click to place a listening probe; press Enter to place one near the center.",
    },
  };
  function syncSourceForMode() {
    const tracked = state.mode === "tracked";
    stage.classList.toggle("is-tracked", tracked);
    const labels = tracked ? STAGE_LABELS.tracked : STAGE_LABELS.other;
    sourceLabel.textContent = labels.source;
    canvas.setAttribute("aria-label", labels.aria);
    const waiting = state.mode === "picker" && !pickerRunning; // the picker waits on its freeze frame
    if (tracked || waiting) {
      if (!video.paused) video.pause();
    } else if (videoReady && video.paused) {
      video.play().catch(() => {});
    }
    restartButton.hidden = state.mode !== "picker";
    if (typeof syncPlayButton === "function" && !playButton.disabled) syncPlayButton();
  }

  function buildVoiceMonitor() {
    const cells = INPUTS.filter((i) => i.key !== "manual")
      .map((input) => `<td><span class="lab-bar${input.signed ? " is-signed" : ""}" data-bar="${input.key}"><i></i></span></td>`)
      .join("");
    voicesBody.innerHTML = Array.from({ length: MAX_VOICES }, (_, slot) => `
      <tr data-voice="${slot}" hidden>
        <th scope="row"><span class="lab-swatch" style="--swatch:${VOICE_COLORS[slot]}">${slot + 1}</span></th>
        ${cells}
        <td class="lab-voice-profile">–</td>
        <td class="lab-voice-note">–</td>
      </tr>`).join("");
  }

  function setBar(el, value, signed) {
    const bar = el.firstElementChild;
    if (signed) {
      bar.style.left = `${Math.min(value, 0.5) * 100}%`;
      bar.style.width = `${Math.abs(value - 0.5) * 100}%`;
    } else {
      bar.style.left = "0";
      bar.style.width = `${clamp(value, 0, 1) * 100}%`;
    }
  }

  const latitude = (voice) => {
    const lat = Math.round(90 - (voice.fy / FH) * 180);
    return lat === 0 ? "EQ" : `${Math.abs(lat)}°${lat > 0 ? "N" : "S"}`;
  };

  function updateMonitor() {
    // Whole-map mode shows the loudest bands; the other modes show voices in slot order.
    const shown = state.mode === "map"
      ? voices.filter((v) => v.inputs && v.active).sort((a, b) => b.glow - a.glow || b.weight - a.weight).slice(0, MAX_VOICES)
      : voices.filter((v) => v.inputs && v.kind !== "hover").sort((a, b) => a.slot - b.slot);
    voicesBody.querySelectorAll("tr").forEach((row, index) => {
      const voice = shown[index];
      row.hidden = !voice;
      if (!voice) return;
      const swatch = row.querySelector(".lab-swatch");
      swatch.textContent = voice.kind === "band" ? latitude(voice) : String(voice.slot + 1);
      swatch.style.setProperty("--swatch", voice.kind === "band" ? rgba(mixRgb(voice.snowShare), 1) : voiceColor(voice));
      row.classList.toggle("is-quiet", !voice.active || isMuted(voice));
      row.querySelectorAll("[data-bar]").forEach((bar) => {
        const input = INPUTS.find((i) => i.key === bar.dataset.bar);
        setBar(bar, voice.inputs[bar.dataset.bar], input.signed);
      });
      const snowPercent = Math.round(voice.mix.snow ** 2 * 100);
      const tag = row.querySelector(".lab-voice-profile");
      tag.textContent = snowPercent < 5 ? "Rain" : snowPercent > 95 ? "Snow" : `Rain ${100 - snowPercent} · Snow ${snowPercent}`;
      tag.style.color = rgba(mixRgb(voice.snowShare), 1);
      const faded = voice.presence !== undefined && voice.presence < 0.95
        ? (voice.presence < 0.03 ? " · silent (no color here)" : ` · fading to ${Math.round(voice.presence * 100)}%`)
        : "";
      const playingText = (voiceLines(voice).map((l) => l.text).join(" / ") || "…") + faded;
      row.querySelector(".lab-voice-note").textContent = voice.active
        ? (voice.kind === "track" ? `Storm ${voice.trackId} · ${playingText}` : playingText)
        : "below color threshold";
    });

    // Focus: a playing voice of the profile being edited, so "Now" matches the table.
    const audible = (v) => v.active && v.inputs && !isMuted(v);
    const ranked = state.mode === "map" ? voices.slice().sort((a, b) => b.glow - a.glow) : voices;
    const focus = ranked.find((v) => audible(v) && v.profile === state.edit)
      || ranked.find(audible)
      || ranked.find((v) => v.inputs);
    matrixTable.querySelectorAll("[data-meter]").forEach((meter) => {
      const input = INPUTS.find((i) => i.key === meter.dataset.meter);
      setBar(meter, focus ? focus.inputs[meter.dataset.meter] : input.signed ? 0.5 : 0, input.signed);
    });
    for (const output of OUTPUTS) {
      const cell = matrixTable.querySelector(`[data-now="${output.key}"]`);
      cell.textContent = output.format(resolve(output.key, focus ? focus.inputs : null, editing()));
      cell.style.color = focus ? voiceColor(focus) : "";
    }

    if (state.mode === "tracked") {
      const frame = tracks.ready && tracks.pair ? tracks.frames[tracks.pair.k] : null;
      timeLabel.textContent = frame
        ? `${frame.time} UTC · SNAPSHOT ${tracks.pair.k + 1}/${tracks.frames.length} · ${state.globals.mapSpeed.toFixed(2)}×`
        : "LOADING";
    } else if (Number.isFinite(video.duration) && video.duration > 0) {
      timeLabel.textContent = `${Math.round((video.currentTime / video.duration) * 100)}% THROUGH THE WEEK · ${video.paused ? "PAUSED" : `${state.globals.mapSpeed.toFixed(2)}×`}`;
    }
  }

  function applyPreset(index) {
    const preset = PRESETS[index];
    const build = (patchRows) => {
      const rows = clone(DEFAULT_ROWS);
      for (const [key, patch] of Object.entries(patchRows)) Object.assign(rows[key], patch);
      return rows;
    };
    if (preset.profiles) {
      for (const kind of PROFILE_KEYS) {
        const part = preset.profiles[kind];
        state.profiles[kind] = { key: 0, scale: part.scale ?? 0, snap: true, rows: build(part.rows) };
      }
    } else {
      editing().rows = build(preset.rows);
      if (Number.isInteger(preset.scale)) editing().scale = preset.scale;
    }
    // Presets only change the sounds here: this page always stays the Storm picker.
    syncUI();
    saveState();
    const target = preset.profiles ? "both sounds" : `the ${PROFILE_INFO[state.edit].label.toLowerCase()} sound`;
    setStatus(`Preset “${preset.name}” loaded into ${target}.`);
  }

  function randomize() {
    const sources = INPUT_KEYS.filter((k) => k !== "manual");
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    for (const output of OUTPUTS) {
      const row = editing().rows[output.key];
      row.src = Math.random() < 0.3 ? "manual" : pick(sources);
      row.curve = pick(CURVES).key;
      if (output.key === "pitch") {
        row.lo = 36 + Math.floor(Math.random() * 30);
        row.hi = Math.min(96, row.lo + 12 + Math.floor(Math.random() * 24));
      } else if (output.key === "amp") {
        row.lo = Math.round((0.1 + Math.random() * 0.3) * 100) / 100;
        row.hi = Math.round((0.7 + Math.random() * 0.3) * 100) / 100;
      } else if (output.kind === "list") {
        const a = Math.floor(Math.random() * output.items.length);
        const b = Math.floor(Math.random() * output.items.length);
        row.lo = Math.min(a, b);
        row.hi = Math.max(a, b);
      } else {
        const a = lerp(output.min, output.max, Math.random());
        const b = lerp(output.min, output.max, Math.random());
        row.lo = Math.round(Math.min(a, b) * 100) / 100;
        row.hi = Math.round(Math.max(a, b) * 100) / 100;
      }
    }
    syncUI();
    saveState();
    setStatus(`Randomized every row of the ${PROFILE_INFO[state.edit].label.toLowerCase()} sound · keep what you like, change the rest.`);
  }

  async function copySettings() {
    const describe = (kind) => {
      const profile = state.profiles[kind];
      const lines = OUTPUTS.map((o) => {
        const r = profile.rows[o.key];
        if (r.src === "manual") return `  ${o.label}: fixed at ${o.format(r.lo)}`;
        const input = INPUTS.find((i) => i.key === r.src);
        const curve = CURVES.find((c) => c.key === r.curve);
        return `  ${o.label}: from ${input.label} (${curve.label.replace(/^\S+\s/, "")}), ${o.format(r.lo)} → ${o.format(r.hi)}`;
      }).join("\n");
      return `${PROFILE_INFO[kind].label.toUpperCase()} · ${NOTE_NAMES[profile.key]} ${SCALES[profile.scale].name}${profile.snap ? "" : " (no snap)"}\n${lines}`;
    };
    const text = `Gravitunes sound mapping\nMode: ${state.mode} · Tempo: ${state.globals.bpm} BPM\n\n${describe("rain")}\n\n${describe("snow")}\n\n${JSON.stringify(state)}`;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Mapping copied · paste it to your team.");
    } catch (error) {
      console.log(text);
      setStatus("Could not reach the clipboard · the mapping was printed to the browser console instead.");
    }
  }

  function canvasToField(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      fx: ((event.clientX - bounds.left) / bounds.width) * FW,
      fy: ((event.clientY - bounds.top) / bounds.height) * FH,
    };
  }

  function toggleProbeAt(fx, fy) {
    const picker = state.mode === "picker";
    if (state.mode !== "probes" && !picker) {
      state.mode = "probes";
      syncUI();
      saveState();
    }
    const existing = probes.findIndex((p) => Math.hypot(wrapDx(p.fx - fx), p.fy - fy) < (picker ? 8 : 6));
    if (existing >= 0) {
      const gone = probes.splice(existing, 1)[0];
      setStatus(picker ? `Spot ${gone.slot + 1} dropped · ${probes.length} picked.` : "Probe removed.");
      return;
    }
    // The picker keeps one slot for the hover preview, so it holds up to MAX_VOICES - 1 picks.
    const limit = picker ? MAX_VOICES - 1 : MAX_VOICES;
    const used = new Set(probes.map((p) => p.slot));
    if (picker) used.add(hoverVoice.slot);
    let slot = freeSlot(used);
    if (slot < 0 || probes.length >= limit) {
      slot = probes.shift().slot;
    }
    if (picker) {
      // A click near a storm lands on its heaviest spot, so the pick sits on the storm.
      const peak = maxNear(latestBlur, fx, fy, 3);
      if (peak.value > 0.02) {
        fx = (peak.index % FW) + 0.5;
        fy = Math.floor(peak.index / FW) + 0.5;
      }
    }
    const probe = makeVoice(slot, fx, fy);
    probe.kind = "probe";
    probe.fx0 = fx;
    probe.fy0 = fy;
    probe.waiting = picker && !pickerRunning;
    probes.push(probe);
    probes.sort((a, b) => a.slot - b.slot);
    if (!picker) {
      setStatus(`Probe ${slot + 1} placed · click it again to remove it.`);
      return;
    }
    // Say what the spot will play (the hover voice was just measured right here).
    const what = hoverVoice.inputs ? voiceLines(hoverVoice).map((l) => l.text).join(" / ") : "";
    setStatus(`Spot ${slot + 1} picked${what ? ` · will play ${what}` : ""} · ${probes.length} picked. Click it again to drop it; Space plays the week.`);
  }

  // Picker: the hover voice follows the mouse (or the arrow keys) over the map.
  function moveHover(fx, fy) {
    hoverVoice.fx = wrapX(fx);
    hoverVoice.fy = clamp(fy, 0, FH - 1);
  }

  // =========================================================================
  // Main loops
  // =========================================================================
  let lastFrameTime = 0;
  let lastVideoTime = 0;
  let lastMonitor = 0;

  function frame(timestamp) {
    const dtReal = lastFrameTime ? Math.min(0.1, (timestamp - lastFrameTime) / 1000) : 0;
    lastFrameTime = timestamp;
    if (videoReady && state.mode !== "tracked" && !useVideoFrameCallback && video.readyState >= 2) analyzeFrame(video.currentTime);
    if (state.mode === "scan") scanPhase = (scanPhase + dtReal / state.globals.scanSeconds) % 1;
    let dtVideo = video.currentTime - lastVideoTime;
    lastVideoTime = video.currentTime;
    if (dtVideo < 0) dtVideo = 0;
    updateVoices(dtVideo, dtReal);
    updateDrones();
    updateWeather(dtReal);
    updateGuide();
    drawOverlay();
    if (timestamp - lastMonitor > 120) {
      lastMonitor = timestamp;
      updateMonitor();
    }
    requestAnimationFrame(frame);
  }

  const useVideoFrameCallback = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
  function onVideoFrame(_now, metadata) {
    analyzeFrame(metadata.mediaTime);
    video.requestVideoFrameCallback(onVideoFrame);
  }

  // Called when the video analysis or the Storm Watch tracks become ready.
  function onSourceReady() {
    if (playButton.disabled) {
      playButton.disabled = false;
      playLabel.textContent = "Play sound";
    }
    if (playing) return;
    if (state.mode === "picker" && videoReady) {
      syncPlayButton();
      setStatus("Storm picker · the map waits on its first frame. Click once to turn the sound on, then move over it: the pulsing tone is where you are (left/right = ear, up/down = pitch), storms add rain or a snowstorm. Click storms to pick spots, type a spot's number to drop it, press Space to play the week.");
    } else if (state.mode === "tracked" && tracks.ready) {
      setStatus(`Storm Watch ready · ${tracks.byId.size} storms tracked through 7 Nov 2026. Press Play sound: each filled outline is a storm you hear, labeled with its notes. Click a storm to hear it alone.`);
    } else if (state.mode !== "tracked" && videoReady) {
      setStatus("Ready · press Play sound, then change rows in the mapping table.");
    }
  }

  let started = false;
  async function start() {
    if (started) return;
    started = true;
    try {
      await learnBackground();
    } catch (error) {
      background = null;
      console.warn("Sound lab could not learn the background; continuing without it.", error);
    }
    makeBasemap();
    // Prime the motion for the freeze frame: read the first few frames in order (so speed, spin and spread are
    // known at the start), then go back to the first frame.
    for (let k = 0; k <= FLOW_LAG; k += 1) {
      await seekTo(k / 30 + 0.001);
      analyzeFrame(video.currentTime);
    }
    await seekTo(0);
    analyzeFrame(video.currentTime);
    video.playbackRate = state.globals.mapSpeed;
    if (useVideoFrameCallback) video.requestVideoFrameCallback(onVideoFrame);
    videoReady = true;
    if (state.mode !== "tracked" && state.mode !== "picker") {
      try {
        await video.play();
      } catch (error) {
        console.warn("Map autoplay was blocked; it starts with Play sound.", error);
      }
    }
    onSourceReady();
  }

  // Read-only peek for debugging in the browser console: gravitunesLab.voices etc.
  window.gravitunesLab = {
    get state() { return state; },
    get voices() { return voices; },
    get scales() { return { speedScale, spinScale }; },
    get drones() { return drones; },
    instruments: INSTRUMENT_NAMES,
    // Step the analysis + sound + drawing by hand (for testing while the page isn't rendering frames).
    tick(dt = 0.05) {
      if (video.readyState >= 2) analyzeFrame(video.currentTime);
      updateVoices(0, dt);
      updateDrones();
      updateWeather(dt);
      updateGuide();
      drawOverlay();
      updateMonitor();
    },
    get audio() { return ac && { state: ac.state, time: ac.currentTime, playing, drones: drones.size, activeNotes }; },
    get weather() { return weather && { rainLight: weather.rainL.gain.value, rainHeavy: weather.rainH.gain.value, wind: weather.wind.gain.value, amount: hoverVoice.stormAmount }; },
    get guide() { return guide && { midi: guide.midi, gain: guide.gain, pan: guide.pan.pan.value }; },
    get picks() { return probes.map((p) => ({ n: p.slot + 1, fx: p.fx, fy: p.fy })); },
    get pickerRunning() { return pickerRunning; },
    get background() { return background; },
    // Debug: classify the current frame with and without the learned background; returns wet pixel counts.
    probeField() {
      const saved = background;
      const count = () => fieldI.reduce((n, v) => n + (v > 0.02 ? 1 : 0), 0);
      sampleField();
      const withBg = count();
      background = null;
      sampleField();
      const withoutBg = count();
      background = saved;
      sampleField();
      return { withBg, withoutBg };
    },
    fields: { fieldI, fieldS, cellU, cellV, cellSpin, cellDiv, cellMass, rawOK },
    // Render one note offline and return its peak level (checks an instrument works, silently).
    async renderInstrument(index, midi = 72) {
      const savedContext = ac;
      const savedWaves = new Map(waveCache);
      const offline = new OfflineAudioContext(2, 44100 * 3, 44100);
      waveCache.clear();
      ac = offline;
      try {
        const out = offline.createGain();
        out.connect(offline.destination);
        INSTRUMENTS[index].play({ t: 0.01, dur: 0.5, freq: midiFreq(midi), amp: 0.5, bright: 0.6, vib: 0.3, loud: 0.6, out });
      } finally {
        ac = savedContext;
        waveCache.clear();
        savedWaves.forEach((wave, id) => waveCache.set(id, wave));
      }
      const buffer = await offline.startRendering();
      let peak = 0;
      for (const sample of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
      return peak;
    },
    // Render a continuous voice gliding from one chord to another; returns the level per 0.5 s.
    async renderDrone(index, from = [60, 64, 67], to = [62, 65, 69]) {
      const spec = INSTRUMENTS[index].sustain;
      if (!spec) return null;
      const savedContext = ac;
      const savedWaves = new Map(waveCache);
      const offline = new OfflineAudioContext(2, 44100 * 4, 44100);
      waveCache.clear();
      ac = offline;
      try {
        const out = offline.createGain();
        out.connect(offline.destination);
        const layer = buildLayer(spec, from.length, 0.5, out, 0);
        layer.strands.forEach((strand, i) => {
          strand.gain.gain.setValueAtTime(1 / Math.sqrt(from.length), 0);
          for (const [param, mult] of strand.freqs) {
            param.setValueAtTime(midiFreq(from[i]) * mult, 0);
            param.setTargetAtTime(midiFreq(to[i]) * mult, 2, 0.1);
          }
        });
        layer.filter.frequency.setValueAtTime(cutoff(spec, midiFreq(from[0]), 0.5, 0.6), 0);
        layer.env.gain.setTargetAtTime(0.3, 0, Math.max(0.04, spec.attack / 3));
        layer.env.gain.setTargetAtTime(0, 3.2, Math.max(0.06, spec.release / 3));
      } finally {
        ac = savedContext;
        waveCache.clear();
        savedWaves.forEach((wave, id) => waveCache.set(id, wave));
      }
      const data = (await offline.startRendering()).getChannelData(0);
      const levels = [];
      for (let start = 0; start < data.length; start += 22050) {
        let sum = 0;
        for (let i = start; i < start + 22050; i += 1) sum += data[i] * data[i];
        levels.push(Math.round(Math.sqrt(sum / 22050) * 1000) / 1000);
      }
      return levels;
    },
  };

  // ---------- Wire up ----------
  buildGlobals();
  buildMatrix();
  buildVoiceMonitor();
  syncUI();
  presetSelect.innerHTML = '<option value="" disabled selected>Load a preset…</option>'
    + PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join("");

  playButton.addEventListener("click", () => {
    if (state.mode === "picker") setPickerRunning(!pickerRunning);
    else if (playing) pauseSound();
    else startSound();
  });
  stopButton.addEventListener("click", () => {
    if (state.mode === "picker" && pickerRunning) setPickerRunning(false);
    stopSound();
  });
  restartButton.addEventListener("click", restartPicker);

  // Picker: the sound wakes on the first click or key (browsers need one), so hovering is heard right away.
  const wakeAudio = () => {
    if (state.mode === "picker" && !playing && videoReady) startSound();
  };
  window.addEventListener("pointerdown", wakeAudio, { capture: true });
  window.addEventListener("keydown", wakeAudio, { capture: true });
  // Space plays or stops the day anywhere on the page, even when a button or slider has focus (so it never
  // presses that button instead, e.g. Randomize). Only a menu, a check box or a text field keeps its own Space.
  // Hear the storm's intro, tutorial and info cards and its top buttons keep their own Space too (hear.js).
  const keepsSpace = (el) => el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable
    || (el.tagName === "INPUT" && el.type !== "range")
    || !!el.closest?.(".hts-intro, .hts-card, .hts-top, summary")
    || document.body.classList.contains("is-intro") || document.body.classList.contains("is-tutorial");
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || state.mode !== "picker" || !videoReady || keepsSpace(event.target)) return;
    event.preventDefault();
    if (!event.repeat) setPickerRunning(!pickerRunning); // holding Space down doesn't flip it on and off
  });
  // A focused button would otherwise "click" when Space comes back up.
  document.addEventListener("keyup", (event) => {
    if (event.code === "Space" && state.mode === "picker" && !keepsSpace(event.target)) event.preventDefault();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (state.mode !== "picker") return;
    const { fx, fy } = canvasToField(event);
    moveHover(fx, fy);
    hoverOver = true;
  });
  canvas.addEventListener("pointerenter", () => { if (state.mode === "picker") hoverOver = true; });
  canvas.addEventListener("pointerleave", () => { hoverOver = false; });
  // Leaving the page (another window or tab) also stops the cursor's sounds: the mouse may never "leave" the map.
  window.addEventListener("blur", () => { hoverOver = false; });
  // A hidden tab stops drawing frames, so nothing would update the sound: silence the picking sounds now, and
  // stop the day (it can't follow the map while hidden). Space plays on from there.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden || state.mode !== "picker") return;
    hoverOver = false;
    silencePickingSounds();
    if (pickerRunning) setPickerRunning(false);
  });
  // Arrow-key listening stops when the map loses keyboard focus (unless the mouse is over it).
  canvas.addEventListener("blur", () => { if (!canvas.matches(":hover")) hoverOver = false; });
  presetSelect.addEventListener("change", () => {
    applyPreset(Number(presetSelect.value));
    presetSelect.value = "";
  });
  randomButton.addEventListener("click", randomize);
  copyButton.addEventListener("click", copySettings);
  resetButton.addEventListener("click", () => {
    state = defaultState();
    syncUI();
    saveState();
    setStatus("Everything reset to the default mapping.");
  });
  clearProbesButton.addEventListener("click", () => {
    probes = [];
    setStatus(state.mode === "picker" ? "Picks cleared · click storms to pick new spots." : "Probes cleared · click the map to place new ones.");
  });
  modeInputs.forEach((input) => input.addEventListener("change", () => {
    state.mode = input.value;
    voices = [];
    syncUI();
    saveState();
    if (state.mode === "tracked") {
      setStatus(tracks.ready
        ? "Storm Watch · each filled outline is a tracked storm you hear. Rings mark merges and splits; click a storm to hear it alone."
        : tracks.failed ? "Could not load the Storm Watch tracks (earth-jukebox/data/storm-watch)." : "Loading Storm Watch tracks…");
    }
    if (state.mode === "picker") {
      pickerRunning = false;
      restartPicker();
    }
    if (state.mode === "probes" && !probes.length) setStatus("Click anywhere on the map to drop a listening probe (up to 8).");
    if (state.mode === "map") setStatus(`Whole map · ${BANDS} latitude bands each sound as loud as they are covered, panned to where the precipitation sits.`);
  }));
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const { fx, fy } = canvasToField(event);
    if (state.mode === "tracked") {
      // Click a storm you hear to solo it; click it again (or anywhere else) to hear them all.
      const hit = voices.find((v) => Math.hypot(wrapDx(v.fx - fx), v.fy - fy) < 7);
      state.solo = hit && state.solo !== hit.slot + 1 ? hit.slot + 1 : 0;
      syncUI();
      saveState();
      setStatus(state.solo ? `Listening to Storm ${hit.trackId} alone · click it again to hear every storm.` : "Listening to every storm.");
      return;
    }
    toggleProbeAt(fx, fy);
  });
  canvas.addEventListener("keydown", (event) => {
    if (state.mode === "tracked") {
      // Arrow keys step through the storms you hear (solo); Escape brings them all back.
      if (!["ArrowRight", "ArrowLeft", "Escape"].includes(event.key) || !voices.length) return;
      event.preventDefault();
      const order = voices.map((v) => v.slot + 1);
      const at = order.indexOf(state.solo);
      if (event.key === "Escape") state.solo = 0;
      else state.solo = order[(at + (event.key === "ArrowRight" ? 1 : order.length - 1 + (at < 0 ? 1 : 0))) % order.length];
      syncUI();
      saveState();
      const soloed = voices.find((v) => v.slot + 1 === state.solo);
      setStatus(soloed ? `Storm ${soloed.trackId} alone · ${voiceLines(soloed).map((l) => l.text).join(" / ")}` : "Listening to every storm.");
      return;
    }
    if (state.mode === "picker") {
      // Keyboard picking: arrows move the listening point (Shift = small steps), Enter picks or drops a spot there.
      const step = event.shiftKey ? 1 : 4;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[event.key]) {
        event.preventDefault();
        if (!hoverOver) moveHover(FW / 2, FH / 2);
        moveHover(hoverVoice.fx + moves[event.key][0], hoverVoice.fy + moves[event.key][1]);
        hoverOver = true;
        const inp = hoverVoice.inputs;
        if (inp) setStatus(`${latitude(hoverVoice)}, ${inp.color > 0.05 ? (inp.snow >= 0.5 ? "snow" : "rain") : "dry"} · ${voiceLines(hoverVoice).map((l) => l.text).join(" / ")}`);
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (!hoverOver) moveHover(FW / 2, FH / 2);
      hoverOver = true;
      toggleProbeAt(hoverVoice.fx, hoverVoice.fy);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    toggleProbeAt(FW / 2 + (Math.random() - 0.5) * 40, FH / 2 + (Math.random() - 0.5) * 20);
  });

  // The end of the day: the music stops and the map stays on the last frame.
  video.addEventListener("ended", () => {
    if (state.mode !== "picker" || !pickerRunning) return;
    pickerRunning = false;
    hushMusic();
    syncPlayButton();
    setStatus("The week is over · Space plays it again from the first frame, with your picks where you placed them.");
  });

  // Typing a pick's number drops that pick (1–7), while picking or while the day plays.
  document.addEventListener("keydown", (event) => {
    if (state.mode !== "picker" || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    const n = /^Digit([1-9])$/.exec(event.code)?.[1] ?? /^Numpad([1-9])$/.exec(event.code)?.[1];
    if (!n) return;
    const at = probes.findIndex((p) => p.slot + 1 === Number(n));
    event.preventDefault();
    if (at < 0) {
      setStatus(`There is no spot ${n} · ${probes.length ? `picked: ${probes.map((p) => p.slot + 1).join(", ")}` : "nothing picked yet"}.`);
      return;
    }
    probes.splice(at, 1);
    setStatus(`Spot ${n} dropped · ${probes.length} picked.`);
  });

  video.addEventListener("error", () => {
    setStatus("Could not load the map video. Start the server from the repository root (see README).");
  });
  if (video.readyState >= 2) start();
  else video.addEventListener("loadeddata", start, { once: true });
  loadTracks();
  requestAnimationFrame(frame);
})();
