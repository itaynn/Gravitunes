// Vortex melodies: pure logic (no DOM), tested by test.mjs.
// Input: the compact vortices.json written by analysis/scripts/vortex-melodies/build.py.
import { rankNormaliser } from '../../core/flow.js';
import { snapToScale, LOW_SEMIS, HIGH_SEMIS } from '../../core/scales.js';

// The tunes' default range, semitones from C4 (C2..E6); the Low / High menus change it (range-control.js).
export const TUNE_LOW = LOW_SEMIS, TUNE_HIGH = HIGH_SEMIS;

// Motifs as scale steps (ascending form) from a root (semitones from C4). Big vortices: longer and lower (from C4);
// small: short and higher (from C5). Everything stays within C4..E6.
export const MOTIFS = [
  { name: 'small', steps: [0, 2, 4], root: 12 },
  { name: 'medium', steps: [0, 1, 3, 2, 4], root: 5 },
  { name: 'large', steps: [0, 2, 1, 3, 2, 4, 3, 5], root: 0 },
];

// Rotating marker: loop position u (in notes since the loop origin) -> fraction of one turn (0..1).
// The mark rests at note k's angle k/n when note k sounds and glides (smoothstep) to the next, so one
// melody = exactly one revolution and the loop restart is seamless.
export function markTurn(u, n) {
  const k = Math.floor(u), f = u - k, e = f * f * (3 - 2 * f);
  return ((((k + e) / n) % 1) + 1) % 1;
}

// Counterclockwise = ascending motif; clockwise = mirrored (inverted) and descending.
export function orient(steps, direction) {
  if (direction !== 'cw') return steps.slice();
  const top = Math.max(...steps);
  return steps.map((s) => top - s);
}

// Rank normalisers over every vortex observation in the sequence. Spin is underestimated by smoothing, so
// only its rank is used; strength = |circulation| and size = radius are ranked the same way.
// Hotspots (data.kind 'hotspots') reuse the slots: size = area, strength = mean intensity, spin = peak intensity.
export const metric = (data) => data.kind === 'hotspots'
  ? { size: (v) => v.area, strength: (v) => v.mean, spin: (v) => v.peak }
  : { size: (v) => v.r, strength: (v) => v.circ * v.r, spin: (v) => v.spin };
export function buildRanks(data) {
  const all = data.frames.flat();
  const tracks = data.tracks, m = metric(data);
  return {
    spin: rankNormaliser(all.map(m.spin)),
    size: rankNormaliser(all.map(m.size)),
    strength: rankNormaliser(all.map(m.strength)),
    lifetime: rankNormaliser(tracks.map((t) => t.frames)),
  };
}

// Loop period in seconds from spin rank: slowest 4 s, fastest 1.2 s.
export const loopSeconds = (spinRank, slow = 4, fast = 1.2) => slow + (fast - slow) * Math.max(0, Math.min(1, spinRank));

// Fade in at birth, out at death (frames). Returns 0..1.
export function lifeFade(t, track, fade = 2) {
  if (!track) return 1;
  const a = Math.min(1, (t - track.birth + 1) / fade), b = Math.min(1, (track.death - t + 1) / fade);
  return Math.max(0, Math.min(a, b));
}

// Which motif: by size (default), by region index, or by lifetime rank.
export function motifIndex(by, { sizeRank = 0.5, regionIndex = 0, lifetimeRank = 0.5 }) {
  const n = MOTIFS.length;
  if (by === 'region') return ((regionIndex % n) + n) % n;
  const x = by === 'lifetime' ? lifetimeRank : sizeRank;
  return Math.min(n - 1, Math.floor(x * n));
}

// The vortices that sound at frame t: loudness = strength x size rank x life fade; loudest first, capped.
export function activeVortices(data, ranks, t, maxVoices, trackById) {
  const m = metric(data);
  const list = (data.frames[t] || []).map((v) => {
    const tr = trackById.get(v.id), st = ranks.strength(m.strength(v));
    const loud = (0.35 + 0.65 * st) * lifeFade(t, tr);
    return { ...v, track: tr, loud, fade: lifeFade(t, tr), spinRank: ranks.spin(m.spin(v)), sizeRank: ranks.size(m.size(v)), strengthRank: st };
  });
  return list.sort((a, b) => b.loud - a.loud || a.id - b.id).slice(0, Math.max(0, maxVoices));
}

