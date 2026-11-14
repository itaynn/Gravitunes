// Layered maps: ozone, CO and NOx at the same spot and hour, each gas its own voice and register.
// The host loads one dataset (the map you see); the other gases are loaded with the same core loader.
import { formatLatLon as where } from '../../core/geo.js';
import { loadDataset } from '../../core/datasets.js';
import { scaleControl } from '../../core/scale-control.js';
import { LAYERS, notesFor, describeReadings, frameAtDate } from './layers.js';

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe } = ctx;
  let alive = true, last = null, layers = null;
  const state = Object.fromEntries(LAYERS.map((l) => [l.id, 'on']));
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  for (const l of LAYERS) {
    panel.select(cap(l.name), [['on', 'On'], ['mute', 'Muted'], ['solo', 'Solo']], (v) => {
      state[l.id] = v;
      describe(`${cap(l.name)} ${v === 'on' ? 'on' : v === 'mute' ? 'muted' : 'solo'}`);
    }, { value: 'on' });
  }
  let scale = 'pentatonic-major';
  scaleControl(panel, { value: scale, describe, onChange: (v) => { scale = v; } });
  panel.button('Describe this spot', () => {
    if (!last) describe('Move over the map or use the arrow keys first.');
    else if (!layers) describe('Still loading gas maps.');
    else probe(last, { announce: true, force: true });
  });

  (async () => {
    const ds = await Promise.all(LAYERS.map((l) =>
      (String(dataset.id) === l.id ? dataset : loadDataset(l.id).catch((e) => { console.warn(e); return null; }))));
    if (!alive) return;
    layers = LAYERS.map((layer, i) => ({ layer, ds: ds[i] })).filter((x) => x.ds);
    const missing = LAYERS.filter((_, i) => !ds[i]).map((l) => l.name);
    describe(missing.length ? `Could not load ${missing.join(' and ')}.`
      : 'Ready: carbon monoxide plays low, ozone in the middle, nitrogen oxides higher.');
    if (last) probe(last, { announce: false, force: true });
  })().catch((e) => { console.error(e); describe(`Could not load the gas maps: ${e.message}`); });

  function readingsAt(lat, lon) {
    const date = time.date();
    return layers.map(({ layer, ds }) => {
      const t = ds === dataset ? time.now() : frameAtDate(ds.count, ds.timeOf, date);
      const value = ds.valueAt(lat, lon, t);
      return { layer, ds, value, norm: value == null ? null : ds.norm(value) };
    });
  }

  // Hover is throttled (150 ms) so a fast sweep does not pile up chords.
  let lastAt = 0;
  const lastFreq = {};   // layer id -> last played frequency, for playback
  function probe({ lat, lon }, { announce = true, force = false, onlyChanged = false, prefix = '' } = {}) {
    last = { lat, lon };
    if (!layers) return;
    const now = performance.now();
    if (!force && !onlyChanged && now - lastAt < 150) return;
    lastAt = now;
    const r = readingsAt(lat, lon);
    for (const n of notesFor(r, state, lon / 180, scale)) {
      if (onlyChanged && lastFreq[n.id] === n.freq) continue;
      lastFreq[n.id] = n.freq;
      sound.play(n);
    }
    if (announce) describe(`${prefix}${cap(describeReadings(r, (x) => x.ds.format(x.value)))}, near ${where(lat, lon)}`);
  }

  const offHover = input.onHover((p) => probe(p));
  const offClick = input.onClick((p) => probe(p, { force: true }));
  const offFrame = time.onFrame(() => {
    if (time.playing) { if (last) probe(last, { announce: false, onlyChanged: true }); return; }
    if (last && layers) probe(last, { force: true, prefix: `${time.label()}: ` });
    else describe(time.label());
  });
  return () => { alive = false; offHover(); offClick(); offFrame(); };
}
