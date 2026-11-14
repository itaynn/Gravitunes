// Vortex melodies: pure logic (no DOM), tested by test.mjs.
// Input: the compact vortices.json written by analysis/scripts/vortex-melodies/build.py.
import { rankNormaliser } from '../../core/flow.js';
import { snapToScale } from '../../core/scales.js';

// Motifs as scale steps (ascending form) from a root (semitones from C4). Big vortices: longer and lower (from G2);
// small: short and higher (from G3). Everything stays within about G2..G4.
export const MOTIFS = [
  { name: 'small', steps: [0, 2, 4], root: -5 },
  { name: 'medium', steps: [0, 1, 3, 2, 4], root: -12 },
  { name: 'large', steps: [0, 2, 1, 3, 2, 4, 3, 5], root: -17 },
];

// Counterclockwise = ascending motif; clockwise = mirrored (inverted) and descending.
export function orient(steps, direction) {
  if (direction !== 'cw') return steps.slice();
  const top = Math.max(...steps);
  return steps.map((s) => top - s);
}

// Rank normalisers over every vortex observation in the sequence. Spin is underestimated by smoothing, so
// only its rank is used; strength = |circulation| and size = radius are ranked the same way.
export function buildRanks(data) {
  const all = data.frames.flat();
  const tracks = data.tracks;
  return {
    spin: rankNormaliser(all.map((v) => v.spin)),
    size: rankNormaliser(all.map((v) => v.r)),
    strength: rankNormaliser(all.map((v) => v.circ * v.r)),
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
  const list = (data.frames[t] || []).map((v) => {
    const tr = trackById.get(v.id);
    const loud = (0.35 + 0.65 * ranks.strength(v.circ * v.r)) * lifeFade(t, tr);
    return { ...v, track: tr, loud, spinRank: ranks.spin(v.spin), sizeRank: ranks.size(v.r) };
  });
  return list.sort((a, b) => b.loud - a.loud || a.id - b.id).slice(0, Math.max(0, maxVoices));
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
