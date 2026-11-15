// The original NASA SVS frames of a dataset (written by analysis/gravitunes_analysis/mode_export.py into a
// mode's data folder: frames.json, frames/NNN.webp, land.png) drawn as a backdrop: dark ocean, filled land,
// coastlines and borders, then the NASA rain colours (transparent where dry), cross-faded between frames so
// playback is continuous. Same equirectangular extent as the viewer (lon -180..180, lat 90..-90).
import { loadBasemap, basemapPaths } from './viewer.js';

// Fetch (not <img src>) so the standalone build's fetch override serves the files too.
async function bitmap(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url}`);
  const b = await r.blob();
  if (typeof createImageBitmap === 'function') return createImageBitmap(b);
  const im = new Image();
  im.src = URL.createObjectURL(b);
  await im.decode();
  return im;
}

// Fractional time: the frame shown and how far playback is toward the next one (0..1).
export function framePhase(sinceMs, fps, playing) {
  return playing ? Math.max(0, Math.min(1, (sinceMs * fps) / 1000)) : 0;
}

export function createBackdrop(dirUrl, { viewer, time, alpha = 0.85 } = {}) {
  let meta = null, land = null, base = null, frames = [];
  let frameAt = performance.now(), t0 = time.now();
  const offFrame = time.onFrame((t) => { t0 = t; frameAt = performance.now(); });
  const ready = (async () => {
    meta = await (await fetch(new URL('frames.json', dirUrl))).json();
    frames = new Array(meta.files.length).fill(null);
    [land, base] = await Promise.all([bitmap(new URL('land.png', dirUrl)).catch(() => null), loadBasemap().catch(() => null)]);
    // Current frame first, then the rest in order.
    const order = [...meta.files.keys()].sort((a, b) => ((a - t0 + 999) % frames.length) - ((b - t0 + 999) % frames.length));
    for (const i of order) frames[i] = await bitmap(new URL(meta.files[i], dirUrl)).catch(() => null);
    viewer.redraw();
  })();
  ready.catch((e) => console.warn('[backdrop]', e.message));

  // Land mask (white on black) -> tinted, transparent sea, cached per canvas size.
  let landTint = null;
  function tinted(W, H) {
    if (landTint && landTint.width === W && landTint.height === H) return landTint;
    const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g = c.getContext('2d');
    g.drawImage(land, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H), m = d.data;
    for (let i = 0; i < m.length; i += 4) { m[i + 3] = m[i]; m[i] = 0x3a; m[i + 1] = 0x42; m[i + 2] = 0x50; }
    g.putImageData(d, 0, 0);
    landTint = c;
    return c;
  }
  function lines(g, vw, list, width, color) {
    g.strokeStyle = color; g.lineWidth = width; g.lineJoin = g.lineCap = 'round'; g.beginPath();
    for (const p of basemapPaths(list, vw.toPixel)) { g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]); }
    g.stroke();
  }

  return {
    ready,
    // Fractional frame index for smooth animation (t + phase while playing).
    phase: () => framePhase(performance.now() - frameAt, time.fps || 2, time.playing),
    frameCount: () => frames.length,
    draw(g, vw) {
      const W = vw.canvas.width, H = vw.canvas.height;
      g.save();
      g.fillStyle = '#0d1520'; g.fillRect(0, 0, W, H);
      if (land) g.drawImage(tinted(W, H), 0, 0);
      const t = time.now(), n = frames.length;
      const ph = this.phase();
      const a = frames[t], b = n ? frames[(t + 1) % n] : null;
      g.imageSmoothingEnabled = true;
      if (a) { g.globalAlpha = alpha * (b ? 1 - ph : 1); g.drawImage(a, 0, 0, W, H); }
      if (b && ph > 0) { g.globalAlpha = alpha * ph; g.drawImage(b, 0, 0, W, H); }
      g.globalAlpha = 1;
      if (base && vw.basemap !== false) {
        const w = Math.max(0.6, W / 1400);
        g.globalAlpha = 0.7; lines(g, vw, base.coast, w, '#c9d3df');
        g.globalAlpha = 0.35; lines(g, vw, base.borders, w * 0.8, '#c9d3df');
      }
      g.restore();
    },
    // NASA colour bars (rain, snow) as <img> elements with alt text, or [] when not shipped.
    async colorbars() {
      await ready;
      const out = [];
      for (const [k, alt] of [['rain', 'NASA liquid precipitation colour bar: dark green 0.1 mm per hour, yellow 2, orange 5, red 10 to 50.'],
        ['snow', 'NASA frozen precipitation colour bar: cyan 0.1 mm per hour through blue to purple 50.']]) {
        const f = meta?.colorbars?.[k];
        if (!f) continue;
        try {
          const r = await fetch(new URL(f, dirUrl));
          if (!r.ok) continue;
          const im = new Image();
          im.src = URL.createObjectURL(await r.blob());
          im.alt = alt; im.className = 'colorbar'; im.style.cssText = 'width:260px;max-width:48%;margin-right:8px';
          out.push(im);
        } catch {}
      }
      return out;
    },
    dispose() { offFrame(); },
  };
}
