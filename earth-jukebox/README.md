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
2. The ball remains still until a colored precipitation patch reaches it. If you place it directly on a colored patch, contact triggers immediately. Click **Reset** to place it again.
3. Use the controls to pause the video, adjust the color-driven impulse, and set how long the ball retains its momentum.

Keyboard: tab to focus the map, use the arrow keys to position a placed ball, and press Enter to place it at the center.

The page samples the rendered video at low resolution and estimates a height field from saturated red and blue colors; black and other colors are treated as flat. A change from flat to raised color at the ball's position marks contact. Color strength controls the impulse size, and the negative local height gradient points downhill, away from a raised red/blue peak. There is no gravity or self-propelled movement. After a contact impulse, the inertia slider sets the velocity half-life.

This is an artistic interaction, **not** a temperature, elevation, or scientific precipitation measurement. The MP4 is a prerecorded visualization, and its displayed color is not a raw data layer. The visual can include labels, map imagery, and separate rain/snow palettes; color sampling can therefore misclassify pixels.

## Source and attribution

Video: [Near Real-Time Global Precipitation from the Global Precipitation Measurement (GPM) Constellation (SVS 4285)](https://svs.gsfc.nasa.gov/4285/), local file `../data/nasa-svs/4285-imergert-current.mp4`.

Visualizations by Horace Mitchell (NASA/GSFC). Scientific consulting by George Huffman, Gail Skofronick Jackson, and Dalia B. Kirschbaum (NASA/GSFC). Consult the source page for complete metadata and reuse terms.
