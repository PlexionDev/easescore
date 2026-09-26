# EaseScore.AI — status

_Plain-language build log. Newest first._

## Now
- Loading Allegheny County data into the database (assessments → parcel boundaries → zoning → hazards → sales).

## Done
- Pittsburgh overlays (historic districts, inclusionary housing, height, parking, riverfront, RCO areas), PLI permits, and condemned properties loaded.
- School districts (45) and Pittsburgh Public Schools attendance zones (51) loaded; every parcel tagged.
- Parcel boundaries loaded: 585,351 parcel shapes, matched to assessments by parcel ID.
- Valid property sales loaded: 99,176 arm's-length sales, 2012–2026.
- Property assessments loaded: 584,999 parcels, personal data removed.
- Pittsburgh zoning and hazard layers loaded (FEMA flood zones countywide).
- Project accounts set up (GitHub, Vercel, Supabase, data APIs). All keys stay out of the repo.
- Safety checks on every commit: secrets scan, private-file check, personal-data check.
- Database: PostGIS available, Row Level Security switched on automatically for every new table.

## Blocked
- Nothing.

## Next
- Development Ease Score engine, then the single-parcel view.