// Mapping: each sound property (pitch, volume, tempo, notes) takes its value from one data source (size,
// strength, spin speed) or nothing (fixed middle value); spin direction optionally turns the tune up (ccw) or
// down (cw). Location is always instrument + pan.
export const SOURCES = ['nothing', 'size', 'strength', 'spin'];
export const DEFAULT_MAP = { pitch: 'size', volume: 'strength', tempo: 'spin', notes: 'size', direction: 'nothing' };
// Hotspots: Pitch <- intensity (stronger = higher, pitchUp), Volume <- size, Tempo <- peak, Notes <- size.
export const HOTSPOT_MAP = { pitch: 'strength', volume: 'size', tempo: 'spin', notes: 'size', direction: 'nothing', pitchUp: true };
// Rank 0..1 of the source chosen for `target`, or null for nothing.
export function targetRank(v, map, target) {
  const src = { size: v.sizeRank, strength: v.strengthRank, spin: v.spinRank }[map[target]];
  return src ?? null;
}
// Notes per loop: 3..8 (higher rank = more notes); nothing = 5.
export const NOTES_MIN = 3, NOTES_MAX = 8, NOTES_FIXED = 5;
export const noteCount = (rank) => rank == null ? NOTES_FIXED : Math.round(NOTES_MIN + (NOTES_MAX - NOTES_MIN) * Math.max(0, Math.min(1, rank)));
// Motif of n notes (scale steps, ascending form): a rising zig-zag, prefix of 0 2 1 3 2 4 3 5.
const ZIGZAG = [0, 2, 1, 3, 2, 4, 3, 5];
export const motifSteps = (n) => ZIGZAG.slice(0, Math.max(1, Math.min(ZIGZAG.length, n)));
// Motif root (semitones from C4) from pitch rank, within the range low..high (the motif needs about an octave above
// its root): high rank = the lowest note, low rank = an octave under the top; nothing = middle.
export const pitchRoot = (rank, low = TUNE_LOW, high = TUNE_HIGH) => Math.round(low + Math.max(0, high - 12 - low) * (1 - (rank ?? 0.5)));
// Sound parameters for a vortex under `map`: root, notes per loop, loudness, loop seconds.
export function mapped(v, map, range = { low: TUNE_LOW, high: TUNE_HIGH }) {
  const p = targetRank(v, map, 'pitch'), vol = targetRank(v, map, 'volume'), tempo = targetRank(v, map, 'tempo');
  return {
    root: pitchRoot(p != null && map.pitchUp ? 1 - p : p, range.low, range.high),
    n: noteCount(targetRank(v, map, 'notes')),
    loud: (0.35 + 0.65 * (vol ?? 0.6)) * (v.fade ?? 1),
    loop: loopSeconds(tempo ?? 0.5),
  };
}

// Divergence bed for one frame: net convergence -1 (all spreading) .. +1 (all converging).
export function convergence(div, t) {
  let conv = 0, spread = 0;
  for (let y = 0; y < div.H; y++) for (let x = 0; x < div.W; x++) {
    const d = div.at(t, 0, y, x);
    if (d == null) continue;
    const w = Math.cos(((90 - ((y + 0.5) / div.H) * 180) * Math.PI) / 180);   // area weight
    if (d < 0) conv -= d * w; else spread += d * w;
  }
  return conv + spread > 0 ? (conv - spread) / (conv + spread) : 0;
}

// "1 turn per 6 hours" / "1 turn per 3 days".
export function periodText(turnsPerHour) {
  if (!(turnsPerHour > 0)) return 'no measurable spin';
  const h = 1 / turnsPerHour;
  return h >= 48 ? `1 turn per ${Math.round(h / 24)} days` : `1 turn per ${Math.round(h)} hours`;
}

// Notes due in (from, to] seconds for a loop with phase origin t0: returns [{k, at}] (k = motif step index).
export function dueNotes(nSteps, loopSec, t0, from, to) {
  const step = loopSec / nSteps, out = [];
  let k = Math.ceil((from - t0) / step + 1e-9);
  for (; t0 + k * step <= to; k++) out.push({ k: ((k % nSteps) + nSteps) % nSteps, at: t0 + k * step });
  return out;
}

// Frequency of motif step k: `step` scale tones above the first tone at or above rootHz, shifted by the
// voice's octave and snapped back onto `tones` (the chosen scale within C2..C5), so it stays in scale.
export function motifFreq(tones, rootHz, step, octave = 0) {
  const root = Math.max(0, tones.findIndex((f) => f >= rootHz * 0.999));
  const f = tones[Math.max(0, Math.min(tones.length - 1, root + step))] * 2 ** octave;
  return snapToScale(f, tones);
}

// Keyboard-move text when no vortex is under the cursor: "no vortex; nearest 1200 km north-west".
export function nearestText(lat, lon, vortices, dist, compass) {
  let best = null, bestD = Infinity;
  for (const v of vortices) { const d = dist(lat, lon, v.lat, v.lon); if (d < bestD) { bestD = d; best = v; } }
  if (!best) return 'no vortex; none at this time';
  return `no vortex; nearest ${Math.round(bestD / 100) * 100} km ${compass(lat, lon, best.lat, best.lon)}`;
}
