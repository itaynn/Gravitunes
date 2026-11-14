// Mapping lab: pure logic (no DOM), tested by app/modes/mapping-lab/test.mjs.
// A mapping says, for each sound parameter, which data source drives it (or 'off') and whether it is flipped.
import { quantize, noteHz, noteName, C4 } from '../../core/scales.js';
import { blendVoices, shapeForPitch } from '../../core/voices.js';

export const SOURCES = {
  off: 'off',
  lon: 'longitude (west to east)',
  lat: 'latitude (south to north)',
  value: 'value',
  change: 'change (how fast it rises)',
};

export const PARAMS = {
  pitch: { label: 'Pitch', lo: 'low', hi: 'high' },
  loudness: { label: 'Loudness', lo: 'quiet', hi: 'loud' },
  pan: { label: 'Pan', lo: 'left', hi: 'right' },
  brightness: { label: 'Brightness (overtones)', lo: 'few overtones', hi: 'many overtones' },
  depth: { label: 'Depth (dark to bright filter)', lo: 'dark', hi: 'bright' },
  attack: { label: 'Attack (soft to plucky)', lo: 'soft', hi: 'plucky' },
  timbre: { label: 'Timbre family', lo: 'organ', hi: 'flute' },
};

// Timbre family: morph along these voices (instruments.json ids). Gamelan stands in for "bell".
export const FAMILY = ['organ', 'gamelan', 'panflute'];
export const FAMILY_LABEL = { organ: 'organ', gamelan: 'bell', panflute: 'flute' };

// Value used when a parameter is off (0..1).
export const DEFAULTS = { pitch: 0.5, loudness: 0.5, pan: 0.5, brightness: 0.5, depth: 0.75, attack: 0.4, timbre: 0 };

const off = () => Object.fromEntries(Object.keys(PARAMS).map((p) => [p, { src: 'off', flip: false }]));
const preset = (label, set) => {
  const m = off();
  for (const [p, src, flip = false] of set) m[p] = { src, flip };
  return { label, mapping: m };
};
export const PRESETS = {
  classic: preset('Classic', [['pitch', 'value'], ['pan', 'lon'], ['loudness', 'value']]),
  deepsouth: preset('Deep south', [['depth', 'lat'], ['pitch', 'value']]),
  stormrush: preset('Storm rush', [['attack', 'change'], ['brightness', 'change'], ['pitch', 'value']]),
  aroundworld: preset('Around the world', [['timbre', 'lon'], ['pitch', 'lat']]),
};
export const emptyMapping = off;
export const cloneMapping = (m) => Object.fromEntries(Object.keys(PARAMS).map((p) => [p, { ...(m[p] || { src: 'off', flip: false }) }]));

// Which preset (key) a mapping equals, or null.
export function presetOf(m) {
  const same = (a, b) => Object.keys(PARAMS).every((p) => a[p].src === b[p].src && (a[p].src === 'off' || !!a[p].flip === !!b[p].flip));
  return Object.keys(PRESETS).find((k) => same(m, PRESETS[k].mapping)) || null;
}

