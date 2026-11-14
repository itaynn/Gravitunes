// Ozone probe: the ppbv under the cursor plays a pentatonic note.
import { formatLatLon as fmt } from '../../core/geo.js';
import { valueHelpers } from '../../core/data.js';
import { soundHint } from '../../core/ui.js';
import { quantize, noteHz } from '../../core/scales.js';
import { scaleControl } from '../../core/scale-control.js';

// pitch <- value, harmonics <- roughness (spread) of the neighborhood, pan <- longitude.
export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe } = ctx;
  // norm: 0..1 over the range (log space for log datasets such as NOx).
  const { norm, fmtV } = valueHelpers(dataset);
  let radius = 2;            // neighborhood radius in degrees
  let speak = true;
  let last = null;           // last probed position
  let scale = 'pentatonic-major';

  panel.slider('Neighborhood size', {
    min: 0, max: 10, step: 1, value: radius,
    hint: 'Wider neighborhoods make rough areas sound brighter (more harmonics).',
    format: (v) => `${v} degrees`,
  }, (v) => { radius = v; });
  scaleControl(panel, { value: scale, describe, onChange: (v) => { scale = v; } });
  panel.checkbox('Speak values', speak, (v) => { speak = v; });
  panel.button('Describe this spot', () => (last ? probe(last, { announce: true, force: true })
    : describe('Move over the map or use the arrow keys first.')));

  function neighborhood(lat, lon, t) {
    if (!radius) return [];
    const vals = [];
    for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const v = dataset.valueAt(lat + dy * radius, lon + dx * radius, t);
      if (v != null) vals.push(norm(v));
    }
    return vals;
  }

  let lastAt = 0;
  function probe({ lat, lon }, { announce = speak, force = false, prefix = '' } = {}) {
    last = { lat, lon };
    // Hover and arrow keys are throttled (150 ms) so notes and announcements do not pile up.
    const now = performance.now();
    if (!force && now - lastAt < 150) return;
    lastAt = now;
    const t = time.now();
    const v = dataset.valueAt(lat, lon, t);
    if (v == null) {
      if (announce) describe(`${prefix}No data near ${fmt(lat, lon)}`);
      return;
    }
    const around = neighborhood(lat, lon, t);
    const n = norm(v);
    const spread = around.length ? Math.max(...around, n) - Math.min(...around, n) : 0;
    const rough01 = Math.min(1, spread * 3);
    const harmonics = 1 + Math.round(rough01 * 6);
    sound.play({
      freq: quantize(n, [0, 1], scale, noteHz(-24), noteHz(12)).freq, harmonics, pan: lon / 180,
      amplitude: 0.25, duration: 0.35, voice: 'probe',
      // Patchy spots also get a breathy edge, so smooth and rough areas are easy to tell apart.
      ...(rough01 > 0.1 && { noise: { amount: rough01 * 0.3, attack: 0.01, decay: 0.25, cutoff: 2500 } }),
    });
    if (announce) {
      const rough = harmonics > 4 ? ', rough' : harmonics > 2 ? ', varied' : '';
      describe(`${prefix}${fmtV(v)} near ${fmt(lat, lon)}${rough}`);
    }
  }

  const offHover = input.onHover((p) => probe(p));
  const offClick = input.onClick((p) => probe(p, { announce: true, force: true }));
  const offFrame = time.onFrame(() => {
    if (time.playing) { if (last) probe(last, { announce: false, force: true }); return; }
    if (last) probe(last, { announce: true, force: true, prefix: `${time.label()}: ` });
    else describe(time.label());
  });

  soundHint(panel, sound, 'move over the map. Without sound, values are still announced.');
  describe(`Ozone probe ready. ${dataset.count} frames. Focus the map and use the arrow keys.`);
  return () => { offHover(); offClick(); offFrame(); };
}
