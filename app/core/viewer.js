// ctx.viewer (map canvas, overlays, lat/lon <-> pixel) and ctx.input (hover/click/touch/keys -> {lat, lon}).
// The map is a full-globe equirectangular image (2:1): x = lon -180..180, y = lat 90..-90.

// Basemap: Natural Earth (public domain) coastlines + land borders, data/earth/{coastlines,borders}.json,
// {lines: [[lon, lat, lon, lat, ...], ...]}. Drawn thin and faint between the data image and mode overlays.
// Plain mode (createViewer {plain: true} or setPlain): no data image; land (data/earth/land.json, Natural Earth via
// world-atlas) filled on a light ocean, with coastlines and country borders, for maps that only show places.
let basemapData = null;
export function loadBasemap(base = '/data/earth/') {
  basemapData ??= Promise.all(['coastlines', 'borders', 'land'].map((n) =>
    fetch(`${base}${n}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
    .then(([coast, borders, land]) => ({ coast: coast?.lines || [], borders: borders?.lines || [], land: land?.rings || [] }));
  return basemapData;
}

// A land ring as one continuous path: longitudes are unwrapped across the date line, so the caller draws it
// again shifted by +-360 degrees to fill both edges of the map.
export function unwrapRing(L) {
  const out = [];
  let off = 0;
  for (let i = 0; i < L.length; i += 2) {
    if (i && Math.abs(L[i] - L[i - 2]) > 180) off += L[i] < L[i - 2] ? 360 : -360;
    out.push([L[i] + off, L[i + 1]]);
  }
  return out;
}
export const PLAIN = { ocean: '#a8c5dc', land: '#fbf9f3', coast: '#4f6070', border: '#8d99a4' };

// Split a polyline where it jumps across the date line, so no segment streaks across the map.
export function basemapPaths(lines, toPixel) {
  const out = [];
  for (const L of lines) {
    let path = [];
    for (let i = 0; i < L.length; i += 2) {
      if (i && Math.abs(L[i] - L[i - 2]) > 180) { if (path.length > 1) out.push(path); path = []; }
      path.push(toPixel(L[i + 1], L[i]));
    }
    if (path.length > 1) out.push(path);
  }
  return out;
}

export function createViewer(canvas, { basemap = true, plain = false } = {}) {
  const g = canvas.getContext('2d');
  const overlays = new Set();
  let image = null, cursor = null, base = null, showBase = basemap, isPlain = plain;
  if ((basemap || plain) && typeof fetch === 'function') loadBasemap().then((b) => { base = b; draw(); });

  function drawPlain() {
    const W = canvas.width, H = canvas.height;
    g.save();
    g.fillStyle = PLAIN.ocean; g.fillRect(0, 0, W, H);
    if (base) {
      g.fillStyle = PLAIN.land; g.beginPath();
      for (const ring of base.land) {
        const pts = unwrapRing(ring);
        for (const shift of [0, -360, 360]) {
          pts.forEach(([lon, lat], i) => { const [x, y] = viewer.toPixel(lat, lon + shift); i ? g.lineTo(x, y) : g.moveTo(x, y); });
          g.closePath();
        }
      }
      g.fill('evenodd');
      const w = Math.max(0.6, W / 1400);
      strokeLines(base.borders, w * 0.9, 0.9, PLAIN.border);
      strokeLines(base.coast, w * 1.1, 0.9, PLAIN.coast);
    }
    g.restore();
  }

  function strokeLines(lines, width, alpha, color) {
    g.save();
    g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = width; g.lineJoin = g.lineCap = 'round';
    g.beginPath();
    for (const p of basemapPaths(lines, viewer.toPixel)) {
      g.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]);
    }
    g.stroke(); g.restore();
  }
  function drawBasemap() {
    // Theme-aware: --basemap (or --fg) from the page's CSS; scale width with canvas size.
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(canvas) : null;
    const color = css?.getPropertyValue('--basemap').trim() || css?.getPropertyValue('--fg').trim() || '#fff';
    const w = Math.max(0.6, canvas.width / 1400);
    strokeLines(base.coast, w, 0.45, color);
    strokeLines(base.borders, w * 0.8, 0.25, color);
  }

  function draw() {
    const { width: W, height: H } = canvas;
    g.clearRect(0, 0, W, H);
    if (isPlain) drawPlain();
    else {
      if (image) g.drawImage(image, 0, 0, W, H);
      if (showBase && base) drawBasemap();
    }
    for (const fn of overlays) fn(g, viewer);
    if (cursor) {
      const [x, y] = viewer.toPixel(cursor.lat, cursor.lon);
      g.lineWidth = 2; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke();
      g.strokeStyle = '#000'; g.beginPath(); g.arc(x, y, 11, 0, 7); g.stroke();
    }
  }
  const viewer = {
    canvas,
    setImage(im) { image = im; draw(); },
    setCursor(c) { cursor = c; draw(); },
    // Overlay: fn(ctx2d, viewer) drawn on top of the frame. Returns a remover.
    addOverlay(fn) { overlays.add(fn); draw(); return () => { overlays.delete(fn); draw(); }; },
    redraw: draw,
    // Plain map (no data image; land, coastlines and borders on a light ocean).
    get plain() { return isPlain; },
    setPlain(on) {
      isPlain = !!on;
      if (isPlain && !base && typeof fetch === 'function') loadBasemap().then((b) => { base = b; draw(); });
      draw();
    },
    // Basemap (coastlines + borders) toggle; on by default.
    get basemap() { return showBase; },
    setBasemap(on) {
      showBase = !!on;
      if (showBase && !base && typeof fetch === 'function') loadBasemap().then((b) => { base = b; draw(); });
      draw();
    },
    // Canvas pixel coordinates (canvas.width/height space).
    toPixel: (lat, lon) => [((lon + 180) / 360) * canvas.width, ((90 - lat) / 180) * canvas.height],
    toLatLon: (x, y) => ({ lon: (x / canvas.width) * 360 - 180, lat: 90 - (y / canvas.height) * 180 }),
  };
  return viewer;
}

const clampLat = (v) => Math.max(-89.9, Math.min(89.9, v));
const wrapLon = (v) => ((((v + 180) % 360) + 360) % 360) - 180;

export function createInput(viewer) {
  const c = viewer.canvas;
  const hover = new Set(), click = new Set();
  let pos = { lat: 0, lon: 0 };
  const emit = (set, p) => { pos = p; viewer.setCursor(p); set.forEach((fn) => fn(p)); };

  function fromEvent(e) {
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width, y = ((e.clientY - r.top) / r.height) * c.height;
    return viewer.toLatLon(x, y);
  }
  c.addEventListener('pointermove', (e) => emit(hover, fromEvent(e)));
  c.addEventListener('pointerdown', (e) => { c.focus(); emit(click, fromEvent(e)); emit(hover, fromEvent(e)); });
  c.style.touchAction = 'none';  // touch drag explores instead of scrolling

  // Arrow keys move 5 degrees (Shift: 1, Alt: 20). Enter/Space = click. Home = 0,0. Key moves carry keyboard: true.
  c.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 1 : e.altKey ? 20 : 5;
    let { lat, lon } = pos;
    switch (e.key) {
      case 'ArrowUp': lat += d; break;
      case 'ArrowDown': lat -= d; break;
      case 'ArrowLeft': lon -= d; break;
      case 'ArrowRight': lon += d; break;
      case 'Home': lat = 0; lon = 0; break;
      case 'Enter': case ' ': e.preventDefault(); emit(click, pos); return;
      default: return;
    }
    e.preventDefault();
    emit(hover, { lat: clampLat(lat), lon: wrapLon(lon), keyboard: true });
  });

  const sub = (set) => (fn) => { set.add(fn); return () => set.delete(fn); };
  return {
    onHover: sub(hover),
    onClick: sub(click),
    position: () => pos,
    moveTo(lat, lon) { emit(hover, { lat: clampLat(lat), lon: wrapLon(lon) }); },
  };
}
