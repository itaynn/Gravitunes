// One dataset's value as a 0..1 "level" for modes that work on any dataset (flow-tracers, vortex-melodies):
// IMERG rain (4285, already 0..1 log rain rate) or a GEOS-CF gas (5152 ozone, 5153 carbon monoxide,
// 5154 nitrogen oxides; normalised over the dataset's range, log for nitrogen oxides). Pure, runs in node.

export const FIELD_NAMES = { 4285: 'rain', 5152: 'ozone', 5153: 'carbon monoxide', 5154: 'nitrogen oxides' };

// Rain rate (mm/h) for a 0..1 IMERG level (log10 scale 0.1..50 mm/h, 0 = dry; field header rate_log10).
export const RATE_LOG10 = [-1, Math.log10(50)];
export const rateOf = (v) => (v == null || v <= 0 ? 0 : 10 ** (RATE_LOG10[0] + v * (RATE_LOG10[1] - RATE_LOG10[0])));

export function rainText(v) {
  const r = rateOf(v);
  if (!r) return 'dry';
  const n = r < 1 ? r.toFixed(1) : String(Math.round(r));
  const word = r < 1 ? 'light rain' : r < 5 ? 'moderate rain' : r < 20 ? 'heavy rain' : 'very heavy rain';
  return `${word}, ${n} mm per hour`;
}

// dataset: ctx.dataset (valueAt, norm, format, percentile). Returns
//   name: 'rain' | 'ozone' | ...; rain: true for IMERG;
//   level(lat, lon, t): 0..1 or 0 where there is no value;
//   spread(level): 0..1 over threshold..top (gases), for pitch and loudness;
//   threshold: the level above which a place counts as "having signal" (rain: 0.1 mm/h; gases: the median);
//   text(lat, lon, t): spoken value ("heavy rain, 8 mm per hour" / "ozone 42 ppbv, high").
export function fieldOf(dataset) {
  const id = String(dataset.id);
  const rain = id === '4285';
  const name = FIELD_NAMES[id] || (dataset.title || 'value').toLowerCase();
  const norm = (v) => (v == null ? null : Math.max(0, Math.min(1, rain ? v : dataset.norm(v))));
  const raw = (lat, lon, t) => dataset.valueAt(lat, lon, t);
  const level = (lat, lon, t) => norm(raw(lat, lon, t)) ?? 0;
  const pct = (p) => { const v = dataset.percentile?.(p); return v == null ? null : norm(v); };
  const threshold = rain ? 0.02 : (pct(0.5) ?? 0.5);
  const hi = rain ? null : pct(0.9), lo = rain ? null : pct(0.2), top = rain ? 1 : Math.max(threshold + 0.05, pct(0.995) ?? 1);
  // 0..1 across the "signal" part of the range (threshold..top) for pitch and loudness; rain keeps its level.
  const spread = (l) => (rain ? l : Math.max(0, Math.min(1, (l - threshold) / (top - threshold))));
  function word(l) {
    if (hi != null && l >= hi) return 'very high';
    if (l >= threshold) return 'high';
    if (lo != null && l <= lo) return 'low';
    return 'moderate';
  }
  function text(lat, lon, t) {
    const v = raw(lat, lon, t);
    if (rain) return rainText(v ?? 0);
    if (v == null) return `no ${name} data`;
    return `${name} ${dataset.format(v)}, ${word(norm(v))}`;
  }
  return { id, name, rain, norm, level, threshold, spread, text, word };
}
