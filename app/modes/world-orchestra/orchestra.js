// World orchestra: pure logic (no DOM), tested by app/modes/world-orchestra/test.mjs.

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;

export function distKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// The two nearest centers: [{center, km}, {center, km}].
export function nearestCenters(lat, lon, centers) {
  return centers.map((c) => ({ center: c, km: distKm(lat, lon, c.lat, c.lon) }))
    .sort((a, b) => a.km - b.km).slice(0, 2);
}

// Weight of the nearest center. Outside the blend zone (d2 - d1 >= blendKm) it is 1;
// on the exact boundary (d1 == d2) it is 0.5.
export function blendWeight(d1, d2, blendKm) {
  if (!(blendKm > 0)) return 1;
  const gap = d2 - d1;
  return gap >= blendKm ? 1 : 0.5 + 0.5 * (gap / blendKm);
}

const lerp = (a, b, w) => a * w + b * (1 - w);

// Crossfade two instrument presets: w = weight of `a`.
export function blendVoices(a, b, w) {
  if (!b || w >= 1) return { ...a };
  if (w <= 0) return { ...b };
  const ha = a.harmonics || [], hb = b.harmonics || [];
  const n = Math.max(ha.length, hb.length);
  const harmonics = n ? Array.from({ length: n }, (_, k) => lerp(ha[k] || 0, hb[k] || 0, w)) : undefined;
  const partials = [
    ...(a.partials || []).map((p) => ({ ...p, amp: p.amp * w })),
    ...(b.partials || []).map((p) => ({ ...p, amp: p.amp * (1 - w) })),
  ];
  const ea = { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.4, ...a.envelope };
  const eb = { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.4, ...b.envelope };
  const envelope = Object.fromEntries(Object.keys(ea).map((k) => [k, lerp(ea[k], eb[k], w)]));
  const na = a.noise, nb = b.noise;
  const noise = na || nb ? {
    amount: lerp(na?.amount || 0, nb?.amount || 0, w),
    attack: lerp(na?.attack ?? 0.01, nb?.attack ?? 0.01, w),
    decay: lerp(na?.decay ?? 0.1, nb?.decay ?? 0.1, w),
    cutoff: lerp(na?.cutoff ?? 2000, nb?.cutoff ?? 2000, w),
  } : undefined;
  return {
    harmonics: harmonics || [0], partials, envelope, noise,
    brightness: lerp(a.brightness ?? 0.5, b.brightness ?? 0.5, w),
    dur: lerp(a.dur ?? 0.4, b.dur ?? 0.4, w),
  };
}

// The blended voice at a spot: nearest center's instrument, mixed with the second within the blend zone.
export function voiceAt(lat, lon, centers, instruments, blendKm = 800) {
  const [n1, n2] = nearestCenters(lat, lon, centers);
  const w = n2 ? blendWeight(n1.km, n2.km, blendKm) : 1;
  const a = instruments[n1.center.instrument], b = n2 && instruments[n2.center.instrument];
  return { primary: n1.center, secondary: w < 1 ? n2.center : null, weight: w, voice: blendVoices(a, b, w) };
}

// Make a voice safe at pitch `freq`: apply brightness, then roll off upper partials as pitch rises
// so bright voices never get shrill. Partials above `ceiling` Hz are dropped.
export function shapeForPitch(voice, freq, { cutoff = 1800, ceiling = 4000 } = {}) {
  const b = voice.brightness ?? 0.5;
  const tilt = 1 - b;                                  // 0 = keep, 1 = extra 1/k
  const roll = (f) => (f <= cutoff ? 1 : (cutoff / f) ** 2);
  const harmonics = (voice.harmonics || [1]).map((h, i) => {
    const k = i + 1, f = freq * k;
    return f > ceiling ? 0 : h * k ** -tilt * roll(f);
  });
  const partials = (voice.partials || []).filter((p) => freq * p.ratio <= ceiling)
    .map((p) => ({ ...p, amp: p.amp * roll(freq * p.ratio) }));
  const noise = voice.noise && { ...voice.noise, cutoff: Math.min(voice.noise.cutoff ?? 2000, 3000) };
  return { ...voice, harmonics: harmonics.some((h) => h > 0) ? harmonics : [1], partials, noise };
}

// Cities whose value rose past `threshold` between frames (prev < thr <= cur), skipping those played
// within `cooldown` frames, loudest first, at most `maxNotes`. Returns indices into the arrays.
export function selectTriggers({ prev, cur, threshold, frame, lastPlayed = [], cooldown = 0, maxNotes = Infinity }) {
  const hits = [];
  for (let i = 0; i < cur.length; i++) {
    const p = prev[i], c = cur[i];
    if (p == null || c == null || !(p < threshold && c >= threshold)) continue;
    if (lastPlayed[i] != null && frame - lastPlayed[i] < cooldown) continue;
    hits.push(i);
  }
  return hits.sort((a, b) => cur[b] - cur[a]).slice(0, maxNotes);
}

// Value-at-fraction of a list of numbers (nulls ignored).
export function percentileOf(values, p) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
}
