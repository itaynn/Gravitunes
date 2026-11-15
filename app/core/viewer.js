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

// Zoom & pan. A view {z, x, y}: zoom 1..MAX_ZOOM and the map-space point (canvas pixels at zoom 1) shown at the
// top-left corner. Map space is what toPixel/toLatLon use, so overlays draw unchanged: the viewer applies the view
// as a canvas transform around them. Screen space is canvas pixels as displayed (what pointer events give).
export const MAX_ZOOM = 8;
export function clampView({ z = 1, x = 0, y = 0 }, W, H) {
  z = Math.max(1, Math.min(MAX_ZOOM, z));
  return { z, x: Math.max(0, Math.min(W - W / z, x)), y: Math.max(0, Math.min(H - H / z, y)) };
}
export const screenToMap = (v, sx, sy) => [v.x + sx / v.z, v.y + sy / v.z];
export const mapToScreen = (v, mx, my) => [(mx - v.x) * v.z, (my - v.y) * v.z];
// Zoom by `factor` keeping the map point under screen point (sx, sy) fixed (as far as clamping allows).
export function zoomAt(v, factor, sx, sy, W, H) {
  const [mx, my] = screenToMap(v, sx, sy), z = Math.max(1, Math.min(MAX_ZOOM, v.z * factor));
  return clampView({ z, x: mx - sx / z, y: my - sy / z }, W, H);
}

