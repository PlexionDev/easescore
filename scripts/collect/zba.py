# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27", "pypdf>=5"]
# ///
"""Source A: Pittsburgh Zoning Board of Adjustment decision PDFs.

Usage:
  uv run scripts/collect/zba.py fetch [--years 2]   # polite download (resumable)
  uv run scripts/collect/zba.py load                # parse cached PDFs, upload, match parcels

Discovery uses only robots-allowed pages: /sitemap.xml and the ZBA-Agendas
meeting pages under /Business-Development/City-Planning/City-Planning-Meetings/.
The ZBA meeting archive, Commissions-and-Boards ZBA pages, Hearing-Notices, and
/Sitemap are disallowed and never fetched.

PII: the Appearances section, findings, and signatures are never stored. Only
structured fields are kept; free text (request, conditions) is name-scrubbed.
"""
import io
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin

sys.path.insert(0, str(Path(__file__).resolve().parent))
from polite import PoliteFetcher, SourceStopped, Disallowed  # noqa: E402
from common import load_env, upload, scrub, sql  # noqa: E402

SITE = "https://www.pittsburghpa.gov"
AGENDAS = "/Business-Development/City-Planning/City-Planning-Meetings/ZBA-Agendas/"
DENY = (
    "/Business-Development/City-Planning/Commissions-and-Boards/Zoning-Board-of-Adjustment",
    "/ZBA-meeting-archive",
    "/Hearing-Notices",
    "pittsburghpa.gov/Sitemap",
)
MONTHS = {m: i for i, m in enumerate(
    "January February March April May June July August September October November December".split(), 1)}


def meeting_date(url):
    g = re.search(r"/ZBA-Agendas/[^/]*?([A-Z][a-z]+)-(\d{1,2})-(20\d\d)", url)
    if g and g.group(1) in MONTHS:
        return date(int(g.group(3)), MONTHS[g.group(1)], int(g.group(2)))
    return None


def discover(f, years):
    x = f.read(f.fetch(f"{SITE}/sitemap.xml", ext=".xml")).decode("utf-8", "replace")
    locs = [u for u in re.findall(r"<loc>(.*?)</loc>", x) if AGENDAS in u]
    cutoff = date.today() - timedelta(days=365 * years)
    leaf, index = [], {}
    for u in locs:
        d = meeting_date(u)
        if not d or d < cutoff or d > date.today():
            continue
        tail = u.split(AGENDAS, 1)[1].split("/")
        if len(tail) >= 3 and tail[-2] == "Decisions":
            leaf.append((d, u))
        elif len(tail) == 2 and tail[1] == "Decisions":
            index[d] = u
    have = {d for d, _ in leaf}
    pages = leaf + [(d, u) for d, u in index.items() if d not in have]
    pages.sort(key=lambda t: t[0], reverse=True)  # most recent first
    return pages


def fetch(years=2):
    f = PoliteFetcher("zba", delay=3.0, deny=DENY)
    stopped = None
    try:
        pages = discover(f, years)
        f.log(f"discovered {len(pages)} decision pages "
              f"({pages[-1][0] if pages else '-'} .. {pages[0][0] if pages else '-'})")
        links = f.dir / "pdf_links.jsonl"
        seen = set()
        if links.exists():
            seen = {json.loads(ln)["pdf"] for ln in links.read_text().splitlines() if ln}
        for i, (d, page) in enumerate(pages, 1):
            try:
                rec = f.fetch(page, ext=".html")
            except Disallowed:
                continue
            if rec["status"] != 200:
                continue
            html = f.read(rec).decode("utf-8", "replace")
            pdfs = {urljoin(SITE, h) for h in re.findall(r'href="(/files/assets/[^"]+?\.pdf)"', html, re.I)}
            for pdf in sorted(pdfs):
                if pdf not in seen:
                    seen.add(pdf)
                    with links.open("a") as fh:
                        fh.write(json.dumps({"pdf": pdf, "page": page, "meeting": d.isoformat()}) + "\n")
                try:
                    f.fetch(pdf, ext=".pdf")
                except Disallowed:
                    pass
            if i % 20 == 0:
                f.log(f"progress {i}/{len(pages)} pages; {f.requests_made} requests this run")
    except SourceStopped as e:
        stopped = str(e)
        f.log(f"SOURCE STOPPED: {e}")
    f.log(f"fetch done: {f.requests_made} requests, {f.cache_hits} cache hits, stopped={stopped}")
    f.close()


