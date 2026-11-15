# World orchestra

An instrument-comparison map. About 60 musical regions (`data/earth/musical-centers.json`), each with a
recorded instrument (`data/earth/instruments.json`, samples in `sound-engine/library/samples`). No dataset.

- **Play:** click or tap a region, or move with the arrow keys and press Enter. `[` and `]` jump between regions.
  Hover and arrow keys only announce the region and instrument; they never play.
- **Same notes everywhere:** Pitch (C3 to C5, default C4), Melody (Single note, Scale up, Arpeggio, Short tune)
  and Scale apply to every region, so only the timbre differs. Nothing goes above A5.
- **Visuals:** a faint tint per region and instrument labels; the clicked region gets a yellow outline and is
  announced ("Playing South Asia: Sitar, ...").

Tests: `node app/modes/world-orchestra/test.mjs`.
