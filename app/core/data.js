// Small data helpers shared by modes: JSON loading and per-dataset value helpers.

export async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url}`);
  return r.json();
}

// URL of a repo file (path from the repo root, no leading slash). Resolved from this module, so it also works
// when the site is served from a sub-path (e.g. GitHub Pages /Gravitunes/). Standalone builds load modules as
// blob: URLs; there the root-absolute path is used and their fetch() override serves it from the bundle.
export function repoUrl(path) {
  const here = import.meta.url;
  return here.startsWith('blob:') ? new URL('/' + path, location.href).href : new URL('../../' + path, here).href;
}

// Repo data files (data/earth/*.json).
export const loadEarth = (name) => getJson(repoUrl(`data/earth/${name}.json`));

// 0..1 over the dataset range (log space for log datasets), its inverse, and "12.3 ppbv" formatting.
export function valueHelpers(dataset) {
  const [lo, hi] = dataset.range;
  return {
    norm: dataset.norm || ((v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)))),
    denorm: dataset.denorm || ((x) => lo + x * (hi - lo)),
    fmtV: (v) => (dataset.format ? dataset.format(v) : `${Math.round(v * 10) / 10} ${dataset.units}`),
  };
}
