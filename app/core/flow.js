// Flow-analysis layers (analysis/scripts/flow/README.md): int8 grids, value = byte * scale, -128 = no data.
// Pure, runs in node too. Grids are equirectangular, row 0 = 90N, column 0 = 180W.

const KM_PER_DEG = 111.32;

// layer: the header entry from flow.json ("flow_WxH", "divergence_WxH", ...); bytes: Int8Array.
export function parseLayer(layer, bytes) {
  const [W, H] = layer.dims;
  const C = layer.components ? layer.components.length : 1;
  const { scale, nodata = -128 } = layer;
  const frames = Math.floor(bytes.length / (W * H * C));
  const at = (t, c, y, x) => {
    const b = bytes[((t * C + c) * H + y) * W + x];
    return b === nodata ? null : b * scale;
  };
  // Bilinear sample at (lat, lon), longitude wraps. Cells with no data are skipped; null if all four are empty.
  function sample(lat, lon, t, c = 0) {
    t = Math.max(0, Math.min(frames - 1, t | 0));
    const fx = ((((lon + 180) / 360) % 1) + 1) % 1 * W - 0.5;
    const fy = Math.max(0, Math.min(H - 1, ((90 - lat) / 180) * H - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    let sum = 0, wsum = 0;
    for (const [dx, dy, w] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]]) {
      const x = (((x0 + dx) % W) + W) % W, y = Math.min(H - 1, y0 + dy);
      const v = at(t, c, y, x);
      if (v != null && w > 0) { sum += v * w; wsum += w; }
    }
    return wsum > 1e-6 ? sum / wsum : null;
  }
  return { W, H, C, frames, at, sample, units: layer.units };
}

// {u, v} in km/h (east, north) at a point, or null where there is no detectable motion.
export function flowAt(flow, lat, lon, t) {
  const u = flow.sample(lat, lon, t, 0), v = flow.sample(lat, lon, t, 1);
  return u == null || v == null ? null : { u, v };
}

// Move a point with velocity (u, v) km/h for dtH hours (README formula), wrapping longitude.
export function advect(lat, lon, u, v, dtH) {
  const c = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  let nlon = lon + (u * dtH) / (KM_PER_DEG * c);
  const nlat = Math.max(-85, Math.min(85, lat + (v * dtH) / KM_PER_DEG));
  nlon = ((((nlon + 180) % 360) + 360) % 360) - 180;
  return { lat: nlat, lon: nlon };
}

const DIRS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
// "north-east" for a velocity (u east, v north).
export function compass(u, v) {
  const a = Math.atan2(v, u);
  return DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

// Rank-normalise: each value -> its percentile 0..1 within `values` (ties share a rank). Robust to the
// smoothed (underestimated) spin rates: only "faster/slower than the others" matters.
export function rankNormaliser(values) {
  const s = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return () => 0.5;
  if (s.length === 1) return () => 0.5;
  return (x) => {
    if (!Number.isFinite(x)) return 0;
    let lo = 0, hi = s.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < x) lo = m + 1; else hi = m; }
    let up = lo;
    while (up < s.length && s[up] === x) up++;
    return Math.max(0, Math.min(1, ((lo + up - 1) / 2) / (s.length - 1)));
  };
}

// Load flow.json + the layer files from a folder URL (browser). names: layer names (default all).
// Returns { header, layers: {name: parsed} }.
export async function loadFlow(dirUrl, names = null) {
  const r0 = await fetch(new URL('flow.json', dirUrl));
  if (!r0.ok) throw new Error(`Could not load flow.json in ${dirUrl}`);
  const header = await r0.json();
  names = names || Object.keys(header.layers);
  const layers = {};
  await Promise.all(names.map(async (n) => {
    const L = header.layers[n];
    if (!L) throw new Error(`flow.json has no layer ${n}`);
    const r = await fetch(new URL(L.file, dirUrl));
    if (!r.ok) throw new Error(`Could not load ${L.file}`);
    layers[n] = parseLayer(L, new Int8Array(await r.arrayBuffer()));
  }));
  return { header, layers };
}
