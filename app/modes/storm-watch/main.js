// Storm watch (itay): follow storms tracked offline (analysis/gravitunes_analysis/storms.py) through the
// 48 half-hourly IMERG frames, as a thin mode on the shared host. Everything storm-specific comes from
// app/core/storms.js; this file only wires it to the map, keys, panel and sound.
// The full tracking studio (tuning sliders, in-browser reanalysis, full-size frames) is studio.html.
import {
  loadStormTracks, latLonToGrid, gridToLatLon, stormAt, stepStorm, bySize, familyParts, anchorOf,
  stormColor, stormSize, stormPlace, drawStormShape, drawCoreMarker,
} from '../../core/storms.js';
import { scaleFreqs, noteHz, snapToScale } from '../../core/scales.js';
import { scaleControl } from '../../core/scale-control.js';
import { volumeSlider, soundHint, throttle } from '../../core/ui.js';

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe, viewer } = ctx;
  let alive = true, cleanup = () => {};
  const dir = new URL(dataset.dir, location.href);
  loadStormTracks(new URL('storms.json', dir), { frames: time.count })
    .then((data) => { if (alive) cleanup = run(data); })
    .catch((e) => { console.error(e); describe(`Storm tracks could not load (only dataset 4285 is prepared): ${e.message}`); });

  function run(data) {
    const W = data.width, H = data.height;
    const s = { followed: null, outlines: true, scale: 'pentatonic-major', volume: 0.7 };
    const frame = () => data.frames[time.now()];
    const tones = () => scaleFreqs(s.scale, noteHz(-24), noteHz(12));   // C2..C5
    const nameOf = (c) => `Storm ${s.followed != null && familyParts(frame(), s.followed).parts.includes(c) ? s.followed : c.id}`;

    // A storm's note: north is higher, larger storms louder; pan follows longitude.
    function voice(c, comps, dur = 0.5) {
      if (!sound.started || !c) return;
      const { lat, lon } = gridToLatLon(c.coreX, c.coreY, W, H);
      const sorted = bySize(comps);
      const big = 1 - sorted.indexOf(c) / Math.max(1, sorted.length - 1);
      const north = Math.max(0, Math.min(1, (lat + 60) / 120));
      const f = snapToScale(noteHz(-24) * 2 ** (3 * north), tones());
      sound.play({ freq: f, duration: dur, amplitude: 0.25 + 0.5 * big, pan: lon / 180, harmonics: [1, 0.35, 0.12] });
    }
    function say(c, comps) {
      const sorted = bySize(comps);
      return `${nameOf(c)}, ${sorted.indexOf(c) + 1} of ${sorted.length}, ${stormSize(c, sorted)}, ${stormPlace(c, W, H)}.`;
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
      if (s.outlines) for (const c of f.components) drawStormShape(g, c, stormColor(c.id), { fill: 0.08, line: 0.45, sx, sy });
      const { parts, remembered } = familyParts(f, s.followed);
      const col = s.followed != null ? stormColor(s.followed) : null;
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
        voice(c, frame().components, 0.3);
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
    const offFrame = time.onFrame(() => { const k = stepped; stepped = false; onFrame(k); });

    soundHint(panel, sound, 'hover over a storm or press N for the largest storm; Enter follows the storm under the cursor.');
    scaleControl(panel, { value: s.scale, describe, sound, onChange: (v) => { s.scale = v; } });
    volumeSlider(panel, sound, s.volume);
    panel.checkbox('Outlines', s.outlines, (on) => { s.outlines = on; viewer.redraw(); },
      { hint: 'Faint outlines of every tracked storm; the followed storm is always drawn bright.' });
    panel.button('Largest', () => follow(bySize(frame().components)[0] ?? null)).setAttribute('aria-label', 'Follow the largest storm');
    panel.button('Unfollow', () => follow(null)).setAttribute('aria-label', 'Stop following');
    panel.text('Keys on the map: N and P pick storms (largest first), Enter follows the storm under the cursor, '
      + 'Page Up and Page Down step through time, Escape stops following. North sounds higher, bigger storms louder.');
    // The studio needs the full-size frames, so the single-file (blob:) build leaves the link out.
    if (!import.meta.url.startsWith('blob:')) {
      panel.text('', { visible: true }).append(Object.assign(document.createElement('a'), { href: new URL('studio.html', import.meta.url).href,
        textContent: 'Studio' }));
    }
    describe(`${data.summary.trackCount} storms tracked across ${data.frames.length} frames. Press N for the largest storm.`);
    viewer.redraw();

    return () => { overlay(); offHover(); offClick(); offFrame(); viewer.canvas.removeEventListener('keydown', onKey); };
  }

  return () => { alive = false; cleanup(); };
}
