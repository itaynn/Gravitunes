// Vortex melodies: each tracked vortex (analysis/scripts/vortex-melodies/build.py) loops a short motif. One dataset at a
// time (Data menu: IMERG rain, or GEOS-CF ozone, carbon monoxide, nitrogen oxides); each has its own vortex analysis.
// Pitch / volume / tempo / notes each take a source (menus: size, strength, spin speed or nothing); spin direction can turn the tune up/down; pan <- longitude,
// instrument (and ring colour) <- world-orchestra region at the center. A soft bed follows net convergence of the flow.
import { loadFlow, rankNormaliser, layerByPrefix, drawFlowArrows, flowAt, advect } from '../../core/flow.js';
import { scaleFreqs, noteHz, snapToScale } from '../../core/scales.js';
import { scaleControl } from '../../core/scale-control.js';
import { rangeControl } from '../../core/range-control.js';
import { shapeForPitch } from '../../core/voices.js';
import { voiceAt, distKm, compass, formatLatLon, centerColors } from '../../core/geo.js';
import { getJson, loadEarth } from '../../core/data.js';
import { volumeSlider, createPanel } from '../../core/ui.js';
import { createBackdrop, plainBackdrop } from '../../core/svs-frames.js';
import { fieldOf, rainText } from '../../core/fields.js';
import { motifFreq, motifSteps, orient, buildRanks, activeVortices, mapped, DEFAULT_MAP, convergence, periodText, dueNotes, nearestText, TUNE_LOW, TUNE_HIGH, markTurn, HOTSPOT_MAP } from './vortex.js';
import { buildHotspots } from './hotspots.js';

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe, viewer } = ctx;
  let alive = true, setup = null;
  const field = fieldOf(dataset), NAME = field.name;
  // The mode's own copy of the dataset (mode.json datasetDirs) also holds the flow layers and vortices.
  const dir = new URL(dataset.dir, location.href);
  (async () => {
    const [flowData, vort, mj, ij] = await Promise.all([
      loadFlow(dir), getJson(new URL('vortices.json', dir)),
      loadEarth('musical-centers'), loadEarth('instruments'),
    ]);
    if (!alive) return;
    setup = run(flowData, vort, mj.centers, ij.instruments);
  })().catch((e) => { console.error(e); describe(`Vortex melodies could not load the swirls in ${NAME}: ${e.message}`); });

  function run({ layers }, vortData, centers, instruments) {
    const flow = layerByPrefix(layers, 'flow_');
    const div = layerByPrefix(layers, 'divergence_');
    // Track: vortices (offline, vortices.json) or hotspots (strong-value clusters, found here on first use).
    let data = vortData, ranks = buildRanks(data), trackById = new Map(data.tracks.map((t) => [t.id, t])), hotData = null;
    let kind = 'vortices';
    const hot = () => kind === 'hotspots';
    const one = () => (hot() ? 'hotspot' : 'vortex'), many = () => (hot() ? 'hotspots' : 'vortices');
    // Net convergence per frame is small (about -0.1..0.1 on 4285), so the bed follows its rank over the sequence.
    const rawBed = Array.from({ length: vortData.frames.length }, (_, t) => convergence(div, t));
    const bedRank = rankNormaliser(rawBed);
    const bedByFrame = rawBed.map((c) => 2 * bedRank(c) - 1);
    const instLabel = (id) => instruments[id]?.label || id;
    // Recorded samples for every instrument; until loaded (or on the built-in synth) notes are synthesized.
    sound.loadSamples?.(Object.values(instruments).map((v) => v.sample).filter(Boolean));
    const centerIndex = new Map(centers.map((c, i) => [c.id, i]));
    const colorOf = centerColors(centers);   // same colours as World orchestra / Tone lab

    const s = {
      scale: 'pentatonic-minor', map: { ...DEFAULT_MAP },
      bed: false, arrows: false, streams: false, volume: 0.6,
    };
    const backdrop = field.rain ? createBackdrop(dir, { viewer, time }) : plainBackdrop({ time });
    // vortex id -> { t0, loop, root, n }: loop origin (performance clock, s), loop length, motif root, notes per loop. Kept for the
    // track's life so its melody and its rotating mark never restart; a loop-length change keeps the position.
    const phase = new Map();
    let active = [], soloId = null;    // soloId: only this vortex plays (click / Enter toggles, Escape clears)
    let clock = performance.now() / 1000;   // animation clock; frozen while stopped

    let range = { low: TUNE_LOW, high: TUNE_HIGH };   // Low / High menus
    const tones = () => scaleFreqs(s.scale, noteHz(range.low), noteHz(range.high));          // the tunes
    const bedTones = () => scaleFreqs(s.scale, noteHz(range.low), noteHz(range.low + 12));    // the hum: lowest octave
    function loopOf(v, now) {
      const { loop, root, n } = mapped(v, s.map, range);
      let p = phase.get(v.id);
      if (!p) {
        p = { t0: now, loop, root, n }; phase.set(v.id, p);
      } else if (Math.abs(p.loop - loop) > 1e-6) {
        p.t0 = now - ((now - p.t0) / p.loop) * loop; p.loop = loop;
      }
      return p;
    }
    function voiceFor(v) {
      const region = voiceAt(v.lat, v.lon, centers, instruments, 900);
      return { drone: !!instruments[region.primary.instrument]?.drone, voice: region.voice, name: instLabel(region.primary.instrument), center: region.primary, sample: instruments[region.primary.instrument]?.sample, color: colorOf.get(region.primary.id) };
    }
    function motifOf(v) {
      const p = loopOf(v, clock), steps = motifSteps(p.n);
      return { root: p.root, steps: s.map.direction === 'updown' ? orient(steps, v.track?.direction || 'ccw') : steps };
    }
    function playStep(v, k, at, ampScale = 1) {
      const { voice, sample } = voiceFor(v);
      const m = motifOf(v);
      const freq = motifFreq(tones(), noteHz(m.root), m.steps[k % m.steps.length], voice.octave || 0);
      const sh = shapeForPitch(voice, freq);
      // Detached notes (about half a step, quick fade): bowed, blown and whale recordings otherwise join into one held moan.
      const step = loopOf(v, clock).loop / m.steps.length;
      sound.play({ freq, amp: 0.4 * mapped(v, s.map, range).loud * ampScale, pan: v.lon / 180, t: Math.max(0, at - performance.now() / 1000),
        dur: Math.min(sh.dur ?? 0.4, step * 0.55), fade: Math.min(0.08, step * 0.25), sample, harmonics: sh.harmonics, partials: sh.partials, envelope: sh.envelope, noise: sh.noise,
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
          const p = loopOf(v, now), steps = p.n;
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
      updateLegend(active);
      for (const id of phase.keys()) if (!ids.has(id)) phase.delete(id);
      if (soloId != null && !ids.has(soloId)) { soloId = null; describe(`The soloed ${one()} has faded; all ${many()} play again.`); }
      if (time.playing && s.bed) {
        const c = bedByFrame[t] || 0, frameDur = 1 / Math.max(0.1, time.fps || 2);
        // Convergence swells and brightens (more upper harmonics); divergence thins. Soft pad on the scale's
        // root (bottom of the range) and the tone a fifth up, re-struck each frame, under the tunes.
        const bed = bedTones(), b = (c + 1) / 2;
        for (const freq of [bed[0], snapToScale(noteHz(range.low + 7), bed)]) {
          sound.play({ freq, amp: 0.03 + 0.1 * b, pan: 0, dur: frameDur * 1.3,
            harmonics: [1, 0.3 + 0.3 * b, 0.1 + 0.25 * b, 0.1 * b], envelope: { attack: frameDur * 0.4, decay: 0.2, sustain: 0.9, release: frameDur } });
        }
      }
      // Drone only for drone-based traditions (instrument "drone": true): a soft held root under that vortex's tune.
      if (time.playing) {
        const frameDur = 1 / Math.max(0.1, time.fps || 2), list = soloId != null ? active.filter((v) => v.id === soloId) : active;
        const droned = new Set();
        for (const v of list) {
          if (!voiceFor(v).drone) continue;
          const freq = snapToScale(noteHz(motifOf(v).root) / 2, bedTones());
          const key = `${Math.round(freq)}|${Math.round(v.lon / 30)}`;
          if (droned.has(key)) continue;
          droned.add(key);
          sound.play({ freq, amp: 0.04 * mapped(v, s.map, range).loud, pan: v.lon / 180, dur: frameDur * 1.3,
            harmonics: [1, 0.4, 0.2, 0.1], envelope: { attack: frameDur * 0.4, decay: 0.2, sustain: 0.9, release: frameDur } });
        }
      }
      // Debounced so scrubbing does not flood the live region; one merged message after the host's "Paused at".
      clearTimeout(pausedTimer);
      if (!time.playing) pausedTimer = setTimeout(() => {
        if (alive && !time.playing) describe(`Paused at ${time.label()}: ${(data.frames[t] || []).length} ${many()}; ${bedText(t)}.`);
      }, 400);
      viewer.redraw();
    });
    const bedText = (t) => {
      const c = bedByFrame[t] || 0;
      return c > 0.4 ? 'more converging than usual' : c < -0.4 ? 'more spreading out than usual' : 'converging and spreading about usual';
    };

    // ---- controls: Play (host bar; the core starts audio on that click); Scale and Volume in the bar; a few extras in More.
    scaleControl(panel, { value: s.scale, describe, sound, onChange: (v) => { s.scale = v; } });
    range = rangeControl(panel, { describe, onChange: () => phase.clear() });
    volumeSlider(panel, sound, s.volume, (v) => { s.volume = v; });
    const legend = document.createElement('p');
    legend.className = 'hint';
    const legendList = document.createElement('span'), legendNote = document.createElement('span');
    const noteText = () => hot()
      ? ` Ring colour = instrument; the filled blob is a hotspot (its size = area). The dot goes round once per tune. Drone only under drone-tradition instruments (sitar, bagpipe, didgeridoo...). Hum adds a low hum where ${NAME} converges. Arrows show which way the ${NAME} is moving (longer, brighter = faster).`
      : ` Ring colour = instrument. The dot goes round once per tune (its direction is the spin). Drone only under drone-tradition instruments (sitar, bagpipe, didgeridoo...). Hum adds a low hum where ${NAME} converges. Arrows show which way the ${NAME} is moving (longer, brighter = faster).`;
    legendNote.textContent = noteText();
    legend.append(legendList, legendNote);
    let legendKey = null;
    function updateLegend(vs) {
      const seen = new Map();
      for (const v of vs) { const f = voiceFor(v); if (!seen.has(f.name)) seen.set(f.name, f.color); }
      const key = [...seen.keys()].join('|');
      if (key === legendKey) return;
      legendKey = key; legendList.replaceChildren();
      for (const [name, col] of seen) {
        const sw = document.createElement('span');
        sw.setAttribute('aria-hidden', 'true'); sw.style.cssText = `color:${col};font-weight:bold`; sw.textContent = '\u25CF ';
        const it = document.createElement('span'); it.style.marginRight = '.7em'; it.append(sw, name);
        legendList.append(it);
      }
      if (!seen.size) legendList.textContent = `No ${many()} on screen.`;
    }
    // Sound and view options sit right in the control bar (after Play / Data), not in a fold: one word each.
    const barBox = document.createElement('div'); barBox.className = 'bar-item';
    const picker = document.getElementById('dataset-picker');
    if (picker) picker.after(barBox);
    const opts = picker ? createPanel(barBox) : panel;
    const bedCb = opts.checkbox('Hum', s.bed, (v) => { s.bed = v; });
    bedCb.setAttribute('aria-label', 'Convergence hum (low pad) on or off');
    // Mapping menus: where each sound property gets its value. A new mapping restarts the tunes.
    const VORT_OPTS = [['nothing', 'Nothing'], ['size', 'Size'], ['strength', 'Strength'], ['spin', 'Spin speed']];
    const HOT_OPTS = [['nothing', 'Nothing'], ['size', 'Size'], ['strength', 'Intensity'], ['spin', 'Peak']];
    const srcOpts = () => (hot() ? HOT_OPTS : VORT_OPTS);
    const trackSel = opts.select('Track', [['vortices', 'Vortices'], ['hotspots', 'Hotspots']], (val) => setKind(val), { value: kind });
    trackSel.setAttribute('aria-label', 'Track vortices (swirls) or hotspots (strongest clusters)');
    const SOUND_NAMES = { pitch: 'Pitch', volume: 'Volume', tempo: 'Tempo', notes: 'Notes' };
    const hints = (key) => (hot() && key === 'pitch' ? 'bigger = higher' : HINTS[key]);
    const HINTS = { pitch: 'bigger = lower', volume: 'bigger = louder', tempo: 'bigger = faster', notes: 'bigger = more notes, 3 to 8' };
    const FIXED = { pitch: 'fixed middle pitch', volume: 'fixed volume', tempo: 'fixed tempo', notes: 'fixed at 5 notes' };
    const srcSel = (key) => opts.select(`${SOUND_NAMES[key]} \u2190`, VORT_OPTS, (val) => {
      s.map[key] = val; phase.clear();
      const label = srcOpts().find((o) => o[0] === val)[1].toLowerCase();
      describe(val === 'nothing' ? `${SOUND_NAMES[key]}: ${FIXED[key]}.` : `${SOUND_NAMES[key]} now follows ${label} (${hints(key)}).`);
    }, { value: s.map[key] });
    const mapSels = ['pitch', 'volume', 'tempo', 'notes'].map(srcSel);
    const srcSels = mapSels.slice();
    mapSels.unshift(trackSel);
    const spinSel = opts.select('Spin \u2192', [['nothing', 'Nothing'], ['updown', 'Tune up/down']], (val) => {
      s.map.direction = val; phase.clear();
      describe(val === 'updown' ? 'Spin direction now turns the tune up (counterclockwise) or down (clockwise).' : 'Spin direction now controls nothing.');
    }, { value: s.map.direction });
    mapSels.push(spinSel);
    function setKind(val) {
      if (val === kind) return;
      kind = val;
      if (hot() && !hotData) {
        const n = vortData.frames.length;
        hotData = buildHotspots((lat, lon, t) => field.level(lat, lon, t), n);
      }
      data = hot() ? hotData : vortData;
      ranks = buildRanks(data); trackById = new Map(data.tracks.map((t) => [t.id, t]));
      s.map = hot() ? { ...HOTSPOT_MAP } : { ...DEFAULT_MAP };
      phase.clear(); soloId = null; legendKey = null;
      ['pitch', 'volume', 'tempo', 'notes'].forEach((key, i) => {
        const sel = srcSels[i];
        srcOpts().forEach(([, txt], j) => { sel.options[j].text = txt; });
        sel.value = s.map[key];
      });
      spinSel.value = s.map.direction;
      const spinRow = spinSel.closest('.control'); if (spinRow) spinRow.hidden = hot();
      legendNote.textContent = noteText();
      active = activeVortices(data, ranks, time.now(), Infinity, trackById);
      updateLegend(active); viewer.redraw();
      describe(hot()
        ? `Tracking hotspots: the strongest ${NAME} clusters, ${active.length} now, ${data.tracks.length} over the sequence. Pitch follows intensity (stronger = higher), volume follows size, tempo follows peak.`
        : `Tracking vortices: ${active.length} swirls now. Pitch follows size, volume strength, tempo spin speed.`);
    }
    const arrowsCb = opts.checkbox('Arrows', s.arrows, (v) => { s.arrows = v; viewer.redraw(); });
    arrowsCb.setAttribute('aria-label', `Flow arrows: which way the ${NAME} is moving`);
    const streamsCb = opts.checkbox('Streams', s.streams, (v) => {
      s.streams = v; parts = v ? Array.from({ length: NPARTS }, () => spawnPart({}, true)) : [];
      viewer.redraw(); describe(v ? `Streams on: faint lines follow the ${NAME} motion.` : 'Streams off.');
    });
    streamsCb.setAttribute('aria-label', `Show streamlines of the ${NAME} motion`);
    (document.getElementById('mode-controls') || barBox).prepend(legend);
    for (const el of [...mapSels, bedCb, arrowsCb, streamsCb]) {
      const row = el.closest('.control'); if (row) barBox.append(row);
    }
    const offPlay = time.onPlayState((p) => {
      const now = performance.now() / 1000;
      if (!p) sound.stopAll(); else for (const q of phase.values()) q.t0 += now - clock;   // resume where the marks stopped
      clock = now;
    });
    // Rain: the NASA colour bars replace the host's generic one (gases keep the host's).
    const hostBar = field.rain ? document.getElementById('colorbar') : null;
    if (hostBar) hostBar.hidden = true;
    const bars = document.createElement('div');
    (hostBar || document.getElementById('colorbar') || viewer.canvas).after(bars);
    backdrop.colorbars().then((ims) => { if (alive) bars.append(...ims); });

    // ---- click / Enter: solo the vortex there (again, empty map, or Escape: back to all). Mouse hover is silent.
    const vortexText = (v) => {
      if (hot()) return `hotspot ${v.id}, playing ${voiceFor(v).name}, about ${Math.round(v.area / 1e4) * 1e4} square km, intensity ${field.rain ? rainText(v.mean) : `${Math.round(v.mean * 100)} percent`}, peak ${field.rain ? rainText(v.peak) : `${Math.round(v.peak * 100)} percent`} (stronger than ${Math.round(v.strengthRank * 100)} percent of hotspots)`;
      const dirTxt = v.track?.direction === 'cw' ? 'clockwise' : 'counterclockwise';
      return `vortex ${v.id}, playing ${voiceFor(v).name}, ${dirTxt}, ${periodText(v.spin)} (spins faster than ${Math.round(v.spinRank * 100)} percent of vortices), ${Math.round(v.r * 2 / 50) * 50} km wide`;
    };
    function hit(lat, lon) {
      let best = null, bestD = Infinity;
      for (const v of active) { const d = distKm(lat, lon, v.lat, v.lon); if (d < v.r + 400 && d < bestD) { bestD = d; best = v; } }
      return best;
    }
    function unsolo() {
      if (soloId == null) return;
      soloId = null; viewer.redraw();
      describe(`All ${active.length} ${many()} playing.`);
    }
    function onKeyMove({ lat, lon, keyboard }) {
      if (!keyboard) return;
      const v = hit(lat, lon);
      describe(`${formatLatLon(lat, lon)}: ${v ? `${vortexText(v)}. Press Enter to solo it` : nearestText(lat, lon, active, distKm, compass).replace(/vortex/g, one())}.`);
    }
    function onSelect({ lat, lon }) {
      const v = hit(lat, lon);
      if (!v) { if (soloId != null) unsolo(); else describe(`No ${one()} here. ${active.length} ${many()} at ${time.label()}.`); return; }
      if (soloId === v.id) { unsolo(); return; }
      soloId = v.id; viewer.redraw();
      describe(`Solo: ${vortexText(v)}. ${time.playing ? '' : 'Press Play to hear it. '}Select it again or press Escape to hear all.`);
    }
    const onEsc = (e) => { if (e.key === 'Escape' && soloId != null) unsolo(); };
    document.addEventListener('keydown', onEsc);
    const offHover = input.onHover(onKeyMove);
    const offClick = input.onClick(onSelect);

    // ---- streams: faint particles advected by the optical-flow field, drawn as short fading tails (under the rings).
    const NPARTS = 700, KEEP = 18, STEP = 0.1, HOURS = 1.2;
    let parts = [], acc = 0, lastStep = performance.now();
    function spawnPart(p, scatterAge = false) {
      const t = time.now();
      let lat = 0, lon = 0;
      for (let k = 0; k < 20; k++) {
        lat = (Math.asin(Math.random() * 2 - 1) * 180) / Math.PI * 0.85; lon = Math.random() * 360 - 180;
        if (flowAt(flow, lat, lon, t)) break;
      }
      const life = 30 + Math.random() * 40;
      return Object.assign(p, { lat, lon, hist: [], idle: 0, life, age: scatterAge ? Math.random() * life : 0 });
    }
    function stepParts() {
      const t = time.now();
      for (const p of parts) {
        p.hist.push(p.lat, p.lon);
        if (p.hist.length > KEEP * 2) p.hist.splice(0, 2);
        const f = flowAt(flow, p.lat, p.lon, t);
        p.age++;
        if (!f) { if (++p.idle > 10) spawnPart(p); continue; }
        p.idle = 0;
        const n = advect(p.lat, p.lon, f.u, f.v, HOURS);
        p.lat = n.lat; p.lon = n.lon;
        if (p.age > p.life) spawnPart(p);
      }
    }
    function drawStreams(g, vw) {
      const now = performance.now();
      acc += Math.min(0.25, (now - lastStep) / 1000); lastStep = now;
      while (acc >= STEP) { stepParts(); acc -= STEP; }
      const W = vw.canvas.width, bands = 3;
      g.lineWidth = Math.max(0.6, W / 1800); g.lineCap = 'round';
      for (let b = 0; b < bands; b++) {
        g.strokeStyle = `rgba(235,245,255,${0.45 * ((b + 1) / bands) ** 1.5})`; g.beginPath();
        for (const p of parts) {
          const h = p.hist, n = h.length / 2; if (n < 2) continue;
          const i0 = Math.floor((b * n) / bands), i1 = Math.floor(((b + 1) * n) / bands);
          let prev = vw.toPixel(h[i0 * 2], h[i0 * 2 + 1]);
          for (let i = i0 + 1; i <= i1; i++) {
            const cur = i < n ? vw.toPixel(h[i * 2], h[i * 2 + 1]) : vw.toPixel(p.lat, p.lon);
            if (Math.abs(cur[0] - prev[0]) < W / 2) { g.moveTo(prev[0], prev[1]); g.lineTo(cur[0], cur[1]); }
            prev = cur;
          }
        }
        g.stroke();
      }
    }

    // ---- visuals: rotating rings sized by radius, coloured by instrument; the dot's direction shows spin
    const removeOverlay = viewer.addOverlay((g, vw) => {
      const W = vw.canvas.width, t = time.now();
      if (time.playing) clock = performance.now() / 1000;
      const sec = clock;
      g.save();
      backdrop.draw(g, vw);
      if (s.arrows) {   // bold arrows on a coarse grid, skipped inside vortex rings so the rings stay readable
        const rings = active.map((v) => [v.lat, v.lon, v.r + 300]);
        drawFlowArrows(g, vw, flow, t, { bold: true, avoid: (lat, lon) => rings.some(([a, b, r]) => distKm(lat, lon, a, b) < r) });
      }
      if (s.streams) drawStreams(g, vw);
      const ph = backdrop.phase(), nextPos = new Map((data.frames[(t + 1) % data.frames.length] || []).map((n) => [n.id, n]));
      const byId = new Map(active.map((v) => [v.id, v]));
      let soloAt = null;
      for (const v of data.frames[t] || []) {
        // Glide toward the same vortex's next position while playing (no jump at the date line).
        const nx = nextPos.get(v.id);
        const dLon = nx ? ((nx.lon - v.lon + 540) % 360) - 180 : 0;
        const [x, y] = vw.toPixel(nx ? v.lat + (nx.lat - v.lat) * ph : v.lat, nx ? v.lon + dLon * ph : v.lon);
        const rpx = Math.max(4, (v.r / 40030) * W / Math.max(0.2, Math.cos((v.lat * Math.PI) / 180)));
        const cw = !hot() && trackById.get(v.id)?.direction === 'cw';
        const av = byId.get(v.id), isSolo = soloId === v.id, col = voiceFor(av || v).color;
        // Mark position: one full turn per melody, landing on note k's tick as note k sounds.
        const p = av ? loopOf(av, sec) : null, n = p ? p.n : 1;
        const turn = p ? markTurn((sec - p.t0) / (p.loop / n), n) : 0;
        // Canvas y is down: counterclockwise = decreasing angle. Start at the top.
        const toXY = (fr) => { const a = (cw ? 1 : -1) * fr * 2 * Math.PI - Math.PI / 2; return [x + rpx * Math.cos(a), y + rpx * Math.sin(a)]; };
        g.globalAlpha = soloId != null && !isSolo ? 0.3 : 1;
        const lw = isSolo ? 4 : 2;
        if (isSolo) { g.strokeStyle = '#fff'; g.lineWidth = lw + 6; g.beginPath(); g.arc(x, y, rpx, 0, 2 * Math.PI); g.stroke(); soloAt = [x, y, rpx]; }
        if (hot()) { g.fillStyle = col; g.globalAlpha *= 0.28; g.beginPath(); g.arc(x, y, rpx, 0, 2 * Math.PI); g.fill(); g.globalAlpha = soloId != null && !isSolo ? 0.3 : 1; }
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
    updateLegend(active);
    describe(`Vortex melodies ready: ${dataset.title}, ${data.tracks.length} tracked swirls in ${NAME}. Press Play to hear them all; select one on the map (click, or arrow keys then Enter) to solo it; choose another dataset with the Data menu.`);
    return () => {
      offFrame(); offPlay(); document.removeEventListener('keydown', onEsc); offHover(); offClick(); clearInterval(sched); clearTimeout(pausedTimer); removeOverlay(); cancelAnimationFrame(raf);
      barBox.remove(); legend.remove(); bars.remove(); backdrop.dispose(); if (hostBar) hostBar.hidden = false;
    };
  }

  return () => { alive = false; setup?.(); };
}
