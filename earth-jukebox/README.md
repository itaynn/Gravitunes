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

## Source and attribution

Video: [Near Real-Time Global Precipitation from the Global Precipitation Measurement Constellation (SVS 4285)](https://svs.gsfc.nasa.gov/4285/), local file `../data/nasa-svs/4285-imergert-current.mp4`.

Still frame: [IMERG precipitation visualization, 2026-11-07 00:00 UTC (SVS 4285)](https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/frames/3600x1800_2x1_30p/flatalpha/imergert_alpha.2026-11-07T00:00:00Z.png), local file `../data/nasa-svs/4285-imergert-2026-11-07.png`.

Visualizations by Horace Mitchell (NASA/GSFC). Scientific consulting by George Huffman, Gail Skofronick Jackson, and Dalia B. Kirschbaum (NASA/GSFC). Consult the source page for complete metadata and reuse terms.
