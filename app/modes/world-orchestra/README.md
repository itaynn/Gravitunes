# World orchestra

About 280 major cities (`data/earth/cities.json`) are listening points. Each hour, a city whose value
rises past the threshold (previous hour below, this hour at or above) plays one note.

- **Voice:** the instrument of the nearest musical center (`data/earth/musical-centers.json`), crossfaded
  with the second-nearest within a 900 km blend zone. Voices (`data/earth/instruments.json`) are
  hand-synthesized impressions *inspired by* organ, guzheng, gamelan, sitar, koto, kora, balafon, oud,
  pan flute, Celtic harp, marimba, balalaika, bandoneón, didgeridoo, banjo, mbira, duduk, bouzouki, plus
  an ocean pad. They are not recordings or faithful models.
- **Pitch:** value, quantized to the chosen scale (pentatonic default; slendro and pelog use the sound
  engine's gamelan cents). Range is low to mid: default G2 to G4, adjustable within C2 to C5. Upper
  partials roll off as pitch rises (and above 4 kHz are dropped) so bright voices are not shrill.
- **Loudness:** value. **Pan:** longitude.
- **Controls:** play/pause, speed (hours per second), scale, threshold (default: dataset 70th percentile),
  max notes per hour, per-city cooldown, lowest/highest note, volume, center legend.
- **Explore:** hover, touch or arrow keys play the blended voice of that spot once and announce, e.g.
  "Delhi region: sitar-inspired, 48 ppbv". While playing, a summary is announced every 5 s
  ("Playing: East Asia, South Asia; 12 notes in the last 6 hours").
- **Visuals:** a faint tint per center region, white city dots that flash in the region color when they play,
  instrument labels when the legend is shown.

Works with any dataset that has a descriptor and a value grid (`?dataset=<id>`); ozone 5152 is the default.

Tests: `node app/modes/world-orchestra/test.mjs` (nearest center and blending, triggering, scale
quantization, and decoding the real 256x128 grid when `data/nasa-svs/5152/web/5152_256x128.bin` exists).
