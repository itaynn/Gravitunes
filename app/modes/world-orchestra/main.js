// World orchestra: an instrument-comparison map. ~60 musical regions, each with a recorded instrument
// (sound-engine/library/samples). A click, tap or Enter plays the chosen melody at the chosen pitch in the
// chosen scale on that region's instrument; every region plays the same notes, so only the timbre differs.
// Hover and arrow keys only announce. No dataset.
import { voiceAt, melodyNotes, MELODIES } from './orchestra.js';
import { noteName } from '../../core/scales.js';
import { scaleControl } from '../../core/scale-control.js';
import { loadEarth } from '../../core/data.js';
import { formatLatLon as fmt, regionTint } from '../../core/geo.js';
import { playNotes } from '../../core/gestures.js';

const BLEND_KM = 900;

export default function start(ctx) {
  const { input, sound, panel, describe, viewer } = ctx;
  let alive = true, setup = null;
  (async () => {
    const [mj, ij] = await Promise.all([loadEarth('musical-centers'), loadEarth('instruments')]);
    if (!alive) return;
    setup = run(mj.centers, ij.instruments);
  })().catch((e) => {
    console.error(e);
    const msg = `World orchestra could not load its map data: ${e.message}`;
    panel.text(msg); describe(msg);
  });

  function run(centers, instruments) {
    const colorOf = new Map(centers.map((c, i) => [c.id, `hsl(${Math.round((i * 360) / centers.length)} 70% 55%)`]));
    const sampleIds = [...new Set(Object.values(instruments).map((v) => v.sample).filter(Boolean))];
    sound.loadSamples?.(sampleIds);

    const s = { scale: 'pentatonic-major', melody: 'tune', pitch: 0, picked: null };
    for (const q of ['#timeline', '#time-label', '#colorbar', '#dataset-title', '#dataset-picker'])
      { const el = document.querySelector(q); if (el) el.hidden = true; }

    panel.text('Click a region to hear its instrument. Every region plays the same notes, so only the instrument changes.', { visible: true });
    panel.select('Pitch', [-12, -7, -5, 0, 5, 7, 12].map((v) => [String(v), noteName(v)]),
      (v) => { s.pitch = +v; describe(`Pitch ${noteName(+v)}`); }, { value: String(s.pitch), hint: 'Starting note, the same for every region.' });
    panel.select('Melody', Object.entries(MELODIES).map(([k, m]) => [k, m.label]),
      (v) => { s.melody = v; describe(`Melody: ${MELODIES[v].label}`); }, { value: s.melody, hint: 'The same melody for every region.' });
    scaleControl(panel, { value: s.scale, describe, sound, onChange: (v) => { s.scale = v; } });

    // Hover and arrow keys announce; a click, tap or Enter plays.
    let lastKey = null, jumping = false;
    function probe({ lat, lon, keyboard = false }, play = false) {
      const { primary, voice } = voiceAt(lat, lon, centers, instruments, BLEND_KM);
      const inst = instruments[primary.instrument];
      const text = `${primary.label}: ${inst.label}, ${inst.inspiredBy}.`;
      if (play) {
        s.picked = primary.id; lastKey = primary.id;
        describe(`Playing ${text}`);
        viewer.redraw();
        playNotes(sound, voice, melodyNotes(s.scale, s.pitch, s.melody), { amp: 0.4, pan: lon / 180 });
        return;
      }
      if (primary.id === lastKey) return;
      lastKey = primary.id; viewer.redraw();
      if (keyboard || jumping) describe(`${fmt(lat, lon)}. ${text}`);
    }
    // [ and ] jump west/east between regions.
    const order = [...centers].sort((a, b) => a.lon - b.lon || b.lat - a.lat);
    const onKey = (e) => {
      if (e.key !== '[' && e.key !== ']') return;
      e.preventDefault();
      const { lat, lon } = input.position();
      const cur = voiceAt(lat, lon, centers, instruments, BLEND_KM).primary;
      const i = order.indexOf(cur), n = order.length;
      const c = order[(i + (e.key === ']' ? 1 : -1) + n) % n];
      jumping = true; lastKey = null;
      try { input.moveTo(c.lat, c.lon); } finally { jumping = false; }
    };
    viewer.canvas.addEventListener('keydown', onKey, true);
    const offHover = input.onHover((p) => probe(p));
    const offClick = input.onClick((p) => probe(p, true));

    // Region tint and instrument labels (no overlaps); the clicked region gets a yellow outline.
    const atlasTint = regionTint(centers, colorOf, BLEND_KM);
    const removeOverlay = viewer.addOverlay((g, v) => {
      const W = v.canvas.width, H = v.canvas.height;
      g.save();
      g.globalAlpha = 0.16; g.imageSmoothingEnabled = false; g.drawImage(atlasTint, 0, 0, W, H); g.globalAlpha = 1;
      g.font = '600 12px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      const placed = [];
      const hit = (a) => placed.some((b) => a.bx < b.bx + b.w + 2 && b.bx < a.bx + a.w + 2 && a.by < b.by + b.h + 2 && b.by < a.by + a.h + 2);
      for (const c of centers) {
        if (c.instrument === 'ocean') continue;
        const [x, y0] = v.toPixel(c.lat, c.lon), text = instruments[c.instrument].label;
        const w = g.measureText(text).width + 20, h = 16;
        const box = { c, text, w, h, bx: Math.min(W - w, Math.max(0, x - w / 2)), by: y0 - h / 2 };
        for (let k = 1; hit(box) && k < 12; k++) box.by = y0 - h / 2 + Math.ceil(k / 2) * (h + 2) * (k % 2 ? 1 : -1);
        placed.push(box);
      }
      const rank = (c) => (c.id === s.picked ? 2 : c.id === lastKey ? 1 : 0);
      placed.sort((a, b) => rank(a.c) - rank(b.c));
      for (const { c, text, w, h, bx, by } of placed) {
        const y = by + h / 2, r = rank(c);
        g.fillStyle = r ? 'rgba(0,0,0,.92)' : 'rgba(0,0,0,.72)';
        g.beginPath(); g.roundRect ? g.roundRect(bx, by, w, h, 5) : g.rect(bx, by, w, h); g.fill();
        if (r) { g.strokeStyle = r === 2 ? '#ffd400' : '#fff'; g.lineWidth = r === 2 ? 2.5 : 1.5; g.stroke(); }
        g.fillStyle = colorOf.get(c.id); g.beginPath(); g.arc(bx + 8, y, 4, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.fillText(text, bx + 15, y + 0.5);
      }
      g.restore();
    });
    viewer.redraw();
    describe(`World orchestra: ${centers.length} regions. Click a region, or move with the arrow keys and press Enter, to hear its instrument. Square brackets jump between regions.`);

    return () => {
      offHover(); offClick(); removeOverlay();
      viewer.canvas.removeEventListener('keydown', onKey, true);
    };
  }

  return () => { alive = false; setup?.(); };
}
