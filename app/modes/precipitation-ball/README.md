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
4. Click **Sound off** to enable the musical voice. By default, the ball plays warm keys in a major chord; use **Shape the sound** to choose an instrument, chord, note rhythm, scale, and whether pitch and loudness follow rain, speed, or slope. Storm ambience is off by default and can be added separately. Stereo can follow the ball's position.

Keyboard: tab to focus the map, use the arrow keys to position a placed ball, and press Enter to place it at the center.

The visible video is NASA's local 1920×1080 MP4 source at `../../../data/nasa-svs/4285/4285-imergert-current.mp4`; it is not replaced by a low-resolution preview. The browser scales it responsively to fit the page, preserving its source aspect ratio. Only the separate physics sampling path downsamples video frames to a 160×90 height field. Saturated red and blue channel values are added into one height value; black and low-saturation colors are flat. A smoothed, central-difference height gradient is calculated at the ball. Its negative is the downhill acceleration vector: `a = -380 × surface force × ∇height` in canvas pixels per second squared, so steeper slopes accelerate the ball more strongly. Speed is capped at 900 canvas pixels per second. There is no gravity or self-propelled movement. Surface friction applies exponential velocity decay (`v *= exp(-friction × elapsed time)`); zero friction preserves momentum, and increasing the friction rate makes the ball slow down faster.

Sound is synthesized locally with the Web Audio API and does not load external audio. It starts only after pressing **Sound off**, as browsers require a user gesture before playing audio. The ball's musical voice maps the selected field to a scale-quantized pitch and chord, with selectable timbre, flowing or pulsing rhythm, loudness, and stereo position. Filtered storm noise and rumble are an optional ambience layer while the ball contacts a raised slope. Sound controls do not affect the physics.

This is an artistic interaction, **not** a temperature, elevation, or scientific precipitation measurement. The MP4 is a prerecorded visualization, and its displayed color is not a raw data layer. The visual can include labels, map imagery, and separate rain/snow palettes; color sampling can therefore misclassify pixels.

## Source and attribution

Video: [Near Real-Time Global Precipitation from the Global Precipitation Measurement (GPM) Constellation (SVS 4285)](https://svs.gsfc.nasa.gov/4285/). The repository bundles NASA's [`imergert_1080p_30.mp4`](https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/imergert_1080p_30.mp4) as `data/nasa-svs/4285/4285-imergert-current.mp4` (1920×1080, 30 fps).

Visualizations by Horace Mitchell (NASA/GSFC). Scientific consulting by George Huffman, Gail Skofronick Jackson, and Dalia B. Kirschbaum (NASA/GSFC). Consult the source page for complete metadata and reuse terms.
