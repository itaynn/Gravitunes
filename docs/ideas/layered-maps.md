# Layered maps

**Status:** built (`app/modes/layered-maps/`)

## What you hear
Pick several maps (ozone, CO, NOx) and hear them together, each as its own instrument, to compare where and when they rise.

## Mapping
- Each dataset is a layer with its own voice, volume and mute/solo.
- Works on top of any mode that uses a single dataset (e.g. probe, world orchestra).

## Build as a demo
- Needs: dataset picker → multi-select in `app/core`; descriptors + grids for 5153 and 5154.
