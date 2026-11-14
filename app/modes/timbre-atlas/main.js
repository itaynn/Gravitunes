// Timbre atlas: hover (or arrow keys / touch) over the world map to hear that region's instrument play a short
// idiomatic gesture. Voices blend near borders, as in world-orchestra. No data values are used.
import { voiceAt, gestureNotes, gestureLength } from './atlas.js';
import { playNotes } from '../../core/gestures.js';
import { noteHz, noteName } from '../../core/scales.js';
import { MAX_FUND_HZ } from '../../core/sound.js';
import { loadEarth } from '../../core/data.js';
import { formatLatLon, regionTint } from '../../core/geo.js';
import { volumeSlider, soundHint } from '../../core/ui.js';

export default function start(ctx) {
  const { input, sound, panel, describe, viewer } = ctx;
  let alive = true, setup = null;
  (async () => {
    const [mj, ij] = await Promise.all([loadEarth('musical-centers'), loadEarth('instruments')]);
    if (alive) setup = run(mj.centers, ij.instruments);
  })().catch((e) => {
    console.error(e);
    const msg = `Timbre atlas could not load its data: ${e.message}`;
    panel.text(msg); describe(msg);
  });

  function run(centers, instruments) {
    const BLEND_KM = 900;
    const s = { volume: 0.7, phrase: true, baseSemis: -12 };   // C3
    const colorOf = new Map(centers.map((c, i) => [c.id, `hsl(${Math.round((i * 360) / centers.length)} 70% 55%)`]));
    // West to east, for the [ and ] keys.
    const order = [...centers].sort((a, b) => a.lon - b.lon || b.lat - a.lat);

    volumeSlider(panel, sound, s.volume, (v) => { s.volume = v; });
    panel.checkbox('Play a short tune', s.phrase, (v) => { s.phrase = v; }, { hint: 'Off: one note.' });
    panel.slider('Base pitch', { min: -19, max: 0, step: 1, value: s.baseSemis, format: (v) => noteName(v),
      hint: 'Starting note of each tune, F2 to C4. Tunes stay between C2 and C5.' }, (v) => { s.baseSemis = v; });
    const info = panel.text('Move over the map to hear a region.');
    info.setAttribute('aria-hidden', 'true');   // the same text is announced via describe
    panel.text('Keys on the map: arrows move, [ and ] jump to the previous or next instrument region.');
    panel.text('Voices are hand-synthesized impressions "inspired by" each instrument, not recordings.');

    let lastKey = null, lastAt = 0, lastLen = 0, keyboard = false;
    function probe({ lat, lon }, force = false) {
      const { primary, secondary, weight, voice } = voiceAt(lat, lon, centers, instruments, BLEND_KM);
      const key = primary.id, now = performance.now();
      const changed = key !== lastKey;
      const inst = instruments[primary.instrument];
      const blend = secondary && secondary.instrument !== primary.instrument && weight < 0.85
        ? `, blending with ${instruments[secondary.instrument].label}` : '';
      const text = `${primary.label}: ${inst.label}, inspired by ${inst.inspiredBy}${blend}. ${inst.family || ''}`.trim();
      // Keyboard moves always say where you are, even when the sound is throttled.
      if (keyboard && !force) describe(`${formatLatLon(lat, lon)}. ${text}`);
      if (!force && (changed ? now - lastAt < 120 : now - lastAt < Math.max(400, lastLen * 1000))) return;
      lastKey = key; lastAt = now;
      info.textContent = text;
      if (!keyboard || force) describe(force ? `${formatLatLon(lat, lon)}. ${text}` : text);
      const notes = gestureNotes(voice, noteHz(s.baseSemis), { phrase: s.phrase, floorHz: noteHz(-24) });
      lastLen = gestureLength(notes);
      playNotes(sound, voice, notes, { amp: 0.4, pan: lon / 180 });
      viewer.redraw();
    }
    const offHover = input.onHover((p) => probe(p));
    const offClick = input.onClick((p) => probe(p, true));

    // Mark keyboard-driven moves (capture runs before the viewer's own key handler), and add [ / ] region jumps.
    const canvas = viewer.canvas;
    const onKey = (e) => {
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        const { lat, lon } = input.position();
        const cur = voiceAt(lat, lon, centers, instruments, BLEND_KM).primary;
        const i = order.indexOf(cur), n = order.length;
        const c = order[(i + (e.key === ']' ? 1 : -1) + n) % n];
        keyboard = true; lastKey = null; lastAt = 0;
        input.moveTo(c.lat, c.lon);
        keyboard = false;
        return;
      }
      if (e.key.startsWith('Arrow') || e.key === 'Home') { keyboard = true; queueMicrotask(() => { keyboard = false; }); }
    };
    canvas.addEventListener('keydown', onKey, true);

    // Region tint (fading over the blend zones you hear) + instrument labels on dark backing boxes.
    const tint = regionTint(centers, colorOf, BLEND_KM);
    const removeOverlay = viewer.addOverlay((g, v) => {
      const W = v.canvas.width, H = v.canvas.height;
      g.save();
      g.globalAlpha = 0.22; g.imageSmoothingEnabled = false; g.drawImage(tint, 0, 0, W, H); g.globalAlpha = 1;
      g.font = '600 13px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      // Greedy layout: a label that would overlap one already placed moves down (then up) until it is clear.
      const placed = [];
      const hit = (a) => placed.some((b) => a.bx < b.bx + b.w + 2 && b.bx < a.bx + a.w + 2 && a.by < b.by + b.h + 2 && b.by < a.by + a.h + 2);
      for (const c of centers) {
        const [x, y0] = v.toPixel(c.lat, c.lon), text = instruments[c.instrument].label;
        const w = g.measureText(text).width + 22, h = 18, box = { c, text, w, h, bx: x - w / 2, by: y0 - h / 2 };
        for (let k = 1; hit(box) && k < 12; k++) box.by = y0 - h / 2 + Math.ceil(k / 2) * (h + 3) * (k % 2 ? 1 : -1);
        placed.push(box);
      }
      // The highlighted label is drawn last, so it is always on top.
      placed.sort((a, b) => (a.c.id === lastKey) - (b.c.id === lastKey));
      for (const { c, text, w, h, bx, by } of placed) {
        const y = by + h / 2, on = c.id === lastKey;
        g.fillStyle = on ? 'rgba(0,0,0,.92)' : 'rgba(0,0,0,.7)';
        g.beginPath(); g.roundRect ? g.roundRect(bx, by, w, h, 5) : g.rect(bx, by, w, h); g.fill();
        if (on) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
        g.fillStyle = colorOf.get(c.id); g.beginPath(); g.arc(bx + 9, y, 4, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.fillText(text, bx + 16, y + 0.5);
      }
      g.restore();
    });
    viewer.redraw();
    soundHint(panel, sound, 'move over the map.');
    describe(`Timbre atlas: ${centers.length} regions. Move the mouse, touch, or use the arrow keys on the map to hear each region's instrument. Square brackets jump between regions.`);
    return () => { offHover(); offClick(); removeOverlay(); canvas.removeEventListener('keydown', onKey, true); };
  }
  return () => { alive = false; setup?.(); };
}
