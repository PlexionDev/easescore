# EaseScore.AI — data inventory

Every table the app reads, where it came from, and what was removed. Join key everywhere: `parid`, the 16-character Allegheny County parcel ID (e.g. `0001C00123000000`). Loaded by `scripts/ingest.py`; raw downloads live in `data/raw/` (not committed).

| Table | Source | Coverage | Rows loaded | Notes |
|---|---|---|---|---|
| `zoning` | City of Pittsburgh — Zoning Districts (PGHWebZoning) | City of Pittsburgh only | 1,068 | 57 zone codes; ~59 sq mi. 1 source feature had no geometry. |
| `overlays` · `flood_fema_nfhl` | FEMA National Flood Hazard Layer, DFIRM 42003C | All of Allegheny County | 7,793 | Zones AE (4,285), A (182) = 1%-annual-chance floodplain; X (3,326) includes 0.2% and minimal-risk areas — use `attrs.subtype` to tell them apart. |
| `overlays` · `landslide_prone_pgh` | City of Pittsburgh — Landslide Prone Areas | City only | 37 | ~11.5 sq mi. Outside the city: unknown, not "no risk". |
| `overlays` · `undermined_pgh` | City of Pittsburgh — Undermined Areas | City only | 47 | ~15.2 sq mi. Outside the city: unknown. |
| `overlays` · `greenway_pgh` | City of Pittsburgh — Greenways | City only | 10 | ~0.4 sq mi. Looks low; source last substantively updated ~2018. |

## Personal data removed at ingest
- Assessments: owner mailing-address fields, legal descriptions, deed book/page, prior-sale history. The county does not publish owner names.
- Map layers: GIS editor user names (`created_user`, `last_edited_user`) are never loaded.
- Sales: the county file has no buyer/seller names; deed book/page is not kept.
