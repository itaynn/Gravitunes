// Vortex melodies: each tracked vortex (analysis/scripts/vortex-melodies/build.py) loops a short motif.
// Loop speed <- spin rank, loudness <- strength x size rank, pan <- longitude, ccw rising / cw falling,
// timbre <- world-orchestra region at the center. A soft bed follows net convergence of the flow.
import { loadFlow, rankNormaliser, layerByPrefix, drawFlowArrows } from '../../core/flow.js';
import { scaleFreqs, noteHz, snapToScale } from '../../core/scales.js';
import { scaleControl } from '../../core/scale-control.js';
import { shapeForPitch, pickVoice } from '../../core/voices.js';
import { voiceAt, distKm, compass, formatLatLon } from '../../core/geo.js';
import { getJson, loadEarth } from '../../core/data.js';
import { volumeSlider, timbreControl, fold } from '../../core/ui.js';
import { createBackdrop } from '../../core/svs-frames.js';
import { motifFreq, MOTIFS, orient, buildRanks, loopSeconds, motifIndex, activeVortices, convergence, periodText, dueNotes, nearestText, TUNE_LOW, TUNE_HIGH, markTurn } from './vortex.js';

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
    const flow = layerByPrefix(layers, 'flow_');
    const div = layerByPrefix(layers, 'divergence_');
    const ranks = buildRanks(data);
    const trackById = new Map(data.tracks.map((t) => [t.id, t]));
    // Net convergence per frame is small (about -0.1..0.1 on 4285), so the bed follows its rank over the sequence.
    const rawBed = Array.from({ length: data.frames.length }, (_, t) => convergence(div, t));
    const bedRank = rankNormaliser(rawBed);
    const bedByFrame = rawBed.map((c) => 2 * bedRank(c) - 1);
    const instIds = Object.keys(instruments);
    const instLabel = (id) => instruments[id]?.label || id;
    // Recorded samples for every instrument; until loaded (or on the built-in synth) notes are synthesized.
    sound.loadSamples?.(Object.values(instruments).map((v) => v.sample).filter(Boolean));
    const centerIndex = new Map(centers.map((c, i) => [c.id, i]));

    const s = {
      scale: 'pentatonic-minor', timbre: 'region', single: instIds[0], melody: 'size',
      bed: true, arrows: false, volume: 0.6,
    };
    const backdrop = createBackdrop(dir, { viewer, time });
    // vortex id -> { t0, loop, mi }: loop origin (performance clock, s), loop length, motif index. Kept for the
    // track's life so its melody and its rotating mark never restart; a loop-length change keeps the position.
    const phase = new Map();
    let active = [], soloId = null;    // soloId: only this vortex plays (click / Enter toggles, Escape clears)
    let clock = performance.now() / 1000;   // animation clock; frozen while stopped

    const tones = () => scaleFreqs(s.scale, noteHz(TUNE_LOW), noteHz(TUNE_HIGH));   // the tunes: C4..E6
    const bedTones = () => scaleFreqs(s.scale, noteHz(-12), noteHz(0));             // the hum: C3..C4
    function loopOf(v, now) {
      const loop = loopSeconds(v.spinRank);
      let p = phase.get(v.id);
      if (!p) {
        const mi = motifIndex(s.melody, { sizeRank: v.sizeRank, regionIndex: centerIndex.get(voiceFor(v).center.id) || 0,
          lifetimeRank: ranks.lifetime(v.track?.frames ?? 0) });
        p = { t0: now, loop, mi }; phase.set(v.id, p);
      } else if (Math.abs(p.loop - loop) > 1e-6) {
        p.t0 = now - ((now - p.t0) / p.loop) * loop; p.loop = loop;
      }
      return p;
    }
    function voiceFor(v) {
      const region = voiceAt(v.lat, v.lon, centers, instruments, 900);
      if (s.timbre === 'region') return { voice: region.voice, name: instLabel(region.primary.instrument), center: region.primary, sample: instruments[region.primary.instrument]?.sample };
      const pickBy = s.timbre === 'size' ? v.sizeRank : s.timbre === 'strength' ? ranks.strength(v.circ * v.r) : null;
      const id = pickBy == null ? s.single : pickVoice(instIds, pickBy);
      return { voice: instruments[id], name: instLabel(id), center: region.primary, sample: instruments[id]?.sample };
    }
    function motifOf(v) {
      const m = MOTIFS[loopOf(v, clock).mi];
      return { ...m, steps: orient(m.steps, v.track?.direction || 'ccw') };
    }
    function playStep(v, k, at, ampScale = 1) {
      const { voice, sample } = voiceFor(v);
      const m = motifOf(v);
      const freq = motifFreq(tones(), noteHz(m.root), m.steps[k % m.steps.length], voice.octave || 0);
      const sh = shapeForPitch(voice, freq);
      const step = loopOf(v, clock).loop / m.steps.length;
      sound.play({ freq, amp: 0.4 * v.loud * ampScale, pan: v.lon / 180, t: Math.max(0, at - performance.now() / 1000),
        dur: Math.min(sh.dur ?? 0.4, step * 0.9), sample, harmonics: sh.harmonics, partials: sh.partials, envelope: sh.envelope, noise: sh.noise,
        vibrato: sh.vibrato, wah: sh.wah });
    }

    // ---- scheduler: notes due in the next 150 ms. All vortices play; a soloed one plays alone.
    let lastTick = performance.now() / 1000;
    const sched = setInterval(() => {
      const now = performance.now() / 1000, to = now + 0.15;
      if (time.playing) {
        const list = soloId != null ? active.filter((v) => v.id === soloId) : active;
        const n = Math.max(1, list.length);
        for (const v of list) {
          const p = loopOf(v, now), steps = MOTIFS[p.mi].steps.length;
          for (const { k, at } of dueNotes(steps, p.loop, p.t0, lastTick, to)) playStep(v, k, at, soloId != null ? 1 : 1.5 / Math.sqrt(n));
        }
      }
      lastTick = to;
    }, 100);

    // ---- frames
    let pausedTimer = 0;
    const offFrame = time.onFrame((t) => {
      active = activeVortices(data, ranks, t, Infinity, trackById);
      const ids = new Set(active.map((v) => v.id));
      for (const id of phase.keys()) if (!ids.has(id)) phase.delete(id);
      if (soloId != null && !ids.has(soloId)) { soloId = null; describe('The soloed vortex has faded; all vortices play again.'); }
      if (time.playing && s.bed) {
        const c = bedByFrame[t] || 0, frameDur = 1 / Math.max(0.1, time.fps || 2);
        // Convergence swells and brightens (more upper harmonics); divergence thins. Soft pad on the scale's
        // root (C3) and the scale tone nearest G3, re-struck each frame, under the tunes.
        const bed = bedTones(), b = (c + 1) / 2;
        for (const freq of [bed[0], snapToScale(noteHz(-5), bed)]) {
          sound.play({ freq, amp: 0.03 + 0.1 * b, pan: 0, dur: frameDur * 1.3,
            harmonics: [1, 0.3 + 0.3 * b, 0.1 + 0.25 * b, 0.1 * b], envelope: { attack: frameDur * 0.4, decay: 0.2, sustain: 0.9, release: frameDur } });
        }
      }
      // Debounced so scrubbing does not flood the live region; one merged message after the host's "Paused at".
      clearTimeout(pausedTimer);
      if (!time.playing) pausedTimer = setTimeout(() => {
        if (alive && !time.playing) describe(`Paused at ${time.label()}: ${(data.frames[t] || []).length} vortices; ${bedText(t)}.`);
      }, 400);
      viewer.redraw();
    });
    const bedText = (t) => {
      const c = bedByFrame[t] || 0;
      return c > 0.4 ? 'more converging than usual' : c < -0.4 ? 'more spreading out than usual' : 'converging and spreading about usual';
    };

    // ---- controls: Play (host bar; the core starts audio on that click); Scale and Volume in the bar; a few extras in More.
    scaleControl(panel, { value: s.scale, describe, sound, onChange: (v) => { s.scale = v; } });
    volumeSlider(panel, sound, s.volume, (v) => { s.volume = v; });
    const legend = document.createElement('p');
    legend.className = 'hint';
    legend.innerHTML = '<span aria-hidden="true" style="color:#2fd16a;font-weight:bold">&#9711;</span> counterclockwise (tune rises) '
      + '&nbsp;<span aria-hidden="true" style="color:#ff4fd8;font-weight:bold">&#9711;</span> clockwise (tune falls). '
      + 'The dot goes round once per tune. A low hum swells where rain converges.';
    const bedCb = panel.checkbox('Hum', s.bed, (v) => { s.bed = v; });
    bedCb.setAttribute('aria-label', 'Convergence hum (low pad) on or off');
    const timbre = timbreControl(panel, { options: [['region', 'By region'], ['size', 'By size'], ['strength', 'By strength'], ['single', 'One voice']],
      value: s.timbre, single: s.single, instruments, onChange: (t) => Object.assign(s, t) });
    const arrowsCb = panel.checkbox('Arrows', s.arrows, (v) => { s.arrows = v; viewer.redraw(); });
    arrowsCb.setAttribute('aria-label', 'Show flow arrows');
    const more = fold('More', [bedCb, timbre.timbre, timbre.single, arrowsCb]);
    more.before(legend);
    const offPlay = time.onPlayState((p) => {
      const now = performance.now() / 1000;
      if (!p) sound.stopAll(); else for (const q of phase.values()) q.t0 += now - clock;   // resume where the marks stopped
      clock = now;
    });
    const hostBar = document.getElementById('colorbar');
    if (hostBar) hostBar.hidden = true;
    const bars = document.createElement('div');
    (hostBar || viewer.canvas).after(bars);
    backdrop.colorbars().then((ims) => { if (alive) bars.append(...ims); });

    // ---- click / Enter: solo the vortex there (again, or Escape: back to all). Mouse hover is silent.
    const vortexText = (v) => {
      const dirTxt = v.track?.direction === 'cw' ? 'clockwise' : 'counterclockwise';
      return `vortex ${v.id}, ${dirTxt}, ${periodText(v.spin)} (spins faster than ${Math.round(v.spinRank * 100)} percent of vortices), ${Math.round(v.r * 2 / 50) * 50} km wide, ${voiceFor(v).name}-inspired`;
    };
    function hit(lat, lon) {
      let best = null, bestD = Infinity;
      for (const v of active) { const d = distKm(lat, lon, v.lat, v.lon); if (d < v.r + 400 && d < bestD) { bestD = d; best = v; } }
      return best;
    }
    function unsolo() {
      if (soloId == null) return;
      soloId = null; viewer.redraw();
      describe(`All ${active.length} vortices playing.`);
    }
    function onKeyMove({ lat, lon, keyboard }) {
      if (!keyboard) return;
      const v = hit(lat, lon);
      describe(`${formatLatLon(lat, lon)}: ${v ? `${vortexText(v)}. Press Enter to solo it` : nearestText(lat, lon, active, distKm, compass)}.`);
    }
    function onSelect({ lat, lon }) {
      const v = hit(lat, lon);
      if (!v) { describe(`No vortex here. ${active.length} vortices at ${time.label()}.${soloId != null ? ' Press Escape to hear all again.' : ''}`); return; }
      if (soloId === v.id) { unsolo(); return; }
      soloId = v.id; viewer.redraw();
      describe(`Solo: ${vortexText(v)}. ${time.playing ? '' : 'Press Play to hear it. '}Select it again or press Escape to hear all.`);
    }
    const onEsc = (e) => { if (e.key === 'Escape' && soloId != null) unsolo(); };
    document.addEventListener('keydown', onEsc);
    const offHover = input.onHover(onKeyMove);
    const offClick = input.onClick(onSelect);

    // ---- visuals: rotating rings sized by radius, green = ccw, magenta = cw
    const removeOverlay = viewer.addOverlay((g, vw) => {
      const W = vw.canvas.width, t = time.now();
      if (time.playing) clock = performance.now() / 1000;
      const sec = clock;
      g.save();
      backdrop.draw(g, vw);
      if (s.arrows) drawFlowArrows(g, vw, flow, t, { heads: false });
      const ph = backdrop.phase(), nextPos = new Map((data.frames[(t + 1) % data.frames.length] || []).map((n) => [n.id, n]));
      const byId = new Map(active.map((v) => [v.id, v]));
      let soloAt = null;
      for (const v of data.frames[t] || []) {
        // Glide toward the same vortex's next position while playing (no jump at the date line).
        const nx = nextPos.get(v.id);
        const dLon = nx ? ((nx.lon - v.lon + 540) % 360) - 180 : 0;
        const [x, y] = vw.toPixel(nx ? v.lat + (nx.lat - v.lat) * ph : v.lat, nx ? v.lon + dLon * ph : v.lon);
        const rpx = Math.max(4, (v.r / 40030) * W / Math.max(0.2, Math.cos((v.lat * Math.PI) / 180)));
        const cw = trackById.get(v.id)?.direction === 'cw', col = cw ? '#ff4fd8' : '#2fd16a';
        const av = byId.get(v.id), isSolo = soloId === v.id;
        // Mark position: one full turn per melody, landing on note k's tick as note k sounds.
        const p = av ? loopOf(av, sec) : null, n = p ? MOTIFS[p.mi].steps.length : 1;
        const turn = p ? markTurn((sec - p.t0) / (p.loop / n), n) : 0;
        // Canvas y is down: counterclockwise = decreasing angle. Start at the top.
        const toXY = (fr) => { const a = (cw ? 1 : -1) * fr * 2 * Math.PI - Math.PI / 2; return [x + rpx * Math.cos(a), y + rpx * Math.sin(a)]; };
        g.globalAlpha = soloId != null && !isSolo ? 0.3 : 1;
        const lw = isSolo ? 4 : 2;
        if (isSolo) { g.strokeStyle = '#fff'; g.lineWidth = lw + 6; g.beginPath(); g.arc(x, y, rpx, 0, 2 * Math.PI); g.stroke(); soloAt = [x, y, rpx]; }
        // Black outline under each ring keeps it visible on the light map.
        for (const [style, w] of [['#000', lw + 2], [col, lw]]) {
          g.strokeStyle = style; g.lineWidth = w;
          g.beginPath(); g.arc(x, y, rpx, 0, 2 * Math.PI); g.stroke();
        }
        // Note ticks, then the orbiting dot.
        g.fillStyle = '#000';
        for (let k = 0; k < n; k++) { const [tx, ty] = toXY(k / n); g.fillRect(tx - 1.5, ty - 1.5, 3, 3); }
        const [dx, dy] = toXY(turn), dr = Math.max(3.5, lw + 2);
        g.beginPath(); g.arc(dx, dy, dr + 1.5, 0, 2 * Math.PI); g.fillStyle = '#000'; g.fill();
        g.beginPath(); g.arc(dx, dy, dr, 0, 2 * Math.PI); g.fillStyle = isSolo ? '#fff' : col; g.fill();
      }
      g.globalAlpha = 1;
      if (soloAt) {
        const [x, y, r] = soloAt;
        g.font = 'bold 14px system-ui, sans-serif'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = '#000'; g.fillStyle = '#fff';
        g.strokeText('SOLO', x, y - r - 10); g.fillText('SOLO', x, y - r - 10);
      }
      g.restore();
    });
    let raf = 0;
    const spin = () => { viewer.redraw(); if (alive) raf = requestAnimationFrame(spin); };
    raf = requestAnimationFrame(spin);

    active = activeVortices(data, ranks, time.now(), Infinity, trackById);
    describe(`Vortex melodies ready: ${data.tracks.length} tracked vortices. Press Play to hear them all; select one on the map (click, or arrow keys then Enter) to solo it.`);
    return () => {
      offFrame(); offPlay(); document.removeEventListener('keydown', onEsc); offHover(); offClick(); clearInterval(sched); clearTimeout(pausedTimer); removeOverlay(); cancelAnimationFrame(raf);
      more.remove(); legend.remove(); bars.remove(); backdrop.dispose(); if (hostBar) hostBar.hidden = false;
    };
  }

  return () => { alive = false; setup?.(); };
}
