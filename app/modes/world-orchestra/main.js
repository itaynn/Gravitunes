// World orchestra: ~280 cities are listening points. When a city's value rises past the threshold
// between two hours, it plays one note in the voice of its nearest "musical center" (blended near
// borders). Pitch <- value (quantized to a scale, low-to-mid register), loudness <- value, pan <- longitude.
// "Instruments" view (on by default; ?instruments=0 starts in the data view): no dataset, a plain map, and
// hovering or the arrow keys play each region's own phrase (the former Timbre atlas). Both views share the
// regions, voices and recorded samples (sound-engine/library/samples).
import { distKm, voiceAt, selectTriggers, percentileOf } from './orchestra.js';
import { formatValue as fmtNum } from '../../core/grid.js';
import { quantize, noteHz, noteName, LOW_SEMIS, HIGH_SEMIS } from '../../core/scales.js';
import { scaleControl } from '../../core/scale-control.js';

import { loadEarth, valueHelpers } from '../../core/data.js';
import { formatLatLon as fmt, regionTint } from '../../core/geo.js';
import { volumeSlider, soundHint, fold, throttle } from '../../core/ui.js';
import { voiceNote as shapeNote } from '../../core/voices.js';
import { gestureNotes, gestureLength, playNotes } from '../../core/gestures.js';

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe, viewer } = ctx;
  let alive = true;
  let setup = null;
  (async () => {
    const [cj, mj, ij] = await Promise.all([
      loadEarth('cities'), loadEarth('musical-centers'), loadEarth('instruments'),
    ]);
    if (!alive) return;
    setup = run(cj, mj.centers, ij.instruments);
  })().catch((e) => {
    console.error(e);
    const msg = `World orchestra could not load its city data: ${e.message}`;
    panel.text(msg); describe(msg);
  });

  function run(cj, centers, instruments) {
    const [lo, hi] = dataset.range;
    const units = dataset.units;
    // 0..1 over the range (log space for log datasets); value formatting like "0.013 ppbv".
    const { norm, denorm, fmtV } = valueHelpers(dataset);
    const f = cj.fields;
    const cities = cj.cities.map((r) => Object.fromEntries(f.map((k, i) => [k, r[i]])));
    const BLEND_KM = 900;
    const cityVoice = cities.map((c) => voiceAt(c.lat, c.lon, centers, instruments, BLEND_KM));
    const colorOf = new Map(centers.map((c, i) => [c.id, `hsl(${Math.round((i * 360) / centers.length)} 70% 55%)`]));
    const instLabel = (id) => instruments[id]?.label || id;
    // Recorded samples for every region's instrument; the rest (or all, on the built-in synth) are synthesized.
    const sampleIds = [...new Set(Object.values(instruments).map((v) => v.sample).filter(Boolean))];
    sound.loadSamples?.(sampleIds).then(({ loaded, fallback }) => {
      const synth = Object.entries(instruments).filter(([, v]) => !v.sample || fallback.includes(v.sample)).map(([k]) => k);
      console.info(`[world-orchestra] samples loaded: ${loaded.join(', ') || 'none'}; synthesized: ${synth.join(', ') || 'none'}`);
    });

    // ---- state
    const s = {
      speed: 6, scale: 'pentatonic-major', maxNotes: 6, cooldown: 6, volume: 0.7, legend: false,
      lowSemis: -12, highSemis: 12,           // C3 .. C5, inside the global C2..A5
      threshold: null, atlas: new URLSearchParams(location.search).get('instruments') !== '0', phrase: true, baseSemis: -12,
    };
    let prev = null, prevT = null;
    const lastPlayed = new Array(cities.length).fill(null);
    const flashes = new Map();            // city index -> { t0, color }
    let summary = { regions: new Map(), notes: 0, frames: 0 };

    const valuesAt = (t) => cities.map((c) => dataset.valueAt(c.lat, c.lon, t));
    s.threshold = dataset.percentile?.(0.7) ?? percentileOf(valuesAt(time.now()), 0.7) ?? lo + 0.7 * (hi - lo);
    s.threshold = Number(fmtNum(s.threshold));

    // ---- controls
    const viewBox = panel.checkbox('Instruments', s.atlas, (v) => {
      setView(v);
      describe(v ? 'Instruments: move over the map to hear each region. Square brackets jump between regions.'
        : `Data: ${dataset.title}. Press Play orchestra; click or use the arrow keys to hear a spot.`);
    }, { hint: 'On: the map and its instruments. Off: the cities play the data.' });
    const firstControl = viewBox.closest('.control');
    const phraseBox = panel.checkbox('Tune', s.phrase, (v) => { s.phrase = v; }, { hint: 'Off: one note per region.' });
    const baseSl = panel.slider('Pitch', { min: LOW_SEMIS + 5, max: 0, step: 1, value: s.baseSemis, format: (v) => noteName(v),
      hint: 'Starting note of each tune.' }, (v) => { s.baseSemis = v; });
    const atlasBox = [phraseBox, baseSl].map((c) => c.closest('.control'));
    const playBtn = panel.button(time.playing ? 'Pause orchestra' : 'Play orchestra', () => {
      if (time.playing) { time.pause(); describe(`Orchestra paused at ${time.label()}`); }
      else { applySpeed(); time.play(); describe('Orchestra playing'); }
    }, { hint: 'Plays the hours in order. Cities whose value rises past the threshold play one note.' });
    const offState = time.onPlayState?.((p) => {
      if (p) applySpeed();   // the host's own Play button respects Speed too
      playBtn.textContent = p ? 'Pause orchestra' : 'Play orchestra';
    });
    const applySpeed = () => time.setSpeed(Math.min(30, s.speed / (dataset.stepHours || 1)));
    panel.slider('Speed', { min: 1, max: 48, step: 1, value: s.speed, format: (v) => `${v} hours per second` },
      (v) => { s.speed = v; applySpeed(); });
    applySpeed();
    scaleControl(panel, { value: s.scale, describe, sound, onChange: (v) => { s.scale = v; } });
    // Slider runs over norm 0..1 so log datasets get usable steps.
    panel.slider('Threshold', { min: 0, max: 1, step: 0.01, value: norm(s.threshold),
      hint: 'A city plays when its value rises past this. Default: the dataset\'s 70th percentile.',
      format: (x) => fmtV(Number(fmtNum(denorm(x)))) }, (x) => { s.threshold = Number(fmtNum(denorm(x))); });
    volumeSlider(panel, sound, s.volume, (v) => { s.volume = v; });
    const maxN = panel.slider('Max notes per hour', { min: 1, max: 24, step: 1, value: s.maxNotes, format: (v) => `${v} notes` },
      (v) => { s.maxNotes = v; });
    const stepH = dataset.stepHours || 1;
    const cool = panel.slider('City cooldown', { min: 0, max: 48, step: 1, value: s.cooldown,
      hint: 'Hours before a city can play again.', format: (v) => `${Math.round(v * stepH)} hours` }, (v) => { s.cooldown = v; });
    const low =panel.slider('Lowest note', { min: LOW_SEMIS, max: HIGH_SEMIS - 7, step: 1, value: s.lowSemis, format: (v) => noteName(v) },
      (v) => { s.lowSemis = Math.min(v, s.highSemis - 7); low.update(s.lowSemis); });
    const high = panel.slider('Highest note', { min: LOW_SEMIS + 7, max: HIGH_SEMIS, step: 1, value: s.highSemis, format: (v) => noteName(v),
      hint: 'Pitch range for notes, C2 to A5. Default C3 to C5.' },
      (v) => { s.highSemis = Math.max(v, s.lowSemis + 7); high.update(s.highSemis); });
    let legendList = null;
    const legendBox = panel.checkbox('Show center legend', s.legend, (v) => { s.legend = v; renderLegend(); viewer.redraw(); });
    fold('More sound settings', [maxN, cool, low, high, legendBox]);
    function renderLegend() {
      legendList?.remove(); legendList = null;
      if (!s.legend) return;
      legendList = document.createElement('ul');
      legendList.setAttribute('aria-label', 'Musical centers');
      for (const c of centers) {
        const li = document.createElement('li');
        const sw = document.createElement('span');
        sw.style.cssText = `display:inline-block;width:.8em;height:.8em;margin-right:.4em;background:${colorOf.get(c.id)}`;
        sw.setAttribute('aria-hidden', 'true');
        const inst = instruments[c.instrument];
        li.append(sw, `${c.label}: ${inst.label}-inspired (${inst.inspiredBy})`);
        legendList.append(li);
      }
      legendBox.closest('.control').after(legendList);
    }
    const about = panel.text('Recorded instruments (open licences) where available, else synthesized impressions.');
    // Everything except the toggle, the Instruments controls and this note belongs to the data view.
    const dataBox = [];
    for (let el = firstControl.parentElement?.firstElementChild; el; el = el.nextElementSibling)
      if (el !== firstControl && !atlasBox.includes(el) && el !== about) dataBox.push(el);

    // ---- notes
    // value -> scale note in the chosen range, shifted by the voice's octave, clamped to C2..C5, shaped for pitch.
    const voiceNote = (voice, value) =>
      shapeNote(voice, quantize(norm(value), [0, 1], s.scale, noteHz(s.lowSemis), noteHz(s.highSemis)).freq);
    // One note in a (possibly blended) voice: its recorded samples when loaded, else its synthesized timbre.
    const playOne = (voice, note, { amp, pan, dur, t = 0 }) =>
      playNotes(sound, voice, [{ freq: note.freq, t, dur, vibrato: note.vibrato }], { amp, pan });
    function playCity(i, value, k, n, frameDur) {
      const voice = cityVoice[i].voice, { note, dur } = voiceNote(voice, value);
      playOne(voice, note, { amp: (0.15 + 0.45 * norm(value)) / Math.sqrt(Math.max(1, n)), pan: cities[i].lon / 180,
        dur: Math.min(dur, Math.max(0.15, frameDur * 1.5)), t: (k * frameDur * 0.8) / Math.max(1, n) });
    }

    const offFrame = time.onFrame((t) => {
      if (s.atlas) return;
      const cur = valuesAt(t);
      if (prev && prevT === t - 1) {
        const hits = selectTriggers({ prev, cur, threshold: s.threshold, frame: t, lastPlayed,
          cooldown: s.cooldown, maxNotes: s.maxNotes });
        const frameDur = 1 / Math.max(0.1, time.fps || 2);
        hits.forEach((i, k) => {
          lastPlayed[i] = t;
          playCity(i, cur[i], k, hits.length, frameDur);
          const center = cityVoice[i].primary;
          flashes.set(i, { t0: performance.now() + (k * frameDur * 800) / Math.max(1, hits.length), color: colorOf.get(center.id) });
          summary.regions.set(center.region, (summary.regions.get(center.region) || 0) + 1);
        });
        summary.notes += hits.length; summary.frames++;
        if (hits.length) animate();
      }
      prev = cur; prevT = t;
      if (!time.playing) {
        const n = cur.filter((v) => v != null && v >= s.threshold).length;
        describe(`${time.label()}: ${n} of ${cities.length} cities above ${fmtV(s.threshold)}`);
      }
    });

    // Periodic summary for screen readers while playing.
    const sumTimer = setInterval(() => {
      if (!time.playing || s.atlas) return;
      const regions = [...summary.regions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((r) => r[0]);
      const hours = Math.round(summary.frames * (dataset.stepHours || 1));
      const span = hours <= 1 ? 'this hour' : `in the last ${hours} hours`;
      describe(summary.notes
        ? `${time.label()}. Playing: ${regions.join(', ')}; ${summary.notes} notes ${span}.`
        : `${time.label()}. Quiet: no city crossed ${fmtV(s.threshold)} ${span}.`);
      summary = { regions: new Map(), notes: 0, frames: 0 };
    }, 5000);

    // ---- hover probe
    const ready = throttle(150);
    function probe(p, force = false) {
      if (s.atlas) return atlasProbe(p, force);
      const { lat, lon } = p;
      // Data view: the mouse only announces; a click, tap or arrow key also plays the note.
      const play = force || p.keyboard;
      if (!ready(force, () => probe(p, force))) return;
      let best = null, bestKm = Infinity;
      cities.forEach((c) => { const d = distKm(lat, lon, c.lat, c.lon); if (d < bestKm) { bestKm = d; best = c; } });
      const place = bestKm < 1200 ? `${best.name} region` : `Near ${fmt(lat, lon)}`;
      const { primary, secondary, voice } = voiceAt(lat, lon, centers, instruments, BLEND_KM);
      const inst = instLabel(primary.instrument);
      const blend = secondary && secondary.instrument !== primary.instrument ? ` blending with ${instLabel(secondary.instrument)}` : '';
      const v = dataset.valueAt(lat, lon, time.now());
      if (v == null) { describe(`${place}: ${inst}-inspired${blend}, no data`); return; }
      const { note, dur } = voiceNote(voice, v);
      // While playing, keep the probe note at a chord voice's level so the sum cannot clip.
      if (play) playOne(voice, note, { amp: time.playing ? 0.35 / Math.sqrt(Math.max(1, s.maxNotes)) : 0.35, pan: lon / 180, dur });
      describe(`${place}: ${inst}-inspired${blend}, ${fmtV(v)}`);
    }

    // Instruments view: each region plays its own short phrase. Arrow moves always announce, even when throttled.
    let lastKey = null, lastAt = 0, lastLen = 0, jumping = false;
    function atlasProbe({ lat, lon, keyboard: fromKey = false }, force = false) {
      const keyboard = fromKey || jumping;
      const { primary, secondary, weight, voice } = voiceAt(lat, lon, centers, instruments, BLEND_KM);
      const key = primary.id, now = performance.now(), changed = key !== lastKey;
      const inst = instruments[primary.instrument];
      const mix = secondary && secondary.instrument !== primary.instrument && weight < 0.85
        ? `, blending with ${instruments[secondary.instrument].label}` : '';
      const text = `${primary.label}: ${inst.label}, ${inst.inspiredBy}${mix}.`;
      if (keyboard && !force) describe(`${fmt(lat, lon)}. ${text}`);
      if (!force && (changed ? now - lastAt < 120 : now - lastAt < Math.max(400, lastLen * 1000))) return;
      lastKey = key; lastAt = now;
      if (!keyboard || force) describe(force ? `${fmt(lat, lon)}. ${text}` : text);
      const notes = gestureNotes(voice, noteHz(s.baseSemis), { phrase: s.phrase, floorHz: noteHz(LOW_SEMIS) });
      lastLen = gestureLength(notes);
      playNotes(sound, voice, notes, { amp: 0.4, pan: lon / 180 });
      viewer.redraw();
    }
    // [ and ] jump west/east between regions (Instruments view).
    const order = [...centers].sort((a, b) => a.lon - b.lon || b.lat - a.lat);
    const onKey = (e) => {
      if (!s.atlas || (e.key !== '[' && e.key !== ']')) return;
      e.preventDefault();
      const { lat, lon } = input.position();
      const cur = voiceAt(lat, lon, centers, instruments, BLEND_KM).primary;
      const i = order.indexOf(cur), n = order.length;
      const c = order[(i + (e.key === ']' ? 1 : -1) + n) % n];
      jumping = true; lastKey = null; lastAt = 0;
      try { input.moveTo(c.lat, c.lon); } finally { jumping = false; }
    };
    viewer.canvas.addEventListener('keydown', onKey, true);
    const offHover = input.onHover((p) => probe(p));
    const offClick = input.onClick((p) => probe(p, true));

    // ---- visuals: faint region tint (Voronoi of centers), city dots, flashes, optional labels
    const tint = regionTint(centers, colorOf), atlasTint = regionTint(centers, colorOf, BLEND_KM);
    const removeOverlay = viewer.addOverlay((g, v) => {
      if (s.atlas) return drawAtlas(g, v);
      const W = v.canvas.width, H = v.canvas.height, now = performance.now();
      g.save();
      g.globalAlpha = 0.13; g.imageSmoothingEnabled = false; g.drawImage(tint, 0, 0, W, H);
      g.globalAlpha = 1;
      cities.forEach((c, i) => {
        const [x, y] = v.toPixel(c.lat, c.lon);
        const fl = flashes.get(i);
        const age = fl ? (now - fl.t0) / 900 : 2;
        if (age >= 0 && age < 1) {
          g.fillStyle = fl.color; g.globalAlpha = 1 - age;
          g.beginPath(); g.arc(x, y, 3 + 12 * age, 0, 7); g.fill(); g.globalAlpha = 1;
        } else if (fl && age >= 1) flashes.delete(i);
        g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); g.stroke();
      });
      if (s.legend) {
        g.font = '12px system-ui, sans-serif'; g.textAlign = 'center';
        for (const c of centers) {
          const [x, y] = v.toPixel(c.lat, c.lon);
          const text = `${instruments[c.instrument].label}`;
          g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(text, x, y - 6);
          g.fillStyle = colorOf.get(c.id); g.fillText(text, x, y - 6);
        }
      }
      g.restore();
    });
    // Instruments view: region tint fading over the blend zones, instrument labels on dark boxes (no overlaps).
    function drawAtlas(g, v) {
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
      placed.sort((a, b) => (a.c.id === lastKey) - (b.c.id === lastKey));
      for (const { c, text, w, h, bx, by } of placed) {
        const y = by + h / 2, on = c.id === lastKey;
        g.fillStyle = on ? 'rgba(0,0,0,.92)' : 'rgba(0,0,0,.72)';
        g.beginPath(); g.roundRect ? g.roundRect(bx, by, w, h, 5) : g.rect(bx, by, w, h); g.fill();
        if (on) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
        g.fillStyle = colorOf.get(c.id); g.beginPath(); g.arc(bx + 8, y, 4, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.fillText(text, bx + 15, y + 0.5);
      }
      g.restore();
    }

    // ---- view toggle: Instruments (plain map, region phrases) or Data (cities play the dataset)
    const hostBits = ['#colorbar', '#dataset-title', '#dataset-picker', '#timeline', '#time-heading', '#time-label'].map((q) => document.querySelector(q)).filter(Boolean);
    function setView(on) {
      s.atlas = on;
      if (on) time.pause();
      viewer.setPlain(on);
      for (const el of hostBits) el.style.visibility = on ? 'hidden' : '';
      for (const el of dataBox) el.style.display = on ? 'none' : '';   // (.control.inline sets display, so not .hidden)
      for (const el of atlasBox) el.style.display = on ? '' : 'none';
      lastKey = null; viewer.redraw();
    }
    let raf = 0;
    function animate() {
      if (raf) return;
      const tick = () => { raf = 0; viewer.redraw(); if (flashes.size && alive) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    }

    prev = valuesAt(time.now()); prevT = time.now();
    soundHint(panel, sound, 'move over the map, or turn Instruments off and press Play orchestra.');
    setView(s.atlas);
    describe(s.atlas
      ? `World orchestra, Instruments: ${centers.length} regions. Move the mouse, touch, or use the arrow keys on the map to hear each region's instrument. Square brackets jump between regions. Turn Instruments off to hear the data.`
      : `World orchestra ready: ${cities.length} cities, ${centers.length} musical centers. Threshold ${fmtV(s.threshold)}. Press Play orchestra, or explore the map with the arrow keys.`);

    return () => {
      offFrame(); offHover(); offClick(); offState?.(); clearInterval(sumTimer); removeOverlay();
      viewer.canvas.removeEventListener('keydown', onKey, true); viewer.setPlain(false);
      cancelAnimationFrame(raf); legendList?.remove();
    };
  }

  return () => { alive = false; setup?.(); };
}
