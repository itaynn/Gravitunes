// Mapping lab: ~300 grid points listen to the data. When a point's value rises past the threshold between
// frames it plays one note; the listener chooses which source (longitude, latitude, value, change) drives each
// sound parameter (pitch, loudness, pan, brightness, depth, attack, timbre family). Mapping lives in the URL.
import { SOURCES, PARAMS, PRESETS, cloneMapping, presetOf, encodeMapping, decodeMapping,
  renderNote, describeNote, makePoints } from './mapping.js';
import { selectTriggers, percentileOf } from '../../core/triggers.js';
import { formatValue as fmtNum } from '../../core/grid.js';
import { noteName, LOW_SEMIS, HIGH_SEMIS } from '../../core/scales.js';
import { formatLatLon } from '../../core/geo.js';
import { scaleControl } from '../../core/scale-control.js';
import { loadEarth, valueHelpers } from '../../core/data.js';
import { volumeSlider, soundHint, fold, throttle } from '../../core/ui.js';

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe, viewer } = ctx;
  let alive = true, cleanup = null;
  loadEarth('instruments').then((ij) => { if (alive) cleanup = run(ij.instruments); })
    .catch((e) => { console.error(e); describe(`Mapping lab could not load its voices: ${e.message}`); });

  function run(instruments) {
    const [lo, hi] = dataset.range;
    const units = dataset.units;
    const { norm, denorm, fmtV } = valueHelpers(dataset);
    const points = makePoints();
    const url = new URLSearchParams(location.search);

    const s = {
      mapping: decodeMapping(url.get('map')) || cloneMapping(PRESETS.classic.mapping),
      scale: 'pentatonic-major',   // set by the shared Scale menu (?scale= or the remembered choice)
      speed: 6, maxNotes: 6, cooldown: 6, volume: 0.7,
      lowSemis: LOW_SEMIS, highSemis: HIGH_SEMIS,   // C2 .. A5
      threshold: null,
    };
    const valuesAt = (t) => points.map((p) => dataset.valueAt(p.lat, p.lon, t));
    s.threshold = dataset.percentile?.(0.7) ?? percentileOf(valuesAt(time.now()), 0.7) ?? lo + 0.7 * (hi - lo);
    s.threshold = Number(fmtNum(s.threshold));
    if (url.has('thr') && Number.isFinite(+url.get('thr'))) s.threshold = Math.max(lo, Math.min(hi, +url.get('thr')));

    function saveUrl() {
      const q = new URLSearchParams(location.search);
      q.set('map', encodeMapping(s.mapping) || 'none');
      q.set('scale', s.scale);
      history.replaceState(null, '', `${location.pathname}?${q}`);
    }

    // ---- controls (the host's Time Play button runs the timeline; this mode only sets its speed)
    const applySpeed = () => time.setSpeed(Math.min(30, s.speed / (dataset.stepHours || 1)));
    applySpeed();
    const offState = time.onPlayState?.((p) => { if (p) applySpeed(); });
    panel.slider('Speed', { min: 1, max: 48, step: 1, value: s.speed, format: (v) => `${v} hours per second`,
      hint: 'Press Play under Time. Points whose value rises past the threshold play one note, shaped by the mapping.' },
      (v) => { s.speed = v; applySpeed(); });

    const presetSel = panel.select('Preset', [['custom', 'Custom'], ...Object.entries(PRESETS).map(([k, p]) => [k, p.label])],
      (k) => {
        if (!PRESETS[k]) return;
        s.mapping = cloneMapping(PRESETS[k].mapping); syncMappingControls(); saveUrl();
        describe(`Preset ${PRESETS[k].label}: ${summary()}`);
      }, { value: presetOf(s.mapping) || 'custom', hint: 'Classic, Deep south, Storm rush, Around the world. The mapping is saved in the page address, so you can share it.' });

    const srcOptions = Object.entries(SOURCES);
    const mapControls = {};
    for (const [p, info] of Object.entries(PARAMS)) {
      const sel = panel.select(info.label, srcOptions, (v) => {
        s.mapping[p].src = v; mappingChanged(`${info.label}: ${SOURCES[v]}`);
      }, { value: s.mapping[p].src });
      const flip = panel.checkbox(`Flip ${info.label.split(' (')[0].toLowerCase()}`, !!s.mapping[p].flip, (v) => {
        s.mapping[p].flip = v;
        mappingChanged(`${info.label} ${v ? 'flipped: high source gives ' + info.lo : 'normal: high source gives ' + info.hi}`);
      }, { hint: 'High source gives a low setting.' });
      mapControls[p] = { sel, flip };
    }
    function syncMappingControls() {
      for (const p of Object.keys(PARAMS)) {
        mapControls[p].sel.value = s.mapping[p].src;
        mapControls[p].flip.checked = !!s.mapping[p].flip;
      }
      presetSel.value = presetOf(s.mapping) || 'custom';
    }
    function mappingChanged(msg) {
      presetSel.value = presetOf(s.mapping) || 'custom';
      saveUrl(); describe(msg);
    }
    const summary = () => {
      const on = Object.keys(PARAMS).filter((p) => s.mapping[p].src !== 'off');
      return on.length ? on.map((p) => `${s.mapping[p].src} to ${p}${s.mapping[p].flip ? ' flipped' : ''}`).join(', ') : 'nothing mapped';
    };

    scaleControl(panel, { value: s.scale, describe, sound, onChange: (v) => { s.scale = v; saveUrl(); },
      hint: 'Pitch is quantized to this scale, between the lowest and highest note.' });
    // Slider runs over norm 0..1 so log datasets get usable steps.
    panel.slider('Threshold', { min: 0, max: 1, step: 0.01, value: norm(s.threshold),
      hint: 'A point plays when its value rises past this. Default: the dataset\'s 70th percentile.',
      format: (x) => fmtV(Number(fmtNum(denorm(x)))) }, (x) => { s.threshold = Number(fmtNum(denorm(x))); });
    volumeSlider(panel, sound, s.volume, (v) => { s.volume = v; });
    const dens = panel.slider('Density (max notes per frame)', { min: 1, max: 24, step: 1, value: s.maxNotes, format: (v) => `${v} notes` },
      (v) => { s.maxNotes = v; });
    const stepH = dataset.stepHours || 1;
    const cool = panel.slider('Point cooldown', { min: 0, max: 48, step: 1, value: s.cooldown,
      hint: 'Hours before a point can play again.', format: (v) => `${Math.round(v * stepH)} hours` }, (v) => { s.cooldown = v; });
    const low = panel.slider('Lowest note', { min: LOW_SEMIS, max: HIGH_SEMIS - 7, step: 1, value: s.lowSemis, format: (v) => noteName(v) },
      (v) => { s.lowSemis = Math.min(v, s.highSemis - 7); low.update(s.lowSemis); });
    const high = panel.slider('Highest note', { min: LOW_SEMIS + 7, max: HIGH_SEMIS, step: 1, value: s.highSemis, format: (v) => noteName(v),
      hint: 'Pitch range, C2 to A5.' }, (v) => { s.highSemis = Math.max(v, s.lowSemis + 7); high.update(s.highSemis); });
    // Keep Preset, Scale, Threshold, Volume up front; the rest is one click away.
    fold('Customize mapping', Object.values(mapControls).flatMap((c) => [c.sel, c.flip]));
    fold('More sound settings', [dens, cool, low, high]);
    panel.text('Voices are hand-synthesized impressions (organ, bell-like gamelan, flute), not recordings.');

    // ---- notes
    const noteOpts = (dur) => ({ range: [lo, hi], norm, scale: s.scale, lowSemis: s.lowSemis, highSemis: s.highSemis, instruments, dur });
    let prev = null, prevT = null, notes = 0;
    const lastPlayed = new Array(points.length).fill(null);
    const flashes = new Map();

    const offFrame = time.onFrame((t) => {
      const cur = valuesAt(t);
      if (prev && prevT === t - 1) {
        const hits = selectTriggers({ prev, cur, threshold: s.threshold, frame: t, lastPlayed,
          cooldown: s.cooldown, maxNotes: s.maxNotes });
        const frameDur = 1 / Math.max(0.1, time.fps || 2);
        const n = hits.length;
        hits.forEach((i, k) => {
          lastPlayed[i] = t;
          const { play } = renderNote(s.mapping, { ...points[i], value: cur[i], prev: prev[i] },
            noteOpts(Math.min(0.6, Math.max(0.15, frameDur * 1.5))));
          sound.play({ ...play, amp: play.amp / Math.sqrt(Math.max(1, n)), t: (k * frameDur * 0.8) / Math.max(1, n) });
          flashes.set(i, performance.now() + (k * frameDur * 800) / Math.max(1, n));
        });
        notes += n;
        if (n) animate();
      }
      prev = cur; prevT = t;
      if (!time.playing) {
        const n = cur.filter((v) => v != null && v >= s.threshold).length;
        describe(`${time.label()}: ${n} of ${points.length} points above ${fmtV(s.threshold)}`);
      }
    });
    const sumTimer = setInterval(() => {
      if (!time.playing) return;
      describe(notes ? `${time.label()}: ${notes} notes in the last 5 seconds.` : `${time.label()}: quiet, nothing crossed ${fmtV(s.threshold)}.`);
      notes = 0;
    }, 5000);

    // ---- hover / arrow keys: play one point with the current mapping and say how it was mapped
    const ready = throttle(150);
    function probe({ lat, lon }, force = false) {
      if (!ready(force, () => probe({ lat, lon }, force))) return;
      const t = time.now();
      const value = dataset.valueAt(lat, lon, t), before = t > 0 ? dataset.valueAt(lat, lon, t - 1) : null;
      const point = { lat, lon, value, prev: before };
      const { play, labels, src } = renderNote(s.mapping, point, noteOpts(0.5));
      if (value != null) sound.play({ ...play, amp: Math.min(0.45, play.amp + 0.05) });
      const said = describeNote(s.mapping, point, labels, units, src.delta, dataset.format && ((v) => dataset.format(v, false)));
      describe(`Near ${formatLatLon(lat, lon)}: ${value == null ? `no data. ${said}` : said}`);
    }
    const offHover = input.onHover((p) => probe(p));
    const offClick = input.onClick((p) => probe(p, true));

    // ---- visuals: point dots, flash on play
    const removeOverlay = viewer.addOverlay((g, v) => {
      const now = performance.now();
      g.save();
      points.forEach((p, i) => {
        const [x, y] = v.toPixel(p.lat, p.lon);
        const t0 = flashes.get(i), age = t0 != null ? (now - t0) / 900 : 2;
        if (age >= 0 && age < 1) {
          g.globalAlpha = 1 - age; g.fillStyle = '#ff8c00'; g.strokeStyle = '#000'; g.lineWidth = 1;
          g.beginPath(); g.arc(x, y, 3 + 12 * age, 0, 7); g.fill(); g.stroke(); g.globalAlpha = 1;
        } else if (t0 != null && age >= 1) flashes.delete(i);
        g.fillStyle = 'rgba(255,255,255,.85)'; g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); g.stroke();
      });
      g.restore();
    });
    let raf = 0;
    function animate() {
      if (raf) return;
      const tick = () => { raf = 0; viewer.redraw(); if (flashes.size && alive) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    }

    prev = valuesAt(time.now()); prevT = time.now();
    saveUrl();
    soundHint(panel, sound, 'press Play. Without sound, mappings are still announced.');
    describe(`Mapping lab ready: ${points.length} points. Mapping: ${summary()}. Threshold ${fmtV(s.threshold)}. Press Play, or explore the map with the arrow keys.`);

    return () => { offFrame(); offHover(); offClick(); offState?.(); clearInterval(sumTimer); removeOverlay(); cancelAnimationFrame(raf); };
  }

  return () => { alive = false; cleanup?.(); };
}
