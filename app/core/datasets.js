// Dataset descriptors + loader -> ctx.dataset.
// Descriptors come from /data-tools/datasets/<id>.json (data-tools); the built-in entries below are
// fallbacks and local overrides. Data files are served from the repo root under /data/.
//
// Time axis: when a value grid (<id>_<W>x<H>.json/.bin, from `gravitunes_data export`) exists, frames
// are the grid's times[] (hourly for 5152). Images come from the frames.json manifest when present
// (nearest earlier image for each hour); with no images, the grid itself is painted with the color bar.
import { buildLut, decode } from './colorbar.js';
import { parseGrid, frameForHour, makeNorm, formatValue, unpackGrid, chunkedGrid } from './grid.js';

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
  // IMERG precipitation (0..1: log rain rate decoded from the SVS colours). No data-tools export: the shared
  // grid is committed in data/nasa-svs/4285/web/ (delta-gzip); modes with extra layers ship their own copy
  // and name its folder in mode.json "datasetDirs" (see host.js).
  4285: {
    id: '4285',
    title: 'Rain (IMERG precipitation)',
    committed: true,                  // always available (in git), even when the data-tools index omits it
    units: 'relative',
    range: [0, 1],
    source: 'https://svs.gsfc.nasa.gov/4285',
    step_hours: 0.5,
    manifest: null,                   // grid only: no frames.json to look for
    colorbar: { stops: [[0, [8, 12, 28]], [0.08, [20, 60, 120]], [0.3, [40, 160, 220]], [0.6, [140, 230, 160]], [1, [255, 255, 255]]] },
    grid: { header: 'field_256x128.json', bin: 'field_256x128.bin' },
  },
};

const fetchJson = async (url) => {
  try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; }
};

let idsPromise = null;
const listedIds = () => (idsPromise ||= fetchJson('/data-tools/datasets/index.json')
  .then((idx) => (Array.isArray(idx) ? idx : idx?.ids)?.map(String) || null));

export async function getDefinition(id, overrides = {}) {
  id = String(id);
  const builtin = DATASETS[id];
  // Skip the descriptor request (a 404 in the console) for built-ins the index doesn't list (4285).
  const listed = builtin ? await listedIds() : null;
  const desc = listed && !listed.includes(id) ? null : await fetchJson(`/data-tools/datasets/${id}.json`);
  if (!desc && !builtin) throw new Error(`Unknown dataset ${id}`);
  const def = { dir: `/data/nasa-svs/${id}/web/`, manifest: 'frames.json', ...(builtin || {}), ...(desc || {}), id };
  // The descriptor's frames/colorbar describe the raw SVS files; keep web-copy file names from built-ins.
  if (overrides.dir) def.dir = overrides.dir;
  def.frames = undefined;
  def.colorbar = { ...(desc?.colorbar || {}), ...(builtin?.colorbar?.file ? { file: builtin.colorbar.file } : {}) };
  // Built-in stops when there is no descriptor (4285: dark IMERG ramp, so the map matches the other demos).
  if (!def.colorbar.stops && builtin?.colorbar?.stops) def.colorbar.stops = builtin.colorbar.stops;
  if (!def.colorbar.file) def.colorbar.file = 'colorbar.png';
  def.grid = desc?.grid || builtin?.grid || { header: `${id}_256x128.json`, bin: `${id}_256x128.bin` };
  return def;
}

// Known datasets for pickers: built-ins plus /data-tools/datasets/index.json ({ids:[...]} or [...]) if present.
export async function listDatasets() {
  const idx = await fetchJson('/data-tools/datasets/index.json');
  // The index lists what is really available (standalone builds write only the bundled ids); built-ins are a fallback.
  const listed = (Array.isArray(idx) ? idx : idx?.ids)?.map(String);
  const ids = new Set(listed?.length ? listed : Object.keys(DATASETS));
  for (const [id, d] of Object.entries(DATASETS)) if (d.committed) ids.add(id);
  const out = [];
  for (const id of ids) {
    // No descriptor request (a 404) for built-ins the index doesn't list.
    const d = listed?.length && !listed.includes(id) ? null : await fetchJson(`/data-tools/datasets/${id}.json`);
    out.push({ id, title: d?.title || DATASETS[id]?.title || id });
  }
  return out;
}

// Through fetch (so single-file builds can serve bundled frames), then decoded from a blob URL.
const loadImage = async (src) => {
  let url = src, blob = null;
  try { const r = await fetch(src); if (r.ok) { blob = URL.createObjectURL(await r.blob()); url = blob; } } catch {}
  return new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => { if (blob) URL.revokeObjectURL(blob); ok(im); };
    im.onerror = () => fail(new Error(`Could not load ${src}`));
    im.src = url;
  });
};

