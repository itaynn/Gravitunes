// Layered maps: one gas at a time (ozone, carbon monoxide or nitrogen oxides, chosen with the Dataset picker).
// What you see is what you hear: the map, colour bar and sound all come from ctx.dataset, played with that
// gas's own voice and pitch range (layers.js).
import { formatLatLon as where } from '../../core/geo.js';
import { scaleControl } from '../../core/scale-control.js';
import { throttle } from '../../core/ui.js';
import { layerFor, noteFor } from './layers.js';

export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe } = ctx;
  const layer = layerFor(dataset.id);
  let last = null, lastFreq = null;
  let scale = 'pentatonic-major';
  scaleControl(panel, { value: scale, describe, sound, onChange: (v) => { scale = v; lastFreq = null; } });
  panel.button('Describe', () => {
    if (!last) describe('Move over the map or use the arrow keys first.');
    else probe(last, { force: true });
  });

  // Hover is throttled (150 ms) so a fast sweep does not pile up notes.
  const ready = throttle(150);
  const speak = throttle(5000);   // text summary during playback, at most every 5 s
  function probe({ lat, lon }, { announce = true, force = false, onlyChanged = false, prefix = '' } = {}) {
    last = { lat, lon };
    if (!ready(force || onlyChanged, () => probe({ lat, lon }, { announce, force, onlyChanged, prefix }))) return;
    const value = dataset.valueAt(lat, lon, time.now());
    const n = value == null ? null : noteFor(layer, dataset.norm(value), lon / 180, scale);
    if (n && !(onlyChanged && lastFreq === n.freq)) { lastFreq = n.freq; sound.play(n); }
    if (announce) describe(`${prefix}${layer.name} ${dataset.format(value)}, near ${where(lat, lon)}`);
  }

  const offHover = input.onHover((p) => probe(p));
  const offClick = input.onClick((p) => probe(p, { force: true }));
  const offFrame = time.onFrame(() => {
    if (time.playing) {
      if (last) probe(last, { announce: speak(), onlyChanged: true, prefix: `${time.label()}: ` });
      return;
    }
    if (last) probe(last, { force: true, prefix: `${time.label()}: ` });
    else describe(time.label());
  });
  describe(`Layered maps ready: ${layer.name}. Choose another gas with the Dataset menu.`);
  return () => { offHover(); offClick(); offFrame(); };
}
