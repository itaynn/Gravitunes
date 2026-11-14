// Dataset descriptors + loader -> ctx.dataset.
// Descriptors come from /data-tools/datasets/<id>.json (data-tools); the built-in entries below are
// fallbacks and local overrides. Data files are served from the repo root under /data/.
//
// Time axis: when a value grid (<id>_<W>x<H>.json/.bin, from `gravitunes_data export`) exists, frames
// are the grid's times[] (hourly for 5152). Images come from the frames.json manifest when present
// (nearest earlier image for each hour); with no images, the grid itself is painted with the color bar.
import { buildLut, decode } from './colorbar.js';
import { parseGrid, frameForHour, makeNorm, formatValue } from './grid.js';

export const DATASETS = {
  5152: {
    id: '5152',
    title: 'Near-surface ozone (GEOS-CF forecast)',
    units: 'ppbv',
    range: [5, 60],
    source: 'https://svs.gsfc.nasa.gov/5152',
    start: '2026-10-29T09:00:00Z',
    step_hours: 1,
    dir: '/data/nasa-svs/5152/web/',
    manifest: 'frames.json',          // written by app/tools/fetch-sample.sh
    // x1 is exclusive: 463-464 are white border pixels (they made white read as 60 ppbv).
    colorbar: { file: 'colorbar.png', row: 60, x0: 71, x1: 463 },
    grid: { header: '5152_256x128.json', bin: '5152_256x128.bin' },
    // Burned-in boxes (fractions of the frame): x, y, w, h. valueAt returns null inside.
    masks: [[0, 0, 0.172, 0.074], [0, 0.902, 0.245, 0.098]],
  },
  // IMERG precipitation (relative 0..1 from the SVS PNG alpha). No data-tools export yet: modes that use it
  // ship their own grid and name its folder in mode.json "datasetDirs" (see host.js).
  4285: {
    id: '4285',
    title: 'Precipitation (IMERG, relative)',
    units: 'relative',
    range: [0, 1],
    source: 'https://svs.gsfc.nasa.gov/4285',
    step_hours: 0.5,
    colorbar: { stops: [[0, [8, 12, 28]], [0.08, [20, 60, 120]], [0.3, [40, 160, 220]], [0.6, [140, 230, 160]], [1, [255, 255, 255]]] },
    grid: { header: 'field_256x128.json', bin: 'field_256x128.bin' },
  },
};

const fetchJson = async (url) => {
  try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; }
};

export async function getDefinition(id, overrides = {}) {
  id = String(id);
  const desc = await fetchJson(`/data-tools/datasets/${id}.json`);
  const builtin = DATASETS[id];
  if (!desc && !builtin) throw new Error(`Unknown dataset ${id}`);
  const def = { dir: `/data/nasa-svs/${id}/web/`, manifest: 'frames.json', ...(builtin || {}), ...(desc || {}), id };
  // The descriptor's frames/colorbar describe the raw SVS files; keep web-copy file names from built-ins.
  if (overrides.dir) def.dir = overrides.dir;
  def.frames = undefined;
  def.colorbar = { ...(desc?.colorbar || {}), ...(builtin?.colorbar ? { file: builtin.colorbar.file } : {}) };
  if (!def.colorbar.file) def.colorbar.file = 'colorbar.png';
  def.grid = desc?.grid || builtin?.grid || { header: `${id}_256x128.json`, bin: `${id}_256x128.bin` };
  return def;
}

// Known datasets for pickers: built-ins plus /data-tools/datasets/index.json ({ids:[...]} or [...]) if present.
export async function listDatasets() {
  const idx = await fetchJson('/data-tools/datasets/index.json');
  const ids = new Set([...Object.keys(DATASETS), ...((Array.isArray(idx) ? idx : idx?.ids) || []).map(String)]);
  const out = [];
  for (const id of ids) {
    const d = await fetchJson(`/data-tools/datasets/${id}.json`);
    out.push({ id, title: d?.title || DATASETS[id]?.title || id });
  }
  return out;
}

const loadImage = (src) => new Promise((ok, fail) => {
  const im = new Image();
  im.onload = () => ok(im);
  im.onerror = () => fail(new Error(`Could not load ${src}`));
  im.src = src;
});

function pixels(im) {
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

async function tryGrid(def) {
  const names = [def.grid, { header: `${def.id}_256x128.json`, bin: `${def.id}_256x128.bin` },
    { header: `${def.id}_512x256.json`, bin: `${def.id}_512x256.bin` }];
  for (const g of names) {
    try {
      const h = await fetch(def.dir + g.header);
      if (!h.ok) continue;
      const header = await h.json();
      const b = await fetch(def.dir + g.bin);
      if (!b.ok) continue;
      return parseGrid(header, new Uint8Array(await b.arrayBuffer()));
    } catch {}
  }
  return null;
}

// Color for a value from descriptor stops [[v,[r,g,b]],...] (used to paint grids without images).
// log: interpolate between stops in log10 space (for log colour bars).
export function stopColor(stops, v, log = false) {
  if (v <= stops[0][0]) return stops[0][1];
  const T = log ? (x) => Math.log10(Math.max(x, 1e-30)) : (x) => x;
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (v <= v1) {
      const [v0, c0] = stops[i - 1], f = (T(v) - T(v0)) / (T(v1) - T(v0) || 1);
      return c0.map((c, k) => c + f * (c1[k] - c));
    }
  }
  return stops[stops.length - 1][1];
}

