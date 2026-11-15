"""Per-dataset settings for the flow / vortex analysis, shared by every mode that ships flow layers
(flow-tracers, vortex-melodies; storm-watch could reuse them for other datasets).

- every: time stride over the source series (hourly GEOS-CF grids -> every 6 h keeps the 16.5 days in budget
  for the ~10 MB single-file demos). The analysis itself runs on the strided series, so flow, vortices and
  the field grid share one time axis.
- width: analysis grid width (px) for the optical flow.
- k / min_area_km2: Okubo-Weiss vortex threshold and minimum vortex area. The defaults (0.4, 20 000 km2) were
  tuned on IMERG rain (4285, about 19 vortices per frame); the smooth gas fields give far more small swirls at
  those settings, so they are raised until each gas also has about 10-16 tracked vortices per frame
  (see analysis/scripts/flow/README.md).
- name: what the value is called in the app (labels and spoken text).
"""

PROFILES = {
    "4285": {"name": "rain", "every": 1, "width": 1440, "k": 0.4, "min_area_km2": 20000},
    "5152": {"name": "ozone", "every": 6, "width": 512, "k": 1.0, "min_area_km2": 300000},
    "5153": {"name": "carbon monoxide", "every": 6, "width": 512, "k": 0.6, "min_area_km2": 100000},
    "5154": {"name": "nitrogen oxides", "every": 6, "width": 512, "k": 0.6, "min_area_km2": 100000},
}


def profile(dataset: str) -> dict:
    return PROFILES.get(str(dataset), {"name": str(dataset), "every": 1, "width": 512, "k": 0.4, "min_area_km2": 20000})