// URL form: "pitch:value,pan:lon,depth:-lat" ('-' = flipped, off params omitted); a preset key also parses.
export function encodeMapping(m) {
  return Object.keys(PARAMS).filter((p) => m[p]?.src && m[p].src !== 'off')
    .map((p) => `${p}:${m[p].flip ? '-' : ''}${m[p].src}`).join(',');
}
export function decodeMapping(str) {
  if (str == null) return null;
  if (PRESETS[str]) return cloneMapping(PRESETS[str].mapping);
  const m = off();
  for (const part of String(str).split(',')) {
    const [p, raw = ''] = part.split(':');
    const flip = raw.startsWith('-'), src = flip ? raw.slice(1) : raw;
    if (PARAMS[p] && SOURCES[src]) m[p] = { src, flip };
  }
  return m;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Source values (0..1) for one point. change: rise per frame, full scale at 10% of the range.
export function sourceValues({ lat, lon, value, prev }, [lo, hi]) {
  const span = hi - lo || 1;
  const delta = value != null && prev != null ? value - prev : 0;
  return {
    lon: clamp01((lon + 180) / 360),
    lat: clamp01((lat + 90) / 180),
    value: value == null ? 0.5 : clamp01((value - lo) / span),
    change: clamp01(delta / (0.1 * span)),
    delta,
  };
}

// 0..1 control for each parameter from the mapping.
export function controls(mapping, src) {
  const out = {};
  for (const p of Object.keys(PARAMS)) {
    const m = mapping[p];
    if (!m || m.src === 'off') { out[p] = DEFAULTS[p]; continue; }
    const x = src[m.src] ?? 0.5;
    out[p] = m.flip ? 1 - x : x;
  }
  return out;
}

const lerp = (a, b, w) => a + (b - a) * w;
const word = (x, lo, mid, hi) => (x < 0.34 ? lo : x > 0.66 ? hi : mid);

// Voice at timbre position x in 0..1 along FAMILY.
export function familyVoice(x, instruments) {
  const pos = clamp01(x) * (FAMILY.length - 1);
  const i = Math.min(FAMILY.length - 2, Math.floor(pos)), w = pos - i;
  const a = FAMILY[i], b = FAMILY[i + 1];
  const voice = blendVoices(instruments[a], instruments[b], 1 - w);
  const label = w < 0.15 ? FAMILY_LABEL[a] : w > 0.85 ? FAMILY_LABEL[b] : `${FAMILY_LABEL[a]}-${FAMILY_LABEL[b]} blend`;
  return { voice, label };
}

export const depthHz = (x) => 200 * 2 ** (clamp01(x) * 5.3);       // ~200 Hz (dark) .. ~8 kHz (bright)
export const attackSec = (x) => 0.25 * (0.003 / 0.25) ** clamp01(x); // 250 ms (soft) .. 3 ms (plucky)
export const overtoneCount = (x) => 1 + Math.round(clamp01(x) * 11); // 1 .. 12 partials
export const freqName = (f) => noteName(Math.round(12 * Math.log2(f / C4)));

// Note for one point: ready-to-play sound.play() options plus spoken labels per parameter.
// opts: { range, scale, lowSemis, highSemis, instruments, dur }
export function renderNote(mapping, point, opts) {
  const { range, scale = 'pentatonic-major', lowSemis = -24, highSemis = 12, instruments, dur = 0.5 } = opts;
  const src = sourceValues(point, range);
  const c = controls(mapping, src);
  const lowHz = noteHz(Math.max(-24, lowSemis)), highHz = noteHz(Math.min(12, highSemis));
  const freq = quantize(c.pitch, [0, 1], scale, lowHz, highHz).freq;

  const { voice: base, label: timbreLabel } = familyVoice(c.timbre, instruments);
  let voice = { ...base };
  const brightnessOn = mapping.brightness?.src && mapping.brightness.src !== 'off';
  if (brightnessOn) {
    const n = overtoneCount(c.brightness);
    const hs = voice.harmonics?.length ? voice.harmonics : [1];
    voice.harmonics = Array.from({ length: n }, (_, k) => (k < hs.length ? hs[k] : 0) || (k ? 0.5 / (k + 1) ** 1.2 : 1));
    voice.partials = (voice.partials || []).filter((p) => p.ratio <= n + 0.5);
    voice.brightness = 0.25 + 0.75 * c.brightness;
  }
  const shaped = shapeForPitch(voice, freq);
  const atk = attackSec(c.attack);
  const env = { attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.4, ...shaped.envelope };
  const attackOn = mapping.attack?.src && mapping.attack.src !== 'off';
  const envelope = attackOn
    ? { ...env, attack: atk, sustain: lerp(Math.max(env.sustain, 0.6), Math.min(env.sustain, 0.3), c.attack) }
    : env;
  const noise = shaped.noise && attackOn ? { ...shaped.noise, amount: shaped.noise.amount * lerp(0.3, 1.5, c.attack) } : shaped.noise;
  const lowpass = depthHz(c.depth);

  const play = {
    freq, amp: lerp(0.08, 0.5, c.loudness), pan: lerp(-0.9, 0.9, c.pan),
    dur: Math.max(dur, envelope.attack + 0.05), harmonics: shaped.harmonics, partials: shaped.partials,
    envelope, noise, lowpass,
  };
  const labels = {
    pitch: freqName(freq),
    loudness: word(c.loudness, 'quiet', 'medium', 'loud'),
    pan: word(c.pan, 'left', 'center', 'right'),
    brightness: `${overtoneCount(c.brightness)} overtones`,
    depth: word(c.depth, 'dark', 'mellow', 'bright'),
    attack: word(c.attack, 'soft', 'medium', 'plucky'),
    timbre: timbreLabel,
  };
  return { play, labels, controls: c, src };
}

const fmtLat = (lat) => `${Math.abs(Math.round(lat))}°${lat >= 0 ? 'N' : 'S'}`;
const fmtLon = (lon) => `${Math.abs(Math.round(lon))}°${lon >= 0 ? 'E' : 'W'}`;

// "value 45 → pitch D3, latitude 30°N → depth dark" for the mapped parameters.
export function describeNote(mapping, point, labels, units = '', delta = 0) {
  const srcText = {
    lon: `longitude ${fmtLon(point.lon)}`,
    lat: `latitude ${fmtLat(point.lat)}`,
    value: `value ${point.value == null ? 'no data' : Math.round(point.value * 10) / 10}${units ? ` ${units}` : ''}`,
    change: `change ${delta >= 0 ? '+' : ''}${Math.round(delta * 10) / 10}`,
  };
  const parts = Object.keys(PARAMS).filter((p) => mapping[p]?.src && mapping[p].src !== 'off')
    .map((p) => `${srcText[mapping[p].src]} → ${PARAMS[p].label.split(' (')[0].toLowerCase()} ${labels[p]}${mapping[p].flip ? ' (flipped)' : ''}`);
  return parts.length ? parts.join(', ') : 'nothing mapped';
}

// ~300 listening points on an even lat/lon grid (land and ocean).
export function makePoints({ latStep = 10, lonStep = 20, maxLat = 75 } = {}) {
  const pts = [];
  for (let lat = maxLat; lat >= -maxLat; lat -= latStep)
    for (let lon = -180 + lonStep / 2; lon < 180; lon += lonStep) pts.push({ lat, lon });
  return pts;
}
