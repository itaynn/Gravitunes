# NASA Earth Information Center and SVS Catalog

**Catalog checked:** 2026-11-14
**Primary source:** [NASA Scientific Visualization Studio (SVS), Earth Information Center gallery](https://svs.gsfc.nasa.gov/gallery/earth-information-center/)

This note records the SVS gallery structure, machine-readable metadata routes, time-sensitive visualizations, and a small set of downloaded image snapshots. The catalog is a living site: check the linked record and its `update_date` before relying on a visualization as current.

## What is in the EIC gallery

The [EIC gallery](https://svs.gsfc.nasa.gov/gallery/earth-information-center/) describes content used in the EIC hyperwall and groups it as follows:

| Gallery section | Entries | Examples and links |
|---|---:|---|
| EIC Dashboards | 6 | [Earth Now](https://svs.gsfc.nasa.gov/gallery/earth-now-dashboard/), [Climate Vital Signs](https://svs.gsfc.nasa.gov/gallery/climate-vital-signs-dashboard/), [Greenhouse Gases](https://svs.gsfc.nasa.gov/gallery/greenhouse-gases-dashboard/), [Carbon Dioxide Sources and Sinks](https://svs.gsfc.nasa.gov/gallery/carbon-dioxide-sources-sinks/), [Air Quality](https://svs.gsfc.nasa.gov/gallery/air-quality-dashboard/), [Wildland Fires](https://svs.gsfc.nasa.gov/gallery/wildland-fires/) |
| EIC Videos | 8 | [NASA and Hurricanes](https://svs.gsfc.nasa.gov/gallery/nasaand-hurricanes/), [NASA and Agriculture](https://svs.gsfc.nasa.gov/gallery/nasaand-agriculture/), [NASA + Smithsonian: Biodiversity](https://svs.gsfc.nasa.gov/14700/), [NASA and Fire](https://svs.gsfc.nasa.gov/14606/), [NASA + Smithsonian and Greenhouse Gases](https://svs.gsfc.nasa.gov/14696/), [Tracking Methane](https://svs.gsfc.nasa.gov/14568/), [Chimpanzee Habitat Conservation](https://svs.gsfc.nasa.gov/14507/), [Coastal Resilience](https://svs.gsfc.nasa.gov/14713/) |
| EIC Beauty Pieces | 9 | Includes [GEDI Forest Height](https://svs.gsfc.nasa.gov/4950/), [Atmospheric River](https://svs.gsfc.nasa.gov/4960/), [ISS Lightning Events](https://svs.gsfc.nasa.gov/5011/), [Night Lights](https://svs.gsfc.nasa.gov/5313/), [Global Carbon Dioxide](https://svs.gsfc.nasa.gov/5196/), [Perpetual Ocean 2](https://svs.gsfc.nasa.gov/5425/), and [Air Quality Model Runs](https://svs.gsfc.nasa.gov/5533/), plus the [Dixie Fire](https://svs.gsfc.nasa.gov/4993/) and one direct media item for ocean currents. |
| Media Resources | 1 | [Earth Information Center Media B-Roll](https://svs.gsfc.nasa.gov/14371/) |
| Daily Visualizations | 1 link | [Daily Visualizations gallery](https://svs.gsfc.nasa.gov/gallery/daily-visualizations/), with 23 visualization entries at the time checked. |

The EIC gallery describes nine Earth topics: sea level change, air quality, biodiversity, wildfires, greenhouse gases, energy, disasters, water resources, and agriculture. Its galleries are a curated media catalog, not a complete list of all NASA Earth observation datasets.

## SVS JSON routes and media downloads

SVS page and gallery records expose JSON at:

- EIC collection: [`https://svs.gsfc.nasa.gov/api/40467`](https://svs.gsfc.nasa.gov/api/40467)
- Daily collection: [`https://svs.gsfc.nasa.gov/api/40512`](https://svs.gsfc.nasa.gov/api/40512)
- An individual visualization, e.g. [Air Quality Model Runs JSON](https://svs.gsfc.nasa.gov/api/5533): `https://svs.gsfc.nasa.gov/api/{SVS_ID}`

The individual response includes fields such as `title`, `description`, `release_date`, `update_date`, `main_image`, `media_groups`, `credits`, and (where supplied) `datasets` and `sources`. Media-group entries hold an `instance` with a media filename, type, dimensions, and direct `url`. Gallery records have `media_groups[].items[]`; an item's `instance` identifies a page, gallery, or media resource.

Example:

```sh
curl -fsSL https://svs.gsfc.nasa.gov/api/5533
```

Use the JSON-provided media URL to download a specific file. For example, an image URL under `/vis/a.../` is a downloadable visualization asset. The API endpoint returns catalog metadata and media references; it is **not** a general raw-measurement or Earth-observation data API. The SVS `/api/` root did not provide API documentation; the working collection and item routes above are the ones linked by the SVS pages.

The SVS JSON currently emits `http://svs.gsfc.nasa.gov/...` URLs. The same checked media files were retrievable over HTTPS; prefer HTTPS when fetching them.

### The challenge's existing SVS links

Every SVS page path linked from the original [challenge Resources tab](https://www.spaceappschallenge.org/2026/challenges/the-earth-information-jukebox/?tab=resources) returned HTTP 200 when checked. Their item JSON routes were also verified.

| SVS ID | Resource | Page | JSON |
|---:|---|---|---|
| 13786 | Data Sonification: Caldwell 73 | [Page](https://svs.gsfc.nasa.gov/13786/) | [JSON](https://svs.gsfc.nasa.gov/api/13786) |
| 5313 | Change in Night Lights, 2012–2023 | [Page](https://svs.gsfc.nasa.gov/5313/) | [JSON](https://svs.gsfc.nasa.gov/api/5313) |
| 3912 | Global Sea Surface Currents and Temperature | [Page](https://svs.gsfc.nasa.gov/3912/) | [JSON](https://svs.gsfc.nasa.gov/api/3912) |
| 5669 | GEOS Aerosols | [Page](https://svs.gsfc.nasa.gov/5669/) | [JSON](https://svs.gsfc.nasa.gov/api/5669) |
| 5533 | Air Quality Model Runs | [Page](https://svs.gsfc.nasa.gov/5533/) | [JSON](https://svs.gsfc.nasa.gov/api/5533) |
| 5425 | Perpetual Ocean 2: Western Boundary Currents | [Page](https://svs.gsfc.nasa.gov/5425/) | [JSON](https://svs.gsfc.nasa.gov/api/5425) |
| 5196 | DYAMOND Global Carbon Dioxide | [Page](https://svs.gsfc.nasa.gov/5196/) | [JSON](https://svs.gsfc.nasa.gov/api/5196) |
| 5011 | Lightning Events Detected from the ISS, 2017–2023 | [Page](https://svs.gsfc.nasa.gov/5011/) | [JSON](https://svs.gsfc.nasa.gov/api/5011) |
| 4960 | 3D View of an Atmospheric River | [Page](https://svs.gsfc.nasa.gov/4960/) | [JSON](https://svs.gsfc.nasa.gov/api/4960) |
| 4950 | GEDI Forest Height | [Page](https://svs.gsfc.nasa.gov/4950/) | [JSON](https://svs.gsfc.nasa.gov/api/4950) |

## Time-sensitive entries in the Daily Visualizations gallery

The gallery page labels these as daily EIC visualizations. The descriptions below summarize the temporal content, and the final column is the individual SVS API record's `update_date` (date only) observed on 2026-11-14. It is the record's update timestamp, **not necessarily the acquisition time of the underlying data**.

| ID | Visualization | Time component / cadence described by SVS | Record updated |
|---:|---|---|---|
| 4285 | [Near Real-Time Global Precipitation (GPM/IMERG)](https://svs.gsfc.nasa.gov/4285/) | Global precipitation product at 30-minute intervals; preliminary near-real-time data is available within hours. | 2026-11-14 |
| 5067 | [Earth Observing Fleet - Now](https://svs.gsfc.nasa.gov/5067/) | Satellite-orbit still is updated every 10 minutes; video once daily. | 2026-11-13 |
| 5113 | [Active Fires from VIIRS, 2024–Present](https://svs.gsfc.nasa.gov/5113/) | Animated, moving five-day window of fire radiative power. | 2026-10-24 |
| 5101 | [Sea Surface Temperature (SST) - Near Real Time](https://svs.gsfc.nasa.gov/5101/) | MUR SST analysis has one-day latency; the visualization covers the past 2.5 years and is described as updated daily. The [PO.DAAC MUR dataset record](https://podaac.jpl.nasa.gov/dataset/MUR-JPL-L4-GLOB-v4.1) is linked from the SVS page. | 2026-10-26 |
| 5120 | [GOES-East/West True Color Imagery](https://svs.gsfc.nasa.gov/5120/) | Satellite imagery over the past five days. | 2026-11-13 |
| 4897 | [Seasonal Global Precipitation Variation (GPM)](https://svs.gsfc.nasa.gov/4897/) | Animation of recent seasonal precipitation variation. | 2026-11-14 |
| 5046 | [Daily Arctic Sea Ice, By Year](https://svs.gsfc.nasa.gov/5046/) | Daily sea-ice progression, organized by year. | 2026-04-23 |
| 5064 | [Daily Antarctic Sea Ice, By Year](https://svs.gsfc.nasa.gov/5064/) | Daily sea-ice progression, organized by year. | 2026-01-09 |
| 5099 | [Daily Polar Sea Ice, Two Year History](https://svs.gsfc.nasa.gov/5099/) | Dated daily sea-ice history over two years. | 2026-10-24 |
| 5072 | [Atlantic Hurricane Wind Speed Plots](https://svs.gsfc.nasa.gov/5072/) | Time-versus-wind-speed plots across Atlantic hurricane seasons. | 2026-10-16 |
| 5153 | [Carbon Monoxide (CO)](https://svs.gsfc.nasa.gov/5153/) | Near-surface concentrations estimated by NASA's GEOS-CF model. | 2026-11-14 |
| 5154 | [Nitrogen Oxides (NOx)](https://svs.gsfc.nasa.gov/5154/) | Near-surface concentrations estimated by NASA's GEOS-CF model. | 2026-11-14 |
| 5152 | [Near-Surface Ozone (O3)](https://svs.gsfc.nasa.gov/5152/) | Near-surface concentrations estimated by NASA's GEOS-CF model. | 2026-11-14 |
| 5151 | [Particulate Matter (PM2.5)](https://svs.gsfc.nasa.gov/5151/) | Near-surface concentrations estimated by NASA's GEOS-CF model. | 2026-11-14 |
| 5150 | [GEOS-FP Near-Surface Humidity](https://svs.gsfc.nasa.gov/5150/) | Near-surface specific humidity from the GEOS-FP weather system. | 2026-11-14 |
| 5149 | [GEOS-FP Precipitation and Clouds](https://svs.gsfc.nasa.gov/5149/) | Precipitation and cloud fields from the GEOS-FP system. | 2026-11-14 |
| 5148 | [GEOS-FP Near-Surface Wind Speed](https://svs.gsfc.nasa.gov/5148/) | Near-surface wind speed from the GEOS-FP system. | 2026-11-14 |
| 5147 | [GEOS-FP Near-Surface Temperature](https://svs.gsfc.nasa.gov/5147/) | Near-surface temperature from the GEOS-FP system. | 2026-11-14 |
| 5176 | [SST Anomaly - Near Real Time](https://svs.gsfc.nasa.gov/5176/) | SST anomaly over the past 2.5 years; described as updated daily. | 2026-10-24 |
| 5315 | [Daily Experimental Fire Weather Forecast](https://svs.gsfc.nasa.gov/5315/) | Forecast map for the current day. | 2026-11-14 |
| 5584 | [Daily Global Landslide Exposure Map](https://svs.gsfc.nasa.gov/5584/) | Daily map from the Landslide Hazard Assessment for Situational Awareness (LHASA) model. | 2026-10-29 |
| 5544 | [Near Real-Time NDVI](https://svs.gsfc.nasa.gov/5544/) | Normalized Difference Vegetation Index described as near-real-time. | 2026-11-13 |
| 5577 | [SDO Sun This Week](https://svs.gsfc.nasa.gov/5577/) | Solar imagery covering the past seven days. | 2026-08-28 |

**Freshness caution:** “Daily” in a gallery title or description is not a freshness guarantee. At retrieval, the daily gallery record itself was last updated 2026-08-10, some entries had much older `update_date` values, and the SST records described as daily had not been updated in several weeks. For a live integration, poll the individual record, inspect its media URL and data date, and treat stale or missing updates explicitly.

SVS records may also list the underlying data provider, but those links are not always direct download APIs. For example, the SST record links to the MUR dataset at PO.DAAC, while the PM2.5 record points to NASA's GEOS-CF data portal. Use the provider's own access instructions when the goal is to process scientific values rather than the rendered SVS media.

## Time-indexed image services: NASA GIBS

For date-selectable Earth imagery beyond the SVS media files, NASA's [Global Imagery Browse Services (GIBS)](https://nasa-gibs.github.io/gibs-api-docs/) provides standardized WMTS, WMS, TWMS, and tiled-map services. This is a separate imagery service, not an API for the SVS gallery entries themselves. Use the [available-visualizations catalog](https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/) to choose a supported layer.

The documented WMTS REST tile pattern is:

```text
https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{LayerIdentifier}/default/{YYYY-MM-DD}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.{FormatExt}
```

Each tile request selects a time value (`YYYY-MM-DD`, or an ISO UTC date-time for subdaily layers). Use the WMTS `GetCapabilities` and `DescribeDomains` requests described in the [GIBS access guide](https://nasa-gibs.github.io/gibs-api-docs/access-basics/) to discover supported layers, projections, formats, and actual time values; `DescribeDomains` can return the full time domain. GIBS notes that today's imagery may be incomplete while data is acquired and processed.

## Downloaded local snapshots

These are small, date-stamped examples for local prototyping, not a mirror of the NASA source or the underlying raw datasets. Downloaded 2026-11-14 from the linked NASA SVS media files; record update dates below come from the corresponding API records.

| Local file | Source visualization | Source media |
|---|---|---|
| [`data/nasa-svs/4285-imergert-current.jpg`](../data/nasa-svs/4285-imergert-current.jpg) | [GPM near-real-time precipitation](https://svs.gsfc.nasa.gov/4285/) — record updated 2026-11-14. | [`imergert_1080p_30_print.jpg`](https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/imergert_1080p_30_print.jpg), 1024×576 |
| [`data/nasa-svs/4285-imergert-current.webm`](../data/nasa-svs/4285-imergert-current.webm) | Same GPM near-real-time visualization; this is the local time-sequenced sample. | [`imergert_1080p_30.webm`](https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/imergert_1080p_30.webm), 2.7 MB |
| [`data/nasa-svs/4285-imergert-current.mp4`](../data/nasa-svs/4285-imergert-current.mp4) | Same visualization, downloaded as the full MP4 for the planned interactive prototype. | [`imergert_1080p_30.mp4`](https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/imergert_1080p_30.mp4), 1920×1080, about 30 MB |
| [`data/nasa-svs/5067-fleet-now.jpg`](../data/nasa-svs/5067-fleet-now.jpg) | [Earth Observing Fleet - Now](https://svs.gsfc.nasa.gov/5067/) — still image is described as refreshing every 10 minutes; record updated 2026-11-13. | [`fleet_now_print.jpg`](https://svs.gsfc.nasa.gov/vis/a000000/a005000/a005067/fleet_now_print.jpg), 1024×576 |
| [`data/nasa-svs/5101-sst-mur-history.jpg`](../data/nasa-svs/5101-sst-mur-history.jpg) | [SST near-real-time series](https://svs.gsfc.nasa.gov/5101/) — the local JPEG is a still preview, not the full 2.5-year sequence; record last updated 2026-10-26. | [`sst_mur_print.jpg`](https://svs.gsfc.nasa.gov/vis/a000000/a005100/a005101/sst_mur_print.jpg), 1024×512 |
| [`data/nasa-svs/5151-geos-cf-pm25.jpg`](../data/nasa-svs/5151-geos-cf-pm25.jpg) | [GEOS-CF PM2.5](https://svs.gsfc.nasa.gov/5151/) — record updated 2026-11-14. | [`MC01_stage4_GMAO_pm25_2048x1024_en.00001_print.jpg`](https://svs.gsfc.nasa.gov/vis/a000000/a005100/a005151/MC01_stage4_GMAO_pm25_2048x1024_en.00001_print.jpg), 1024×512 |
| [`data/nasa-svs/5315-fire-weather-latest.png`](../data/nasa-svs/5315-fire-weather-latest.png) | [Daily experimental fire weather forecast](https://svs.gsfc.nasa.gov/5315/) — current-day forecast; record updated 2026-11-14. | [`FWI_forecast_latest.png`](https://svs.gsfc.nasa.gov/vis/a000000/a005300/a005315/FWI_forecast_latest.png), 2160×1080 |

The SVS record also offers the full [SST time-series movie](https://svs.gsfc.nasa.gov/vis/a000000/a005100/a005101/sst_30_sec_4096x2048_2x1_30p.mp4) (78 MB); it is not included locally. The smaller GPM WebM above is a motion sample, while the other downloaded files are still images.

For interactive use, interpret the GPM visualization as precipitation intensity—not temperature. The source record provides separate liquid- and frozen-precipitation color bars, plus transparent (`flatalpha`) and composited frame sequences; these can help distinguish precipitation from labels and map background when detecting colored regions and their edges.

## Local interactive prototype

The [Earth Jukebox prototype](../earth-jukebox/) uses the local SVS 4285 video to trigger slow ball impulses from precipitation color and edge direction. See its [README](../earth-jukebox/README.md) for run instructions, controls, assumptions, and attribution.

SVS credits for these samples: GPM/IMERG visualizations by Horace Mitchell (NASA/GSFC), with scientific consulting by George Huffman, Gail Skofronick Jackson, and Dalia B. Kirschbaum (NASA/GSFC); fleet and SST visualizations by Kel Elkins (USRA); PM2.5 visualization by Joseph V. Ardizzone (NASA/GSFC); and fire-weather visualization by Trent L. Schindler (USRA), with scientific consulting by Robert Field (Columbia University).

Preserve the linked SVS page and its item-level credits when reusing an image; do not assume every page asset has identical authorship or usage terms. The [challenge Resources tab](https://www.spaceappschallenge.org/2026/challenges/the-earth-information-jukebox/?tab=resources) also reminds participants to follow the use parameters of any non-U.S. Government website they use.
