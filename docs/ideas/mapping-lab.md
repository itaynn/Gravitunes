# Mapping lab

**Status:** idea

## What you hear
Play the animation and points on the map sound as the data rises. The listener chooses, from dropdowns, what controls each part of the sound — e.g. longitude → pitch, latitude → depth — and hears the same data in different ways.

## Mapping
- Data: any dataset with a value grid (ozone first).
- Points: coarse grid of ~300 points (land and ocean).
- Trigger: a point plays when its value rises past a threshold between frames (default 70th percentile); per-point cooldown and notes-per-frame cap (same as world orchestra).
- Sources (each dropdown picks one, or "off"): longitude (X), latitude (Y), value, change (how fast the value is rising).
- Sound parameters (one dropdown each):
  - pitch (quantized to the chosen scale, range ≈C2–C5)
  - loudness
  - pan
  - brightness (how many overtones)
  - depth (low-pass / EQ: dark → bright)
  - attack (soft → plucky)
  - timbre family (morph along voices, e.g. organ → bell → flute)
- Each mapping has a direction toggle (low→high or high→low).
- Presets: Classic (value→pitch, lon→pan, value→loudness), Deep south (lat→depth, value→pitch), Storm rush (change→attack, change→brightness), Around the world (lon→timbre family, lat→pitch).
- Shareable: the current mapping is saved in the URL.
- Interaction: play/speed, scale, threshold, density; hover or arrow keys play one point with the current mapping and announce the values ("value 45 → pitch D3, latitude 30°N → depth dark").

## Build as a demo
- Mode folder: `app/modes/mapping-lab/`
- Reuses: threshold triggering and grid loading from world orchestra (move shared parts to `app/core/`), voices from `data/earth/instruments.json` for the timbre family.
- Needs from sound-engine: a low-pass filter per note for depth (check; else add).
- Open questions: none.
