// Timbre atlas: hover (or arrow keys / touch) over the world map to hear that region's instrument play a short
// idiomatic gesture. Voices blend near borders, as in world-orchestra. No data values are used.
import { voiceAt, distKm, gestureNotes, gestureLength } from './atlas.js';
import { playNotes } from '../../core/gestures.js';
import { noteHz, noteName } from '../../core/scales.js';
import { loadEarth } from '../../core/data.js';
import { soundHint } from '../../core/ui.js';

export default function start(ctx) {
  const { input, sound, panel, describe, viewer } = ctx;
  let alive = true, setup = null;
  (async () => {
    const [mj, ij] = await Promise.all([loadEarth('musical-centers'), loadEarth('instruments')]);
    if (alive) setup = run(mj.centers, ij.instruments);
  })().catch((e) => { console.error(e); describe(`Timbre atlas could not load its data: ${e.message}`); });

  function run(centers, instruments) {
    const BLEND_KM = 900;
    const s = { volume: 0.7, phrase: true, baseSemis: -12 };   // C3
    const colorOf = new Map(centers.map((c, i) => [c.id, `hsl(${Math.round((i * 360) / centers.length)} 70% 55%)`]));

    panel.slider('Volume', { min: 0, max: 1, step: 0.05, value: s.volume, format: (v) => `${Math.round(v * 100)} percent` },
      (v) => { s.volume = v; sound.setVolume?.(v); });
    sound.setVolume?.(s.volume);
    panel.checkbox('Play a phrase (off: single note)', s.phrase, (v) => { s.phrase = v; });
    panel.slider('Base pitch', { min: -19, max: 0, step: 1, value: s.baseSemis, format: (v) => noteName(v),
      hint: 'Tonic of each phrase, F2 to C4. Phrases never go above C5.' }, (v) => { s.baseSemis = v; });
    const info = panel.text('Move over the map to hear a region.');
    info.setAttribute('aria-hidden', 'true');   // the same text is announced via describe
    panel.text('Voices are hand-synthesized impressions "inspired by" each instrument, not recordings.');

    let lastKey = null, lastAt = 0, lastLen = 0;
    function probe({ lat, lon }, force = false) {
      const { primary, secondary, weight, voice } = voiceAt(lat, lon, centers, instruments, BLEND_KM);
      const key = primary.id, now = performance.now();
      const changed = key !== lastKey;
      if (!force && (changed ? now - lastAt < 120 : now - lastAt < Math.max(400, lastLen * 1000))) return;
      lastKey = key; lastAt = now;
      const inst = instruments[primary.instrument];
      const blend = secondary && secondary.instrument !== primary.instrument && weight < 0.85
        ? `, blending with ${instruments[secondary.instrument].label}` : '';
      const text = `${primary.label}: ${inst.label}, inspired by ${inst.inspiredBy}${blend}. ${inst.family || ''}`.trim();
      info.textContent = text;
      describe(text);
      const notes = gestureNotes(voice, noteHz(s.baseSemis), { phrase: s.phrase });
      lastLen = gestureLength(notes);
      playNotes(sound, voice, notes, { amp: 0.4, pan: lon / 180 });
    }
    const offHover = input.onHover((p) => probe(p));
    const offClick = input.onClick((p) => probe(p, true));

    // Region tint + instrument labels.
    const tint = document.createElement('canvas');
    tint.width = 360; tint.height = 180;
    {
      const g = tint.getContext('2d');
      for (let y = 0; y < 180; y += 2) for (let x = 0; x < 360; x += 2) {
        const lat = 89 - y, lon = x - 180;
        let bi = 0, bd = Infinity;
        centers.forEach((c, i) => { const d = distKm(lat, lon, c.lat, c.lon); if (d < bd) { bd = d; bi = i; } });
        g.fillStyle = colorOf.get(centers[bi].id); g.fillRect(x, y, 2, 2);
      }
    }
    const removeOverlay = viewer.addOverlay((g, v) => {
      const W = v.canvas.width, H = v.canvas.height;
      g.save();
      g.globalAlpha = 0.22; g.imageSmoothingEnabled = false; g.drawImage(tint, 0, 0, W, H); g.globalAlpha = 1;
      g.font = '12px system-ui, sans-serif'; g.textAlign = 'center';
      for (const c of centers) {
        const [x, y] = v.toPixel(c.lat, c.lon), text = instruments[c.instrument].label;
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(text, x, y);
        g.fillStyle = c.id === lastKey ? '#fff' : colorOf.get(c.id); g.fillText(text, x, y);
      }
      g.restore();
    });
    viewer.redraw();
    soundHint(panel, sound, 'move over the map.');
    describe(`Timbre atlas: ${centers.length} regions. Move the mouse, touch, or use the arrow keys on the map to hear each region's instrument.`);
    return () => { offHover(); offClick(); removeOverlay(); };
  }
  return () => { alive = false; setup?.(); };
}
