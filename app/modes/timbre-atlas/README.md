# Timbre atlas

The world map with its musical regions (`data/earth/musical-centers.json`) and nothing else. Move the mouse,
touch, or use the arrow keys on the map: the region under you plays a short idiomatic phrase in its voice
(`data/earth/instruments.json`, field `gesture`), blended with the neighbouring voice near borders. A new
phrase starts when the region changes, or once the current one has finished (at least 400 ms). The instrument,
"inspired by" and region are shown and announced.

Controls: volume, phrase on/off (off = one tonic note), base pitch (F2 to C4; phrases shift down by octaves
so nothing goes above C5; the adapter keeps overtones under 5 kHz).

Expressive voice fields (used here and in world-orchestra): `vibrato`, `slide`, `wah` (driven by
`handle.set` ramps in `app/core/sound.js`), `gesture` (scale cents, steps, gap, tremolo, bend).

Tests: `node app/modes/timbre-atlas/test.mjs`.
