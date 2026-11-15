// Flow tracers: one dataset at a time (Data menu: IMERG rain, or GEOS-CF ozone, carbon monoxide, nitrogen oxides).
// Rain shows the original NASA frames (cross-faded, over land and coastlines); gases show the host's painted value grid.
// ~1000 faint particles stream along the apparent motion of the pattern (optical flow,
// analysis/scripts/flow-tracers/build.py), plus a few dozen larger "singing" tracers. A singing tracer over a high
// value (rain, or a gas above its median) plays a note: higher value = higher and louder, faster motion = brighter,
// east/west = right/left, timbre = world-orchestra region. Tracers over low values are silent.
import { loadFlow, flowAt, compass, layerByPrefix, drawFlowArrows } from '../../core/flow.js';
import { quantize, noteHz, scaleFreqs, LOW_SEMIS, HIGH_SEMIS } from '../../core/scales.js';
import { scaleControl } from '../../core/scale-control.js';
import { rangeControl } from '../../core/range-control.js';
import { voiceNote, pickVoice } from '../../core/voices.js';
import { voiceAt, formatLatLon } from '../../core/geo.js';
import { loadEarth } from '../../core/data.js';
import { volumeSlider, fold, timbreControl } from '../../core/ui.js';
import { createBackdrop, plainBackdrop } from '../../core/svs-frames.js';
import { fieldOf } from '../../core/fields.js';
import { rng, scatter, pickVoices, speedBrightness, hoverGesture, flowBetween, moveParticle } from './tracers.js';


