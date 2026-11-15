// Value grids exported by data-tools (<id>_<W>x<H>.json header + .bin). Pure, runs in node too.
// .bin is uint8, layout t,y,x (y=0 is 90N, x=0 is 180W); nodata (255) -> null.
// header.transform: "linear" (default): value = offset + byte*scale; "log10": value = 10 ** (offset + byte*scale).

// value -> 0..1 over range, in log space for log datasets (so low NOx values are not all squashed to 0).
export function makeNorm([lo, hi], transform = 'linear') {
  if (transform === 'log10' && lo > 0 && hi > 0) {
    const a = Math.log10(lo), b = Math.log10(hi);
    return {
      norm: (v) => (v == null ? null : Math.max(0, Math.min(1, (Math.log10(Math.max(v, 1e-30)) - a) / (b - a || 1)))),
      denorm: (x) => 10 ** (a + x * (b - a)),
    };
  }
  return {
    norm: (v) => (v == null ? null : Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)))),
    denorm: (x) => lo + x * (hi - lo),
  };
}

// Human-readable number: 14, 2.6, 0.34, 0.013, 0.0021 (two significant digits below 10).
export function formatValue(v) {
  if (v == null || !isFinite(v)) return 'no data';
  const a = Math.abs(v);
  if (a >= 10 || a === 0) return String(Math.round(v));
  return String(Number(v.toPrecision(2)));
}

export function parseGrid(header, bytes) {
  const [width, height] = header.dims || [header.width, header.height];
  const frames = header.frames ?? Math.floor(bytes.length / (width * height));
  const { scale = 1, offset = 0 } = header;
  const nodata = header.nodata ?? 255;
  const transform = header.transform || 'linear';
  const fromByte = transform === 'log10' ? (b) => 10 ** (offset + b * scale) : (b) => offset + b * scale;
  if (bytes.length < frames * width * height) throw new Error(`grid: ${bytes.length} bytes, expected ${frames * width * height}`);
  const times = header.times || null;

  function cell(lat, lon) {
    const fx = ((((lon + 180) / 360) % 1) + 1) % 1, fy = (90 - lat) / 180;
    if (!(fy >= 0 && fy <= 1)) return -1;
    const x = Math.min(width - 1, (fx * width) | 0), y = Math.min(height - 1, (fy * height) | 0);
    return y * width + x;
  }
  function valueAt(lat, lon, t) {
    const c = cell(lat, lon);
    t = Math.max(0, Math.min(frames - 1, t | 0));
    if (c < 0) return null;
    const b = bytes[t * width * height + c];
    return b === nodata || b == null ? null : fromByte(b);
  }
  // p in 0..1 over all valid cells and frames (histogram, exact to one byte step).
  function percentile(p) {
    const hist = new Float64Array(256);
    const n = frames * width * height;
    for (let i = 0; i < n; i++) hist[bytes[i]]++;
    hist[nodata] = 0;
    const total = hist.reduce((a, b) => a + b, 0);
    if (!total) return null;
    let acc = 0;
    for (let b = 0; b < 256; b++) { acc += hist[b]; if (acc >= p * total) return fromByte(b); }
    return fromByte(254);
  }
  return { width, height, frames, times, scale, offset, nodata, transform, fromByte, valueAt, percentile, cell, bytes, header };
}

// ---- Compressed grids (header.encoding "delta-gzip", written by data-tools gravitunes_data/web.py) ----
// Each chunk is gzip of: first frame as is, then (byte - previous frame's byte) mod 256.
export async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export function undelta(buf, cells) {
  for (let i = cells; i < buf.length; i++) buf[i] = (buf[i] + buf[i - cells]) & 255;
  return buf;
}
// All frames of a delta-gzip grid as one Uint8Array. fetchBytes(file) -> Uint8Array.
export async function unpackGrid(header, fetchBytes) {
  const [w, h] = header.dims, n = w * h;
  const out = new Uint8Array(header.frames * n);
  await Promise.all(header.chunks.map(async (c) => out.set(undelta(await gunzip(await fetchBytes(c.file)), n), c.start * n)));
  return out;
}

// A large grid loaded chunk by chunk (time ranges). valueAt returns undefined while a frame's chunk is missing,
// so callers fall back to a coarse grid. ensure(t) loads the chunk holding t (and returns a promise).
export function chunkedGrid(header, fetchBytes) {
  const [width, height] = header.dims, n = width * height;
  const { scale = 1, offset = 0 } = header, nodata = header.nodata ?? 255;
  const fromByte = header.transform === 'log10' ? (b) => 10 ** (offset + b * scale) : (b) => offset + b * scale;
  const data = header.chunks.map(() => null), pending = new Map();
  const index = (t) => header.chunks.findIndex((c) => t >= c.start && t < c.start + c.frames);
  function ensure(t) {
    const i = index(t | 0);
    if (i < 0 || data[i]) return Promise.resolve();
    if (!pending.has(i)) {
      pending.set(i, fetchBytes(header.chunks[i].file).then(gunzip)
        .then((b) => { data[i] = undelta(b, n); }).catch((e) => { pending.delete(i); console.warn('[grid]', e.message); }));
    }
    return pending.get(i);
  }
  // Loads every chunk, nearest to `from` first, one at a time.
  async function loadAll(from = 0) {
    const order = header.chunks.map((c, i) => i).sort((a, b) =>
      Math.abs(header.chunks[a].start - from) - Math.abs(header.chunks[b].start - from));
    for (const i of order) await ensure(header.chunks[i].start);
  }
  function valueAt(lat, lon, t) {
    t = Math.max(0, Math.min(header.frames - 1, t | 0));
    const i = index(t);
    if (i < 0 || !data[i]) return undefined;
    const fx = ((((lon + 180) / 360) % 1) + 1) % 1, fy = (90 - lat) / 180;
    if (!(fy >= 0 && fy <= 1)) return null;
    const x = Math.min(width - 1, (fx * width) | 0), y = Math.min(height - 1, (fy * height) | 0);
    const b = data[i][(t - header.chunks[i].start) * n + y * width + x];
    return b === nodata ? null : fromByte(b);
  }
  return { width, height, frames: header.frames, ensure, loadAll, valueAt, loaded: (t) => !!data[index(t | 0)] };
}

// Index of the image frame (sorted by hour) to show for a given hour: the last one at or before it.
export function frameForHour(frames, hour) {
  let best = 0;
  for (let i = 0; i < frames.length; i++) if (frames[i].hour <= hour) best = i; else break;
  return best;
}
