// Color -> value lookup. Pure functions (no DOM) so they run in node tests too.
//
// buildLut(rgba, width, height, opts) samples one row of a color bar image left to right.
// decode(lut, r, g, b) returns the value of the closest color bar entry, or lut.low for
// "strongly desaturated" pixels.
//
// ASSUMPTION (SVS 5152 and similar): frames are colorbar x opacity(value) blended over a
// greyscale Earth, so low values are mostly transparent and show the grey/black base map.
// Any pixel whose chroma (max-min of RGB) is below `minChroma` is therefore treated as
// "low" (the bottom of the range). This also covers white/near-white, which is the low end
// of the ozone bar anyway. Coastlines/borders burned into the frame are thin and grey, so
// they read as low too; callers can smooth with a small neighborhood if needed.

// Optional ticks [[x, value], ...] (pixel x in the same image) map x -> value piecewise, interpolated
// in log10 when scale === 'log'; without ticks values run linearly across range.
export function tickValue(x, ticks, scale = 'linear') {
  const log = scale === 'log', f = (v) => (log ? Math.log10(v) : v), g = (u) => (log ? 10 ** u : u);
  const t = ticks.slice().sort((a, b) => a[0] - b[0]);
  let i = 1;
  while (i < t.length - 1 && x > t[i][0]) i++;
  const [xa, va] = t[i - 1], [xb, vb] = t[i];
  return g(f(va) + ((x - xa) / (xb - xa || 1)) * (f(vb) - f(va)));
}

export function buildLut(rgba, width, height, { row, x0, x1, range, ticks, scale, steps = 256 } = {}) {
  const y = row ?? Math.floor(height / 2);
  // Auto-detect the opaque bar span on that row when x0/x1 are not given.
  if (x0 == null || x1 == null) {
    let a = -1, b = -1;
    for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4 + 3] > 200) { if (a < 0) a = x; b = x; }
    x0 = x0 ?? a; x1 = x1 ?? b;
  }
  const colors = new Float32Array(steps * 3), values = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const f = i / (steps - 1);
    const x = Math.round(x0 + f * (x1 - x0));
    const p = (y * width + x) * 4;
    colors.set([rgba[p], rgba[p + 1], rgba[p + 2]], i * 3);
    values[i] = ticks?.length >= 2 ? Math.max(range[0], Math.min(range[1], tickValue(x, ticks, scale)))
      : scale === 'log' ? 10 ** (Math.log10(range[0]) + f * (Math.log10(range[1]) - Math.log10(range[0])))
      : range[0] + f * (range[1] - range[0]);
  }
  return { colors, values, steps, low: range[0], minChroma: 18 };
}

export function decode(lut, r, g, b) {
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  if (chroma < lut.minChroma) return lut.low;
  let best = 0, bestD = Infinity;
  const c = lut.colors;
  for (let i = 0; i < lut.steps; i++) {
    const dr = c[i * 3] - r, dg = c[i * 3 + 1] - g, db = c[i * 3 + 2] - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return lut.values[best];
}
