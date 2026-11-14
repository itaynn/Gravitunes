# Scanning line

By **itay**, brought over from his `scanning-line-demo` branch (`earth-jukebox/sonification.html`, `sonification.js`, `sonification.css`, plus the `styles.css` it shared with the motion demo at that time). `sonification.html` is now `index.html`.


This demo uses NASA's [7 November 2026 IMERG frame](https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/frames/3600x1800_2x1_30p/flatalpha/imergert_alpha.2026-11-07T00:00:00Z.png). Its local input is included in the repository at `data/nasa-svs/4285/4285-imergert-2026-11-07.png` (3600 × 1800 PNG). The demo reads each image column and plays a continuous progression of smooth synthesized tones, with each pitch's sustained voice following the image. Its pass-length control sets the total time for all 3,600 columns (1–60 seconds, default one minute). The full piano range maps to 88 equal-height bands, from A0 at the bottom to C8 at the top; the strongest colored pixel in each band controls that note's volume.

The mapping is an artistic interpretation of the image colors, not a scientific measurement. Use **Play sound** to start audio; browsers require this user interaction before sound can play.


## Run

From the repo root: `python3 -m http.server 8000`, then open http://localhost:8000/app/modes/scanning-line/

## Source and attribution

Still frame: [IMERG precipitation visualization, 2026-11-07 00:00 UTC (SVS 4285)](https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/frames/3600x1800_2x1_30p/flatalpha/imergert_alpha.2026-11-07T00:00:00Z.png), local file `data/nasa-svs/4285/4285-imergert-2026-11-07.png`.

Visualizations by Horace Mitchell (NASA/GSFC). Scientific consulting by George Huffman, Gail Skofronick Jackson, and Dalia B. Kirschbaum (NASA/GSFC). Consult the source page for complete metadata and reuse terms.
