// Threshold triggering for listening points (world orchestra, mapping lab). Pure, runs in node too.
// Points are indexed arrays; trigger = value rises past the threshold between consecutive frames.

// Points whose value rose past `threshold` between frames (prev < thr <= cur), skipping those played
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

// Default trigger threshold: the dataset's 70th percentile (pct(p) or, without a grid, of `values`). For mostly
// empty fields such as rain that is the bottom of the range, where nothing can rise past it: then the
// 95th percentile, else 20% of the range.
export function defaultThreshold({ pct, values = [], range: [lo, hi] }) {
  const at = (p) => pct?.(p) ?? percentileOf(values, p);
  for (const p of [0.7, 0.95]) { const v = at(p); if (v != null && v > lo) return v; }
  return lo + 0.2 * (hi - lo);
}
