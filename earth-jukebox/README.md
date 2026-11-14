# Earth Jukebox: precipitation ball

A no-dependency browser experiment that plays the local NASA SVS 4285 precipitation visualization and lets passing precipitation patches set a ball in motion.

## Run locally

From the repository root, start a static server:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000/earth-jukebox/](http://localhost:8000/earth-jukebox/) for the motion experiment. Serve from the repository root so the page can load the shared SVS 4285 video from `data/nasa-svs/`.

## Use

1. Click or tap the video to place the ball.
2. The ball remains still on flat ground. Red and blue precipitation raise the sampled surface; when the ball is on a raised slope, it accelerates downhill. Click **Reset** to place it again.
3. Use the controls to pause the video, adjust surface force from 0.4× to 100× (starting at 30×), and set surface friction from none to high. Higher friction values shed momentum faster.
4. Click **Sound off** to enable the procedural storm ambience and motion tone. Storm sound plays while the ball is on a raised slope; the tone rises with speed and acceleration. Adjust the storm and motion volumes and pitch response independently.

Keyboard: tab to focus the map, use the arrow keys to position a placed ball, and press Enter to place it at the center.

The page plays the local WebM encoding first, with the local MP4 as a browser-codec fallback, and samples the rendered video at low resolution. Saturated red and blue channel values are added into one height value; black and low-saturation colors are flat. A smoothed, central-difference height gradient is calculated at the ball. Its negative is the downhill acceleration vector: `a = -380 × surface force × ∇height` in canvas pixels per second squared, so steeper slopes accelerate the ball more strongly. Speed is capped at 900 canvas pixels per second. There is no gravity or self-propelled movement. Surface friction applies exponential velocity decay (`v *= exp(-friction × elapsed time)`); zero friction preserves momentum, and increasing the friction rate makes the ball slow down faster.

Sound effects are synthesized locally with the Web Audio API and do not load external audio. Sound starts only after pressing **Sound off**, as browsers require a user gesture before playing audio. The storm ambience is filtered noise and a low rumble while the ball contacts a raised slope. A soft two-note tone follows ball speed and surface acceleration; the sound sliders adjust their levels and pitch response.

This is an artistic interaction, **not** a temperature, elevation, or scientific precipitation measurement. The MP4 is a prerecorded visualization, and its displayed color is not a raw data layer. The visual can include labels, map imagery, and separate rain/snow palettes; color sampling can therefore misclassify pixels.

## Source and attribution

Video: [Near Real-Time Global Precipitation from the Global Precipitation Measurement (GPM) Constellation (SVS 4285)](https://svs.gsfc.nasa.gov/4285/), local files `../data/nasa-svs/4285-imergert-current.webm` (preferred) and `../data/nasa-svs/4285-imergert-current.mp4` (fallback).

Visualizations by Horace Mitchell (NASA/GSFC). Scientific consulting by George Huffman, Gail Skofronick Jackson, and Dalia B. Kirschbaum (NASA/GSFC). Consult the source page for complete metadata and reuse terms.