# ---------- parse ----------
SEC = r"\d{3}\.\d{2}(?:\.[A-Za-z0-9]+)*(?:\([A-Za-z0-9]+\))*"
FIELDS = ["Date of Hearing", "Date of Decision", "Zone Case", "Address", "Lot and Block",
          "Zoning Districts?", "Ward", "Neighborhood", "Request", "Application"]
RELIEF = re.compile(r"\b(Special Exceptions?|Use Variance|Variances?|Review|Appeal|Conditional Use)\b")
VERB = re.compile(r"\b(app?rove[sd]?|aproved|grant(?:s|ed)?|den(?:y|ies|ied)|dismiss(?:es|ed)?|withdrawn|(?-i:CONTINUED)|remanded)\b", re.I)


def verb_out(v):
    v = v.lower()
    return ("granted" if v.startswith(("ap", "grant")) else "denied" if v.startswith("den") else
            "dismissed" if v.startswith("dismiss") else "withdrawn" if v == "withdrawn" else
            "pending" if v == "continued" else "other")
SIG = re.compile(r"^\s*(s/|/s/|RECUSED|ABSENT|Note: Decision issued|[A-Z][\w.\s-]+,\s*(Chair|Secretary|Member))", re.M)


def pdf_text(data):
    from pypdf import PdfReader
    return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages)


