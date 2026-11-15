// Storm watch (itay): follow storms tracked offline (analysis/gravitunes_analysis/storms.py) through the
// 48 half-hourly IMERG frames, as a thin mode on the shared host. Everything storm-specific comes from
// app/core/storms.js; this file only wires it to the map, keys, panel and sound.
// The full tracking studio (tuning sliders, in-browser reanalysis, full-size frames) is studio.html.
import {
  loadStormTracks, latLonToGrid, gridToLatLon, stormAt, stepStorm, bySize, familyParts, anchorOf,
  stormColor, stormSize, stormPlace, drawStormShape, drawCoreMarker, inComponent, inFamily,
} from '../../core/storms.js';
import { scaleFreqs, noteHz } from '../../core/scales.js';
import { scaleControl } from '../../core/scale-control.js';
import { volumeSlider, soundHint, throttle } from '../../core/ui.js';
import { voiceAt, centerColors } from '../../core/geo.js';
import { shapeForPitch } from '../../core/voices.js';
import { loadEarth } from '../../core/data.js';
import {
  ranks, stormTune, tuneFreq, tuneSteps, dueNotes, mixGains, markTurn, panOf, kmBetween, cssToRgb, DEFAULT_MAP, PITCH_LOW, PITCH_HIGH,
} from './mapping.js';

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe, viewer } = ctx;
  let alive = true, cleanup = () => {};
  const dir = new URL(dataset.dir, location.href);
  Promise.all([loadStormTracks(new URL('storms.json', dir), { frames: time.count }), loadEarth('musical-centers'), loadEarth('instruments')])
    .then(([data, mj, ij]) => { if (alive) cleanup = run(data, mj.centers, ij.instruments); })
    .catch((e) => { console.error(e); describe(`Storm tracks could not load (only dataset 4285 is prepared): ${e.message}`); });

  function run(data, centers, instruments) {
    const W = data.width, H = data.height;
    // Recorded samples for every instrument; until loaded (or on the built-in synth) notes are synthesized.
    sound.loadSamples?.(Object.values(instruments).map((v) => v.sample).filter(Boolean));
    const s = { followed: null, outlines: true, scale: 'pentatonic-major', volume: 0.7, map: { ...DEFAULT_MAP } };
    const frame = () => data.frames[time.now()];
    const tones = () => scaleFreqs(s.scale, noteHz(PITCH_LOW), noteHz(PITCH_HIGH));   // C3..E6
    const colorOf = centerColors(centers);   // same colours as World orchestra / Vortex melodies
    const instLabel = (id) => instruments[id]?.label || id;
    // The instrument of the region at a storm's core (and its colour).
    function regionOf(c) {
      const { lat, lon } = gridToLatLon(c.coreX, c.coreY, W, H);
      const reg = voiceAt(lat, lon, centers, instruments, 900);
      const css = colorOf.get(reg.primary.id) || 'hsl(0 0% 75%)';
      return { lat, lon, inst: reg.primary.instrument, voice: reg.voice, sample: instruments[reg.primary.instrument]?.sample, name: instLabel(reg.primary.instrument), css, rgb: cssToRgb(css) };
    }
    const nameOf = (c) => `Storm ${s.followed != null && familyParts(frame(), s.followed).parts.includes(c) ? s.followed : c.id}`;

    // Storm properties beyond size: latitude, rain intensity (mean IMERG value at points inside the outline)
    // and speed (km/h the core moved since the previous half-hour frame; null when it is new).
    const propCache = new Map();
    function propsOf(c, t = time.now()) {
      const key = `${t}:${c.id}:${c.coreX}:${c.coreY}`;
      if (propCache.has(key)) return propCache.get(key);
      const here = gridToLatLon(c.coreX, c.coreY, W, H);
      const xs = [], ys = [];
      for (const p of c.polygons ?? []) for (const [x, y] of p.outer ?? []) { xs.push(x); ys.push(y); }
      let sum = 0, n = 0;
      if (xs.length) {
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), N = 8;
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
          const x = x0 + (x1 - x0) * (i + 0.5) / N, y = y0 + (y1 - y0) * (j + 0.5) / N;
          if (!inComponent(c, x, y)) continue;
          const { lat, lon } = gridToLatLon(x, y, W, H), v = dataset.valueAt?.(lat, lon, t);
          if (v != null && Number.isFinite(v)) { sum += v; n++; }
        }
      }
      if (!n) { const v = dataset.valueAt?.(here.lat, here.lon, t); if (v != null && Number.isFinite(v)) { sum = v; n = 1; } }
      let speed = null;
      const prev = t > 0 ? data.frames[t - 1]?.components ?? [] : [];
      const before = prev.find((p) => p.id === c.id) ?? prev.find((p) => inFamily(c, p.id) || inFamily(p, c.id));
      if (before) speed = 2 * kmBetween(here, gridToLatLon(before.coreX, before.coreY, W, H));
      const out = { lat: here.lat, rain: n ? sum / n : null, speed };
      propCache.set(key, out);
      return out;
    }
    // ---- tunes. Every storm in the frame loops a short melody on its region's instrument, panned by longitude;
    // pitch / volume / tempo / notes follow the storm properties chosen in the menus. A soloed storm (s.followed)
    // plays alone. The loudest MAX_VOICES play together, normalised so many storms do not get louder.
    const MAX_VOICES = 8;
    // storm id -> { t0, loop }: loop origin (performance clock, s) and length, kept for the storm's life.
    const phase = new Map();
    let playing = [];   // [{ c, reg, tune, gain }] for this frame
    let clock = performance.now() / 1000;
    // Tunes follow the playback Speed menu gently: 50% speed = loop about 1.4x slower (square root keeps notes playable).
    const loopLen = (it) => it.tune.loop * Math.sqrt(2 / Math.max(0.1, time.fps || 2));
    function loopOf(id, loop, now) {
      let p = phase.get(id);
      if (!p) { p = { t0: now, loop }; phase.set(id, p); }
      else if (Math.abs(p.loop - loop) > 1e-6) { p.t0 = now - ((now - p.t0) / p.loop) * loop; p.loop = loop; }
      return p;
    }
    function soloLead(f = frame()) {
      if (s.followed == null) return null;
      const { parts } = familyParts(f, s.followed);
      return parts.length ? bySize(parts)[0] : null;
    }
    function computePlaying() {
      const f = frame(), comps = f?.components ?? [];
      const lead = soloLead(f);
      const list = s.followed != null ? (lead ? [lead] : []) : comps;
      const items = list.map((c) => ({ c, reg: regionOf(c), tune: stormTune(ranks(c, comps, (x) => propsOf(x)), s.map) }));
      const gains = s.followed != null ? items.map((it) => it.tune.amp) : mixGains(items.map((it) => it.tune.amp), MAX_VOICES);
      items.forEach((it, i) => { it.gain = gains[i]; });
      playing = items.filter((it) => it.gain > 0);
      const now = performance.now() / 1000;
      for (const it of playing) loopOf(it.c.id, loopLen(it), now);
    }
    const freqOf = (it, k) => tuneFreq(tones(), noteHz(it.tune.root), tuneSteps(it.tune.n)[k % it.tune.n]);
    function playStep(it, k, at) {
      const freq = freqOf(it, k), sh = shapeForPitch(it.reg.voice, freq), step = loopLen(it) / it.tune.n;
      sound.play({ freq, amp: 0.4 * it.gain, pan: panOf(it.reg.lon), sample: it.reg.sample, t: Math.max(0, at - performance.now() / 1000),
        dur: Math.min(sh.dur ?? 0.4, step * 0.9), harmonics: sh.harmonics, partials: sh.partials, envelope: sh.envelope, noise: sh.noise,
        vibrato: sh.vibrato, wah: sh.wah });
    }
    // Scheduler: notes due in the next 150 ms.
    let lastTick = performance.now() / 1000;
    const sched = setInterval(() => {
      const now = performance.now() / 1000, to = now + 0.15;
      if (time.playing) {
        for (const it of playing) {
          const p = loopOf(it.c.id, loopLen(it), now);
          for (const { k, at } of dueNotes(it.tune.n, p.loop, p.t0, Math.max(lastTick, now), to)) playStep(it, k, at);
        }
      }
      lastTick = to;
    }, 100);
    // Drone only for drone-tradition instruments ("drone": true): a soft held root an octave under that storm's tune.
    function drones() {
      const frameDur = 0.5, done = new Set();
      for (const it of playing) {
        if (!instruments[it.reg.inst]?.drone) continue;
        const freq = tuneFreq(tones(), noteHz(it.tune.root), 0) / 2;
        const key = `${Math.round(freq)}|${Math.round(it.reg.lon / 30)}`;
        if (done.has(key)) continue;
        done.add(key);
        sound.play({ freq, amp: 0.05 * it.gain, pan: panOf(it.reg.lon), dur: frameDur * 1.3,
          harmonics: [1, 0.4, 0.2, 0.1], envelope: { attack: frameDur * 0.4, decay: 0.2, sustain: 0.9, release: frameDur } });
      }
    }

    function say(c, comps) {
      const sorted = bySize(comps);
      const sp = propsOf(c).speed;
      return `${nameOf(c)}, ${sorted.indexOf(c) + 1} of ${sorted.length}, ${stormSize(c, sorted)}, ${stormPlace(c, W, H)}, ${regionOf(c).name}`
        + `${sp != null ? `, moving about ${Math.round(sp / 5) * 5} km/h` : ''}.`;
    }
    function solo(c) {
      s.followed = c ? c.id : null;
      computePlaying(); viewer.redraw();
      if (!c) { describe(`All ${frame().components.length} storms playing.`); return; }
      describe(`Solo: ${say(c, frame().components)} ${time.playing ? '' : 'Press Play to hear it. '}Select it again, click empty map or press Escape to hear all.`);
    }

    const overlay = viewer.addOverlay((g, v) => {
      const f = frame();
      if (!f) return;
      if (time.playing) clock = performance.now() / 1000;
      const sx = v.canvas.width / W, sy = v.canvas.height / H;
      g.save();
      if (s.outlines) for (const c of f.components) drawStormShape(g, c, regionOf(c).rgb, { fill: 0.08, line: 0.55, sx, sy });
      const { parts, remembered } = familyParts(f, s.followed);
      const lead = bySize(parts.length ? parts : remembered)[0];
      const col = lead ? regionOf(lead).rgb : s.followed != null ? stormColor(s.followed) : null;
      for (const c of parts) drawStormShape(g, c, col, { fill: 0.35, line: 0.98, sx, sy });
      for (const c of remembered) drawStormShape(g, c, col, { fill: 0.14, line: 0.62, dashed: true, sx, sy });
      for (const c of parts.length ? parts : remembered) {
        const { x, y } = anchorOf(c, s.followed);
        drawCoreMarker(g, x * sx, y * sy, col.css);
      }
      // Tune progress: a ring at each sounding storm's core with one tick per note and a dot that goes round
      // once per tune, resting on note k's tick as it sounds.
      for (const it of playing) {
        const p = phase.get(it.c.id); if (!p) continue;
        const n = it.tune.n, x = it.c.coreX * sx, y = it.c.coreY * sy, r = 11;
        const turn = markTurn((clock - p.t0) / (p.loop / n), n);
        const at = (fr) => { const a = fr * 2 * Math.PI - Math.PI / 2; return [x + r * Math.cos(a), y + r * Math.sin(a)]; };
        g.lineWidth = 3; g.strokeStyle = '#000'; g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.stroke();
        g.lineWidth = 1.5; g.strokeStyle = it.reg.css; g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.stroke();
        g.fillStyle = '#000';
        for (let k = 0; k < n; k++) { const [tx, ty] = at(k / n); g.fillRect(tx - 1.5, ty - 1.5, 3, 3); }
        const [dx, dy] = at(turn);
        g.beginPath(); g.arc(dx, dy, 5, 0, 2 * Math.PI); g.fillStyle = '#000'; g.fill();
        g.beginPath(); g.arc(dx, dy, 3.5, 0, 2 * Math.PI); g.fillStyle = s.followed != null ? '#fff' : it.reg.css; g.fill();
      }
      g.restore();
    });
    let raf = 0;
    const spin = () => { if (time.playing) viewer.redraw(); raf = requestAnimationFrame(spin); };
    raf = requestAnimationFrame(spin);

    // The storm under a point, else the one whose core is nearest within `near` grid pixels (cores can sit
    // just outside a ragged outline, and keyboard users land exactly on the core).
    const under = ({ lat, lon }, near = 0) => {
      const { x, y } = latLonToGrid(lat, lon, W, H), comps = frame().components;
      const hit = stormAt(comps, x, y);
      if (hit || !near) return hit;
      let best = null, bd = near;
      for (const c of comps) { const d = Math.hypot(c.coreX - x, c.coreY - y); if (d <= bd) { best = c; bd = d; } }
      return best;
    };
    // Hover is silent: keyboard moves announce the storm there; the mouse only names it.
    const hoverSay = throttle(250);
    let lastHover = null;
    const offHover = input.onHover((p) => {
      const c = under(p, 4);
      if (c?.id === lastHover) return;
      lastHover = c?.id ?? null;
      if (!c) return;
      const tell = () => { if (under(input.position(), 4)?.id === c.id) describe(`${say(c, frame().components)} Enter solos it.`); };
      if (hoverSay(false, tell)) tell();
    });
    // Click / Enter: solo the storm there; again, on empty map, or Escape: back to all.
    const offClick = input.onClick((p) => {
      const c = under(p, 12);
      if (!c) { if (s.followed != null) solo(null); else describe(`No storm here. ${frame().components.length} storms at ${time.label()}.`); return; }
      if (s.followed != null && (c.id === s.followed || familyParts(frame(), s.followed).parts.includes(c))) { solo(null); return; }
      solo(c);
    });

    // Keys on the map: N / P (or ] and [) move to the next / previous storm, largest first (Enter solos it);
    // PageUp/PageDown (or , and .) step time; Escape returns to all storms. Arrows move the cursor.
    let picked = null;
    function onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const step = { n: 1, N: 1, ']': 1, p: -1, P: -1, '[': -1 }[e.key];
      if (step) {
        e.preventDefault();
        const comps = frame().components, next = stepStorm(comps, picked, step);
        if (!next) { describe('No storms in this frame.'); return; }
        picked = next.id;
        const { lat, lon } = gridToLatLon(next.coreX, next.coreY, W, H);
        lastHover = next.id;
        input.moveTo(lat, lon);
        describe(`${say(next, comps)} Enter solos it.`);
        return;
      }
      const dt = { PageUp: -1, ',': -1, PageDown: 1, '.': 1 }[e.key];
      if (dt) { e.preventDefault(); time.pause(); stepped = true; time.step(dt); return; }
      if (e.key === 'Escape' && s.followed != null) { e.preventDefault(); solo(null); }
    }
    viewer.canvas.addEventListener('keydown', onKey);
    const onEsc = (e) => { if (e.key === 'Escape' && s.followed != null && e.target !== viewer.canvas) solo(null); };
    document.addEventListener('keydown', onEsc);

    // Each new frame: storms join and leave the tune set; describe when stepped by key or paused.
    let stepped = false, pausedTimer = 0;
    const offFrame = time.onFrame((t) => {
      const byKey = stepped; stepped = false;
      updateLegend();
      const f = frame(), ids = new Set(f.components.map((c) => c.id));
      for (const id of phase.keys()) if (!ids.has(id)) phase.delete(id);
      if (s.followed != null && !familyParts(f, s.followed).parts.length && !familyParts(f, s.followed).remembered.length) {
        s.followed = null; describe('The soloed storm has faded; all storms play again.');
      }
      computePlaying();
      if (time.playing) drones();
      viewer.redraw();
      clearTimeout(pausedTimer);
      if (byKey || !time.playing) pausedTimer = setTimeout(() => {
        if (!alive || time.playing) return;
        const lead = soloLead();
        describe(`${time.label()}. ` + (s.followed == null ? `${f.components.length} storms.`
          : lead ? `Storm ${s.followed} ${stormPlace(lead, W, H)}.` : `Storm ${s.followed} is below the size cutoff; showing where it is expected.`));
      }, byKey ? 0 : 400);
    });
    const offPlay = time.onPlayState((p) => {
      const now = performance.now() / 1000;
      if (!p) sound.stopAll?.(); else for (const q of phase.values()) q.t0 += now - clock;   // resume where the dots stopped
      clock = now;
    });

    soundHint(panel, sound, 'press Play to hear every storm; click a storm (or N, then Enter) to solo it.');
    scaleControl(panel, { value: s.scale, describe, sound, onChange: (v) => { s.scale = v; } });
    volumeSlider(panel, sound, s.volume);
    // Legend: the instruments of the storms in this frame, in their outline colours.
    const legend = document.createElement('p');
    legend.className = 'hint';
    const legendList = document.createElement('span'), legendNote = document.createElement('span');
    legendNote.textContent = ' Outline colour = instrument (the region where the storm is). The dot goes round once per tune. Drone only under drone-tradition instruments.';
    legend.append(legendList, legendNote);
    let legendKey = null;
    function updateLegend() {
      const seen = new Map();
      for (const c of frame()?.components ?? []) { const r = regionOf(c); if (!seen.has(r.name)) seen.set(r.name, r.css); }
      const key = [...seen.keys()].join('|');
      if (key === legendKey) return;
      legendKey = key; legendList.replaceChildren();
      for (const [name, col] of seen) {
        const sw = document.createElement('span');
        sw.setAttribute('aria-hidden', 'true'); sw.style.cssText = `color:${col};font-weight:bold`; sw.textContent = '● ';
        const it = document.createElement('span'); it.style.marginRight = '.7em'; it.append(sw, name);
        legendList.append(it);
      }
      if (!seen.size) legendList.textContent = 'No storms in this frame.';
    }
    updateLegend();
    // Mapping menus, one per sound property: which storm property it follows.
    const SOURCE_OPTS = [['nothing', 'Nothing'], ['size', 'Size'], ['latitude', 'Latitude'], ['rain', 'Rain intensity'], ['speed', 'Speed']];
    const SOUND_NAMES = { pitch: 'Pitch', volume: 'Volume', tempo: 'Tempo', notes: 'Notes' };
    const MORE = { size: 'bigger', latitude: 'further north', rain: 'heavier rain', speed: 'faster moving' };
    const EFFECT = { pitch: 'higher', volume: 'louder', tempo: 'faster tune', notes: 'more notes, 3 to 8' };
    const FIXED = { pitch: 'fixed middle pitch', volume: 'fixed volume', tempo: 'fixed tempo', notes: 'fixed at 5 notes' };
    const mapSels = ['pitch', 'volume', 'tempo', 'notes'].map((key) => panel.select(`${SOUND_NAMES[key]} ←`, SOURCE_OPTS, (val) => {
      s.map[key] = val; phase.clear(); computePlaying();
      const label = SOURCE_OPTS.find((o) => o[0] === val)[1].toLowerCase();
      describe(val === 'nothing' ? `${SOUND_NAMES[key]}: ${FIXED[key]}.`
        : `${SOUND_NAMES[key]} now follows ${label} (${MORE[val]} = ${EFFECT[key]}).`);
    }, { value: s.map[key] }));
    // No hidden fold: the menus sit directly in the panel.
    mapSels[0].before(legend);
    panel.checkbox('Outlines', s.outlines, (on) => { s.outlines = on; viewer.redraw(); },
      { hint: 'Faint outlines of every tracked storm; the soloed storm is always drawn bright.' });
    panel.button('All storms', () => solo(null)).setAttribute('aria-label', 'Stop solo; hear all storms');
    panel.text('Play: every storm loops a short tune on its region\'s instrument, panned left to right by longitude (the loudest 8 at once). '
      + 'Click a storm, or press N and P then Enter, to solo it; click it again, click empty map or press Escape to hear all. '
      + 'Page Up and Page Down step through time. Pitch, volume, tempo and number of notes can each follow size, latitude, '
      + 'rain intensity or speed (menus above).');
    // The studio needs the full-size frames, so the single-file (blob:) build leaves the link out.
    if (!import.meta.url.startsWith('blob:')) {
      panel.text('', { visible: true }).append(Object.assign(document.createElement('a'), { href: new URL('studio.html', import.meta.url).href,
        textContent: 'Studio' }));
    }
    computePlaying();
    describe(`${data.summary.trackCount} storms tracked across ${data.frames.length} frames. Press Play to hear every storm; click one to solo it.`);
    viewer.redraw();
    // For tests: what is scheduled now.
    window.__stormWatch = { playing: () => playing.map((it) => ({ id: it.c.id, n: it.tune.n, loop: it.tune.loop, root: it.tune.root, gain: it.gain })), solo: () => s.followed };

    return () => {
      clearInterval(sched); cancelAnimationFrame(raf); clearTimeout(pausedTimer); delete window.__stormWatch;
      legend.remove(); overlay(); offHover(); offClick(); offFrame(); offPlay();
      viewer.canvas.removeEventListener('keydown', onKey); document.removeEventListener('keydown', onEsc);
    };
  }

  return () => { alive = false; cleanup(); };
}
