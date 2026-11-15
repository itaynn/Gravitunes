# Precipitation ball

By **itay**, brought over from his `clustering` branch (`earth-jukebox/`).

A no-dependency browser experiment that plays the local NASA SVS 4285 precipitation visualization and lets passing precipitation patches set a ball in motion.

## Run locally

From the repository root, start a static server:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000/app/modes/precipitation-ball/](http://localhost:8000/app/modes/precipitation-ball/) for the motion experiment. Serve from the repository root so the page can load the shared SVS 4285 video from `data/nasa-svs/4285/`.

## Use

1. Click or tap the video to place the ball.
2. The ball remains still on flat ground. Red and blue precipitation raise the sampled surface; when the ball is on a raised slope, it accelerates downhill. Click **Reset** to place it again.
3. Use the controls to pause the video, adjust surface force from 0.4× to 100× (starting at 30×), and set surface friction from none to high. Higher friction values shed momentum faster.
4. Click **Sound off** to enable the procedural storm ambience and motion tone. Storm sound plays while the ball is on a raised slope. The **Shape the sound** controls let you map pitch and loudness to rain, speed, or slope; choose a scale, tone waveform, harmony, storm texture, and stereo position. The storm and motion volume sliders and pitch response remain independently adjustable.

Keyboard: tab to focus the map, use the arrow keys to position a placed ball, and press Enter to place it at the center.

The visible video is NASA's local 1920×1080 MP4 source at `../../../data/nasa-svs/4285/4285-imergert-current.mp4`; it is not replaced by a low-resolution preview. The browser scales it responsively to fit the page, preserving its source aspect ratio. Only the separate physics sampling path downsamples video frames to a 160×90 height field. Saturated red and blue channel values are added into one height value; black and low-saturation colors are flat. A smoothed, central-difference height gradient is calculated at the ball. Its negative is the downhill acceleration vector: `a = -380 × surface force × ∇height` in canvas pixels per second squared, so steeper slopes accelerate the ball more strongly. Speed is capped at 900 canvas pixels per second. There is no gravity or self-propelled movement. Surface friction applies exponential velocity decay (`v *= exp(-friction × elapsed time)`); zero friction preserves momentum, and increasing the friction rate makes the ball slow down faster.

Sound effects are synthesized locally with the Web Audio API and do not load external audio. Sound starts only after pressing **Sound off**, as browsers require a user gesture before playing audio. The storm ambience is filtered noise and a low rumble while the ball contacts a raised slope. The tone maps the selected values to notes in the selected scale and adjusts loudness by the chosen field; waveform and harmony are configurable, and stereo can follow the ball's horizontal position. Sound controls do not affect the physics.

This is an artistic interaction, **not** a temperature, elevation, or scientific precipitation measurement. The MP4 is a prerecorded visualization, and its displayed color is not a raw data layer. The visual can include labels, map imagery, and separate rain/snow palettes; color sampling can therefore misclassify pixels.

## Source and attribution

Video: [Near Real-Time Global Precipitation from the Global Precipitation Measurement (GPM) Constellation (SVS 4285)](https://svs.gsfc.nasa.gov/4285/). The repository bundles NASA's [`imergert_1080p_30.mp4`](https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/imergert_1080p_30.mp4) as `data/nasa-svs/4285/4285-imergert-current.mp4` (1920×1080, 30 fps).

Visualizations by Horace Mitchell (NASA/GSFC). Scientific consulting by George Huffman, Gail Skofronick Jackson, and Dalia B. Kirschbaum (NASA/GSFC). Consult the source page for complete metadata and reuse terms.