def to_date(s):
    s = re.sub(r"\s+", " ", (s or "").replace(".", "")).strip()
    s = re.sub(r"^Sept\b", "Sep", s)
    for fmt in ("%B %d, %Y", "%b %d, %Y", "%B %d %Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def header_fields(head):
    """Map template labels to values (values may wrap onto following lines)."""
    lab = "|".join(FIELDS)
    parts = re.split(rf"^[^\S\n]*[a-z]?({lab})\s*:", head, flags=re.M)
    out = {}
    for i in range(1, len(parts) - 1, 2):
        key = re.sub(r"s\?$", "", parts[i]).rstrip("s") if parts[i].startswith("Zoning") else parts[i]
        out.setdefault(key, parts[i + 1].strip())
    return out


def outcome_for(section, clauses, overall):
    stem = section.lower()[:6]  # e.g. "903.03"
    for c in clauses:
        if stem in c.lower():
            v = VERB.search(re.split(r"\bsubject to\b", c, flags=re.I)[0])
            if v:
                return verb_out(v.group(1))
    return overall


def parse_decision(text, url):
    """Return (case, [requests], stats) or raise ValueError."""
    stats = {"scrubbed": 0}
    # Drop the Appearances section and anything naming a party, even when a party
    # label ("Owner/Applicant: ...") appears inline without an Appearances heading.
    head = re.split(r"^\s*Appearances\s*:?", text, maxsplit=1, flags=re.M)[0]
    head = re.sub(r"(?:Owner\s*/\s*)?\b(?:Applicants?|Appellants?|Intervenors?|Counsel|Attorneys?|"
                  r"Owners?|Objectors?)\s*:.*$", "", head, flags=re.M)
    fields = header_fields(head)
    zc = re.search(r"(\d+)\s+of\s+(\d{4})", fields.get("Zone Case", ""))
    if not zc:
        raise ValueError("no zone case")
    case_number = f"{zc.group(1)} of {zc.group(2)}"
    case_id = f"pgh:zba:{zc.group(1)}-{zc.group(2)}"
    app_re = r"\b((?:BDA|DCP-[A-Z]{3})-\d{4}-\d{4,6})\b"
    app_block = fields.get("Application", "")
    if re.fullmatch(app_re, fields.get("Request", "").strip()) and not re.search(app_re, app_block):
        # some decisions swap the two values: "Request: BDA-..." / "Application: <description>"
        first, _, rest = app_block.partition("\n")
        fields["Request"], app_block = first, fields["Request"].strip() + "\n" + rest
    app = re.search(app_re, app_block)
    table = app_block[app.end():] if app else "\n".join(app_block.splitlines()[1:])
    table = " ".join(table.split())

    # Decision section: from the last "Decision:" to the signatures.
    di = [m.start() for m in re.finditer(r"^\s*Decision\s*:", text, re.M)]
    decision = text[di[-1]:] if di else ""
    sig = SIG.search(decision, 10)
    decision = " ".join((decision[:sig.start()] if sig else decision).split())
    decision = re.sub(r"^Decision\s*:\s*", "", decision)
    ruling = re.split(r"\bsubject to\b", decision, flags=re.I)[0]  # conditions may say "approved by"
    verbs = [verb_out(v) for v in VERB.findall(ruling)]
    if re.search(r"legally non-?conforming", decision, re.I) and "may continue" in decision.lower():
        verbs.append("granted")
    overall = (verbs[0] if len(set(verbs)) == 1 else
               "partially_granted" if {"granted", "denied"} <= set(verbs) else
               verbs[0] if verbs else "other")
    clauses = re.split(r"(?<=\.)\s+(?=[A-Z])|;\s*|\band the (?=request|application)", decision)
    cond = re.search(r"\bsubject to\b(.*)", decision, re.I | re.S)
    conditions, n = scrub(cond.group(1).strip(" :;.") if cond else None)
    stats["scrubbed"] += n

    full = " ".join(text.split()).lower()
    if re.search(r"no (?:one|person|members? of the public) (?:appeared|testified|spoke)[^.]{0,40}oppos", full):
        opposition = False
    elif re.search(r"(?:appeared|testified|spoke|letters?|objectors?)[^.]{0,40}(?:in opposition|oppos)|"
                   r"in opposition to the (?:application|request)|objected to", full):
        opposition = True
    else:
        opposition = None

    request, n = scrub(" ".join(fields.get("Request", "").split()) or None)
    stats["scrubbed"] += n
    lots = re.findall(r"\d{1,4}-[A-Za-z]-\d{1,5}(?:-\d{1,4})*", fields.get("Lot and Block", ""))
    case = {
        "case_id": case_id, "jurisdiction": "Pittsburgh", "case_number": case_number, "parid": None,
        "address": " ".join(fields.get("Address", "").split()) or None,
        "district": " ".join(fields.get("Zoning District", "").split()) or None,
        "ward": " ".join(fields.get("Ward", "").split()) or None,
        "neighborhood": " ".join(fields.get("Neighborhood", "").split()) or None,
        "application_number": app.group(1) if app else None,
        "hearing_date": to_date(fields.get("Date of Hearing")),
        "decision_date": to_date(fields.get("Date of Decision")),
        "body": "ZBA", "source_url": url, "source_quality": "formal_decision",
        "status": "pending" if overall == "pending" else "decided",
        "lot_block": ", ".join(lots).upper() or " ".join(fields.get("Lot and Block", "").split()) or None,
        "request_summary": request, "opposition": opposition, "permit_id": None,
    }

    # Requests: one per cited code section in the relief table.
    reliefs = [r.lower() for r in RELIEF.findall(table)]
    secs = list(dict.fromkeys(s.rstrip(".") for s in re.findall(SEC, table)))
    if not secs:
        secs = list(dict.fromkeys(s.rstrip(".") for s in re.findall(SEC, decision)))[:5] or [None]
    bare = " ".join(re.sub(rf"Sections?\s+{SEC}(?:\s*[/,&]\s*{SEC})*|{RELIEF.pattern}", " ", table).split())
    pairs = []
    for m in re.finditer(r"\b(?:required|allowed|permitted)[;,]\s+(.+?)\s+(?:requested|proposed)\b", bare, re.I):
        lead = re.search(r"(\d[\d’'\"”./x-]*\s*(?:[A-Za-z’'\"”-]+\s+){0,5})$", bare[:m.start()])
        pairs.append((lead.group(1) if lead else "", m.group(1)))
    dim_secs = [s for s in secs if s and not s.startswith("911")]
    reqs = []
    for k, s in enumerate(secs, 1):
        has_se = any(r.startswith("special exception") for r in reliefs)
        has_var = any("variance" in r for r in reliefs)
        if s and s.startswith("911") and has_se:
            relief = "special_exception"
        elif s and s.startswith("911") and has_var:
            relief = "use_variance"
        elif has_var and "use variance" in reliefs and not s:
            relief = "use_variance"
        elif has_var:
            relief = "dimensional_variance"
        elif has_se:
            relief = "special_exception"
        elif reliefs:
            relief = reliefs[0].replace(" ", "_")
        else:
            relief = "other"
        req_v = rq_v = None
        if s in dim_secs and pairs:
            i = dim_secs.index(s)
            if len(pairs) == len(dim_secs):
                req_v, rq_v = pairs[i]
            elif len(dim_secs) == 1:
                req_v, rq_v = "; ".join(p[0] for p in pairs), "; ".join(p[1] for p in pairs)
        reqs.append({
            "request_id": f"{case_id}#{k}", "case_id": case_id, "relief_type": relief,
            "code_section": s, "required_value": req_v.strip() if req_v else None,
            "requested_value": rq_v.strip() if rq_v else None,
            "outcome": outcome_for(s, clauses, overall) if s else overall,
            "conditions": conditions,
        })
    return case, reqs, stats


def match_and_link():
    """Lot/block -> parid via parcels.map_block_lot (first listed lot), then Source F permits."""
    sql("""
      update public.zoning_cases z set parid = p.parid
      from public.parcels p
      where z.body = 'ZBA' and z.jurisdiction = 'Pittsburgh' and z.lot_block is not null
        and p.map_block_lot = split_part(z.lot_block, ', ', 1)
    """)
    sql("""
      update public.zoning_cases z set permit_id = p.permit_id
      from public.permits p
      where z.application_number is not null and p.permit_id = z.application_number
    """)


def load():
    f = PoliteFetcher("zba", delay=3.0, deny=DENY)
    links = [json.loads(ln) for ln in (f.dir / "pdf_links.jsonl").read_text().splitlines() if ln]
    cases, reqs, fails, scrubbed, non_decision = {}, [], [], 0, 0
    for ln in links:
        rec = f.manifest.get(ln["pdf"])
        if not rec or rec.get("status") != 200:
            continue
        try:
            text = pdf_text(f.read(rec))
            if not re.search(r"Zone Case|Date of Decision", text):
                non_decision += 1  # e.g. an application or request letter linked from the page
                continue
            case, rq, st = parse_decision(text, ln["pdf"])
        except Exception as e:  # noqa: BLE001
            fails.append((ln["pdf"], f"{type(e).__name__}: {e}"[:120]))
            continue
        scrubbed += st["scrubbed"]
        if case["case_id"] in cases:  # same case in two PDFs: keep the later decision
            if (case["decision_date"] or "") < (cases[case["case_id"]]["decision_date"] or ""):
                continue
            reqs = [r for r in reqs if r["case_id"] != case["case_id"]]
        cases[case["case_id"]] = case
        reqs.extend(rq)
    for u, e in fails:
        f.log(f"parse failure: {e} ({u})")
    f.log(f"parsed {len(cases)} cases, {len(reqs)} requests from {len(links)} PDFs; "
          f"{non_decision} non-decision PDFs skipped; {len(fails)} parse failures; "
          f"{scrubbed} name-like strings scrubbed")
    if cases:
        sql("delete from public.zoning_requests where case_id like 'pgh:zba:%'")
        upload("zoning_cases", iter(cases.values()), len(cases), on_conflict="case_id")
        upload("zoning_requests", iter(reqs), len(reqs), on_conflict="request_id")
        match_and_link()
    f.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fetch"
    if cmd == "fetch":
        yrs = int(sys.argv[sys.argv.index("--years") + 1]) if "--years" in sys.argv else 2
        fetch(yrs)
    elif cmd == "load":
        load_env()
        load()
    else:
        raise SystemExit(f"unknown command {cmd}")
