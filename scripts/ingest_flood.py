# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27"]
# ///
"""Flood-risk evidence beyond the FEMA NFHL map, for Allegheny County (countyCode 42003).

Usage: uv run scripts/ingest_flood.py <step>   (nfip | flooding_311 | combined_sewer | parcel_flood)

- nfip: OpenFEMA FimaNfipPolicies (policies-in-force snapshot) + FimaNfipClaims (redacted
  claims), aggregated to census tract and ZIP. Row-level records are fetched in memory only
  and never written to disk or to Supabase -- only the aggregates below are uploaded.
- flooding_311: City of Pittsburgh 311 requests (WPRDC) for flooding-related subjects,
  counted by census tract and year. The 311 dataset has no free-text or personal fields.
- combined_sewer: PWSA/3RWW Combined Sewershed layer (WPRDC), loaded into public.overlays.
- parcel_flood: per-parcel rollup (FEMA floodway/SFHA/0.2% shares, tract NFIP stats, tract
  311 activity, combined-sewer membership), computed in the database in 20 chunks.

Raw downloads land in data/raw/ (gitignored).
"""
import json
import sys
import time
from pathlib import Path

import duckdb
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import ROOT, RAW, load_env, connect, upload, rows, jsonable, _geom_sql  # noqa: E402

COUNTY = "42003"
OPENFEMA = "https://www.fema.gov/api/open/v2"


def _page_openfema(entity, select, filter_=f"countyCode eq '{COUNTY}'", top=1000):
    """Yield every record of an OpenFEMA v2 entity for the county filter. Records are
    held in memory for aggregation only -- never persisted row-level."""
    skip = 0
    with httpx.Client(timeout=60) as client:
        while True:
            params = {"$filter": filter_, "$select": select, "$top": top, "$skip": skip}
            for attempt in range(5):
                r = client.get(f"{OPENFEMA}/{entity}", params=params)
                if r.status_code == 200:
                    break
                time.sleep(2 ** attempt)
            else:
                raise SystemExit(f"OpenFEMA {entity} failed at skip={skip}: {r.status_code}")
            batch = r.json().get(entity, [])
            if not batch:
                break
            yield from batch
            skip += top
            time.sleep(0.2)  # be polite


def _median(vals):
    s = sorted(vals)
    n = len(s)
    if n == 0:
        return None
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


def nfip(con):
    """OpenFEMA policies-in-force + redacted claims -> nfip_by_tract, nfip_by_zip."""
    from collections import defaultdict

    as_of = None
    prem = defaultdict(lambda: defaultdict(list))     # {tract|zip: {key: [premiums]}}
    pol_count = defaultdict(lambda: defaultdict(int))
    claims_by_year = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0, 0.0])))

    print("  fetching FimaNfipPolicies (policies in force) ...", flush=True)
    n = 0
    for rec in _page_openfema(
        "FimaNfipPolicies",
        "censusTract,reportedZipCode,totalInsurancePremiumOfThePolicy,policyEffectiveDate",
    ):
        n += 1
        tract, zip5 = rec.get("censusTract"), rec.get("reportedZipCode")
        premium = rec.get("totalInsurancePremiumOfThePolicy")
        eff = rec.get("policyEffectiveDate")
        if eff and (as_of is None or eff > as_of):
            as_of = eff
        for key, val in (("tract", tract), ("zip", zip5)):
            if val:
                pol_count[key][val] += 1
                if premium is not None:
                    prem[key][val].append(premium)
        if n % 10000 == 0:
            print(f"    policies: {n:,}", flush=True)
    print(f"  policies fetched: {n:,}", flush=True)

    print("  fetching FimaNfipClaims (redacted) ...", flush=True)
    n = 0
    for rec in _page_openfema(
        "FimaNfipClaims",
        "censusTract,reportedZipCode,yearOfLoss,netBuildingPaymentAmount,"
        "netContentsPaymentAmount,netIccPaymentAmount",
    ):
        n += 1
        tract, zip5, year = rec.get("censusTract"), rec.get("reportedZipCode"), rec.get("yearOfLoss")
        paid = (rec.get("netBuildingPaymentAmount") or 0) + \
               (rec.get("netContentsPaymentAmount") or 0) + \
               (rec.get("netIccPaymentAmount") or 0)
        if not year:
            continue
        for key, val in (("tract", tract), ("zip", zip5)):
            if val:
                claims_by_year[key][val][year][0] += 1
                claims_by_year[key][val][year][1] += paid
    print(f"  claims fetched: {n:,}", flush=True)

    as_of_date = as_of[:10] if as_of else None
    this_year = time.gmtime().tm_year
    for key, table in (("tract", "nfip_by_tract"), ("zip", "nfip_by_zip")):
        id_col = "geoid" if key == "tract" else "zip"
        out_rows = []
        keys = set(pol_count[key]) | set(claims_by_year[key])
        for val in keys:
            # FEMA's censusTract is already the full 11-digit tract GEOID; reportedZipCode
            # is the 5-digit ZIP (sometimes ZIP+4-padded upstream, so keep the first 5).
            ident = str(val) if key == "tract" else str(val)[:5]
            years = claims_by_year[key][val]
            claims_10y = {y: c for y, c in years.items() if y >= this_year - 10}
            out_rows.append({
                id_col: ident,
                "policies_in_force": pol_count[key].get(val, 0),
                "premium_median": _median(prem[key].get(val, [])),
                "premium_mean": (sum(prem[key][val]) / len(prem[key][val])) if prem[key].get(val) else None,
                "premium_policy_count": len(prem[key].get(val, [])),
                "claims_count_10y": sum(c for c, _ in claims_10y.values()),
                "claims_total_paid_10y": sum(p for _, p in claims_10y.values()),
                "claims_by_year": [
                    {"year": y, "count": c, "total_paid": round(p, 2)}
                    for y, (c, p) in sorted(years.items())
                ],
                "most_recent_claim_year": max(years) if years else None,
                "as_of_date": as_of_date,
            })
        upload(table, iter(out_rows), len(out_rows), batch=500, on_conflict=id_col)


