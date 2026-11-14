// World orchestra: ~280 cities are listening points. When a city's value rises past the threshold
// between two hours, it plays one note in the voice of its nearest "musical center" (blended near
// borders). Pitch <- value (quantized to a scale, low-to-mid register), loudness <- value, pan <- longitude.
import { distKm, voiceAt, shapeForPitch, selectTriggers, percentileOf } from './orchestra.js';
import { formatValue as fmtNum } from '../../core/grid.js';
import { SCALES, quantize, noteHz, noteName } from '../../core/scales.js';

const getJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url}`);
  return r.json();
};

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe, viewer } = ctx;
  let alive = true;
  const cleanups = [];
  let setup = null;
  (async () => {
    const [cj, mj, ij] = await Promise.all([
      getJson('/data/earth/cities.json'), getJson('/data/earth/musical-centers.json'), getJson('/data/earth/instruments.json'),
    ]);
    if (!alive) return;
    setup = run(cj, mj.centers, ij.instruments);
  })().catch((e) => { console.error(e); describe(`World orchestra could not load its city data: ${e.message}`); });

  function run(cj, centers, instruments) {
    const [lo, hi] = dataset.range;
    const units = dataset.units;
    // 0..1 over the range (log space for log datasets); value formatting like "0.013 ppbv".
    const norm = dataset.norm || ((v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1))));
    const denorm = dataset.denorm || ((x) => lo + x * (hi - lo));
    const fmtV = (v) => (dataset.format ? dataset.format(v) : `${Math.round(v * 10) / 10} ${units}`);
    const f = cj.fields;
    const cities = cj.cities.map((r) => Object.fromEntries(f.map((k, i) => [k, r[i]])));
    const BLEND_KM = 900;
    const cityVoice = cities.map((c) => voiceAt(c.lat, c.lon, centers, instruments, BLEND_KM));
    const colorOf = new Map(centers.map((c, i) => [c.id, `hsl(${Math.round((i * 360) / centers.length)} 70% 55%)`]));
    const instLabel = (id) => instruments[id]?.label || id;

    // ---- state
    const s = {
      speed: 6, scale: 'pentatonic-major', maxNotes: 6, cooldown: 6, volume: 0.7, legend: false,
      lowSemis: -17, highSemis: 7,            // G2 .. G4 (about 98-392 Hz), centered near C3-C4
      threshold: null,
    };
    let prev = null, prevT = null;
    const lastPlayed = new Array(cities.length).fill(null);
    const flashes = new Map();            // city index -> { t0, color }
    let summary = { regions: new Map(), notes: 0, frames: 0 };

    const valuesAt = (t) => cities.map((c) => dataset.valueAt(c.lat, c.lon, t));
    s.threshold = dataset.percentile?.(0.7) ?? percentileOf(valuesAt(time.now()), 0.7) ?? lo + 0.7 * (hi - lo);
    s.threshold = Number(fmtNum(s.threshold));

    // ---- controls
    const playBtn = panel.button(time.playing ? 'Pause orchestra' : 'Play orchestra', () => {
      if (time.playing) { time.pause(); describe(`Orchestra paused at ${time.label()}`); }
      else { applySpeed(); time.play(); describe('Orchestra playing'); }
    }, { hint: 'Plays the hours in order. Cities whose value rises past the threshold play one note.' });
    const offState = time.onPlayState?.((p) => {
      playBtn.textContent = p ? 'Pause orchestra' : 'Play orchestra';
    });
    const applySpeed = () => time.setSpeed(Math.min(30, s.speed / (dataset.stepHours || 1)));
    panel.slider('Speed', { min: 1, max: 48, step: 1, value: s.speed, format: (v) => `${v} hours per second` },
      (v) => { s.speed = v; applySpeed(); });
    panel.select('Scale', Object.entries(SCALES).map(([k, v]) => [k, v.label]), (v) => { s.scale = v; },
      { value: s.scale, hint: 'Slendro and pelog are Javanese gamelan tunings (not 12-tone).' });
    // Slider runs over norm 0..1 so log datasets get usable steps.
    panel.slider('Threshold', { min: 0, max: 1, step: 0.01, value: norm(s.threshold),
      hint: 'A city plays when its value rises past this. Default: the dataset\'s 70th percentile.',
      format: (x) => fmtV(Number(fmtNum(denorm(x)))) }, (x) => { s.threshold = Number(fmtNum(denorm(x))); });
    panel.slider('Max notes per hour', { min: 1, max: 24, step: 1, value: s.maxNotes, format: (v) => `${v} notes` },
      (v) => { s.maxNotes = v; });
    panel.slider('City cooldown', { min: 0, max: 48, step: 1, value: s.cooldown,
      hint: 'Frames a city waits before it may play again.', format: (v) => `${v} frames` }, (v) => { s.cooldown = v; });
    const low = panel.slider('Lowest note', { min: -24, max: 0, step: 1, value: s.lowSemis, format: (v) => noteName(v) },
      (v) => { s.lowSemis = Math.min(v, s.highSemis - 7); low.update(s.lowSemis); });
    const high = panel.slider('Highest note', { min: -12, max: 12, step: 1, value: s.highSemis, format: (v) => noteName(v),
      hint: 'Pitch range for notes, C2 to C5. Default G2 to G4.' },
      (v) => { s.highSemis = Math.max(v, s.lowSemis + 7); high.update(s.highSemis); });
    panel.slider('Volume', { min: 0, max: 1, step: 0.05, value: s.volume, format: (v) => `${Math.round(v * 100)} percent` },
      (v) => { s.volume = v; sound.setVolume?.(v); });
    sound.setVolume?.(s.volume);
    let legendList = null;
    const legendBox = panel.checkbox('Show center legend', s.legend, (v) => { s.legend = v; renderLegend(); viewer.redraw(); });
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
    panel.text('Voices are hand-synthesized impressions "inspired by" each instrument, not recordings.');

    // ---- notes
    function playCity(i, value, k, n, frameDur) {
      const { voice } = cityVoice[i];
      const lowHz = noteHz(s.lowSemis), highHz = noteHz(s.highSemis);
      let freq = quantize(norm(value), [0, 1], s.scale, lowHz, highHz).freq * 2 ** (voice.octave || 0);
      freq = Math.max(noteHz(-24), Math.min(noteHz(12), freq));
      const shaped = shapeForPitch(voice, freq);
      sound.play({
        freq, amp: (0.15 + 0.45 * norm(value)) / Math.sqrt(Math.max(1, n)), pan: cities[i].lon / 180,
        dur: Math.min(shaped.dur ?? 0.4, Math.max(0.15, frameDur * 1.5)), t: (k * frameDur * 0.8) / Math.max(1, n),
        harmonics: shaped.harmonics, partials: shaped.partials, envelope: shaped.envelope, noise: shaped.noise,
      });
    }

    const offFrame = time.onFrame((t) => {
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
      if (!time.playing) return;
      const regions = [...summary.regions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((r) => r[0]);
      const hours = Math.round(summary.frames * (dataset.stepHours || 1));
      const span = hours <= 1 ? 'this hour' : `in the last ${hours} hours`;
      describe(summary.notes
        ? `${time.label()}. Playing: ${regions.join(', ')}; ${summary.notes} notes ${span}.`
        : `${time.label()}. Quiet: no city crossed ${fmtV(s.threshold)} ${span}.`);
      summary = { regions: new Map(), notes: 0, frames: 0 };
    }, 5000);

    // ---- hover probe
    let lastHover = 0;
    const fmt = (lat, lon) => `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? 'E' : 'W'}`;
    function probe({ lat, lon }, force = false) {
      const now = performance.now();
      if (!force && now - lastHover < 150) return;
      lastHover = now;
      let best = null, bestKm = Infinity;
      cities.forEach((c) => { const d = distKm(lat, lon, c.lat, c.lon); if (d < bestKm) { bestKm = d; best = c; } });
      const place = bestKm < 1200 ? `${best.name} region` : `Near ${fmt(lat, lon)}`;
      const { primary, secondary, voice } = voiceAt(lat, lon, centers, instruments, BLEND_KM);
      const inst = instLabel(primary.instrument);
      const blend = secondary && secondary.instrument !== primary.instrument ? ` blending with ${instLabel(secondary.instrument)}` : '';
      const v = dataset.valueAt(lat, lon, time.now());
      if (v == null) { describe(`${place}: ${inst}-inspired${blend}, no data`); return; }
      let freq = quantize(norm(v), [0, 1], s.scale, noteHz(s.lowSemis), noteHz(s.highSemis)).freq * 2 ** (voice.octave || 0);
      freq = Math.max(noteHz(-24), Math.min(noteHz(12), freq));
      const shaped = shapeForPitch(voice, freq);
      sound.play({ freq, amp: 0.35, pan: lon / 180, dur: shaped.dur ?? 0.4,
        harmonics: shaped.harmonics, partials: shaped.partials, envelope: shaped.envelope, noise: shaped.noise });
      describe(`${place}: ${inst}-inspired${blend}, ${fmtV(v)}`);
    }
    const offHover = input.onHover((p) => probe(p));
    const offClick = input.onClick((p) => probe(p, true));

    // ---- visuals: faint region tint (Voronoi of centers), city dots, flashes, optional labels
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
    let raf = 0;
    function animate() {
      if (raf) return;
      const tick = () => { raf = 0; viewer.redraw(); if (flashes.size && alive) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    }

    prev = valuesAt(time.now()); prevT = time.now();
    if (!sound.started) panel.text('Press "Start sound" to hear the orchestra. Without sound, activity is still announced.');
    describe(`World orchestra ready: ${cities.length} cities, ${centers.length} musical centers. Threshold ${fmtV(s.threshold)}. Press Play orchestra, or explore the map with the arrow keys.`);

    return () => {
      offFrame(); offHover(); offClick(); offState?.(); clearInterval(sumTimer); removeOverlay();
      cancelAnimationFrame(raf); legendList?.remove();
    };
  }

  return () => { alive = false; setup?.(); cleanups.forEach((f) => f()); };
}