export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe, viewer } = ctx;
  let alive = true, setup = null;
  // The chosen dataset's value as a 0..1 level; DRY = below it a tracer is silent (rain: 0.1 mm/h, gases: median).
  const field = fieldOf(dataset), DRY = field.threshold, NAME = field.name;
  const dir = new URL(dataset.dir, location.href);
  (async () => {
    const [flowData, mj, ij] = await Promise.all([loadFlow(dir, null), loadEarth('musical-centers'), loadEarth('instruments')]);
    if (!alive) return;
    setup = run(flowData, mj.centers, ij.instruments);
  })().catch((e) => { console.error(e); describe(`Flow tracers could not load the motion of ${NAME}: ${e.message}`); });

  function run({ header, layers }, centers, instruments) {
    const flow = layerByPrefix(layers, 'flow_');
    const dtH = header.dt_hours || dataset.stepHours || 0.5;
    const instIds = Object.keys(instruments);
    const instLabel = (id) => instruments[id]?.label || id;
    // Recorded samples for every instrument; until loaded (or on the built-in synth) notes are synthesized.
    sound.loadSamples?.(Object.values(instruments).map((v) => v.sample).filter(Boolean));
    const backdrop = field.rain ? createBackdrop(dir, { viewer, time }) : plainBackdrop({ time });

    const s = { count: 24, particles: 1200, maxVoices: 6, scale: 'pentatonic-minor', timbre: 'region', single: instIds[0],
      drift: 5, arrows: false, volume: 0.6, sound: true };
    const random = rng(Date.now() & 0xffff);
    const val = (lat, lon, t = time.now()) => field.level(lat, lon, t);
    const rainy = (t) => (lat, lon) => val(lat, lon, t) >= DRY;
    let tracers = [], parts = [];

    function spawn(p = {}) {
      const t = time.now();
      let lat = 0, lon = 0;
      for (let k = 0; k < 25; k++) {
        lat = (Math.asin(random() * 2 - 1) * 180) / Math.PI * 0.9; lon = random() * 360 - 180;
        if (val(lat, lon, t) >= DRY) break;
      }
      return Object.assign(p, { lat, lon, age: 0, idle: 0, life: 40 + random() * 60 });
    }
    function rescatter() {
      tracers = scatter(s.count, { random, accept: rainy(time.now()) }).map((p, id) => ({ id, ...p, quiet: 0, u: 0, v: 0, speed: 0 }));
      tracers.forEach((tr) => { tr.value = val(tr.lat, tr.lon); });
      parts = Array.from({ length: s.particles }, () => spawn());
      parts.forEach((p) => { p.age = random() * p.life; });
      clearTrails();
    }

    function voiceFor(tr) {
      if (s.timbre === 'single') return { voice: instruments[s.single], name: instLabel(s.single), sample: instruments[s.single]?.sample };
      if (s.timbre === 'speed') { const id = pickVoice(instIds, speedBrightness(tr.speed || 0)); return { voice: instruments[id], name: instLabel(id), sample: instruments[id]?.sample }; }
      const r = voiceAt(tr.lat, tr.lon, centers, instruments, 900);
      return { voice: r.voice, name: instLabel(r.primary.instrument), sample: instruments[r.primary.instrument]?.sample };
    }
    // Pitch range: the Low / High menus (default C2..E6).
    let range = { low: LOW_SEMIS, high: HIGH_SEMIS };
    const tones = () => scaleFreqs(s.scale, noteHz(range.low), noteHz(range.high));
    // Pitch from the value over the range (voiceNote folds octave-shifted voices back inside).
    const noteFor = (value) => quantize(field.spread(Math.min(1, value)), [0, 1], s.scale, noteHz(range.low), noteHz(range.high)).freq;
    function sing(tr, { amp, dur, t = 0, pan = tr.lon / 180, sustained = false }) {
      if (!s.sound) return null;
      const vf = voiceFor(tr), sh = voiceNote(vf.voice, noteFor(tr.value), { tones: tones() }).note;
      const freq = sh.freq;
      const envelope = sustained ? { attack: dur * 0.3, decay: 0.1, sustain: 0.9, release: dur * 0.3 } : sh.envelope;
      const glide = sustained && tr.lastFreq && tr.lastFreq !== freq ? { to: freq, time: dur * 0.5 } : undefined;
      sound.play({ freq: glide ? tr.lastFreq : freq, amp, pan, dur, t, sample: vf.sample, harmonics: sh.harmonics, partials: sh.partials, envelope,
        noise: sh.noise, vibrato: sh.vibrato, wah: sh.wah, glide, lowpass: 6000 + 6000 * speedBrightness(tr.speed || 0) });
      return freq;
    }

    // ---- controls: Sound, Scale, Volume up front; the rest folded under "More".
    scaleControl(panel, { value: s.scale, describe, sound, onChange: (v) => { s.scale = v; } });
    range = rangeControl(panel, { describe });
    volumeSlider(panel, sound, s.volume, (v) => { s.volume = v; });
    const howTo = panel.text(field.rain ? 'How it sounds: yellow tracers are over rain and sing. Heavier rain = higher, louder note; left/right = west/east.'
      : `How it sounds: yellow tracers are over high ${NAME} (above its median) and sing. Higher ${NAME} = higher, louder note; left/right = west/east.`);
    howTo.classList.add('hint');
    const legend = document.createElement('p');
    legend.className = 'hint';
    legend.textContent = `White streaks: ${NAME} motion we computed from the maps (not NASA data). Yellow dots: the places you hear now.`;
    howTo.after(legend);
    const timbre = timbreControl(panel, { options: [['region', 'By region'], ['single', 'One voice'], ['speed', 'By speed']],
      value: s.timbre, single: s.single, instruments, onChange: (t) => Object.assign(s, t) });
    const countSl = panel.slider('Tracers', { min: 5, max: 60, step: 1, value: s.count, format: (v) => `${v} singing tracers` }, (v) => { s.count = v; rescatter(); });
    const voicesSl = panel.slider('Voices', { min: 1, max: 12, step: 1, value: s.maxVoices, format: (v) => `at most ${v} notes at once` }, (v) => { s.maxVoices = v; });
    const driftSl = panel.slider('Speed-up', { min: 1, max: 8, step: 1, value: s.drift, format: (v) => `tracers move ${v} times faster than the measured flow` }, (v) => { s.drift = v; });
    const arrowsCb = panel.checkbox('Arrows', s.arrows, (v) => { s.arrows = v; viewer.redraw(); });
    arrowsCb.setAttribute('aria-label', 'Show flow arrows');
    const more = fold('More', [timbre.timbre, timbre.single, countSl, voicesSl, driftSl, arrowsCb]);
    // Rain: the NASA colour bars replace the host's generic one (gases keep the host's).
    const hostBar = field.rain ? document.getElementById('colorbar') : null;
    if (hostBar) hostBar.hidden = true;
    const bars = document.createElement('div');
    (hostBar || document.getElementById('colorbar') || viewer.canvas).after(bars);
    backdrop.colorbars().then((ims) => { if (alive) bars.append(...ims); });

    // ---- sound: one sustained line per singing tracer, re-struck each frame while playing
    let singing = new Set(), prevFreq = new Map(), prevT = time.now();
    const offFrame = time.onFrame((t) => {
      const forward = t === (prevT + 1) % time.count;
      prevT = t;
      tracers.forEach((tr) => { tr.value = val(tr.lat, tr.lon, t); tr.quiet = tr.value >= DRY ? 0 : (tr.quiet || 0) + 1; });
      // A tracer dry for 4 frames jumps to a rainy spot.
      const dead = tracers.filter((tr) => tr.quiet >= 4);
      if (dead.length) {
        const fresh = scatter(dead.length, { random, accept: rainy(t), avoid: tracers.filter((tr) => tr.quiet < 4) });
        dead.forEach((tr, k) => Object.assign(tr, fresh[k], { quiet: 0, hist: [], value: val(fresh[k].lat, fresh[k].lon, t) }));
      }
      const on = pickVoices(tracers, s.maxVoices, DRY);
      singing = new Set(on.map((i) => tracers[i].id));
      if (!forward || !time.playing || !s.sound) { prevFreq = new Map(); return; }
      const frameDur = 1 / Math.max(0.1, time.fps || 2);
      const next = new Map();
      on.forEach((i, k) => {
        const tr = tracers[i];
        next.set(tr.id, sing({ ...tr, lastFreq: prevFreq.get(tr.id) }, { amp: (0.12 + 0.4 * field.spread(tr.value)) / Math.sqrt(on.length),
          dur: frameDur * 1.1, t: (k * 0.02) % frameDur, sustained: true }));
      });
      prevFreq = next;
    });
    const offPlay = time.onPlayState((p) => { if (!p) sound.stopAll(); });

    // Screen-reader summary while playing.
    const sumTimer = setInterval(() => {
      if (!time.playing) return;
      const on = pickVoices(tracers, s.maxVoices, DRY).map((i) => tracers[i]);
      if (!on.length) { describe(`${time.label()}. All tracers are over ${field.rain ? 'dry air' : `low ${NAME}`}.`); return; }
      const top = on[0];
      describe(`${time.label()}. ${on.length} tracers singing. Loudest: ${field.text(top.lat, top.lon, time.now())}, moving ${compass(top.u, top.v)} at ${Math.round(top.speed)} km/h.`);
    }, 6000);

    // ---- keys / click: describe the spot (text). Mouse hover is silent and says nothing; Enter or click also plays it.
    let lastKey = null;
    function probe({ lat, lon, keyboard = false }, play = false) {
      if (!keyboard && !play) return;
      const t = time.now();
      const f = flowAt(flow, lat, lon, t), v = val(lat, lon, t);
      const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
      if (!play && key === lastKey) return;
      lastKey = key;
      const motion = f && v >= DRY ? `moving ${compass(f.u, f.v)} at ${Math.round(Math.hypot(f.u, f.v))} km/h` : 'no detectable motion';
      describe(`${formatLatLon(lat, lon)}: ${field.text(lat, lon, t)}, ${motion}.`);
      if (play && f && v >= DRY) {
        const speed = Math.hypot(f.u, f.v), g = hoverGesture(f.u, f.v, lon), pt = { lat, lon, value: v, speed };
        for (let k = 0; k < g.notes; k++) {
          const x = g.notes > 1 ? k / (g.notes - 1) : 0;
          sing(pt, { amp: 0.3, dur: 0.6 / g.rate, t: k / g.rate, pan: g.pan0 + (g.pan1 - g.pan0) * x });
        }
      }
    }
    const offHover = input.onHover((p) => probe(p));
    const offClick = input.onClick((p) => probe({ ...p, keyboard: true }, true));

    // ---- animation: particles and tracers advect continuously (flow blended between frames, 10 steps a second)
    // and keep their last ~2.5 s of positions, drawn as tails that fade toward the back.
    const STEP = 0.1, KEEP = 25;
    function clearTrails() { parts.forEach((p) => { p.hist = []; }); tracers.forEach((tr) => { tr.hist = []; }); }
    let last = performance.now(), acc = 0, raf = 0;
    function step() {
      const t = time.now(), ph = backdrop.phase();
      const hours = STEP * (time.fps || 2) * dtH * s.drift;
      for (const p of parts) {
        (p.hist ||= []).push([p.lat, p.lon]);
        if (p.hist.length > KEEP) p.hist.shift();
        if (!moveParticle(p, flowBetween(flow, p.lat, p.lon, t, ph, time.count), hours)) { spawn(p); p.hist = []; }
      }
      for (const tr of tracers) {
        (tr.hist ||= []).push([tr.lat, tr.lon]);
        if (tr.hist.length > KEEP) tr.hist.shift();
        const f = flowBetween(flow, tr.lat, tr.lon, t, ph, time.count);
        if (!f) continue;
        const m = { lat: tr.lat, lon: tr.lon, age: 0, life: Infinity };
        moveParticle(m, f, hours);
        Object.assign(tr, { lat: m.lat, lon: m.lon, u: f.u, v: f.v, speed: Math.hypot(f.u, f.v) });
      }
    }
    function tick(now) {
      if (time.playing) {
        acc += Math.min(0.25, (now - last) / 1000);
        while (acc >= STEP) { step(); acc -= STEP; }
        viewer.redraw();
      }
      last = now;
      if (alive) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    // Tails in 5 alpha bands (old = faint), each one batched path.
    function tails(g, vw, list, color, width) {
      const W = vw.canvas.width, bands = 5;
      g.lineWidth = width; g.lineCap = 'round';
      for (let b = 0; b < bands; b++) {
        g.strokeStyle = color(((b + 1) / bands) ** 1.5); g.beginPath();
        for (const p of list) {
          const h = p.hist; if (!h || h.length < 2) continue;
          const n = h.length, i0 = Math.floor((b * n) / bands), i1 = Math.floor(((b + 1) * n) / bands);
          let prev = vw.toPixel(h[i0][0], h[i0][1]);
          for (let i = i0 + 1; i <= i1; i++) {
            const q = i < n ? h[i] : [p.lat, p.lon];
            const cur = vw.toPixel(q[0], q[1]);
            if (Math.abs(cur[0] - prev[0]) < W / 2) { g.moveTo(prev[0], prev[1]); g.lineTo(cur[0], cur[1]); }
            prev = cur;
          }
        }
        g.stroke();
      }
    }

    const removeOverlay = viewer.addOverlay((g, vw) => {
      backdrop.draw(g, vw);
      if (s.arrows) drawFlowArrows(g, vw, flow, time.now());
      const W = vw.canvas.width;
      // Thin, faint streams so the NASA rain colours dominate; only the tracers sounding now are drawn.
      tails(g, vw, parts, (a) => `rgba(235,245,255,${0.35 * a})`, Math.max(0.6, W / 1800));
      const now = tracers.filter((tr) => singing.has(tr.id));
      tails(g, vw, now, (a) => `rgba(255,209,102,${0.9 * a})`, Math.max(2, W / 500));
      g.save();
      const r = Math.max(7, W / 200);
      for (const tr of now) {
        const [x, y] = vw.toPixel(tr.lat, tr.lon);
        g.beginPath(); g.arc(x, y, r, 0, 7);
        g.fillStyle = '#ffd166'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke();
      }
      g.restore();
    });
    backdrop.ready.then(() => viewer.redraw());

    rescatter();
    describe(`Flow tracers ready: ${dataset.title}, with ${s.count} singing tracers following the motion of ${NAME}. Press Play to hear it, or use the arrow keys to explore; choose another dataset with the Data menu.`);
    return () => {
      offFrame(); offPlay(); offHover(); offClick(); clearInterval(sumTimer); cancelAnimationFrame(raf);
      removeOverlay(); more.remove(); legend.remove(); bars.remove(); backdrop.dispose(); if (hostBar) hostBar.hidden = false;
    };
  }

  return () => { alive = false; setup?.(); };
}
