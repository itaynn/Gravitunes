# World orchestra

**Status:** building

## What you hear
Play the animation and cities "pluck" as pollution rises past them, each in an instrument inspired by its region: organ in Germany, guzheng in China, gamelan in Indonesia.

## Mapping
- Data: any dataset with a value grid (ozone 5152 first).
- Places: ~200–300 major cities (`data/earth/cities.json`); each takes the voice of its nearest musical center (`data/earth/musical-centers.json`), blended near borders.
- Trigger: a city plays when its value rises past a threshold (default: 70th percentile); per-city cooldown, notes-per-frame cap.
- Pitch: value, quantized to the chosen scale (pentatonic default; pelog, slendro), range ≈C2–C5.
- Loudness: value. Pan: longitude. Timbre: hand-made presets in `data/earth/instruments.json` (later: library presets from real recordings).
- Interaction: play/speed, scale, threshold, density; hover or arrow keys play one place and announce it.

## Build as a demo
- Mode folder: `app/modes/world-orchestra/`
- Open questions: oceans silent or a soft pad; how busy is pleasant.
