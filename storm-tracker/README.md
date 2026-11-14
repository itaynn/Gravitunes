# Storm Watch

Storm Watch is a browser-based experiment that groups precipitation regions into storms and follows them through 48 bundled NASA IMERG snapshots.

## Run locally

Serve the repository root with a local HTTP server, then open `/storm-tracker/`. The page loads the PNG snapshots and reference MP4 from this folder, so it is not intended to be opened as a `file://` URL. No build step or external runtime dependencies are required.

Tracker parameter changes are saved in the browser's local storage and restored the next time the page is opened in that browser.

## Segmentation and tracking

Each 3600 × 1800 image is analyzed at 900 × 450 pixels. The alpha channel identifies precipitation pixels. Saturated red and blue/cyan heatmap colors are treated as storm-core hints; nearby core patches are grouped using their distance and average RGB color. A weighted region-growing pass then assigns precipitation pixels to those seeds using geodesic distance and similarity to each growing region's average color. If a separate precipitation area has no red/blue core hint, its strongest available core-color pixel becomes a fallback seed. Regions smaller than the configurable minimum area are ignored.

Across snapshots, storm regions are associated using dark, saturated red/blue core positions, motion-predicted mask overlap, area similarity, and average-color similarity. Core proximity is the strongest association signal; mask centroid motion does not drive the track velocity. When regions merge, separate core anchors are preserved and matched to the next frame's core patches where possible. The selected core is marked in the display. Horizontal matching, velocity, and predicted overlays wrap across the map's longitude seam. Merged sources are consumed by the merge so they cannot be matched again as independent missing storms. Split detection requires actual predicted mask overlap, not just nearby centroids. Merges retain their lineage, so selecting a member of a merged family keeps every separated part highlighted after a split. During short detection gaps, the selected mask is shown at its motion-predicted location for the configured memory duration; after that, the UI reports that the track is no longer detected.

The method is an image-space heuristic, not a meteorological storm product: it does not use wind fields, precipitation intensity values, or a geospatial motion model. Thresholds are exposed for experimentation, and ambiguous storm boundaries may need tuning. Minimum area and all distances are measured on the 900 × 450 analysis grid.

The 48-snapshot playback pass has a fixed total runtime of 12.5 seconds.

## Inputs and attribution

The project bundles the 48 half-hourly PNG snapshots for 2026-11-07 and the NASA SVS 4285 animation in `data/nasa-svs/4285-imergert-current.mp4`. The source is linked from the page at [NASA Scientific Visualization Studio: IMERG](https://svs.gsfc.nasa.gov/4285/).
