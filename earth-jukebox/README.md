# Earth Jukebox: precipitation ball

A no-dependency browser experiment that plays the local NASA SVS 4285 precipitation visualization and lets passing precipitation patches set a ball in motion.

## Run locally

From the repository root, start a static server:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000/earth-jukebox/](http://localhost:8000/earth-jukebox/) for the motion experiment, or [http://localhost:8000/earth-jukebox/sonification.html](http://localhost:8000/earth-jukebox/sonification.html) for the standalone sound demo. Serve from the repository root so both demos can load their local NASA inputs from `../data/nasa-svs/`.

## Use

1. Click or tap the video to place the ball.
2. The ball remains still until a colored precipitation patch reaches it. If you place it directly on a colored patch, contact triggers immediately. Click **Reset** to place it again.
3. Use the controls to pause the video, adjust the color-driven impulse, and set how long the ball retains its momentum.

Keyboard: tab to focus the map, use the arrow keys to position a placed ball, and press Enter to place it at the center.

The page samples the rendered video at low resolution and estimates precipitation intensity from saturated color. A change from uncolored to colored at the ball's position marks contact. Color strength controls the impulse size; the local intensity gradient estimates the precipitation blob's edge normal and directs the impulse into the patch. There is no gravity, terrain slope, or self-propelled movement. After a contact impulse, the inertia slider sets the velocity half-life.

This is an artistic interaction, **not** a temperature, elevation, or scientific precipitation measurement. The MP4 is a prerecorded visualization, and its displayed color is not a raw data layer. The visual can include labels, map imagery, and separate rain/snow palettes; color sampling can therefore misclassify pixels.

## Standalone sonification demo

The separate [`sonification.html`](./sonification.html) demo uses NASA's [7 November 2026 IMERG frame](https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/frames/3600x1800_2x1_30p/flatalpha/imergert_alpha.2026-11-07T00:00:00Z.png). Its local input is included in the repository at [`../data/nasa-svs/4285-imergert-2026-11-07.png`](../data/nasa-svs/4285-imergert-2026-11-07.png) (3600 × 1800 PNG). The demo reads each image column and plays a continuous progression of smooth synthesized tones, with each pitch's sustained voice following the image. Its pass-length control sets the total time for all 3,600 columns (1–60 seconds, default one minute). The full piano range maps to 88 equal-height bands, from A0 at the bottom to C8 at the top; the strongest colored pixel in each band controls that note's volume.

The mapping is an artistic interpretation of the image colors, not a scientific measurement. Use **Play sound** to start audio; browsers require this user interaction before sound can play.

## Sound lab (mapping playground)

Below the scan-line demo, `sonification.html#sound-lab` plays the moving SVS 4285 video. It lets you choose which weather input drives which sound parameter, all live.

- **Inputs (what the map does):** X (west → east), Y (south → north), X speed, Y speed, Spin (counterclockwise vs. clockwise), Color (light → heavy, read from the NASA legend), and Rain/Snow.
  - Speed and spin are estimated from how the colored patches move between frames (optical flow), then scaled to how active the map currently is. The middle of a bar means still.
- **Outputs (what you hear):** Pitch, Amplitude, Overtones (dark → bright), Instrument, Chord, Notes, Note length, Pan, and Vibrato.
  - Instruments: sustained ones are soft pad, choir, strings, organ, pure tone, flute, clarinet, cello, brass, synth lead, glass harmonica and wind. Struck ones are pluck, marimba, bell, glockenspiel, harp, vibraphone, kalimba, electric piano and music box.
  - Notes: *Flowing* is continuous. A sustained instrument holds one tone whose pitch, loudness and tone glide as the map moves. A struck instrument rings whenever the voice reaches a new note, and rings again as each note dies away. The other options strike on a tempo grid, from every 2 bars to sixteenths.
- **Rain and snow sounds:** rain and snow each have their own profile, with their own key, scale, instrument and ranges. Every voice plays both, crossfaded by how much snow is around it, smoothed over about a second, so moving from rain into snow fades one sound into the other. The *Rain ↔ snow blend* control sets how gradual that fade is. On the map, a voice's marker morphs from a green circle (rain) to a cyan diamond (snow), matching the NASA legend colors. By default rain is an organ in C pentatonic, and snow is a higher glockenspiel in C Lydian.
- **Fading with the color:** in the video modes, each voice's volume follows how much rain or snow color is right under it.
  - Full color means full volume. As the color thins toward the edge of a patch, the voice fades (smoothed over about 0.3 s), and it goes silent where the map has no color. Its halo dims with it.
  - The voices table shows "fading to 40%" or "silent (no color here)".
  - The *Color threshold* control sets how much color counts as full.
- **Seeing what you hear:**
  - Each voice is labeled with the notes and instrument it is playing, with percentages while rain and snow blend.
  - Its halo grows with its loudness, and a trail shows the path that made the melody.
  - When Pitch is driven by X or Y, the note grid shows the note each place plays, and lights up the band each voice is in. It's the same idea as the 88-band grid in the scan-line demo, but it follows your current range and scale.
- **For each output row:**
  - Pick one input, or *Manual* to set a fixed value yourself.
  - Pick a shape: Normal, Inverted, Strength (ignores direction), or Calmness.
  - Set the From/To range.
- **Who plays:**
  - *Storm Watch (snapshots)* shows still pictures rather than the video, stepping through them one by one. It plays the storms that our storm tracker (`storm-tracker/` on the `clustering` branch) follows through the 48 half-hourly IMERG snapshots of 7 Nov 2026.
    - Each of the biggest storms is one voice, and it keeps that voice as long as the tracker keeps its ID. A much larger storm can take over the quietest voice.
    - When a storm merges, its voice carries on as the merged storm. A merge or split plays a full chord on the next beat, and a ring marks it on the map.
    - The map shows the snapshot with every tracked outline. The storms you hear are filled in their Storm Watch color, brighter while loud and flashing when they strike, and labeled with the storm ID and the notes they play.
    - Click a storm (or use ← / → on the focused map) to hear it alone, and press Escape to hear them all again.
    - Its inputs come from the tracker:
      - X and Y come from the storm's core.
      - Speed comes from how far the core moves between snapshots.
      - Spin is how fast the outline's long axis turns.
      - Color is the heaviest precipitation near the core, and Rain/Snow comes from the snapshot colors.
      - The new **Size** input comes from the storm's area.
    - A day takes 2 minutes at 1× map speed.
  - *Follow storms* tracks the strongest precipitation patches.
  - *Scan line* sweeps west to east and plays the patches it crosses.
  - *My probes* lets you click the map to drop listening points; they can drift with the weather.
  - *Whole map* turns the map into 24 latitude bands that all sound at once. Each band is as loud as its coverage, panned to where its precipitation sits, and colored rain → snow. Each band glows as loud as it sounds.
- **Global controls:** voices, tempo, map speed, color threshold, pitch glide (steps → slides), rain ↔ snow blend (switch → gradual), reverb, volume, and solo one voice. Key, scale and snap to scale are set separately for rain and for snow.
- **Strict tuning (on by default):** every note sits exactly on the scale.
  - Pitch changes land on the eighth-note grid instead of sliding.
  - There is no vibrato and no chorus detune.
  - Bell-like instruments use partials on the note's harmonics.
  - Turn it off under *Tuning* for the expressive version, with glide, vibrato and detune.
  - Chords in scales that don't have 7 notes (pentatonic, whole tone, chromatic) use the scale note nearest each real chord interval, so a "5th" is a 5th.
- **Saving and sharing:** presets and *Randomize* give you starting points. *Copy mapping* copies a readable summary plus JSON to share with the team. Settings are saved in your browser.

## Parameter lab (decide what sounds best)

[`paramlab.html`](./paramlab.html) (linked from the Sound lab) lays out every Sound lab sound parameter as a card, played with the same instruments and synth:

- **Solo** any parameter to hear only it change, against a plain reference (pure tone, middle C, quarter notes, C major). Range rows can sweep From → To or hold either end; Instrument, Chord, Notes and Key & scale can also cycle through every option, two bars each. Voices, tempo, glide and reverb have solos too.
- **In the mix** on each card sets what that parameter does when you press *Play all together*: off (reference), From, To, or Sweep. All sweeping parameters move together, like one storm crossing the map. *Rain ↔ snow* plays both sounds and fades between them with the blend setting.
- **Candidates:** save the current settings by name, then press ▶ on another candidate while one plays to switch instantly (A/B).
- **Send to Sound lab** writes the chosen rain/snow sounds and global sound into the Sound lab's saved settings (what drives each row is kept); *Load from Sound lab* goes the other way. On a first visit the page starts from the Sound lab's current settings.

The synth engine in `paramlab.js` is a copy of the one in `soundlab.js`; if you change an instrument in one, change it in the other.

Files: [`soundlab.js`](./soundlab.js) and [`soundlab.css`](./soundlab.css); [`paramlab.js`](./paramlab.js) and [`paramlab.css`](./paramlab.css). Like the other demos, it needs to be served from localhost so the video pixels can be read.

Storm Watch data: [`data/storm-watch/`](./data/storm-watch/) is a copy of `storm-tracker/data/preprocessed-tracks.json` and `storm-tracker/data/snapshots/` from the `clustering` branch. In the snapshot file names, `:` is replaced with `-`, because Windows can't store `:` in a file name (`imergert_alpha.2026-11-07T00-00-00Z.png`). If the tracker data is regenerated, copy it here again.

## Source and attribution

Video: [Near Real-Time Global Precipitation from the Global Precipitation Measurement Constellation (SVS 4285)](https://svs.gsfc.nasa.gov/4285/), local file `../data/nasa-svs/4285-imergert-current.mp4`.

Still frame: [IMERG precipitation visualization, 2026-11-07 00:00 UTC (SVS 4285)](https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/frames/3600x1800_2x1_30p/flatalpha/imergert_alpha.2026-11-07T00:00:00Z.png), local file `../data/nasa-svs/4285-imergert-2026-11-07.png`.

Visualizations by Horace Mitchell (NASA/GSFC). Scientific consulting by George Huffman, Gail Skofronick Jackson, and Dalia B. Kirschbaum (NASA/GSFC). Consult the source page for complete metadata and reuse terms.
