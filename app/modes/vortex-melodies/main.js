// Vortex melodies: each tracked vortex (analysis/scripts/vortex-melodies/build.py) loops a short motif.
// Loop speed <- spin rank, loudness <- strength x size rank, pan <- longitude, ccw rising / cw falling,
// timbre <- world-orchestra region at the center. A soft bed follows net convergence of the flow.
import { loadFlow, flowAt, rankNormaliser } from '../../core/flow.js';
import { scaleFreqs, noteHz } from '../../core/scales.js';
import { scaleControl } from '../../core/scale-control.js';
import { shapeForPitch } from '../../core/voices.js';
import { voiceAt, distKm } from '../../core/geo.js';
import { getJson, loadEarth } from '../../core/data.js';
import { soundHint } from '../../core/ui.js';
import { motifFreq, MOTIFS, orient, buildRanks, loopSeconds, motifIndex, activeVortices, convergence, periodText, dueNotes } from './vortex.js';

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe, viewer } = ctx;
  let alive = true, setup = null;
  // The mode's own copy of the dataset (mode.json datasetDirs) also holds the flow layers and vortices.
  const dir = new URL(dataset.dir, location.href);
  (async () => {
    const [flowData, vort, mj, ij] = await Promise.all([
      loadFlow(dir), getJson(new URL('vortices.json', dir)),
      loadEarth('musical-centers'), loadEarth('instruments'),
    ]);
    if (!alive) return;
    setup = run(flowData, vort, mj.centers, ij.instruments);
  })().catch((e) => { console.error(e); describe(`Vortex melodies could not load (only dataset 4285 is prepared): ${e.message}`); });

  function run({ layers }, data, centers, instruments) {
    const flow = Object.entries(layers).find(([k]) => k.startsWith('flow_'))[1];
    const div = Object.entries(layers).find(([k]) => k.startsWith('divergence_'))[1];
    const ranks = buildRanks(data);
    const trackById = new Map(data.tracks.map((t) => [t.id, t]));
    // Net convergence per frame is small (about -0.1..0.1 on 4285), so the bed follows its rank over the sequence.
    const rawBed = Array.from({ length: data.frames.length }, (_, t) => convergence(div, t));
    const bedRank = rankNormaliser(rawBed);
    const bedByFrame = rawBed.map((c) => 2 * bedRank(c) - 1);
    const instIds = Object.keys(instruments);
    const instLabel = (id) => instruments[id]?.label || id;
    const centerIndex = new Map(centers.map((c, i) => [c.id, i]));

    const s = {
      maxVoices: 4, scale: 'pentatonic-minor', timbre: 'region', single: instIds[0], melody: 'size',
      melodies: true, bed: true, arrows: false, volume: 0.6,
    };
    const phase = new Map();           // vortex id -> loop start (seconds, performance clock)
    let active = [], solo = null;      // solo: { id, until }

    const tones = () => scaleFreqs(s.scale, noteHz(-24), noteHz(12));   // C2..C5
    function voiceFor(v) {
      const region = voiceAt(v.lat, v.lon, centers, instruments, 900);
      if (s.timbre === 'region') return { voice: region.voice, name: instLabel(region.primary.instrument), center: region.primary };
      const pickBy = s.timbre === 'size' ? v.sizeRank : s.timbre === 'strength' ? ranks.strength(v.circ * v.r) : null;
      const id = pickBy == null ? s.single : instIds[Math.min(instIds.length - 1, Math.floor(pickBy * instIds.length))];
      return { voice: instruments[id], name: instLabel(id), center: region.primary };
    }
    function motifOf(v, center) {
      const m = MOTIFS[motifIndex(s.melody, { sizeRank: v.sizeRank, regionIndex: centerIndex.get(center.id) || 0,
        lifetimeRank: ranks.lifetime(v.track?.frames ?? 0) })];
      return { ...m, steps: orient(m.steps, v.track?.direction || 'ccw') };
    }
    function playStep(v, k, at, ampScale = 1) {
      const { voice, center } = voiceFor(v);
      const m = motifOf(v, center);
      const freq = motifFreq(tones(), noteHz(m.root), m.steps[k % m.steps.length], voice.octave || 0);
      const sh = shapeForPitch(voice, freq);
      const step = loopSeconds(v.spinRank) / m.steps.length;
      sound.play({ freq, amp: 0.4 * v.loud * ampScale, pan: v.lon / 180, t: Math.max(0, at - performance.now() / 1000),
        dur: Math.min(sh.dur ?? 0.4, step * 0.9), harmonics: sh.harmonics, partials: sh.partials, envelope: sh.envelope, noise: sh.noise });
    }

    // ---- scheduler: notes due in the next 150 ms
    let lastTick = performance.now() / 1000;
    const sched = setInterval(() => {
      const now = performance.now() / 1000, to = now + 0.15;
      const soloing = solo && solo.until > now ? solo.id : null;
      if (time.playing && s.melodies) {
        const list = soloing != null
          ? activeVortices(data, ranks, time.now(), Infinity, trackById).filter((v) => v.id === soloing) : active;
        const n = Math.max(1, list.length);
        for (const v of list) {
          if (!phase.has(v.id)) phase.set(v.id, now);
          const m = motifOf(v, voiceFor(v).center);
          for (const { k, at } of dueNotes(m.steps.length, loopSeconds(v.spinRank), phase.get(v.id), lastTick, to)) {
            playStep(v, k, at, 1 / Math.sqrt(n));
          }
        }
      }
      lastTick = to;
    }, 100);

    // ---- frames
    const offFrame = time.onFrame((t) => {
      active = activeVortices(data, ranks, t, s.maxVoices, trackById);
      const ids = new Set(active.map((v) => v.id));
      for (const id of phase.keys()) if (!ids.has(id)) phase.delete(id);
      if (time.playing && s.bed) {
        const c = bedByFrame[t] || 0, frameDur = 1 / Math.max(0.1, time.fps || 2);
        // Convergence swells and brightens; divergence thins. Low C2 + G2 pad, re-struck each frame.
        for (const semis of [-24, -17]) {
          sound.play({ freq: noteHz(semis), amp: 0.05 + 0.08 * (c + 1) / 2, pan: 0, dur: frameDur * 1.3,
            harmonics: [1, 0.3, 0.15], envelope: { attack: frameDur * 0.4, decay: 0.2, sustain: 0.9, release: frameDur },
            lowpass: 250 + 700 * (c + 1) / 2 });
        }
      }
      if (!time.playing) describe(`${time.label()}: ${(data.frames[t] || []).length} vortices; ${bedText(t)}.`);
      viewer.redraw();
    });
    const bedText = (t) => {
      const c = bedByFrame[t] || 0;
      return c > 0.4 ? 'more converging than usual' : c < -0.4 ? 'more spreading out than usual' : 'converging and spreading about usual';
    };

    // ---- controls
    const playBtn = panel.button(time.playing ? 'Pause' : 'Play vortices', () => {
      if (time.playing) { time.pause(); describe(`Paused at ${time.label()}`); } else { time.play(); describe('Vortex melodies playing'); }
    });
    const offState = time.onPlayState((p) => { playBtn.textContent = p ? 'Pause' : 'Play vortices'; });
    panel.checkbox('Vortex melodies', s.melodies, (v) => { s.melodies = v; }, { hint: 'Mute or unmute the melody layer.' });
    panel.checkbox('Divergence bed', s.bed, (v) => { s.bed = v; }, { hint: 'Soft low pad: swells where the rain converges.' });
    panel.slider('Max vortices heard', { min: 1, max: 10, step: 1, value: s.maxVoices, format: (v) => `${v} vortices`,
      hint: 'Only the loudest (strongest and largest) play at once.' }, (v) => { s.maxVoices = v; active = activeVortices(data, ranks, time.now(), v, trackById); });
    panel.select('Timbre', [['region', 'World-orchestra region at the center'], ['size', 'By size'], ['strength', 'By strength'], ['single', 'Single voice']],
      (v) => { s.timbre = v; }, { value: s.timbre });
    panel.select('Single voice', instIds.map((k) => [k, instLabel(k)]), (v) => { s.single = v; }, { value: s.single });
    panel.select('Melody', [['size', 'By size (big = longer, lower)'], ['region', 'By region'], ['lifetime', 'By lifetime']],
      (v) => { s.melody = v; }, { value: s.melody });
    scaleControl(panel, { value: s.scale, describe, onChange: (v) => { s.scale = v; } });
    panel.checkbox('Show flow arrows', s.arrows, (v) => { s.arrows = v; viewer.redraw(); });
    panel.slider('Volume', { min: 0, max: 1, step: 0.05, value: s.volume, format: (v) => `${Math.round(v * 100)} percent` },
      (v) => { s.volume = v; sound.setVolume?.(v); });
    sound.setVolume?.(s.volume);
    panel.text(`Spin rates are underestimated by the analysis smoothing, so loop speed follows each vortex's rank (faster or slower than the others), not its measured rate. Vortices seen in fewer than ${data.min_track_frames} frames are left out.`);

    // ---- hover / keys: solo the vortex under the cursor and describe it
    let lastHover = 0, lastId = null;
    function probe({ lat, lon }, force = false) {
      const now = performance.now();
      if (!force && now - lastHover < 200) return;
      lastHover = now;
      const t = time.now();
      const all = activeVortices(data, ranks, t, Infinity, trackById);
      let best = null, bestD = Infinity;
      for (const v of all) { const d = distKm(lat, lon, v.lat, v.lon); if (d < v.r + 400 && d < bestD) { bestD = d; best = v; } }
      if (!best) {
        if (lastId != null || force) describe(`No vortex here. ${all.length} vortices at ${time.label()}.`);
        lastId = null; solo = null; return;
      }
      solo = { id: best.id, until: now / 1000 + 4 };
      if (best.id === lastId && !force) return;
      lastId = best.id;
      const dirTxt = best.track?.direction === 'cw' ? 'clockwise' : 'counterclockwise';
      const { name } = voiceFor(best);
      const faster = Math.round(best.spinRank * 100);
      describe(`Vortex ${best.id}, ${dirTxt}, ${periodText(best.spin)} (spins faster than ${faster} percent of vortices), ${Math.round(best.r * 2 / 50) * 50} km wide, ${name}-inspired.`);
      if (!time.playing && s.melodies) {
        const m = motifOf(best, voiceFor(best).center), step = loopSeconds(best.spinRank) / m.steps.length;
        const t0 = now / 1000 + 0.05;
        for (let k = 0; k < m.steps.length; k++) playStep({ ...best, loud: Math.max(0.6, best.loud) }, k, t0 + k * step);
      }
    }
    const offHover = input.onHover((p) => probe(p));
    const offClick = input.onClick((p) => probe(p, true));

    // ---- visuals: rotating rings sized by radius, green = ccw, magenta = cw
    const removeOverlay = viewer.addOverlay((g, vw) => {
      const W = vw.canvas.width, t = time.now(), sec = performance.now() / 1000;
      g.save();
      if (s.arrows) {
        g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1;
        for (let lat = 75; lat > -80; lat -= 7.5) for (let lon = -176; lon < 180; lon += 7.5) {
          const f = flowAt(flow, lat, lon, t);
          if (!f) continue;
          const [x, y] = vw.toPixel(lat, lon), k = (W / 1024) * 0.35;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + f.u * k, y - f.v * k); g.stroke();
        }
      }
      const heard = new Set(active.map((v) => v.id));
      for (const v of data.frames[t] || []) {
        const [x, y] = vw.toPixel(v.lat, v.lon);
        const rpx = Math.max(4, (v.r / 40030) * W / Math.max(0.2, Math.cos((v.lat * Math.PI) / 180)));
        const cw = trackById.get(v.id)?.direction === 'cw';
        const ang = (cw ? -1 : 1) * sec * (2 * Math.PI) / loopSeconds(ranks.spin(v.spin));
        g.strokeStyle = cw ? '#ff4fd8' : '#4fff8a'; g.lineWidth = heard.has(v.id) ? 3 : 1.5;
        g.globalAlpha = solo && solo.id !== v.id && solo.until > sec ? 0.3 : 1;
        g.beginPath(); g.arc(x, y, rpx, -ang, -ang + Math.PI * 1.6); g.stroke();   // canvas y is down: negate for ccw
      }
      g.restore();
    });
    let raf = 0;
    const spin = () => { viewer.redraw(); if (alive) raf = requestAnimationFrame(spin); };
    raf = requestAnimationFrame(spin);

    active = activeVortices(data, ranks, time.now(), s.maxVoices, trackById);
    soundHint(panel, sound, 'press Play vortices. Without sound, vortices are still described.');
    describe(`Vortex melodies ready: ${data.tracks.length} tracked vortices. Press Play vortices, or move over the map with the arrow keys to find and solo a vortex.`);
    return () => { offFrame(); offHover(); offClick(); offState(); clearInterval(sched); removeOverlay(); cancelAnimationFrame(raf); };
  }

  return () => { alive = false; setup?.(); };
}
