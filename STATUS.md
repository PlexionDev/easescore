# EaseScore.AI — status

_Plain-language build log. Newest first._

## Now
- Loading Allegheny County data into the database (assessments → parcel boundaries → zoning → hazards → sales).

## Done
- Property assessments loaded: 584,999 parcels, personal data removed.
- Pittsburgh zoning and hazard layers loaded (FEMA flood zones countywide).
- Project accounts set up (GitHub, Vercel, Supabase, data APIs). All keys stay out of the repo.
- Safety checks on every commit: secrets scan, private-file check, personal-data check.
- Database: PostGIS available, Row Level Security switched on automatically for every new table.

## Blocked
- Nothing.

## Next
- Development Ease Score engine, then the single-parcel view.
