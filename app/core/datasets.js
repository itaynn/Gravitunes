// Dataset definitions + loader -> ctx.dataset.
// Definitions live here for now; later they come from data-tools/datasets/<id>.json
// (swap getDefinition()). Data files are served from the repo root under /data/.
import { buildLut, decode } from './colorbar.js';

export const DATASETS = {
  5152: {
    id: '5152',
    title: 'Near-surface ozone (GEOS-CF forecast)',
    units: 'ppbv',
    range: [5, 60],
    source: 'https://svs.gsfc.nasa.gov/5152',
    dir: '/data/nasa-svs/5152/web/',
    manifest: 'frames.json',          // written by app/tools/fetch-sample.sh
    colorbar: { file: 'colorbar.png', row: 60, x0: 70, x1: 464 },
    // Value grids from data-tools (preferred when present): <id>_<W>x<H>.json + .bin
    grid: { header: '5152_1024x512.json', bin: '5152_1024x512.bin' },
    // Burned-in boxes (fractions of the frame): x, y, w, h. valueAt returns null inside.
    masks: [[0, 0, 0.175, 0.078], [0, 0.9, 0.247, 0.1]],
  },
};

export async function getDefinition(id) {
  // Try the data-tools definition first, fall back to the built-in one.
  try {
    const r = await fetch(`/data-tools/datasets/${id}.json`);
    if (r.ok) return { ...DATASETS[id], ...(await r.json()), id: String(id) };
  } catch {}
  if (!DATASETS[id]) throw new Error(`Unknown dataset ${id}`);
  return DATASETS[id];
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
  if (!def.grid) return null;
  try {
    const h = await fetch(def.dir + def.grid.header);
    if (!h.ok) return null;
    const header = await h.json();
    const b = await fetch(def.dir + def.grid.bin);
    if (!b.ok) return null;
    return { header, bytes: new Uint8Array(await b.arrayBuffer()) };
  } catch { return null; }
}

export async function loadDataset(id) {
  const def = await getDefinition(id);
  const manifest = await (await fetch(def.dir + def.manifest)).json();
  const frames = manifest.frames;               // [{file, hour}]
  const start = new Date(manifest.start || def.start);
  const grid = await tryGrid(def);
  let lut = null;
  if (!grid) {
    const cb = pixels(await loadImage(def.dir + def.colorbar.file));
    lut = buildLut(cb.data, cb.width, cb.height, { ...def.colorbar, range: def.range });
  }
  const cache = new Map();                      // frame index -> ImageData
  let current = 0;

  async function load(t) {
    t = Math.max(0, Math.min(frames.length - 1, t | 0));
    if (!cache.has(t)) {
      const im = await loadImage(def.dir + frames[t].file);
      cache.set(t, { im, data: grid ? null : pixels(im) });
    }
    current = t;
    return cache.get(t);
  }

  function masked(fx, fy) {
    return (def.masks || []).some(([x, y, w, h]) => fx >= x && fx < x + w && fy >= y && fy < y + h);
  }

  function valueAt(lat, lon, t = current) {
    const fx = ((lon + 180) / 360 + 1) % 1, fy = (90 - lat) / 180;
    if (fy < 0 || fy > 1 || masked(fx, fy)) return null;
    if (grid) {
      const hd = grid.header, [width, height] = hd.dims || [hd.width, hd.height], { scale = 1, offset = 0 } = hd;
      const x = Math.min(width - 1, (fx * width) | 0), y = Math.min(height - 1, (fy * height) | 0);
      const gi = (hd.times?.length ?? 0) > frames.length ? frames[t | 0].hour : t | 0;
      const byte = grid.bytes[gi * width * height + y * width + x];
      return byte === 255 || byte == null ? null : offset + byte * scale;
    }
    const f = cache.get(t | 0) || cache.get(current);
    if (!f) return null;
    const { data, width, height } = f.data;
    const x = Math.min(width - 1, (fx * width) | 0), y = Math.min(height - 1, (fy * height) | 0);
    const p = (y * width + x) * 4;
    return decode(lut, data[p], data[p + 1], data[p + 2]);
  }

  return {
    id: def.id, title: def.title, units: def.units, range: def.range, source: def.source,
    frames, count: frames.length, colorbarUrl: def.dir + def.colorbar.file, usingGrid: !!grid,
    timeOf: (t) => new Date(start.getTime() + (frames[t | 0]?.hour ?? 0) * 3600e3),
    load, valueAt, image: () => cache.get(current)?.im,
  };
}
