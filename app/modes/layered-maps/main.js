// Layered maps: ozone, CO and NOx at the same spot and hour, each gas its own voice and register.
// The host loads one dataset (the map you see); the other gases are loaded with the same core loader.
import { loadDataset } from '../../core/datasets.js';
import { LAYERS, notesFor, describeReadings, frameAtDate } from './layers.js';

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe } = ctx;
  let alive = true, last = null, layers = null;
  const state = Object.fromEntries(LAYERS.map((l) => [l.id, 'on']));
  const where = (lat, lon) =>
    `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? 'E' : 'W'}`;
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  for (const l of LAYERS) {
    panel.select(cap(l.name), [['on', 'On'], ['mute', 'Muted'], ['solo', 'Solo']], (v) => {
      state[l.id] = v;
      describe(`${cap(l.name)} ${v === 'on' ? 'on' : v === 'mute' ? 'muted' : 'solo'}`);
    }, { value: 'on' });
  }
  panel.button('Describe this spot', () => last && probe(last, { announce: true }));

  (async () => {
    const ds = await Promise.all(LAYERS.map((l) =>
      (String(dataset.id) === l.id ? dataset : loadDataset(l.id).catch((e) => { console.warn(e); return null; }))));
    if (!alive) return;
    layers = LAYERS.map((layer, i) => ({ layer, ds: ds[i] })).filter((x) => x.ds);
    const missing = LAYERS.filter((_, i) => !ds[i]).map((l) => l.name);
    describe(missing.length ? `Could not load ${missing.join(' and ')}.`
      : 'Ready: carbon monoxide plays low, ozone in the middle, nitrogen oxides higher.');
    if (last) probe(last, { announce: false });
  })().catch((e) => { console.error(e); describe(`Could not load the gas maps: ${e.message}`); });

  function readingsAt(lat, lon) {
    const date = time.date();
    return layers.map(({ layer, ds }) => {
      const t = ds === dataset ? time.now() : frameAtDate(ds.count, ds.timeOf, date);
      const value = ds.valueAt(lat, lon, t);
      return { layer, ds, value, norm: value == null ? null : ds.norm(value) };
    });
  }

  function probe({ lat, lon }, { announce = true } = {}) {
    last = { lat, lon };
    if (!layers) return;
    const r = readingsAt(lat, lon);
    for (const n of notesFor(r, state, lon / 180)) sound.play(n);
    if (announce) describe(`${cap(describeReadings(r, (x) => x.ds.format(x.value)))}, near ${where(lat, lon)}`);
  }

  const offHover = input.onHover((p) => probe(p));
  const offClick = input.onClick((p) => probe(p));
  const offFrame = time.onFrame(() => {
    if (last) probe(last, { announce: false });
    if (!time.playing) describe(time.label());
  });
  return () => { alive = false; offHover(); offClick(); offFrame(); };
}
