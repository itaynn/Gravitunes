// Hotspots: strong-value clusters of one dataset, found per frame in the browser (pure, no DOM; tested by test.mjs).
// Grid levels (0..1, row 0 = north) -> threshold at a high percentile -> 8-connected blobs (longitude wraps) ->
// drop tiny blobs, merge near ones -> track by nearest centroid. Output has the same shape as vortices.json
// ({ kind, frames: [[{id, lat, lon, r, area, mean, peak}]], tracks }) so the mode plays it exactly like vortices.

const R = 6371;
export const HOT_DEFAULTS = { top: 0.07, minLevel: 0.02, minCells: 3, mergeKm: 700, trackKm: 1200, maxPerFrame: 14, minTrackFrames: 2 };

const distKm = (a, b, c, d) => {
  const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
};

// Level at which only the top `top` fraction of cells (with level > minLevel) remains.
export function cutoff(levels, top, minLevel) {
  const v = [];
  for (const l of levels) if (l > minLevel) v.push(l);
  if (!v.length) return Infinity;
  v.sort((a, b) => a - b);
  return Math.max(minLevel, v[Math.min(v.length - 1, Math.floor(v.length * (1 - top)))]);
}

// One frame: levels (Float32Array W*H, row-major from 90N, x=0 at 180W) -> hotspots [{lat, lon, r, area, mean, peak}].
export function findHotspots(levels, W, H, opts = {}) {
  const o = { ...HOT_DEFAULTS, ...opts };
  const thr = cutoff(levels, o.top, o.minLevel);
  const lab = new Int32Array(W * H).fill(-1), blobs = [];
  const dLat = 180 / H, dLon = 360 / W;
  for (let i = 0; i < W * H; i++) {
    if (lab[i] >= 0 || !(levels[i] >= thr)) continue;
    const b = { area: 0, sum: 0, peak: 0, x: 0, y: 0, z: 0, cells: 0 }, stack = [i];
    lab[i] = blobs.length;
    while (stack.length) {
      const j = stack.pop(), y = Math.floor(j / W), x = j % W, l = levels[j];
      const lat = 90 - (y + 0.5) * dLat, lon = -180 + (x + 0.5) * dLon, cl = Math.cos((lat * Math.PI) / 180);
      const a = (R * dLat * Math.PI / 180) * (R * dLon * Math.PI / 180) * cl;
      b.area += a; b.sum += l * a; b.peak = Math.max(b.peak, l); b.cells++;
      b.x += a * cl * Math.cos((lon * Math.PI) / 180); b.y += a * cl * Math.sin((lon * Math.PI) / 180); b.z += a * Math.sin((lat * Math.PI) / 180);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy; if (yy < 0 || yy >= H || (!dx && !dy)) continue;
        const k = yy * W + ((x + dx + W) % W);
        if (lab[k] < 0 && levels[k] >= thr) { lab[k] = blobs.length; stack.push(k); }
      }
    }
    blobs.push(b);
  }
  let list = blobs.filter((b) => b.cells >= o.minCells).map(finish);
  // Merge blobs whose centres are close (one storm split by a gap), biggest first.
  list.sort((a, b) => b.area - a.area);
  for (let i = 0; i < list.length; i++) for (let j = list.length - 1; j > i; j--) {
    if (distKm(list[i].lat, list[i].lon, list[j].lat, list[j].lon) > o.mergeKm) continue;
    const p = list[i]._b, q = list[j]._b;
    for (const k of ['area', 'sum', 'x', 'y', 'z', 'cells']) p[k] += q[k];
    p.peak = Math.max(p.peak, q.peak);
    list[i] = finish(p); list.splice(j, 1);
  }
  list.sort((a, b) => b.area * b.mean - a.area * a.mean);
  return list.slice(0, o.maxPerFrame).map(({ _b, ...h }) => h);
}
function finish(b) {
  const lat = (Math.atan2(b.z, Math.hypot(b.x, b.y)) * 180) / Math.PI, lon = (Math.atan2(b.y, b.x) * 180) / Math.PI;
  return { lat: +lat.toFixed(2), lon: +lon.toFixed(2), area: Math.round(b.area), r: Math.round(Math.sqrt(b.area / Math.PI)),
    mean: +(b.sum / b.area).toFixed(4), peak: +b.peak.toFixed(4), _b: b };
}

// Frames of hotspots -> ids kept across frames (greedy nearest centroid within trackKm); short tracks dropped.
export function trackHotspots(perFrame, opts = {}) {
  const o = { ...HOT_DEFAULTS, ...opts };
  let next = 1, prev = [];
  const frames = perFrame.map((list) => {
    const pairs = [];
    for (const h of list) for (const p of prev) { const d = distKm(h.lat, h.lon, p.lat, p.lon); if (d < o.trackKm + h.r) pairs.push([d, h, p]); }
    pairs.sort((a, b) => a[0] - b[0]);
    const used = new Set(), out = new Map();
    for (const [, h, p] of pairs) if (!out.has(h) && !used.has(p.id)) { out.set(h, p.id); used.add(p.id); }
    prev = list.map((h) => ({ ...h, id: out.get(h) ?? next++ }));
    return prev;
  });
  const span = new Map();
  frames.forEach((l, t) => l.forEach((h) => { const s = span.get(h.id); if (s) { s.death = t; s.frames++; } else span.set(h.id, { id: h.id, birth: t, death: t, frames: 1, direction: 'ccw' }); }));
  const keep = new Set([...span.values()].filter((s) => s.frames >= o.minTrackFrames).map((s) => s.id));
  return { kind: 'hotspots', frames: frames.map((l) => l.filter((h) => keep.has(h.id))), tracks: [...span.values()].filter((s) => keep.has(s.id)) };
}

// levelAt(lat, lon, t) -> 0..1, sampled on a W x H grid for each of nFrames.
export function buildHotspots(levelAt, nFrames, W = 128, H = 64, opts = {}) {
  const per = [];
  for (let t = 0; t < nFrames; t++) {
    const lv = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) lv[y * W + x] = levelAt(90 - (y + 0.5) * 180 / H, -180 + (x + 0.5) * 360 / W, t) || 0;
    per.push(findHotspots(lv, W, H, opts));
  }
  return trackHotspots(per, opts);
}