FLOOD_311_SUBJECTS = ["Flooding", "Drainage - Street", "Catch Basins, Grates, and Sewers", "Sewers"]
RES_311 = "5202679a-d243-402e-b82a-63189995a942"  # WPRDC "Pittsburgh 311 Data"


def flooding_311(con):
    """WPRDC 311 requests for flood-related subjects -> flooding_311(geoid, request_type, year, count)."""
    from collections import defaultdict

    counts = defaultdict(int)  # (geoid, request_type, year) -> count
    with httpx.Client(timeout=60) as client:
        for subject in FLOOD_311_SUBJECTS:
            offset, page = 0, 5000
            while True:
                r = client.get("https://data.wprdc.org/api/3/action/datastore_search", params={
                    "resource_id": RES_311,
                    "filters": json.dumps({"subject": subject}),
                    "fields": "census_tract,created_date_et",
                    "limit": page,
                    "offset": offset,
                })
                r.raise_for_status()
                recs = r.json()["result"]["records"]
                if not recs:
                    break
                for rec in recs:
                    tract, created = rec.get("census_tract"), rec.get("created_date_et")
                    if not tract or not created:
                        continue
                    geoid = COUNTY + tract.strip().rjust(4, "0") + "00"
                    year = int(created[:4])
                    counts[(geoid, subject, year)] += 1
                offset += page
                if len(recs) < page:
                    break
                time.sleep(0.1)
            print(f"  311 subject '{subject}': done", flush=True)

    out_rows = [{"geoid": g, "request_type": t, "year": y, "count": c}
                for (g, t, y), c in counts.items()]
    upload("flooding_311", iter(out_rows), len(out_rows), batch=1000, on_conflict="geoid,request_type,year")


COMBINED_SEWER_URL = ("https://data.wprdc.org/dataset/fe7e5332-4c87-410d-b0be-43c5d2c44ae0/"
                      "resource/138d6b65-1630-4905-9421-de90cd9d59e5/download/combinedsewersheds.geojson")


def combined_sewer(con):
    """PWSA/3RWW Combined Sewershed layer (City of Pittsburgh) -> overlays layer 'combined_sewer'."""
    dest = RAW / "combined_sewershed.geojson"
    if not dest.exists():
        with httpx.Client(timeout=120) as client:
            r = client.get(COMBINED_SEWER_URL)
            r.raise_for_status()
            dest.write_bytes(r.content)
    con.execute(f"create or replace table cs as select * from ST_Read('{dest}')")
    total = con.execute("select count(*) from cs").fetchone()[0]
    sql = f"""
      select 'combined_sewer' as layer, cast(OBJECTID as varchar) as source_id,
             CSO_SHED as label,
             json_object('sewershed', CSO_SHED, 'authority', 'PWSA/ALCOSAN', 'in_city', CITYOFPGH) as attrs,
             {_geom_sql()} as geom
      from cs where geom is not null
    """
    upload("overlays", jsonable(rows(con, sql)), total, batch=100, on_conflict="layer,source_id")


CHUNKS = 20


