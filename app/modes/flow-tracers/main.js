// Flow tracers: a few dozen evenly scattered points drift with the apparent motion of the data (optical flow,
// analysis/scripts/flow-tracers/build.py) and sing as they go. Pitch <- value under the tracer (scale-quantized,
// low register), loudness <- value, pan <- longitude, brightness <- tracer speed, timbre <- world-orchestra region.
import { loadFlow, flowAt, compass } from '../../core/flow.js';
import { SCALES, quantize, noteHz, noteName } from '../../core/scales.js';
import { shapeForPitch } from '../../core/voices.js';
// Region -> voice lookup reused as-is from world-orchestra (it is not in core/ yet).
import { voiceAt } from '../world-orchestra/orchestra.js';
import { rng, scatter, stepTracer, pickVoices, speedBrightness, hoverGesture } from './tracers.js';

const getJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url}`);
  return r.json();
};

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe, viewer } = ctx;
  let alive = true, setup = null;
  const dir = new URL(`data/${dataset.id}/`, import.meta.url);
  (async () => {
    const [flowData, mj, ij] = await Promise.all([
      loadFlow(dir, null).catch(() => null),
      getJson('/data/earth/musical-centers.json'), getJson('/data/earth/instruments.json'),
    ]);
    if (!alive) return;
    if (!flowData) throw new Error(`no flow data for dataset ${dataset.id} (only 4285 is prepared)`);
    setup = run(flowData, mj.centers, ij.instruments);
  })().catch((e) => { console.error(e); describe(`Flow tracers could not load: ${e.message}`); });

  function run({ header, layers }, centers, instruments) {
    const flow = Object.entries(layers).find(([k]) => k.startsWith('flow_'))[1];
    const dtH = header.dt_hours || dataset.stepHours || 0.5;
    const norm = dataset.norm || ((v) => v);
    const fmtV = (v) => dataset.format(v);
    const instIds = Object.keys(instruments);
    const instLabel = (id) => instruments[id]?.label || id;

    const s = {
      count: 30, maxVoices: 6, scale: 'pentatonic-minor', timbre: 'region', single: instIds[0],
      lowSemis: -17, highSemis: 7, minValue: 0.06, drift: 4, respawn: true, arrows: true, volume: 0.6, seed: 1,
    };
    let tracers = [];
    const random = rng(Date.now() & 0xffff);
    const hasRain = (t) => (lat, lon) => (dataset.valueAt(lat, lon, t) ?? 0) >= s.minValue;

    function rescatter() {
      tracers = scatter(s.count, { random }).map((p, id) => ({ id, ...p, quiet: 0, trail: [] }));
      refreshValues(time.now());
      viewer.redraw();
    }
    function refreshValues(t) {
      tracers = tracers.map((tr) => ({ ...tr, value: dataset.valueAt(tr.lat, tr.lon, t) }));
    }

    function voiceFor(tr) {
      if (s.timbre === 'single') return { voice: instruments[s.single], name: instLabel(s.single) };
      if (s.timbre === 'speed') {
        const id = instIds[Math.min(instIds.length - 1, Math.floor(speedBrightness(tr.speed || 0) * instIds.length))];
        return { voice: instruments[id], name: instLabel(id) };
      }
      const r = voiceAt(tr.lat, tr.lon, centers, instruments, 900);
      return { voice: r.voice, name: instLabel(r.primary.instrument), region: r.primary.region || r.primary.label };
    }
    function noteFor(value) {
      const f = quantize(norm(value), [0, 1], s.scale, noteHz(s.lowSemis), noteHz(s.highSemis)).freq;
      return Math.max(noteHz(-24), Math.min(noteHz(12), f));
    }
    function sing(tr, { amp, dur, t = 0, pan = tr.lon / 180 }) {
      const { voice } = voiceFor(tr);
      let freq = noteFor(tr.value) * 2 ** (voice.octave || 0);
      freq = Math.max(noteHz(-24), Math.min(noteHz(12), freq));
      const sh = shapeForPitch(voice, freq);
      sound.play({ freq, amp, pan, dur, t, harmonics: sh.harmonics, partials: sh.partials, envelope: sh.envelope,
        noise: sh.noise, lowpass: 400 + 1600 * speedBrightness(tr.speed || 0) });
    }

    // ---- controls
    const playBtn = panel.button(time.playing ? 'Pause tracers' : 'Play tracers', () => {
      if (time.playing) { time.pause(); describe(`Paused at ${time.label()}`); } else { time.play(); describe('Tracers drifting'); }
    }, { hint: 'Plays the half-hourly frames; each tracer moves with the flow and sings.' });
    const offState = time.onPlayState((p) => { playBtn.textContent = p ? 'Pause tracers' : 'Play tracers'; });
    panel.button('Re-scatter tracers', () => { rescatter(); describe(`${s.count} tracers scattered evenly over the map`); });
    panel.slider('Tracer count', { min: 5, max: 80, step: 1, value: s.count, format: (v) => `${v} tracers` },
      (v) => { s.count = v; rescatter(); });
    panel.slider('Max voices', { min: 1, max: 12, step: 1, value: s.maxVoices, format: (v) => `${v} voices`,
      hint: 'Only the loudest tracers (most rain) sing at once.' }, (v) => { s.maxVoices = v; });
    panel.select('Timbre', [['region', 'World-orchestra region it passes'], ['single', 'Single voice'], ['speed', 'By speed']],
      (v) => { s.timbre = v; }, { value: s.timbre });
    panel.select('Single voice', instIds.map((k) => [k, instLabel(k)]), (v) => { s.single = v; }, { value: s.single });
    panel.select('Scale', Object.entries(SCALES).map(([k, v]) => [k, v.label]), (v) => { s.scale = v; }, { value: s.scale });
    const low = panel.slider('Lowest note', { min: -24, max: 0, step: 1, value: s.lowSemis, format: noteName },
      (v) => { s.lowSemis = Math.min(v, s.highSemis - 7); low.update(s.lowSemis); });
    const high = panel.slider('Highest note', { min: -12, max: 12, step: 1, value: s.highSemis, format: noteName,
      hint: 'Pitch range, C2 to C5. Default G2 to G4.' }, (v) => { s.highSemis = Math.max(v, s.lowSemis + 7); high.update(s.highSemis); });
    panel.slider('Drift exaggeration', { min: 1, max: 10, step: 1, value: s.drift, format: (v) => `${v} times real motion`,
      hint: 'Tracers move this many times faster than the measured flow so the drift is easy to follow.' }, (v) => { s.drift = v; });
    panel.checkbox('Respawn quiet tracers', s.respawn, (v) => { s.respawn = v; },
      { hint: 'A tracer that has been in dry air for a few frames jumps to a new rainy spot.' });
    panel.checkbox('Show flow arrows', s.arrows, (v) => { s.arrows = v; viewer.redraw(); });
    panel.slider('Volume', { min: 0, max: 1, step: 0.05, value: s.volume, format: (v) => `${Math.round(v * 100)} percent` },
      (v) => { s.volume = v; sound.setVolume?.(v); });
    sound.setVolume?.(s.volume);
    panel.text('Motion is the apparent motion of the rain pattern (optical flow), not wind.');

    // ---- frames
    let prevT = time.now();
    const offFrame = time.onFrame((t) => {
      const forward = t === prevT + 1 || (prevT === time.count - 1 && t === 0);
      prevT = t;
      if (!forward) { refreshValues(t); viewer.redraw(); return; }
      const value = (lat, lon) => dataset.valueAt(lat, lon, t);
      tracers = tracers.map((tr) => stepTracer(tr, flow, t, dtH * s.drift, { value, minValue: s.minValue }));
      if (s.respawn) {
        const dead = tracers.filter((tr) => tr.quiet >= 4);
        if (dead.length) {
          const fresh = scatter(dead.length, { random, accept: hasRain(t), avoid: tracers.filter((tr) => tr.quiet < 4) });
          let k = 0;
          tracers = tracers.map((tr) => (tr.quiet >= 4 ? { id: tr.id, ...fresh[k++], quiet: 0, trail: [], speed: 0,
            value: dataset.valueAt(fresh[k - 1].lat, fresh[k - 1].lon, t) } : tr));
        }
      }
      const frameDur = 1 / Math.max(0.1, time.fps || 2);
      const on = pickVoices(tracers, s.maxVoices, s.minValue);
      on.forEach((i, k) => {
        const tr = tracers[i];
        // Re-struck every frame with a little overlap: a sustained, slowly changing line per tracer.
        sing(tr, { amp: (0.12 + 0.4 * norm(tr.value)) / Math.sqrt(on.length), dur: frameDur * 1.1, t: (k * 0.02) % frameDur });
      });
      singing = new Set(on.map((i) => tracers[i].id));
      viewer.redraw();
    });
    let singing = new Set();

    // Screen-reader summary while playing.
    const sumTimer = setInterval(() => {
      if (!time.playing) return;
      const on = pickVoices(tracers, s.maxVoices, s.minValue).map((i) => tracers[i]);
      if (!on.length) { describe(`${time.label()}. All tracers are in dry air.`); return; }
      const top = on[0];
      const regions = [...new Set(on.map((tr) => voiceFor(tr).name))].slice(0, 3);
      describe(`${time.label()}. ${on.length} tracers singing (${regions.join(', ')}). Loudest moving ${compass(top.u, top.v)} at ${Math.round(top.speed)} km/h.`);
    }, 6000);

    // ---- hover / keys: local flow as a short gesture
    let lastHover = 0;
    const fmtPos = (lat, lon) => `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? 'E' : 'W'}`;
    function probe({ lat, lon }, force = false) {
      const now = performance.now();
      if (!force && now - lastHover < 200) return;
      lastHover = now;
      const t = time.now();
      const f = flowAt(flow, lat, lon, t);
      const v = dataset.valueAt(lat, lon, t);
      const near = tracers.find((tr) => Math.abs(tr.lat - lat) < 3 && Math.abs(((tr.lon - lon + 540) % 360) - 180) < 3);
      const tracerTxt = near ? ` Tracer ${near.id + 1} is here.` : '';
      if (!f || v == null || v < s.minValue) {
        describe(`${fmtPos(lat, lon)}: ${v != null && v >= s.minValue ? fmtV(v) : 'dry'}, no detectable motion.${tracerTxt}`);
        return;
      }
      const speed = Math.hypot(f.u, f.v);
      const g = hoverGesture(f.u, f.v, lon);
      const probeTr = { lat, lon, value: v, speed };
      for (let k = 0; k < g.notes; k++) {
        const x = g.notes > 1 ? k / (g.notes - 1) : 0;
        sing(probeTr, { amp: 0.3, dur: 0.6 / g.rate, t: k / g.rate, pan: g.pan0 + (g.pan1 - g.pan0) * x });
      }
      const vn = voiceFor(probeTr);
      describe(`${fmtPos(lat, lon)}: moving ${compass(f.u, f.v)}, ${Math.round(speed)} km/h, ${fmtV(v)}, ${vn.name}-inspired.${tracerTxt}`);
    }
    const offHover = input.onHover((p) => probe(p));
    const offClick = input.onClick((p) => probe(p, true));

    // ---- visuals
    const removeOverlay = viewer.addOverlay((g, vw) => {
      const W = vw.canvas.width, t = time.now();
      g.save();
      if (s.arrows) {
        g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1;
        for (let lat = 75; lat > -80; lat -= 7.5) for (let lon = -176; lon < 180; lon += 7.5) {
          const f = flowAt(flow, lat, lon, t);
          if (!f) continue;
          const [x, y] = vw.toPixel(lat, lon), k = (W / 1024) * 0.35;
          const dx = f.u * k, dy = -f.v * k;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y + dy); g.stroke();
          g.beginPath(); g.arc(x + dx, y + dy, 1.2, 0, 7); g.stroke();
        }
      }
      for (const tr of tracers) {
        const [x, y] = vw.toPixel(tr.lat, tr.lon);
        const pts = (tr.trail || []).map((p) => vw.toPixel(p.lat, p.lon));
        g.strokeStyle = 'rgba(255,220,120,0.7)'; g.lineWidth = 2; g.beginPath();
        let started = false;
        for (const [px, py] of pts) {
          if (started && Math.abs(px - x) > W / 2) { started = false; continue; }   // date-line jump
          if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
        }
        if (started) g.lineTo(x, y);
        g.stroke();
        const on = singing.has(tr.id);
        g.fillStyle = on ? '#ffd166' : 'rgba(200,200,200,0.6)'; g.strokeStyle = '#000'; g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, on ? 5 : 3, 0, 7); g.fill(); g.stroke();
      }
      g.restore();
    });

    rescatter();
    if (!sound.started) panel.text('Press "Start sound" to hear the tracers. Without sound, motion is still announced.');
    describe(`Flow tracers ready: ${s.count} tracers on precipitation. Press Play tracers, or explore the map with the arrow keys to hear the local motion.`);
    return () => { offFrame(); offHover(); offClick(); offState(); clearInterval(sumTimer); removeOverlay(); };
  }

  return () => { alive = false; setup?.(); };
}