// overrides.dir: folder (URL) holding the grid/frames instead of /data/nasa-svs/<id>/web/.
export async function loadDataset(id, overrides = {}) {
  const def = await getDefinition(id, overrides);
  const grid = await tryGrid(def);
  const manifest = await fetchJson(def.dir + def.manifest);
  const images = (manifest?.frames || []).slice().sort((a, b) => a.hour - b.hour);
  if (!grid && !images.length) throw new Error(`No value grid or frames in ${def.dir}`);
  const start = new Date(grid?.times?.[0] || def.start || manifest?.start);
  const imgStart = new Date(manifest?.start || start);
  const stepH = def.step_hours || 1;
  const count = grid ? grid.frames : images.length;
  const hourOf = (t) => grid
    ? (grid.times ? (new Date(grid.times[t]) - start) / 3600e3 : t * stepH)
    : images[t].hour;
  const timeOf = (t) => {
    t = Math.max(0, Math.min(count - 1, t | 0));
    if (grid?.times) return new Date(grid.times[t]);
    return new Date((grid ? start : imgStart).getTime() + hourOf(t) * 3600e3);
  };

  let lut = null;
  const colorbarUrl = def.dir + def.colorbar.file;
  if (!grid) {
    const cb = pixels(await loadImage(colorbarUrl));
    const { row, x0, x1, ticks, scale } = def.colorbar;
    lut = buildLut(cb.data, cb.width, cb.height, { row, x0, x1: x1 != null ? x1 - 1 : undefined, range: def.range, ticks, scale });
  }
  // Log datasets: grid header transform, descriptor grid.transform, or a log colour bar.
  const transform = grid?.header?.transform || def.grid?.transform || (def.colorbar.scale === 'log' ? 'log10' : 'linear');
  const { norm, denorm } = makeNorm(def.range, transform);
  const stops = def.colorbar.stops || [[def.range[0], [255, 255, 255]], [def.range[1], [65, 32, 192]]];

  const cache = new Map();     // image index or 'g'+t -> { im, data }
  let current = 0;

  function paintGrid(t) {
    const c = document.createElement('canvas');
    c.width = grid.width; c.height = grid.height;
    const g = c.getContext('2d'), img = g.createImageData(c.width, c.height);
    const n = c.width * c.height;
    for (let i = 0; i < n; i++) {
      const b = grid.bytes[t * n + i];
      if (b === grid.nodata) { img.data[i * 4 + 3] = 0; continue; }
      const [r, gg, bb] = stopColor(stops, grid.fromByte(b), transform === 'log10');
      img.data.set([r, gg, bb, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  async function load(t) {
    t = Math.max(0, Math.min(count - 1, t | 0));
    let key;
    if (images.length) {
      // Image hour is relative to the manifest start; grid hour to the grid start.
      const hour = grid ? hourOf(t) + (start - imgStart) / 3600e3 : images[t].hour;
      key = grid ? frameForHour(images, hour) : t;
      if (!cache.has(key)) {
        try {
          const im = await loadImage(def.dir + images[key].file);
          cache.set(key, { im, data: grid ? null : pixels(im) });
        } catch (e) { if (!grid) throw e; key = null; }
      }
    }
    if (key == null) {
      key = 'g' + t;
      if (!cache.has(key)) cache.set(key, { im: paintGrid(t), data: null });
      if (cache.size > 64) cache.delete(cache.keys().next().value);
    }
    current = t;
    cache.set('cur', cache.get(key));
    return cache.get(key);
  }

  function masked(fx, fy) {
    return (def.masks || []).some(([x, y, w, h]) => fx >= x && fx < x + w && fy >= y && fy < y + h);
  }

  function valueAt(lat, lon, t = current) {
    const fx = ((lon + 180) / 360 + 1) % 1, fy = (90 - lat) / 180;
    if (fy < 0 || fy > 1 || masked(fx, fy)) return null;
    if (grid) return grid.valueAt(lat, lon, t);
    const f = cache.get(t | 0) || cache.get('cur');
    if (!f?.data) return null;
    const { data, width, height } = f.data;
    const x = Math.min(width - 1, (fx * width) | 0), y = Math.min(height - 1, (fy * height) | 0);
    const p = (y * width + x) * 4;
    return decode(lut, data[p], data[p + 1], data[p + 2]);
  }

  let pcache = {};
  return {
    id: def.id, dir: def.dir, title: def.title, units: def.units, range: def.range, source: def.source,
    frames: images, count, colorbarUrl, usingGrid: !!grid, stepHours: grid ? (count > 1 ? hourOf(1) - hourOf(0) : stepH) || stepH : (images.length > 1 ? images[1].hour - images[0].hour : stepH) || stepH,
    timeOf, load, valueAt, image: () => cache.get('cur')?.im,
    // transform: 'linear' | 'log10'. norm(v) -> 0..1 over range (log space for log datasets); denorm inverts.
    transform, norm, denorm,
    // "14 ppbv", "0.013 ppbv"
    format: (v, withUnits = true) => (v == null ? 'no data' : formatValue(v) + (withUnits && def.units ? ` ${def.units}` : '')),
    // Value at fraction p of all grid values (null without a grid).
    percentile: (p) => grid ? (pcache[p] ??= grid.percentile(p)) : null,
  };
}
