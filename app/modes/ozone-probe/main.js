// Ozone probe: the ppbv under the cursor plays a pentatonic note.
// pitch <- value, harmonics <- roughness (spread) of the neighborhood, pan <- longitude.
export default function start(ctx) {
  const { dataset, time, input, sound, panel, describe } = ctx;
  // norm: 0..1 over the range (log space for log datasets such as NOx).
  const norm = dataset.norm || ((v) => Math.max(0, Math.min(1, (v - dataset.range[0]) / (dataset.range[1] - dataset.range[0] || 1))));
  const fmtV = dataset.format || ((v) => `${Math.round(v)} ${dataset.units}`);
  let radius = 2;            // neighborhood radius in degrees
  let speak = true;
  let last = null;           // last probed position

  panel.slider('Neighborhood size', {
    min: 0, max: 10, step: 1, value: radius,
    hint: 'Wider neighborhoods make rough areas sound brighter (more harmonics).',
    format: (v) => `${v} degrees`,
  }, (v) => { radius = v; });
  panel.checkbox('Speak values', speak, (v) => { speak = v; });
  panel.button('Describe this spot', () => last && probe(last, { announce: true }));

  function neighborhood(lat, lon, t) {
    if (!radius) return [];
    const vals = [];
    for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const v = dataset.valueAt(lat + dy * radius, lon + dx * radius, t);
      if (v != null) vals.push(norm(v));
    }
    return vals;
  }

  const fmt = (lat, lon) =>
    `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? 'E' : 'W'}`;

  function probe({ lat, lon }, { announce = speak } = {}) {
    last = { lat, lon };
    const t = time.now();
    const v = dataset.valueAt(lat, lon, t);
    if (v == null) {
      if (announce) describe(`No data near ${fmt(lat, lon)}`);
      return;
    }
    const around = neighborhood(lat, lon, t);
    const n = norm(v);
    const spread = around.length ? Math.max(...around, n) - Math.min(...around, n) : 0;
    const harmonics = 1 + Math.round(Math.min(1, spread * 3) * 6);
    sound.play({
      value: n, range: [0, 1], harmonics, pan: lon / 180,
      amplitude: 0.25, duration: 0.35, voice: 'probe',
    });
    if (announce) {
      const rough = harmonics > 4 ? ', rough' : harmonics > 2 ? ', varied' : '';
      describe(`${fmtV(v)} near ${fmt(lat, lon)}${rough}`);
    }
  }

  const offHover = input.onHover((p) => probe(p));
  const offClick = input.onClick((p) => probe(p, { announce: true }));
  const offFrame = time.onFrame(() => {
    if (last) probe(last, { announce: false });
    if (!time.playing) describe(time.label());
  });

  if (!sound.started) panel.text('Press "Start sound" to hear the map. Without sound, values are still announced.');
  describe(`Ozone probe ready. ${dataset.count} frames. Focus the map and use the arrow keys.`);
  return () => { offHover(); offClick(); offFrame(); };
}
