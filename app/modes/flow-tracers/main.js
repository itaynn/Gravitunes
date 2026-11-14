// Flow tracers: a few dozen evenly scattered points drift with the apparent motion of the data (optical flow,
// analysis/scripts/flow-tracers/build.py) and sing as they go. Pitch <- value under the tracer (scale-quantized,
// low register), loudness <- value, pan <- longitude, brightness <- tracer speed, timbre <- world-orchestra region.
import { loadFlow, flowAt, compass, layerByPrefix, drawFlowArrows } from '../../core/flow.js';
import { quantize, noteHz, noteName, scaleFreqs } from '../../core/scales.js';
import { scaleControl } from '../../core/scale-control.js';
import { voiceNote, pickVoice } from '../../core/voices.js';
import { voiceAt, formatLatLon } from '../../core/geo.js';
import { loadEarth, valueHelpers } from '../../core/data.js';
import { volumeSlider, soundHint, fold, timbreControl } from '../../core/ui.js';
import { rng, scatter, stepTracer, pickVoices, speedBrightness, hoverGesture } from './tracers.js';

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe, viewer } = ctx;
  let alive = true, setup = null;
  // The mode's own copy of the dataset (mode.json datasetDirs) also holds the flow layers.
  const dir = new URL(dataset.dir, location.href);
  (async () => {
    const [flowData, mj, ij] = await Promise.all([
      loadFlow(dir, null),
      loadEarth('musical-centers'), loadEarth('instruments'),
    ]);
    if (!alive) return;
    setup = run(flowData, mj.centers, ij.instruments);
  })().catch((e) => { console.error(e); describe(`Flow tracers could not load (only dataset 4285 is prepared): ${e.message}`); });

  function run({ header, layers }, centers, instruments) {
    const flow = layerByPrefix(layers, 'flow_');
    const dtH = header.dt_hours || dataset.stepHours || 0.5;
    const { norm, fmtV } = valueHelpers(dataset);
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
        const id = pickVoice(instIds, speedBrightness(tr.speed || 0));
        return { voice: instruments[id], name: instLabel(id) };
      }
      const r = voiceAt(tr.lat, tr.lon, centers, instruments, 900);
      return { voice: r.voice, name: instLabel(r.primary.instrument), region: r.primary.region || r.primary.label };
    }
    const noteFor = (value) => quantize(norm(value), [0, 1], s.scale, noteHz(s.lowSemis), noteHz(s.highSemis)).freq;
    function sing(tr, { amp, dur, t = 0, pan = tr.lon / 180, sustained = false }) {
      const { voice } = voiceFor(tr);
      // The voice's octave shift, snapped back into the chosen scale within C2..C5.
      const sh = voiceNote(voice, noteFor(tr.value), { tones: scaleFreqs(s.scale, noteHz(-24), noteHz(12)) }).note;
      const freq = sh.freq;
      // Sustained lines: a pad envelope and a glide from the previous frame's pitch, so each tracer is one
      // continuous note instead of a re-attack per frame (plucked voices would stutter otherwise).
      const envelope = sustained ? { attack: dur * 0.3, decay: 0.1, sustain: 0.9, release: dur * 0.3 } : sh.envelope;
      const glide = sustained && tr.lastFreq && tr.lastFreq !== freq ? { to: freq, time: dur * 0.5 } : undefined;
      sound.play({ freq: glide ? tr.lastFreq : freq, amp, pan, dur, t, harmonics: sh.harmonics, partials: sh.partials, envelope,
        noise: sh.noise, vibrato: sh.vibrato, wah: sh.wah, glide, lowpass: 400 + 1600 * speedBrightness(tr.speed || 0) });
      return freq;
    }

    // ---- controls
    panel.button('Re-scatter tracers', () => { rescatter(); describe(`${s.count} tracers scattered evenly over the map`); });
    panel.slider('Tracer count', { min: 5, max: 80, step: 1, value: s.count, format: (v) => `${v} tracers` },
      (v) => { s.count = v; rescatter(); });
    panel.slider('Max voices', { min: 1, max: 12, step: 1, value: s.maxVoices, format: (v) => `${v} voices`,
      hint: 'Only the loudest tracers (most rain) sing at once.' }, (v) => { s.maxVoices = v; });
    timbreControl(panel, { options: [['region', 'World-orchestra region it passes'], ['single', 'Single voice'], ['speed', 'By speed']],
      value: s.timbre, single: s.single, instruments, onChange: (t) => Object.assign(s, t) });
    scaleControl(panel, { value: s.scale, describe, sound, onChange: (v) => { s.scale = v; } });
    const low = panel.slider('Lowest note', { min: -24, max: 0, step: 1, value: s.lowSemis, format: noteName },
      (v) => { s.lowSemis = Math.min(v, s.highSemis - 7); low.update(s.lowSemis); });
    const high = panel.slider('Highest note', { min: -12, max: 12, step: 1, value: s.highSemis, format: noteName,
      hint: 'Pitch range, C2 to C5. Default G2 to G4.' }, (v) => { s.highSemis = Math.max(v, s.lowSemis + 7); high.update(s.highSemis); });
    const driftSl = panel.slider('Drift exaggeration', { min: 1, max: 10, step: 1, value: s.drift, format: (v) => `${v} times real motion`,
      hint: 'Tracers move this many times faster than the measured flow so the drift is easy to follow.' }, (v) => { s.drift = v; });
    const respawnCb = panel.checkbox('Respawn quiet tracers', s.respawn, (v) => { s.respawn = v; },
      { hint: 'A tracer that has been in dry air for a few frames jumps to a new rainy spot.' });
    panel.checkbox('Show flow arrows', s.arrows, (v) => { s.arrows = v; viewer.redraw(); });
    // Less-used settings in a collapsed "More settings" disclosure.
    const more = fold('More settings', [low, high, driftSl, respawnCb]);
    volumeSlider(panel, sound, s.volume, (v) => { s.volume = v; });
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
      const lastFreq = new Map();
      on.forEach((i, k) => {
        const tr = tracers[i];
        // Re-struck every frame with overlap, gliding from the last pitch: a sustained, slowly changing line per tracer.
        lastFreq.set(tr.id, sing({ ...tr, lastFreq: prevFreq.get(tr.id) }, { amp: (0.12 + 0.4 * norm(tr.value)) / Math.sqrt(on.length),
          dur: frameDur * 1.1, t: (k * 0.02) % frameDur, sustained: true }));
      });
      prevFreq = lastFreq;
      singing = new Set(on.map((i) => tracers[i].id));
      viewer.redraw();
    });
    let singing = new Set(), prevFreq = new Map();

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
    // Announce only when the 3-degree cell or nearby tracer changes; the gesture plays when paused or on click/Enter.
    let lastKey = null;
    function probe({ lat, lon }, force = false) {
      const t = time.now();
      const f = flowAt(flow, lat, lon, t);
      const v = dataset.valueAt(lat, lon, t);
      const near = tracers.find((tr) => Math.abs(tr.lat - lat) < 3 && Math.abs(((tr.lon - lon + 540) % 360) - 180) < 3);
      const tracerTxt = near ? ` Tracer ${near.id + 1} is here.` : '';
      const key = `${Math.floor(lat / 3)},${Math.floor(lon / 3)},${near?.id ?? ''}`;
      if (!force && key === lastKey) return;
      lastKey = key;
      if (!f || v == null || v < s.minValue) {
        describe(`${formatLatLon(lat, lon)}: ${v != null && v >= s.minValue ? fmtV(v) : 'dry'}, no detectable motion.${tracerTxt}`);
        return;
      }
      const speed = Math.hypot(f.u, f.v);
      const g = hoverGesture(f.u, f.v, lon);
      const probeTr = { lat, lon, value: v, speed };
      if (force || !time.playing) for (let k = 0; k < g.notes; k++) {
        const x = g.notes > 1 ? k / (g.notes - 1) : 0;
        sing(probeTr, { amp: 0.3, dur: 0.6 / g.rate, t: k / g.rate, pan: g.pan0 + (g.pan1 - g.pan0) * x });
      }
      const vn = voiceFor(probeTr);
      describe(`${formatLatLon(lat, lon)}: moving ${compass(f.u, f.v)}, ${Math.round(speed)} km/h, ${fmtV(v)}, ${vn.name}-inspired.${tracerTxt}`);
    }
    const offHover = input.onHover((p) => probe(p));
    const offClick = input.onClick((p) => probe(p, true));

    // ---- visuals
    const removeOverlay = viewer.addOverlay((g, vw) => {
      const W = vw.canvas.width, t = time.now();
      g.save();
      if (s.arrows) drawFlowArrows(g, vw, flow, t);
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
        g.fillStyle = on ? '#ffd166' : 'rgba(70,70,70,0.85)'; g.strokeStyle = '#000'; g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, on ? 5 : 3, 0, 7); g.fill(); g.stroke();
      }
      g.restore();
    });

    rescatter();
    soundHint(panel, sound, 'press Play. Without sound, motion is still announced.');
    describe(`Flow tracers ready: ${s.count} tracers on precipitation. Press Play, or explore the map with the arrow keys to hear the local motion.`);
    return () => { offFrame(); offHover(); offClick(); clearInterval(sumTimer); removeOverlay(); more.remove(); };
  }

  return () => { alive = false; setup?.(); };
}
