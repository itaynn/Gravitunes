// Small data helpers shared by modes: JSON loading and per-dataset value helpers.

export async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url}`);
  return r.json();
}

// Repo data files (data/earth/*.json); absolute paths work served from the repo root and in standalone builds.
export const loadEarth = (name) => getJson(`/data/earth/${name}.json`);

// 0..1 over the dataset range (log space for log datasets), its inverse, and "12.3 ppbv" formatting.
export function valueHelpers(dataset) {
  const [lo, hi] = dataset.range;
  return {
    norm: dataset.norm || ((v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)))),
    denorm: dataset.denorm || ((x) => lo + x * (hi - lo)),
    fmtV: (v) => (dataset.format ? dataset.format(v) : `${Math.round(v * 10) / 10} ${dataset.units}`),
  };
}
