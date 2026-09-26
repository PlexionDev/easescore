"""Shared helpers for zoning-decision collectors: DB access and the name scrub."""
import os
import re
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ingest import load_env, upload  # noqa: E402,F401  (re-exported)


def sql(query):
    """Run SQL through the Supabase Management API (same path as scripts/sql.sh)."""
    load_env()
    ref = re.sub(r"https://([^.]+)\..*", r"\1", os.environ["NEXT_PUBLIC_SUPABASE_URL"])
    r = httpx.post(f"https://api.supabase.com/v1/projects/{ref}/database/query",
                   headers={"Authorization": f"Bearer {os.environ['SUPABASE_ACCESS_TOKEN']}"},
                   json={"query": query}, timeout=180)
    if r.status_code >= 300:
        raise SystemExit(f"sql failed {r.status_code}: {r.text[:500]}")
    return r.json()


def q(v):
    """SQL literal."""
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


# ---------- name scrub ----------
# Capitalized words that are NOT personal names in zoning text. A run of
# capitalized words is kept if any word is in this list; otherwise it is
# treated as a possible "First Last" name and replaced with "[name]".
KEEP = set("""
street st avenue ave road rd way drive dr boulevard blvd lane ln place pl court ct alley terrace
square highway hwy parkway pkwy circle plaza pike run row hill hills heights park point view
north south east west n s e w upper lower mount mt saint st. center central
pittsburgh allegheny pennsylvania pa city county state commonwealth united states america
board zoning adjustment code section chapter article title ordinance resolution council
planning commission department division bureau authority district ward neighborhood
university college school academy church hospital library museum center centre foundation
corporation corp company co inc llc lp llp association trust bank group partners holdings
properties property development developers housing redevelopment urban water sewer
residential commercial industrial mixed use unit units single family detached attached
multi-unit dwelling dwellings conversion variance variances special exception exceptions
conditional request requests requested approved approval denied dismissed withdrawn
decision date hearing application applicant appellant case zone lot block parcel
the a an of and for to in on at by with from this that these those any all no not
monday tuesday wednesday thursday friday saturday sunday
january february march april may june july august september october november december
findings fact conclusions law conditions condition subject shall parking off-street
review note board's riverfront golden triangle downtown uptown oakland strip shadyside
lawrenceville bloomfield polish squirrel liberty homewood hazelwood greenfield carrick
beechview brookline sheraden allentown knoxville beltzhoover manchester chateau troy
garfield larimer morningside stanton highland friendship spring garden deutschtown
hill district bluff mexican war streets fineview perry summer brighton marshall
residential planned open space public realm educational medical institution
general local neighborhood commercial office light heavy
new house home houses building buildings structure construction addition additions renovation
rehabilitation demolition alteration expansion extension conversion change occupancy existing
proposed temporary accessory principal primary garage carport deck porch patio fence wall walls
sign signs signage canopy projecting billboard electronic display awning roof rooftop dormer
stair stairs parking pad lot lots space spaces driveway curb cut garden yard front rear side
exterior interior setback setbacks height density area floor story stories retaining subdivision
consolidation plan site access loading bay bays restaurant bar tavern retail store grocery shop
cafe salon office warehouse storage daycare day care child care assembly religious worship
dormitory hotel motel apartment apartments condominium townhouse townhouses duplex triplex rowhouse
two three four five six seven eight nine ten one-unit two-unit three-unit multi-unit mixed-use
short-term rental vacation cultural services recreation entertainment medical clinic health
parking-structure solar panels antenna tower telecommunications cell wireless utility pump station
manufacturing brewery distillery winery production fulfillment depot outdoor indoor dining seating
lighting hours operation operations addition. amend amendment modify modification appeal appeals
administrator administrator's determination permit permits certificate nonconforming legally
elementary secondary general limited major minor excavation grading fill
""".split())
_NAME_RUN = re.compile(r"\b(?:[A-Z][a-z'’-]+|[A-Z]\.)(?:\s+(?:[A-Z][a-z'’-]+|[A-Z]\.)){1,7}(?![a-z])")
_HONORIFIC = re.compile(r"\b(?:Mr|Mrs|Ms|Dr|Atty|Attorney|Councilman|Councilwoman|Councilmember)\.?\s+[A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+)?")


def scrub(text):
    """Return (scrubbed_text, n_replacements). Errs on the side of removing."""
    if not text:
        return text, 0
    n = 0

    def hon(_m):
        nonlocal n
        n += 1
        return "[name]"

    text = _HONORIFIC.sub(hon, text)

    def keep(w):
        return w.lower() in KEEP or w.lower().strip(".") in KEEP

    def run(m):
        # Within a run of capitalized words, any 2+ consecutive words that are not
        # in KEEP are treated as a name ("The Applicant Jane Doe" -> "The Applicant [name]").
        nonlocal n
        words = m.group(0).split()
        out, grp = [], []
        for w in words + [None]:
            if w is not None and not keep(w):
                grp.append(w)
                continue
            if len(grp) >= 2:
                n += 1
                out.append("[name]")
            else:
                out.extend(grp)
            grp = []
            if w is not None:
                out.append(w)
        return " ".join(out)

    text = _NAME_RUN.sub(run, text)
    return text, n
