# Data assets

## Hero layers (`layers/`)

| File | Description | Source |
|------|-------------|--------|
| `ndvi_early.png` | Global MODIS NDVI visualization, July 2001 | [NASA NEO](https://neo.gsfc.nasa.gov/) — `MOD_NDVI_M` |
| `ndvi_recent.png` | Global MODIS NDVI visualization, July 2020 | NASA NEO — `MOD_NDVI_M` |
| `ndvi_2010.png` | Global MODIS NDVI visualization, July 2010 | NASA NEO — `MOD_NDVI_M` |

These are **vegetation greenness** products (NDVI), not Hansen Global Forest Change tree-cover loss. The app labels them as satellite vegetation / change layers.

NASA NEO imagery is provided for public use with attribution to NASA Earth Observations (NEO).

## Seasonal base map

Monthly Blue Marble Next Generation (BMNG) textures are loaded from NASA Science asset URLs at runtime (see `main.js`).
