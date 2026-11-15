// Storm tracks from analysis/gravitunes_analysis/storms.py (itay's storm-watch pipeline): loading,
// lookup, family (merge/split lineage), hit tests, colours, drawing and spoken descriptions.
// Track JSON: {version: 1, width, height, frames: [{time, components, missingSources, merges}], tracks, summary}.
// A component: {id, parentId, lineageIds, lineageAnchors: [{id, x, y}], coreX, coreY, area,
//   polygons: [{outer: [[x, y], ...], holes: [...]}]}, all in analysis-grid pixels (width x height,
//   equirectangular, x = lon -180..180, y = lat 90..-90). Pure except the draw helpers; runs in node.
import { formatLatLon } from './geo.js';

export async function loadStormTracks(url, { frames } = {}) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const data = await r.json();
  checkStormTracks(data, { frames });
  return data;
}

export function checkStormTracks(data, { frames } = {}) {
  if (data?.version !== 1 || !Array.isArray(data.frames) || !(data.width > 0) || !(data.height > 0)
      || (frames != null && data.frames.length !== frames)) {
    throw new Error('Storm track data has an unsupported format.');
  }
  for (const f of data.frames) f.missingSources ??= [];
  return data;
}

// Grid pixel <-> lat/lon on the tracks' analysis grid.
export const gridToLatLon = (x, y, width, height) => ({ lat: 90 - (y / height) * 180, lon: (x / width) * 360 - 180 });
export const latLonToGrid = (lat, lon, width, height) => ({ x: ((lon + 180) / 360) * width, y: ((90 - lat) / 180) * height });

// Is this component the storm `id` or a part of its merged family?
export const inFamily = (c, id) => id != null && (c.id === id || (c.lineageIds ?? []).includes(id));

// The visible parts of storm `id` in a frame, and the remembered (predicted, below cutoff) parts.
export function familyParts(frame, id) {
  if (id == null || !frame) return { parts: [], remembered: [] };
  const parts = frame.components.filter((c) => inFamily(c, id));
  const active = new Set(parts.flatMap((c) => c.lineageIds ?? [c.id]));
  const remembered = (frame.missingSources ?? []).filter((s) => inFamily(s, id) && !active.has(s.id));
  return { parts, remembered };
}

// Where to mark storm `id` on a component: its own lineage anchor if it has one, else the core.
export function anchorOf(c, id) {
  const a = (c.lineageAnchors ?? []).find((item) => item.id === id);
  return { x: a?.x ?? c.coreX ?? c.x, y: a?.y ?? c.coreY ?? c.y };
}

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

export const inComponent = (c, x, y) => (c.polygons ?? []).some((p) =>
  pointInRing(x, y, p.outer) && !(p.holes ?? []).some((h) => pointInRing(x, y, h)));

// Topmost component under grid point (x, y), or null.
export const stormAt = (components, x, y) => [...components].reverse().find((c) => inComponent(c, x, y)) ?? null;

// Largest first: the order used by lists and arrow-key stepping.
export const bySize = (components) => [...components].sort((a, b) => b.area - a.area);

// Arrow-key stepping: the next storm (largest first) after the one in `selectedId`'s family.
export function stepStorm(components, selectedId, step) {
  const sorted = bySize(components);
  if (!sorted.length) return null;
  const at = sorted.findIndex((c) => inFamily(c, selectedId));
  return sorted[at < 0 ? (step > 0 ? 0 : sorted.length - 1) : (at + step + sorted.length) % sorted.length];
}

export function stormSize(c, sorted) {
  const rank = sorted.indexOf(c) / Math.max(1, sorted.length - 1);
  return rank < 0.25 ? 'large' : rank < 0.7 ? 'medium' : 'small';
}

// "over the tropical Pacific, near 12°N, 150°W" from a component's core on a width x height grid.
export function stormPlace(c, width, height) {
  const { lat, lon } = gridToLatLon(c.coreX ?? c.x, c.coreY ?? c.y, width, height);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 'location unknown';
  const ns = lat > 23 ? 'northern' : lat < -23 ? 'southern' : 'tropical';
  const region = lon < -100 || lon > 145 ? 'Pacific' : lon < -20 ? 'Atlantic and the Americas'
    : lon < 60 ? 'Europe and Africa' : 'Asia and the Indian Ocean';
  return `over the ${ns} ${region}, near ${formatLatLon(lat, lon).replace(', ', ' ')}`;
}

// Stable, well-spread colour per storm id (golden angle).
export function stormColor(id) {
  const hue = (id * 137.508) % 360;
  return { hue, css: `hsl(${hue} 96% 62%)`, ...hueToRgb(hue) };
}

export function hueToRgb(hue) {
  const x = 1 - Math.abs(((hue / 60) % 2) - 1);
  const v = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(hue / 60) % 6];
  return { r: Math.round(v[0] * 255), g: Math.round(v[1] * 255), b: Math.round(v[2] * 255) };
}

// ---- drawing (2D canvas) ----
// Fill and outline one component; sx, sy scale grid pixels to canvas pixels.
export function drawStormShape(g, c, { r, g: gr, b }, { fill = 0.35, line = 0.98, dashed = false, sx = 1, sy = 1 } = {}) {
  g.beginPath();
  for (const p of c.polygons ?? []) {
    for (const ring of [p.outer, ...(p.holes ?? [])]) {
      if (!ring?.length) continue;
      g.moveTo(ring[0][0] * sx, ring[0][1] * sy);
      for (let i = 1; i < ring.length; i += 1) g.lineTo(ring[i][0] * sx, ring[i][1] * sy);
      g.closePath();
    }
  }
  g.fillStyle = `rgba(${r}, ${gr}, ${b}, ${fill})`;
  g.fill('evenodd');
  g.strokeStyle = `rgba(${r}, ${gr}, ${b}, ${line})`;
  g.lineWidth = (dashed ? 1 : 1.5) * Math.max(1, sx);
  g.setLineDash(dashed ? [5, 4] : []);
  g.stroke();
  g.setLineDash([]);
}

// White ring with a coloured glow: the followed storm's core.
export function drawCoreMarker(g, x, y, css, radius = 8) {
  g.save();
  g.shadowBlur = 12;
  g.shadowColor = css;
  for (const [stroke, width] of [['#fff', 3], [css, 2]]) {
    g.strokeStyle = stroke;
    g.lineWidth = width;
    g.beginPath();
    g.arc(x, y, radius, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(x, y, 2, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
