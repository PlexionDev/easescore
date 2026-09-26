# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27"]
# ///
"""Source C: Pittsburgh City Council conditional uses via the public Legistar Web API.

Usage: uv run scripts/collect/legistar.py

Pages through every Matter (ordered by MatterId, $top/$skip) with the polite
fetcher, keeps Resolutions whose title or name mentions "Conditional Use",
parses structured fields from the title, and upserts zoning_cases /
zoning_requests (body='City Council', source_quality='formal_decision').
Applicant names in titles are never stored: only the use clause is kept, and
it is name-scrubbed.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from polite import PoliteFetcher, SourceStopped  # noqa: E402
from common import load_env, upload, scrub, sql, q  # noqa: E402

API = "https://webapi.legistar.com/v1/pittsburgh/matters"
PAGE = 1000
LOT = r"\d{1,4}-[A-Z]-\d{1,5}(?:-\d{1,4})?"
SUFFIX = {"AVENUE": "AVE", "STREET": "ST", "ROAD": "RD", "DRIVE": "DR", "BOULEVARD": "BLVD",
          "LANE": "LN", "PLACE": "PL", "COURT": "CT", "TERRACE": "TER", "HIGHWAY": "HWY",
          "SQUARE": "SQ", "PARKWAY": "PKWY", "CIRCLE": "CIR", "ALLEY": "ALY", "PLAZA": "PLZ"}
DIRS = {"NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W"}
STREET_WORDS = "Avenue|Ave|Street|St|Road|Rd|Way|Drive|Dr|Boulevard|Blvd|Lane|Ln|Place|Pl|Court|Ct|Terrace|Ter|Alley|Highway|Pike|Square|Plaza|Parkway|Circle|Run|Ext"
ADDR = re.compile(rf"\b(\d+[A-Z]?)(?:\s*[-–]\s*\d+[A-Z]?)?\s+((?:[NSEW]\.?\s+|North\s+|South\s+|East\s+|West\s+)?"
                  rf"(?:[A-Z0-9][\w.'’]*\s+){{0,3}}?(?:{STREET_WORDS}))\b\.?")
OUTCOME = {
    "Passed Finally": ("granted", "decided"), "Approved": ("granted", "decided"),
    "Adopted": ("granted", "decided"), "Defeated": ("denied", "decided"),
    "Withdrawn": ("withdrawn", "withdrawn"),
    "Died due to expiration of legislative council session": ("expired", "expired"),
    "Read, Received and Filed": ("other", "filed"),
}


def norm_street(s):
    words = re.sub(r"[.,]", "", s).upper().split()
    words = [DIRS.get(w, w) for w in words]
    if words and words[-1] in SUFFIX:
        words[-1] = SUFFIX[words[-1]]
    return " ".join(words)


def collect(f):
    matters, skip = [], 0
    while True:
        url = f"{API}?$orderby=MatterId&$top={PAGE}&$skip={skip}"
        rec = f.fetch(url, ext=".json")
        if rec["status"] != 200:
            f.log(f"page skip={skip} status={rec['status']}; stopping paging")
            break
        page = json.loads(f.read(rec))
        matters.extend(page)
        if len(page) < PAGE:
            break
        skip += PAGE
        if skip % 10000 == 0:
            f.log(f"paged {skip:,} matters; {f.requests_made} requests this run")
    return matters


def parse(m):
    title = (m.get("MatterTitle") or "").replace("\n", " ")
    rec_date = lambda k: (m.get(k) or "")[:10] or None  # noqa: E731
    lots = re.findall(LOT, title)
    addr = ADDR.search(title)
    sec = re.search(r"Section\s+(\d{3}\.\d{2}(?:\.[A-Za-z0-9]+)*)", title)
    dist = re.search(r"zoned\s+[“\"]([^”\"]+)[”\"]", title)
    ward = re.search(r"(\d+)(?:st|nd|rd|th)?\s*(?:(?:&|and)\s*(\d+)(?:st|nd|rd|th)\s+)?Wards?\b", title)
    hear = re.search(r"Public Hearing held (\d{1,2})/(\d{1,2})/(\d{2,4})", title)
    use = re.search(r"\bfor (?:the )?authorization (?:to |for )?(.+?)(?=\s+(?:located\s+)?at\s+\d|,\s*(?:Parcels?|Block)|"
                    r"\s+on property zoned|,?\s*zoned|\s+located\s)", title) or \
        re.search(r",\s*for (?:an? |the )(.+?)(?=\s+(?:located\s+)?at\s+\d|,\s*(?:Parcels?|Block)|,?\s*zoned)", title)
    summary, scrubbed = scrub(use.group(1).strip(" ,") if use else None)
    status = m.get("MatterStatusName") or ""
    outcome, case_status = OUTCOME.get(status, ("pending", "pending"))
    hearing = None
    if hear:
        mo, dd, yy = hear.groups()
        yy = int(yy) + (2000 if len(yy) == 2 else 0)
        hearing = f"{yy:04d}-{int(mo):02d}-{int(dd):02d}"
    case_id = f"pgh:council:{m['MatterFile']}"
    case = {
        "case_id": case_id, "jurisdiction": "Pittsburgh", "case_number": m["MatterFile"],
        "parid": None,
        "address": f"{addr.group(1)} {addr.group(2)}".strip() if addr else None,
        "district": dist.group(1).strip() if dist else None,
        "ward": (f"{ward.group(1)}&{ward.group(2)}" if ward and ward.group(2) else ward.group(1) if ward else None),
        "neighborhood": None, "application_number": None,
        "hearing_date": hearing or rec_date("MatterAgendaDate"),
        "decision_date": rec_date("MatterPassedDate") if case_status == "decided" else None,
        "body": "City Council",
        "source_url": f"https://pittsburgh.legistar.com/LegislationDetail.aspx?ID={m['MatterId']}&GUID={m['MatterGuid']}",
        "source_quality": "formal_decision", "status": case_status,
        "lot_block": ", ".join(dict.fromkeys(lots)) or None,
        "request_summary": summary, "opposition": None, "permit_id": None,
    }
    req = {
        "request_id": f"{case_id}#1", "case_id": case_id, "relief_type": "conditional_use",
        "code_section": sec.group(1).rstrip(".") if sec else None,
        "required_value": None, "requested_value": None, "outcome": outcome, "conditions": None,
    }
    return case, req, scrubbed


def is_conditional_use(m):
    text = f"{m.get('MatterTitle') or ''} {m.get('MatterName') or ''}".lower()
    return "conditional use" in text and m.get("MatterTypeName") == "Resolution"


def match_parcels(case_ids_prefix="pgh:council:"):
    """Set parid where unambiguous: single lot/block first, then house number + street."""
    sql(f"""
      update public.zoning_cases z set parid = p.parid
      from public.parcels p
      where z.case_id like {q(case_ids_prefix + '%')} and z.parid is null
        and z.lot_block is not null and z.lot_block not like '%,%'
        and p.map_block_lot = z.lot_block
        and (select count(*) from public.parcels p2 where p2.map_block_lot = z.lot_block) = 1
    """)
    rows = sql(f"""select case_id, address from public.zoning_cases
                   where case_id like {q(case_ids_prefix + '%')} and parid is null and address is not null""")
    vals = []
    for r in rows:
        g = re.match(r"(\d+)[A-Z]?\s+(.*)", r["address"])
        if g:
            vals.append(f"({q(r['case_id'])},{q(g.group(1))},{q(norm_street(g.group(2)))})")
    if vals:
        sql(f"""
          with v(case_id, house_num, street) as (values {','.join(vals)}),
          m as (
            select v.case_id, min(a.parid) parid, count(*) n
            from v join public.assessments a
              on a.house_num = v.house_num
             and regexp_replace(upper(a.address), '\\s+', ' ', 'g') = v.street
             and a.municode ~ '^1[0-3][0-9]$' and a.municode::int between 101 and 132
            group by v.case_id)
          update public.zoning_cases z set parid = m.parid
          from m where m.case_id = z.case_id and m.n = 1
        """)


def main():
    load_env()
    f = PoliteFetcher("legistar", delay=3.0)
    stopped = None
    try:
        matters = collect(f)
    except SourceStopped as e:
        stopped, matters = str(e), []
        f.log(f"SOURCE STOPPED: {e}")
    f.log(f"{len(matters):,} matters paged; {f.requests_made} requests, {f.cache_hits} cache hits")
    cu = [m for m in matters if is_conditional_use(m)]
    mentions = sum(1 for m in matters if "conditional use" in
                   f"{m.get('MatterTitle') or ''} {m.get('MatterName') or ''}".lower())
    f.log(f"{mentions} matters mention conditional use; {len(cu)} are conditional-use resolutions")
    cases, reqs, scrubbed, fails = [], [], 0, 0
    for m in cu:
        try:
            c, r, n = parse(m)
        except Exception as e:  # noqa: BLE001
            fails += 1
            f.log(f"parse failure {m.get('MatterFile')}: {type(e).__name__}")
            continue
        cases.append(c)
        reqs.append(r)
        scrubbed += n
    f.log(f"parsed {len(cases)} cases, {fails} failures, {scrubbed} name-like strings scrubbed")
    if cases:
        upload("zoning_cases", iter(cases), len(cases), on_conflict="case_id")
        upload("zoning_requests", iter(reqs), len(reqs), on_conflict="request_id")
        match_parcels()
    f.close()
    if stopped:
        print(f"stopped: {stopped}")


if __name__ == "__main__":
    main()
