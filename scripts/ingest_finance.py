# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27", "duckdb>=1.1"]
# ///
"""Load HUD, PHFA, FRED, and Allegheny County Treasurer financial/incentive
data used by the affordability mode and fiscal ledger.

Usage: uv run scripts/ingest_finance.py <dataset>
  hud_fmr | hud_income_limits | affordable_rent_limits | tract_designations |
  market_series | millage

HUD/FRED data is pulled live over their public APIs (HUD_API_TOKEN,
FRED_API_KEY from .env.local). PHFA rent limits and county millage come from
PDFs saved to data/raw/ (gitignored) and parsed with pdftotext. Rows are
upserted through the Supabase REST API via scripts/ingest.py's upload().
"""
import re
import subprocess
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import ROOT, RAW, load_env, upload, fetch_arcgis, connect, rows, jsonable  # noqa: E402

import os

PITTSBURGH_METRO = "METRO38300M38300"
ALLEGHENY_ENTITY = "4200399999"
FMR_YEAR = 2026
IL_YEAR = 2026


def _hud_get(path, **params):
    r = httpx.get(f"https://www.huduser.gov/hudapi/public/{path}",
                   headers={"Authorization": f"Bearer {os.environ['HUD_API_TOKEN']}"},
                   params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def _allegheny_zips():
    """Zip codes that actually appear on an Allegheny County parcel (from the
    already-loaded assessments table) -- used to trim Small Area FMRs (published
    for the whole 6-county Pittsburgh MSA) down to the county."""
    out = _run_sql("select distinct zip from public.assessments where zip is not null")
    return {r["zip"] for r in out}


def _run_sql(sql):
    r = subprocess.run(["bash", str(ROOT / "scripts" / "sql.sh")], input=sql,
                        text=True, capture_output=True)
    if r.returncode != 0:
        raise SystemExit(f"sql.sh failed: {r.stdout}\n{r.stderr}")
    import json
    return json.loads(r.stdout)


# ---------- 1. HUD Fair Market Rents ----------

def hud_fmr(con=None):
    zips = _allegheny_zips()
    data = _hud_get(f"fmr/data/{PITTSBURGH_METRO}", year=FMR_YEAR)["data"]
    area_name = data["area_name"]
    out = []
    for row in data["basicdata"]:
        is_msa = row["zip_code"] == "MSA level"
        if not is_msa and row["zip_code"] not in zips:
            continue
        out.append({
            "year": FMR_YEAR, "area_code": PITTSBURGH_METRO,
            "zip": "MSA" if is_msa else row["zip_code"],
            "br0": row["Efficiency"], "br1": row["One-Bedroom"], "br2": row["Two-Bedroom"],
            "br3": row["Three-Bedroom"], "br4": row["Four-Bedroom"], "area_name": area_name,
        })
    upload("hud_fmr", out, len(out), batch=200, on_conflict="year,area_code,zip")
    print(f"  hud_fmr: {len(out)} rows (1 MSA-level + {len(out) - 1} Allegheny zips), FY{FMR_YEAR}")


# ---------- 2. HUD Income Limits ----------

def hud_income_limits(con=None):
    data = _hud_get(f"il/data/{ALLEGHENY_ENTITY}", year=IL_YEAR)["data"]
    row = {"year": IL_YEAR, "area_code": ALLEGHENY_ENTITY, "county_name": data["county_name"],
           "median_income": data["median_income"]}
    for band, key in (("il30", "extremely_low"), ("il50", "very_low"), ("il80", "low")):
        for p in range(1, 9):
            row[f"{band}_p{p}"] = data[key][f"{band[:2]}{band[2:]}_p{p}"]
    upload("hud_income_limits", [row], 1, batch=1, on_conflict="year,area_code")
    print(f"  hud_income_limits: Allegheny County FY{IL_YEAR}, median income ${data['median_income']:,}")
    return data


# ---------- 3. Derived + official affordable rent limits ----------

# Standard LIHTC convention: 1.5 persons/bedroom, 0BR = 1 person.
_BEDROOM_PERSONS = {0: (1, 1), 1: (1, 2), 2: (3, 3), 3: (4, 5), 4: (6, 6)}


def _il_for_persons(il, band, lo, hi):
    v1, v2 = il[f"{band}_p{lo}"], il[f"{band}_p{hi}"]
    return (v1 + v2) / 2


def affordable_rent_limits(con=None):
    il = _hud_get(f"il/data/{ALLEGHENY_ENTITY}", year=IL_YEAR)["data"]
    flat = {}
    for band, key in (("il30", "extremely_low"), ("il50", "very_low"), ("il80", "low")):
        for p in range(1, 9):
            flat[f"{band}_p{p}"] = il[key][f"{band[:2]}{band[2:]}_p{p}"]

    derived = []
    hud_il_url = "https://www.huduser.gov/hudapi/public/il/data/4200399999"
    for ami_pct, band, formula_note in (
        (30, "il30", "HUD FY2026 extremely-low (30% AMI) income limit"),
        (50, "il50", "HUD FY2026 very-low (50% AMI) income limit"),
        (60, None, "1.2 x the 50% AMI (very-low) income limit -- HUD does not publish a 60% band"),
        (80, "il80", "HUD FY2026 low (80% AMI) income limit"),
    ):
        for br, (lo, hi) in _BEDROOM_PERSONS.items():
            if band:
                income = _il_for_persons(flat, band, lo, hi)
            else:
                income = _il_for_persons(flat, "il50", lo, hi) * 1.2
            rent = round(income * 0.30 / 12, 2)
            formula = (f"persons={'%.1f' % (1.5 * br + 1)} (avg of household size {lo} and {hi}); "
                       f"income = {formula_note}; rent = income x 0.30 / 12")
            derived.append({
                "source": "derived_hud_il", "county": "Allegheny", "year": IL_YEAR,
                "ami_pct": ami_pct, "bedrooms": br, "max_rent": rent, "formula": formula,
                "effective_date": None, "source_url": hud_il_url,
            })
    upload("affordable_rent_limits", derived, len(derived), batch=100,
           on_conflict="source,county,year,ami_pct,bedrooms")
    print(f"  affordable_rent_limits: {len(derived)} derived_hud_il rows")

    # PHFA official LIHTC rent limits (preferred over the derived rows above
    # for the same ami_pct/bedrooms). MTXR041, effective 5/01/2026.
    pdf = RAW / "phfa_lihtc_2026.pdf"
    if not pdf.exists():
        raise SystemExit(f"missing {pdf} -- download the current MTXR041 PDF from "
                          "https://www.phfa.org/mhp/rent_and_income_limits/ (LIHTC Income and "
                          "Rent Limits) into data/raw/ first")
    text = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
    lines = text.splitlines()
    start = next(i for i, ln in enumerate(lines) if ln.strip().startswith("ALLEGHENY"))
    phfa = []
    eff_date = None
    for ln in lines[start:start + 8]:
        ln = ln.strip()
        if not ln or ln.startswith("ALLEGHENY") is False and not re.match(r"^\d+%", ln):
            if not ln.startswith("ALLEGHENY"):
                break
        m_date = re.search(r"(\d{1,2}/\d{2}/\d{4})", ln)
        if m_date:
            eff_date = m_date.group(1)
        pct_m = re.search(r"(\d+)%", ln)
        if not pct_m:
            continue
        ami_pct = int(pct_m.group(1))
        clean = re.sub(r"\d{1,2}/\d{2}/\d{4}", "", ln)
        nums = [int(t.replace(",", "")) for t in re.findall(r"[\d,]+", clean)]
        nums = nums[1:]  # drop the leading AMI% (already captured)
        if len(nums) == 17:  # first row also carries the area median income
            nums = nums[1:]
        if len(nums) != 16:
            raise SystemExit(f"unexpected PHFA row shape ({len(nums)} numbers): {ln!r}")
        rents = nums[9:16]  # EFF, 1BRM..6BRM
        for br, rent in enumerate(rents):
            phfa.append({
                "source": "phfa_lihtc", "county": "Allegheny", "year": IL_YEAR,
                "ami_pct": ami_pct, "bedrooms": br, "max_rent": rent, "formula": None,
                "effective_date": f"20{eff_date[-2:]}-{eff_date.split('/')[0].zfill(2)}-{eff_date.split('/')[1]}" if eff_date else None,
                "source_url": "https://www.phfa.org/mhp/rent_and_income_limits/",
            })
    upload("affordable_rent_limits", phfa, len(phfa), batch=100,
           on_conflict="source,county,year,ami_pct,bedrooms")
    print(f"  affordable_rent_limits: {len(phfa)} phfa_lihtc rows (official, effective {eff_date})")


# ---------- 4. QCT / DDA / Opportunity Zone tract designations ----------

QCT_LAYER = "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/QUALIFIED_CENSUS_TRACTS_2026/FeatureServer/0"
DDA_LAYER = "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Difficult_Development_Areas_2026/FeatureServer/0"
OZ_LAYER = "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Opportunity_Zones/FeatureServer/13"


def tract_designations(con):
    import json as _json

    all_tracts = {r["geoid"] for r in _run_sql("select geoid from public.tracts")}

    qct_src = fetch_arcgis("qct_2026_alco", QCT_LAYER, where="STATE='42' AND COUNTY='003'",
                           out_fields="GEOID")
    qct_geoids = {f["properties"]["GEOID"] for f in _json.loads(qct_src.read_text())["features"]}

    oz_src = fetch_arcgis("oz_alco", OZ_LAYER, where="STATE='42' AND COUNTY='003'",
                          out_fields="GEOID10")
    oz_geoids_2010 = {f["properties"]["GEOID10"] for f in _json.loads(oz_src.read_text())["features"]}
    oz_geoids = oz_geoids_2010 & all_tracts
    oz_unmatched = oz_geoids_2010 - all_tracts

    # DDA is published by ZCTA (metro areas), not by tract -- spatial-join
    # DDA ZCTA polygons against tract geometry already loaded in public.tracts.
    dda_src = fetch_arcgis("dda_2026_alco", DDA_LAYER,
                           where="ZCTA5 IN (" + ",".join(f"'{z}'" for z in _allegheny_zips()) + ")",
                           out_fields="ZCTA5,DDA_CODE")
    con.execute(f"create or replace table _dda as select * from ST_Read('{dda_src}')")

    _run_sql("""
      drop table if exists public._dda_zctas;
      create table public._dda_zctas (zcta text, geom extensions.geometry(MultiPolygon, 4326));
    """)
    # Load the (few dozen) DDA polygons via a local->remote hop: dump WKT and
    # insert through sql.sh rather than the ingest.py REST upload path.
    con.execute("create or replace table _dda2 as select ZCTA5, ST_AsText(ST_Multi(geom)) wkt from _dda")
    dda_rows = con.execute("select ZCTA5, wkt from _dda2").fetchall()
    values_sql = ",\n".join(
        f"('{z}', ST_Multi(ST_GeomFromText('{w}', 4326)))" for z, w in dda_rows
    )
    if values_sql:
        _run_sql(f"insert into public._dda_zctas (zcta, geom) values {values_sql};")
    dda_geoids = {r["geoid"] for r in _run_sql("""
      select distinct t.geoid
      from public.tracts t
      join public._dda_zctas z on extensions.ST_Intersects(t.geom, z.geom)
    """)}
    _run_sql("drop table if exists public._dda_zctas;")

    batch = []
    for geoid in sorted(all_tracts):
        batch.append({
            "geoid": geoid, "qct": geoid in qct_geoids, "dda": geoid in dda_geoids,
            "opportunity_zone": geoid in oz_geoids,
            "qct_source_url": "https://www.huduser.gov/portal/datasets/qct.html",
            "dda_source_url": "https://www.huduser.gov/portal/datasets/qct.html",
            "oz_source_url": "https://www.cdfifund.gov/opportunity-zones",
        })
    upload("tract_designations", batch, len(batch), batch=200, on_conflict="geoid")
    print(f"  tract_designations: {len(all_tracts)} tracts; "
          f"{len(qct_geoids)} QCT, {len(dda_geoids)} DDA, {len(oz_geoids)} Opportunity Zone "
          f"({len(oz_unmatched)} OZ tracts from the 2018/2010-vintage list did not match a "
          f"current tract geoid: {sorted(oz_unmatched)})")


# ---------- 5. FRED market series ----------

FRED_SERIES = {
    "MORTGAGE30US": "30-Year Fixed Rate Mortgage Average in the United States",
    "DPRIME": "Bank Prime Loan Rate",
    "DGS10": "Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity",
    "WPUIP2311001": "PPI: Inputs to Industries: Net Inputs to Residential Construction, Goods",
    "ATNHPIUS38300Q": "All-Transactions House Price Index for Pittsburgh, PA (MSA)",
}


def market_series(con=None):
    key = os.environ["FRED_API_KEY"]
    total_rows = 0
    with httpx.Client(timeout=60) as client:
        for series_id, title in FRED_SERIES.items():
            r = client.get("https://api.stlouisfed.org/fred/series/observations", params={
                "series_id": series_id, "api_key": key, "file_type": "json",
                "observation_start": "2025-06-01",  # >= 12 months of history
            })
            r.raise_for_status()
            obs = [o for o in r.json()["observations"] if o["value"] != "."]
            rows_ = [{"series_id": series_id, "title": title, "date": o["date"],
                      "value": float(o["value"]), "units": None, "source": "fred"} for o in obs]
            upload("market_series", rows_, len(rows_), batch=500, on_conflict="series_id,date")
            total_rows += len(rows_)
            latest = obs[-1] if obs else None
            print(f"  market_series {series_id}: {len(rows_)} rows"
                  + (f", latest {latest['date']} = {latest['value']}" if latest else ""))
    print(f"  market_series: {total_rows} rows total across {len(FRED_SERIES)} series")


# ---------- 6. Millage ----------

_MUNI_SUFFIXES = re.compile(r"\b(BORO|BOROUGH|TWP|TOWNSHIP|MUNICIPALITY|VILLAGE)\b")
_MUNI_OVERRIDES = {"JEFFERSON": "JEFFERSON HILLS"}
# Boro vs Twp is otherwise stripped by _norm_muni, but these municipality
# pairs share a base name with both a borough and a township -- keep the
# type word for exactly these (checked against the un-stripped name).
_MUNI_TYPE_DISAMBIG = {
    "BALDWIN BORO": "877", "BALDWIN TWP": "902",
    "ELIZABETH BORO": "825", "ELIZABETH TWP": "908",
    "SPRINGDALE BORO": "853", "SPRINGDALE TWP": "948",
}


def _norm_muni(name):
    s = name.upper()
    s = re.sub(r"MT\.?\s*", "MOUNT ", s)
    s = s.replace("'", "").replace(".", "")
    s = re.sub(r"\bHGTS\b", "HEIGHTS", s)
    s = _MUNI_SUFFIXES.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    return _MUNI_OVERRIDES.get(s, s)


def _muni_code(name, muni_lookup):
    raw = re.sub(r"MT\.?\s*", "MOUNT ", name.upper()).replace("'", "").replace(".", "")
    raw = re.sub(r"\bHGTS\b", "HEIGHTS", raw)
    raw = re.sub(r"\bBOROUGH\b", "BORO", raw)
    raw = re.sub(r"\bTOWNSHIP\b", "TWP", raw)
    raw = re.sub(r"\s+", " ", raw).strip()
    if raw in _MUNI_TYPE_DISAMBIG:
        return _MUNI_TYPE_DISAMBIG[raw]
    return muni_lookup.get(_norm_muni(name))


def millage(con=None):
    muni_lookup = {}  # normalized name -> municode (non-ward municipalities only)
    for r in _run_sql("select municode, muni_desc from public.assessments group by municode, muni_desc"):
        if "Ward" in r["muni_desc"]:
            continue
        muni_lookup[_norm_muni(r["muni_desc"])] = r["municode"]

    muni_url = "https://alleghenycountytreasurer.us/wp-content/uploads/2026/03/Tax-Collectors-Millages-2026.pdf"
    school_url = "https://alleghenycountytreasurer.us/wp-content/uploads/2025/07/School-District-Millages_2025-2026.pdf"

    out = []
    unmatched = []

    # -- County + municipalities --
    text = subprocess.run(["pdftotext", "-layout", str(RAW / "millage_muni_2026.pdf"), "-"],
                          capture_output=True, text=True, check=True).stdout
    # Name, then (collector name + phone -- both skipped over, whatever their
    # shape) then the two millage numbers and the "value of 1 mill" dollar
    # figure. Phone numbers always contain a hyphen or a letter (extension
    # "x123"), so they never accidentally match the [\d.]+ millage tokens.
    full_re = re.compile(r"^(?P<name>\S.*?)\s{2,}(?P<m2025>[\d.]+)\s+(?P<m2026>[\d.]+)\s+\$\s*[\d,]+\s*$")
    cont_re = re.compile(r"^(?P<name>.+?)\s{2,}(?P<m2025>[\d.]+)\s+(?P<m2026>[\d.]+)\s*$")
    last_name, last_mills = None, None
    CITY_CODES = {"CITY OF CLAIRTON": "CITY_CLAIRTON", "CITY OF DUQUESNE": "CITY_DUQUESNE",
                  "CITY OF MCKEESPORT": "CITY_MCKEESPORT", "CITY OF PITTSBURGH": "CITY_PGH"}
    # Only Clairton and McKeesport actually carry a second (building) row in
    # this file -- Duquesne and Pittsburgh get a single, general-rate row.
    split_rate_cities = set()
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        cm = cont_re.match(ln)
        if cm and i > 0:
            prev_name = re.sub(r"\*+$", "", re.split(r"\s{2,}", lines[i - 1].strip(), maxsplit=1)[0].strip())
            if prev_name.upper() == cm.group("name").strip().upper():
                split_rate_cities.add(prev_name.upper())
    for ln in text.splitlines():
        if not ln.strip() or "MILLAGE" in ln.upper() or "MUNICIPALITY" in ln.upper() or ln.startswith("**"):
            continue
        m = full_re.match(ln)
        if m:
            # The municipality name is always the first field, i.e. everything
            # before the first run of 2+ spaces -- collector name/phone (if
            # any) are whatever full_re's non-greedy match swallowed to reach
            # the trailing millage numbers, and are not otherwise used.
            name = re.sub(r"\*+$", "", re.split(r"\s{2,}", ln.strip(), maxsplit=1)[0].strip())
            mills = float(m.group("m2026"))
            if name == "Allegheny County":
                out.append({"jurisdiction_type": "county", "code": "42003", "name": name,
                            "rate_type": "general", "mills": mills, "year": 2026, "source_url": muni_url})
            else:
                key = name.upper()
                if key in CITY_CODES:
                    code = CITY_CODES[key]
                    rate_type = "land" if key in split_rate_cities else "general"
                else:
                    code = _muni_code(name, muni_lookup)
                    if code is None:
                        unmatched.append(name)
                        code = "slug:" + _norm_muni(name).lower().replace(" ", "-")
                    rate_type = "general"
                out.append({"jurisdiction_type": "municipality", "code": code, "name": name,
                            "rate_type": rate_type, "mills": mills, "year": 2026, "source_url": muni_url})
            last_name, last_mills = name, mills
            continue
        m = cont_re.match(ln)
        if m and last_name and m.group("name").strip() == last_name:
            mills = float(m.group("m2026"))
            key = last_name.upper()
            code = CITY_CODES.get(key)
            if code:
                out.append({"jurisdiction_type": "municipality", "code": code, "name": last_name,
                            "rate_type": "building", "mills": mills, "year": 2026, "source_url": muni_url})

    # -- School districts --
    text = subprocess.run(["pdftotext", "-layout", str(RAW / "millage_school_2026.pdf"), "-"],
                          capture_output=True, text=True, check=True).stdout
    # Fields are separated by runs of 2+ spaces: [district, municipalities
    # fragment, 2024-25 mills, 2025-26 mills, (value of 1 mill, sometimes
    # absent -- e.g. Clairton's -BLDG row)]. Multi-line entries wrap the
    # municipalities list around this row; only this row (district name +
    # numbers on the same line) carries numbers. Clairton is the one
    # split-rate district: field[1] is 'CLAIRTON-LAND' / 'CLAIRTON-BLDG'
    # rather than a municipality name.
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or "MILLAGE" in ln.upper() or "SCHOOL DISTRICT" in ln.upper():
            continue
        fields = re.split(r"\s{2,}", ln)
        if len(fields) < 2:
            continue
        is_num = [bool(re.match(r"^[\d,.]+$", f)) for f in fields[1:]]
        nums = [f for f, n in zip(fields[1:], is_num) if n]
        tags = [f for f, n in zip(fields[1:], is_num) if not n]
        if len(nums) < 2:
            continue
        name = re.sub(r"\*+$", "", fields[0].strip())  # e.g. Penn-Trafford*, Fort Cherry* (only partly in the county)
        mills = float(nums[1].replace(",", ""))  # 2025-26 column (2024-25 is nums[0])
        rate_type = "general"
        tag = tags[0].strip().upper() if tags else ""
        if tag == f"{name}-LAND":
            rate_type = "land"
        elif tag == f"{name}-BLDG":
            rate_type = "building"
        code = "sd:" + name.lower().replace(" ", "-").replace(".", "")
        out.append({"jurisdiction_type": "school_district", "code": code, "name": name,
                    "rate_type": rate_type, "mills": mills, "year": 2026, "source_url": school_url})

    upload("millage", out, len(out), batch=200, on_conflict="jurisdiction_type,code,rate_type,year")
    n_muni = sum(1 for r in out if r["jurisdiction_type"] == "municipality")
    n_sd = sum(1 for r in out if r["jurisdiction_type"] == "school_district")
    print(f"  millage: 1 county + {n_muni} municipality rows + {n_sd} school-district rows"
          + (f"; unmatched to a municode: {unmatched}" if unmatched else ""))


DATASETS = {"hud_fmr": hud_fmr, "hud_income_limits": hud_income_limits,
            "affordable_rent_limits": affordable_rent_limits,
            "tract_designations": tract_designations, "market_series": market_series,
            "millage": millage}

if __name__ == "__main__":
    load_env()
    name, *extra = sys.argv[1:]
    fn = DATASETS[name]
    fn(connect()) if name == "tract_designations" else fn()