// imageCanvas (optional): a canvas under `canvas` (same CSS box) that shows the data frames at their own
// resolution (e.g. 2048x1024 SVS frames), cross-faded; `canvas` then holds only the basemap, overlays and cursor.
export function createViewer(canvas, { basemap = true, plain = false, imageCanvas = null } = {}) {
  const g = canvas.getContext('2d');
  const ig = imageCanvas?.getContext('2d');
  let prev = null, fadeStart = 0, fadeMs = 0, fadeRaf = 0;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function drawImageLayer() {
    if (!ig) return;
    const W = imageCanvas.width, H = imageCanvas.height;
    const f = fadeMs ? Math.min(1, (now() - fadeStart) / fadeMs) : 1;
    ig.imageSmoothingEnabled = true; ig.imageSmoothingQuality = 'high';
    ig.globalAlpha = 1;
    if (!image || isPlain) { ig.clearRect(0, 0, W, H); return; }  // plain map: no data image
    // Crop the source to the view, so a zoomed map samples the frame at its full (HD) resolution.
    const crop = (im) => {
      const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
      const fx = iw / canvas.width, fy = ih / canvas.height;
      ig.drawImage(im, view.x * fx, view.y * fy, (canvas.width / view.z) * fx, (canvas.height / view.z) * fy, 0, 0, W, H);
    };
    if (prev && f < 1) { crop(prev); ig.globalAlpha = f; }
    crop(image);
    ig.globalAlpha = 1;
    if (f < 1) fadeRaf = requestAnimationFrame(drawImageLayer); else { prev = null; fadeRaf = 0; }
  }
  function setImage(im, { fade = 0 } = {}) {
    if (!ig) { image = im; draw(); return; }
    const w = im?.naturalWidth || im?.width, h = im?.naturalHeight || im?.height;
    // The image layer takes the frame's own resolution (at least the overlay canvas's).
    if (w && h && (imageCanvas.width !== Math.max(w, canvas.width) || imageCanvas.height !== Math.max(h, canvas.height))) {
      imageCanvas.width = Math.max(w, canvas.width); imageCanvas.height = Math.max(h, canvas.height); prev = null;
    }
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (fade > 0 && !reduce && image && im !== image && typeof requestAnimationFrame === 'function') {
      prev = image; fadeStart = now(); fadeMs = fade;
    } else { prev = null; fadeMs = 0; }
    image = im;
    if (fadeRaf) cancelAnimationFrame(fadeRaf);
    fadeRaf = 0;
    drawImageLayer();
  }
  const overlays = new Set(), viewListeners = new Set();
  let view = { z: 1, x: 0, y: 0 };
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
      const w = Math.max(0.6, W / 1400) / view.z;
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
    const w = Math.max(0.6, canvas.width / 1400) / view.z;
    strokeLines(base.coast, w, 0.45, color);
    strokeLines(base.borders, w * 0.8, 0.25, color);
  }

  function draw() {
    const { width: W, height: H } = canvas;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    // Everything but the cursor is drawn in map space under the view transform.
    g.setTransform(view.z, 0, 0, view.z, -view.x * view.z, -view.y * view.z);
    if (isPlain) drawPlain();
    else {
      if (image && !ig) g.drawImage(image, 0, 0, W, H);
      if (showBase && base) drawBasemap();
    }
    for (const fn of overlays) { g.save(); fn(g, viewer); g.restore(); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (cursor) {
      const [x, y] = mapToScreen(view, ...viewer.toPixel(cursor.lat, cursor.lon));
      g.lineWidth = 2; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke();
      g.strokeStyle = '#000'; g.beginPath(); g.arc(x, y, 11, 0, 7); g.stroke();
    }
  }
  const viewer = {
    canvas,
    // setImage(im, { fade: ms }) cross-fades from the previous frame when an image layer is used.
    setImage,
    setCursor(c) { cursor = c; draw(); },
    // Overlay: fn(ctx2d, viewer) drawn on top of the frame. Returns a remover.
    addOverlay(fn) { overlays.add(fn); draw(); return () => { overlays.delete(fn); draw(); }; },
    redraw: draw,
    // Zoom & pan: view is {z, x, y} (see clampView). setView clamps, redraws and notifies onView listeners.
    get view() { return view; },
    get zoom() { return view.z; },
    setView(v) {
      const n = clampView(v, canvas.width, canvas.height);
      if (n.z === view.z && n.x === view.x && n.y === view.y) return;
      const zoomed = n.z !== view.z;
      view = n; drawImageLayer(); draw();
      viewListeners.forEach((fn) => fn(view, zoomed));
    },
    zoomAt(factor, sx = canvas.width / 2, sy = canvas.height / 2) { viewer.setView(zoomAt(view, factor, sx, sy, canvas.width, canvas.height)); },
    panBy(dx, dy) { viewer.setView({ ...view, x: view.x - dx / view.z, y: view.y - dy / view.z }); },
    resetView() { viewer.setView({ z: 1, x: 0, y: 0 }); },
    onView(fn) { viewListeners.add(fn); return () => viewListeners.delete(fn); },
    // Screen (displayed canvas pixels) <-> lat/lon, through the view.
    screenToLatLon: (sx, sy) => viewer.toLatLon(...screenToMap(view, sx, sy)),
    latLonToScreen: (lat, lon) => mapToScreen(view, ...viewer.toPixel(lat, lon)),
    // Pan (keeping zoom) so a lat/lon is on screen, centring it if it was near or past the edge.
    reveal(lat, lon) {
      if (view.z === 1) return;
      const [sx, sy] = viewer.latLonToScreen(lat, lon), W = canvas.width, H = canvas.height, m = 0.05;
      if (sx >= W * m && sx <= W * (1 - m) && sy >= H * m && sy <= H * (1 - m)) return;
      const [mx, my] = viewer.toPixel(lat, lon);
      viewer.setView({ ...view, x: mx - W / view.z / 2, y: my - H / view.z / 2 });
    },
    // Plain map (no data image; land, coastlines and borders on a light ocean).
    get plain() { return isPlain; },
    setPlain(on) {
      isPlain = !!on;
      if (isPlain && !base && typeof fetch === 'function') loadBasemap().then((b) => { base = b; draw(); });
      drawImageLayer();
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

  const screenXY = (e) => {
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };
  const fromEvent = (e) => viewer.screenToLatLon(...screenXY(e));

  // Mouse: wheel zooms around the cursor; when zoomed, drag pans and a click without a drag fires on release.
  // Touch: one finger explores; two fingers pinch-zoom and pan.
  const touches = new Map();
  let drag = null, pinch = null;
  const pinchState = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  };
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    viewer.zoomAt(Math.exp(-dy * 0.002), ...screenXY(e));
  }, { passive: false });
  c.addEventListener('pointerdown', (e) => {
    c.focus();
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, screenXY(e));
      if (touches.size === 2) { pinch = pinchState(); return; }
      if (touches.size > 2) return;
    } else if (e.button === 0 && viewer.zoom > 1) {
      drag = { start: screenXY(e), last: screenXY(e), moved: false, id: e.pointerId };
      c.setPointerCapture?.(e.pointerId);
      return;
    }
    emit(click, fromEvent(e)); emit(hover, fromEvent(e));
  });
  c.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, screenXY(e));
      if (pinch && touches.size === 2) {
        const p = pinchState();
        viewer.panBy(p.m[0] - pinch.m[0], p.m[1] - pinch.m[1]);
        viewer.zoomAt(p.d / pinch.d, ...p.m);
        pinch = p;
        return;
      }
      if (pinch) return;  // one finger left after a pinch: wait until it lifts
    }
    if (drag && e.pointerId === drag.id) {
      const p = screenXY(e);
      if (!drag.moved && Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) > 4) { drag.moved = true; c.style.cursor = 'grabbing'; }
      if (drag.moved) { viewer.panBy(p[0] - drag.last[0], p[1] - drag.last[1]); drag.last = p; return; }
    }
    emit(hover, fromEvent(e));
  });
  const up = (e) => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (!touches.size) pinch = null;
      return;
    }
    if (drag && e.pointerId === drag.id) {
      const moved = drag.moved; drag = null; c.style.cursor = '';
      if (!moved && e.type === 'pointerup') { emit(click, fromEvent(e)); emit(hover, fromEvent(e)); }
    }
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
  c.style.touchAction = 'none';  // touch drag explores instead of scrolling

  // Arrow keys move 5 degrees (Shift: 1, Alt: 20). Enter = click (Space is Play/Stop). Home = 0,0. Key moves carry keyboard: true.
  c.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 1 : e.altKey ? 20 : 5;
    let { lat, lon } = pos;
    switch (e.key) {
      case 'ArrowUp': lat += d; break;
      case 'ArrowDown': lat -= d; break;
      case 'ArrowLeft': lon -= d; break;
      case 'ArrowRight': lon += d; break;
      case 'Home': lat = 0; lon = 0; break;
      case 'Enter': e.preventDefault(); emit(click, pos); return;
      // + / - zoom in and out around the cursor (which stays on screen); 0 resets the view.
      case '+': case '=': case '-': case '_': {
        e.preventDefault();
        const [mx, my] = viewer.toPixel(pos.lat, pos.lon), z = viewer.zoom * (e.key === '+' || e.key === '=' ? 2 : 0.5);
        viewer.setView({ z, x: mx - c.width / z / 2, y: my - c.height / z / 2 });
        return;
      }
      case '0': e.preventDefault(); viewer.resetView(); return;
      default: return;
    }
    e.preventDefault();
    const p = { lat: clampLat(lat), lon: wrapLon(lon), keyboard: true };
    viewer.reveal(p.lat, p.lon);
    emit(hover, p);
  });

  const sub = (set) => (fn) => { set.add(fn); return () => set.delete(fn); };
  return {
    onHover: sub(hover),
    onClick: sub(click),
    position: () => pos,
    moveTo(lat, lon) { emit(hover, { lat: clampLat(lat), lon: wrapLon(lon) }); },
  };
}
