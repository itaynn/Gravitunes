# Ozone probe

Dataset: [SVS 5152](https://svs.gsfc.nasa.gov/5152), near-surface ozone, 5 to 60 ppbv.

| Data | Sound |
|---|---|
| ppbv under the cursor | pitch, on a pentatonic scale (low = low note) |
| spread of values in the neighborhood (8 points, "Neighborhood size" degrees away) | number of harmonics (smooth = pure tone, patchy = bright) |
| longitude | stereo pan (west = left, east = right) |

Keyboard: focus the map, then arrow keys move 5° (Shift 1°, Alt 20°), Home goes to 0°,0°, Enter announces the spot.
The timeline Play button animates the frames; the note at the current spot replays on each frame.

Caveat: values are decoded from frame colors (see `app/core/colorbar.js`). Grey/black areas are treated as
the low end of the range, because SVS fades low values to transparent over a grey Earth.