function pixels(im) {
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

const fetchBytes = (dir) => async (file) => {
  const r = await fetch(dir + file);
  if (!r.ok) throw new Error(`Could not load ${file}`);
  return new Uint8Array(await r.arrayBuffer());
};

// High-resolution grid (header lists time chunks), loaded in the background after the coarse grid.
async function tryFineGrid(def) {
  const name = def.grid?.fine || `${def.id}_1024x512.json`;
  const header = await fetchJson(def.dir + name);
  if (!header?.chunks || header.encoding !== 'delta-gzip') return null;
  return chunkedGrid(header, fetchBytes(def.dir));
}

async function tryGrid(def) {
  const names = [def.grid, { header: `${def.id}_256x128.json`, bin: `${def.id}_256x128.bin` },
    { header: `${def.id}_512x256.json`, bin: `${def.id}_512x256.bin` }];
  for (const g of names) {
    try {
      const h = await fetch(def.dir + g.header);
      if (!h.ok) continue;
      const header = await h.json();
      if (header.encoding === 'delta-gzip') return parseGrid(header, await unpackGrid(header, fetchBytes(def.dir)));
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
  const manifest = def.manifest ? await fetchJson(def.dir + def.manifest) : null;
  // Only export-hd sets (delta-gzip grids) can have a fine grid; don't probe (404) for the others.
  let fine = grid?.header?.encoding === 'delta-gzip' ? await tryFineGrid(def) : null;
  if (fine && fine.frames !== grid.frames) fine = null;
  fine?.loadAll(0);
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
  let colorbarUrl = def.dir + def.colorbar.file;
  if (!grid) {
    const cb = pixels(await loadImage(colorbarUrl));
    const { row, x0, x1, ticks, scale } = def.colorbar;
    lut = buildLut(cb.data, cb.width, cb.height, { row, x0, x1: x1 != null ? x1 - 1 : undefined, range: def.range, ticks, scale });
  }
  // Log datasets: grid header transform, descriptor grid.transform, or a log colour bar.
  const transform = grid?.header?.transform || def.grid?.transform || (def.colorbar.scale === 'log' ? 'log10' : 'linear');
  const { norm, denorm } = makeNorm(def.range, transform);
  const stops = def.colorbar.stops || [[def.range[0], [255, 255, 255]], [def.range[1], [65, 32, 192]]];

  // The original SVS colour bar when the frames manifest names one; otherwise grid datasets draw it from the stops.
  if (manifest?.colorbar) {
    colorbarUrl = def.dir + manifest.colorbar;
    try { const r = await fetch(colorbarUrl); if (r.ok) colorbarUrl = URL.createObjectURL(await r.blob()); } catch {}
  }
  else if (grid && typeof document !== 'undefined') {
    const c = Object.assign(document.createElement('canvas'), { width: 256, height: 12 });
    const g = c.getContext('2d');
    for (let x = 0; x < 256; x++) {
      const [r, gg, b] = stopColor(stops, denorm(x / 255), transform === 'log10');
      g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(x, 0, 1, 12);
    }
    // Labelled version (low, units, high) under the ramp, for the light single-file builds.
    const L = Object.assign(document.createElement('canvas'), { width: 512, height: 52 });
    const lg = L.getContext('2d');
    lg.fillStyle = '#fff'; lg.fillRect(0, 0, 512, 52);
    lg.imageSmoothingEnabled = false; lg.drawImage(c, 8, 4, 496, 22);
    lg.fillStyle = '#000'; lg.font = '18px system-ui, sans-serif'; lg.textBaseline = 'bottom';
    const fmt = (v) => formatValue(v);
    lg.textAlign = 'left'; lg.fillText(fmt(def.range[0]), 8, 50);
    lg.textAlign = 'right'; lg.fillText(fmt(def.range[1]), 504, 50);
    lg.textAlign = 'center'; lg.fillText(`${def.units || ''}${transform === 'log10' ? ' (log)' : ''}`, 256, 50);
    colorbarUrl = L.toDataURL();
  }
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
    // The SVS frames' date/logo boxes sit at the left edge and become no-data holes that show as black boxes.
    // Visually fill a no-data run that starts at a row's left edge with the row's first valid colour (values stay null).
    const W = c.width, d = img.data;
    for (let y = 0; y < c.height; y++) {
      const row = y * W;
      let x = 0;
      while (x < W && d[(row + x) * 4 + 3] === 0) x++;
      if (x === 0 || x === W) continue;
      const src = (row + x) * 4;
      for (let k = 0; k < x; k++) d.copyWithin((row + k) * 4, src, src + 4);
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
          trim();
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

  // Keep at most ~40 decoded frames (2048x1024 images are 8 MB each once decoded).
  function trim() {
    const keys = [...cache.keys()].filter((k) => typeof k === 'number');
    while (keys.length > 40) { const k = keys.shift(); if (cache.get(k) !== cache.get('cur')) cache.delete(k); }
  }
  // Warm the image (and fine grid chunk) for frame t without changing the current frame.
  function prefetch(t) {
    t = Math.max(0, Math.min(count - 1, t | 0));
    fine?.ensure(t);
    if (!images.length || !grid) return;
    const hour = hourOf(t) + (start - imgStart) / 3600e3;
    const key = frameForHour(images, hour);
    if (cache.has(key)) return;
    loadImage(def.dir + images[key].file).then((im) => { cache.set(key, { im, data: null }); trim(); }).catch(() => {});
  }

  function masked(fx, fy) {
    return (def.masks || []).some(([x, y, w, h]) => fx >= x && fx < x + w && fy >= y && fy < y + h);
  }

  function valueAt(lat, lon, t = current) {
    const fx = ((lon + 180) / 360 + 1) % 1, fy = (90 - lat) / 180;
    if (fy < 0 || fy > 1 || masked(fx, fy)) return null;
    if (grid) {
      const v = fine?.valueAt(lat, lon, t);
      return v !== undefined ? v : grid.valueAt(lat, lon, t);
    }
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
    timeOf, load, prefetch, valueAt,
    // Value grid resolution [width, height] in use (fine grid once its chunks load).
    resolution: () => (fine ? [fine.width, fine.height] : grid ? [grid.width, grid.height] : null), image: () => cache.get('cur')?.im,
    // transform: 'linear' | 'log10'. norm(v) -> 0..1 over range (log space for log datasets); denorm inverts.
    transform, norm, denorm,
    // "14 ppbv", "0.013 ppbv"
    format: (v, withUnits = true) => (v == null ? 'no data' : formatValue(v) + (withUnits && def.units ? ` ${def.units}` : '')),
    // Value at fraction p of all grid values (null without a grid).
    percentile: (p) => grid ? (pcache[p] ??= grid.percentile(p)) : null,
  };
}