def parcel_flood(con, chunk=None):
    """Per-parcel FEMA floodway/SFHA/0.2% shares + tract NFIP/311 stats + combined-sewer
    membership, computed entirely in Postgres. Runs via scripts/sql.sh in 20 chunks
    (parcel-wide statements must fit the 2-minute limit)."""
    import subprocess

    chunks = [int(chunk)] if chunk is not None else range(CHUNKS)
    for n in chunks:
        # Flood-zone features are few (~7.8k) but some are huge, complex multipolygons, so a
        # correlated ST_Intersects subquery per parcel re-reads them constantly and blows the
        # 2-minute statement limit. ST_Subdivide into a temp table (dropped at commit) first
        # gives the GIST index tight little pieces to work with -- ~100x faster in testing.
        sql = f"""
        create temporary table flood_pieces on commit drop as
          select label, attrs, (extensions.ST_Dump(extensions.ST_Subdivide(geom, 64))).geom as geom
          from public.overlays where layer = 'flood_fema_nfhl';
        create index on flood_pieces using gist (geom);
        analyze flood_pieces;

        with pc as (
          select parid, geom from public.parcels where abs(hashtext(parid)) % {CHUNKS} = {n}
        ),
        overlap as (
          select pc.parid,
            least(1.0, sum(case when coalesce(o.attrs->>'subtype', '') ilike '%FLOODWAY%'
                                 then extensions.ST_Area(extensions.ST_Intersection(o.geom, pc.geom)::extensions.geography) else 0 end)
                       / nullif(extensions.ST_Area(pc.geom::extensions.geography), 0)) as floodway_share,
            least(1.0, sum(case when o.label in ('A', 'AE')
                                 then extensions.ST_Area(extensions.ST_Intersection(o.geom, pc.geom)::extensions.geography) else 0 end)
                       / nullif(extensions.ST_Area(pc.geom::extensions.geography), 0)) as sfha_share,
            least(1.0, sum(case when o.label = 'X' and coalesce(o.attrs->>'subtype', '') ilike '%0.2%'
                                 then extensions.ST_Area(extensions.ST_Intersection(o.geom, pc.geom)::extensions.geography) else 0 end)
                       / nullif(extensions.ST_Area(pc.geom::extensions.geography), 0)) as x500_share
          from pc
          join flood_pieces o on extensions.ST_Intersects(o.geom, pc.geom)
          group by pc.parid, pc.geom
        ),
        cs_hit as (
          select pc.parid, true as hit
          from pc join public.overlays o on o.layer = 'combined_sewer' and extensions.ST_Intersects(o.geom, pc.geom)
          group by pc.parid
        )
        insert into public.parcel_flood
          (parid, floodway_share, sfha_share, x500_share, tract_nfip_claims_10y,
           tract_nfip_median_premium, tract_nfip_policies, flooding_311_5y_tract, in_combined_sewer)
        select
          pc.parid,
          coalesce(ov.floodway_share, 0), coalesce(ov.sfha_share, 0), coalesce(ov.x500_share, 0),
          nt.claims_count_10y, nt.premium_median, nt.policies_in_force,
          f311.cnt, coalesce(cs.hit, false)
        from pc
        left join overlap ov on ov.parid = pc.parid
        left join public.parcel_tract pt on pt.parid = pc.parid
        left join public.nfip_by_tract nt on nt.geoid = pt.geoid
        left join (
          select geoid, sum(count) cnt from public.flooding_311
          where year >= extract(year from current_date)::int - 5
          group by geoid
        ) f311 on f311.geoid = pt.geoid
        left join cs_hit cs on cs.parid = pc.parid
        on conflict (parid) do update set
          floodway_share = excluded.floodway_share,
          sfha_share = excluded.sfha_share,
          x500_share = excluded.x500_share,
          tract_nfip_claims_10y = excluded.tract_nfip_claims_10y,
          tract_nfip_median_premium = excluded.tract_nfip_median_premium,
          tract_nfip_policies = excluded.tract_nfip_policies,
          flooding_311_5y_tract = excluded.flooding_311_5y_tract,
          in_combined_sewer = excluded.in_combined_sewer;
        """
        print(f"  parcel_flood chunk {n}/{CHUNKS - 1}", flush=True)
        r = subprocess.run(["bash", str(ROOT / "scripts" / "sql.sh"), sql],
                           cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0 or "error" in r.stdout.lower() or "message" in r.stdout.lower():
            raise SystemExit(f"chunk {n} failed: {r.stdout[:1000]} {r.stderr[:1000]}")


STEPS = {"nfip": nfip, "flooding_311": flooding_311, "combined_sewer": combined_sewer,
         "parcel_flood": parcel_flood}

if __name__ == "__main__":
    load_env()
    name, *extra = sys.argv[1:]
    STEPS[name](connect(), *extra)
