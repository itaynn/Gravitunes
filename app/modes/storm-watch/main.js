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
import { volumeSlider, soundHint, throttle, fold } from '../../core/ui.js';
import { voiceAt, centerColors } from '../../core/geo.js';
import { shapeForPitch } from '../../core/voices.js';
import { loadEarth } from '../../core/data.js';
import { ranks, stormNote, noteTimes, panOf, kmBetween, cssToRgb, DEFAULT_MAP, PITCH_LOW, PITCH_HIGH } from './mapping.js';

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
      return { lat, lon, voice: reg.voice, sample: instruments[reg.primary.instrument]?.sample, name: instLabel(reg.primary.instrument), css, rgb: cssToRgb(css) };
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
    // A storm's note: the region's instrument, panned by longitude; pitch, volume and tempo follow the storm
    // properties chosen under More (default: bigger storms louder). Tempo repeats the note within `dur`.
    function voice(c, comps, dur = 0.5) {
      if (!c) return;
      const reg = regionOf(c);
      const { freq, amp, gap } = stormNote(ranks(c, comps, (x) => propsOf(x)), s.map, tones());
      const sh = shapeForPitch(reg.voice, freq);
      const times = noteTimes(gap, Math.max(dur, 0.45));
      const each = gap == null ? Math.max(dur, sh.dur ?? 0) : Math.max(0.9 * gap, Math.min(sh.dur ?? 0, 2 * gap));
      for (const t of times) {
        sound.play({ freq, dur: each, amp, pan: panOf(reg.lon), sample: reg.sample, t,
          harmonics: sh.harmonics, partials: sh.partials, envelope: sh.envelope, noise: sh.noise, vibrato: sh.vibrato, wah: sh.wah });
      }
    }
    function say(c, comps) {
      const sorted = bySize(comps);
      const sp = propsOf(c).speed;
      return `${nameOf(c)}, ${sorted.indexOf(c) + 1} of ${sorted.length}, ${stormSize(c, sorted)}, ${stormPlace(c, W, H)}, ${regionOf(c).name}`
        + `${sp != null ? `, moving about ${Math.round(sp / 5) * 5} km/h` : ''}.`;
    }
    function follow(c, { announce = true } = {}) {
      s.followed = c ? c.id : null;
      viewer.redraw();
      if (!announce) return;
      if (!c) { describe('No storm followed.'); return; }
      describe(`Following ${say(c, frame().components)} Page Up and Page Down step through time.`);
      voice(c, frame().components, 0.8);
    }

    const overlay = viewer.addOverlay((g, v) => {
      const f = frame();
      if (!f) return;
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
      g.restore();
    });

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
    const hoverSay = throttle(250);
    let lastHover = null;
    const offHover = input.onHover((p) => {
      const c = under(p, 4);
      if (c?.id === lastHover) return;
      lastHover = c?.id ?? null;
      if (!c) return;
      const tell = () => {
        if (under(input.position())?.id !== c.id) return;
        describe(`${say(c, frame().components)} Enter follows it.`);
        if (p.keyboard) voice(c, frame().components, 0.3);   // the mouse only announces; sound needs a click, key or Play
      };
      if (hoverSay(false, tell)) tell();
    });
    const offClick = input.onClick((p) => follow(under(p, 12)));

    // Keys on the map: N / P (or ] and [) pick the next / previous storm, largest first; PageUp/PageDown
    // (or , and .) step time keeping the followed storm; Escape stops following. Arrows move the cursor.
    function onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const step = { n: 1, N: 1, ']': 1, p: -1, P: -1, '[': -1 }[e.key];
      if (step) {
        e.preventDefault();
        const comps = frame().components, next = stepStorm(comps, s.followed, step);
        if (!next) { describe('No storms in this frame.'); return; }
        follow(next, { announce: false });
        const { lat, lon } = gridToLatLon(next.coreX, next.coreY, W, H);
        input.moveTo(lat, lon);
        describe(say(next, comps));
        voice(next, comps, 0.6);
        return;
      }
      const dt = { PageUp: -1, ',': -1, PageDown: 1, '.': 1 }[e.key];
      if (dt) { e.preventDefault(); time.pause(); stepped = true; time.step(dt); return; }
      if (e.key === 'Escape' && s.followed != null) { e.preventDefault(); follow(null); }
    }
    viewer.canvas.addEventListener('keydown', onKey);

    // Each new frame: redraw; while following, play the storm's note and say where it went when stepping.
    function onFrame(byKey) {
      viewer.redraw();
      const f = frame();
      if (s.followed == null) { if (byKey) describe(`${time.label()}, ${f.components.length} storms.`); return; }
      const { parts, remembered } = familyParts(f, s.followed);
      const lead = parts.length ? bySize(parts)[0] : null;
      if (lead) voice(lead, f.components, 0.45);
      if (!byKey && time.playing) return;
      describe(`${time.label()}. ` + (lead ? `Storm ${s.followed} ${parts.length > 1 ? `in ${parts.length} parts, ` : ''}${stormPlace(lead, W, H)}.`
        : remembered.length ? `Storm ${s.followed} is below the size cutoff; showing where it is expected.`
          : `Storm ${s.followed} is not detected now.`));
    }
    let stepped = false;
    const offFrame = time.onFrame(() => { const k = stepped; stepped = false; updateLegend(); onFrame(k); });

    soundHint(panel, sound, 'hover over a storm or press N for the largest storm; Enter follows the storm under the cursor.');
    scaleControl(panel, { value: s.scale, describe, sound, onChange: (v) => { s.scale = v; } });
    volumeSlider(panel, sound, s.volume);
    // Legend: the instruments of the storms in this frame, in their outline colours.
    const legend = document.createElement('p');
    legend.className = 'hint';
    const legendList = document.createElement('span'), legendNote = document.createElement('span');
    legendNote.textContent = ' Outline colour = instrument (the region where the storm is).';
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
        sw.setAttribute('aria-hidden', 'true'); sw.style.cssText = `color:${col};font-weight:bold`; sw.textContent = '\u25CF ';
        const it = document.createElement('span'); it.style.marginRight = '.7em'; it.append(sw, name);
        legendList.append(it);
      }
      if (!seen.size) legendList.textContent = 'No storms in this frame.';
    }
    updateLegend();
    // Mapping menus, one per sound property: which storm property it follows.
    const SOURCE_OPTS = [['nothing', 'Nothing'], ['size', 'Size'], ['latitude', 'Latitude'], ['rain', 'Rain intensity'], ['speed', 'Speed']];
    const SOUND_NAMES = { pitch: 'Pitch', volume: 'Volume', tempo: 'Tempo' };
    const MORE = { size: 'bigger', latitude: 'further north', rain: 'heavier rain', speed: 'faster moving' };
    const EFFECT = { pitch: 'higher', volume: 'louder', tempo: 'faster repeats' };
    const FIXED = { pitch: 'fixed middle pitch', volume: 'fixed volume', tempo: 'one note each time' };
    const mapSels = ['pitch', 'volume', 'tempo'].map((key) => panel.select(`${SOUND_NAMES[key]} \u2190`, SOURCE_OPTS, (val) => {
      s.map[key] = val;
      const label = SOURCE_OPTS.find((o) => o[0] === val)[1].toLowerCase();
      describe(val === 'nothing' ? `${SOUND_NAMES[key]}: ${FIXED[key]}.`
        : `${SOUND_NAMES[key]} now follows ${label} (${MORE[val]} = ${EFFECT[key]}).`);
    }, { value: s.map[key] }));
    const more = fold('More', mapSels);
    more.before(legend);
    panel.checkbox('Outlines', s.outlines, (on) => { s.outlines = on; viewer.redraw(); },
      { hint: 'Faint outlines of every tracked storm; the followed storm is always drawn bright.' });
    panel.button('Largest', () => follow(bySize(frame().components)[0] ?? null)).setAttribute('aria-label', 'Follow the largest storm');
    panel.button('Unfollow', () => follow(null)).setAttribute('aria-label', 'Stop following');
    panel.text('Keys on the map: N and P pick storms (largest first), Enter follows the storm under the cursor, '
      + 'Page Up and Page Down step through time, Escape stops following. Each region plays its own instrument, '
      + 'panned left to right by longitude; bigger storms are louder. Under More, pitch, volume and tempo can each follow size, latitude, '
      + 'rain intensity or speed.');
    // The studio needs the full-size frames, so the single-file (blob:) build leaves the link out.
    if (!import.meta.url.startsWith('blob:')) {
      panel.text('', { visible: true }).append(Object.assign(document.createElement('a'), { href: new URL('studio.html', import.meta.url).href,
        textContent: 'Studio' }));
    }
    describe(`${data.summary.trackCount} storms tracked across ${data.frames.length} frames. Press N for the largest storm.`);
    viewer.redraw();

    return () => { more.remove(); legend.remove(); overlay(); offHover(); offClick(); offFrame(); viewer.canvas.removeEventListener('keydown', onKey); };
  }

  return () => { alive = false; cleanup(); };
}
