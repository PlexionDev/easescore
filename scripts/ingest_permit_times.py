# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27", "openpyxl>=3.1"]
# ///
"""City of Pittsburgh permit processing time: published targets, the current review queue, and
(when a public source carries application dates) observed application-to-issue durations.

Usage: uv run scripts/ingest_permit_times.py <step>
  targets   PLI "Application Review Order and Service Level Agreements" -> permit_targets
  queue     PLI/DCP "List of Permits Pending Review" spreadsheet     -> permit_queue
  timing    application-to-issue days, last 3 years                  -> permit_timing
  all       all three

Apply supabase/migrations/082_permit_times.sql first. Idempotent: targets upsert, the queue
snapshot for a given as-of date is replaced, timing rows are replaced.

Personal data: the queue spreadsheet has addresses and free-text work descriptions; only the
permit number, type, structure type, and dates are read. Nothing else is stored.
"""
import re
import sys
from datetime import date, timedelta
from math import ceil
from pathlib import Path
from statistics import median

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import RAW, load_env, connect, clean_tsv  # noqa: E402
from ingest_context import run_sql  # noqa: E402
from ingest_utilities import polite_client, polite_get, sql_str  # noqa: E402

OUT = RAW / "permits_timing"
SLA_URL = ("https://www.pittsburghpa.gov/Business-Development/Permits-Licenses-and-Inspections/"
           "Permits/Permit-Process/Permit-Application-Review")
# The City replaces this file in place; the as-of date is the "Date Created" cell inside it.
QUEUE_URL = "https://pittsburghpa.gov/files/assets/city/v/31/pli/documents/plidcp_pending_permits_20250519.xlsx"

# Published SLAs (business days), transcribed from SLA_URL. targets() re-reads the page and stops
# if any of these phrases is gone, so a changed page never leaves stale numbers in the table.
SLA_PHRASES = [
    "30 business days initial, 15 business day revision or amendment",
    "15 business days initial, 8 business day revision or amendment",
    "7 business days initial, revision or amendment",
    "5 business days initial, revision or amendment",
]
SLA = [  # (permit types, structure, initial, revision, scope note)
    (["Building", "Mechanical", "Fire Alarm", "Suppression System", "Floodplain", "Sign", "Demolition",
      "Occupancy Only", "Occupant Load Placard", "Land Operations"], "Commercial", 30, 15,
     "Commercial structures: BDAs, Building, Mechanical, Fire Alarm, Suppression System, Floodplain, Signs, "
     "Demolition, Occupancy Only, Occupant Load Placard, Land Operations. 7 business days for commercial BDAs "
     "limited to temporary occupancy or interior non-structural demolition, and for verified emergencies."),
    (["Building", "Mechanical", "Electrical", "Demolition", "Floodplain", "Occupancy Only"], "Residential", 15, 8,
     "Residential structures: BDAs, Building, Mechanical, Electrical, Demolition, Floodplain, Occupancy Only."),
]

def pct(values, p):
    """Nearest-rank percentile (p in 0-100) -- same convention as percentile_disc."""
    v = sorted(values)
    return v[max(0, ceil(p / 100 * len(v)) - 1)] if v else None


def cal_days(bd):
    return ceil(bd * 7 / 5)


def targets():
    client, ua = polite_client()
    page = polite_get(client, ua, SLA_URL).text
    client.close()
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", page))
    missing = [p for p in SLA_PHRASES if p not in text]
    if missing:
        raise SystemExit(f"SLA page changed; re-check it by hand before loading. Missing: {missing}")
    m = re.search(r"last updated:\s*(\d{2})/(\d{2})/(\d{4})", text)
    as_of = f"{m.group(3)}-{m.group(1)}-{m.group(2)}" if m else None
    vals = []
    for types, st, ini, rev, note in SLA:
        for t in types:
            for rnd, bd in (("initial", ini), ("revision", rev)):
                vals.append(f"({sql_str(t)}, '{st}', '{rnd}', {bd}, {cal_days(bd)}, {sql_str(note)}, "
                            f"{sql_str(SLA_URL)}, {sql_str(as_of) if as_of else 'null'})")
    run_sql(f"""
      insert into public.permit_targets (permit_type, structure_type, review_round, target_days,
                                         target_calendar_days, scope_note, source_url, as_of)
      values {', '.join(vals)}
      on conflict (permit_type, structure_type, review_round) do update set
        target_days = excluded.target_days, target_calendar_days = excluded.target_calendar_days,
        scope_note = excluded.scope_note, source_url = excluded.source_url, as_of = excluded.as_of;
    """)
    print(f"  permit_targets: {len(vals)} rows (page last updated {as_of})")


def queue():
    import openpyxl
    OUT.mkdir(parents=True, exist_ok=True)
    client, ua = polite_client()
    body = polite_get(client, ua, QUEUE_URL).content
    client.close()
    tmp = OUT / "pending_permits_latest.xlsx"
    tmp.write_bytes(body)
    ws = openpyxl.load_workbook(tmp, read_only=True).worksheets[0]
    as_of, header, recs = None, None, {}
    for r in ws.iter_rows(values_only=True):
        if as_of is None and "Date Created:" in r:
            as_of = r[r.index("Date Created:") + 1].date()
        elif header is None and "Permit #" in r:
            header = {name: i for i, name in enumerate(r) if name}
        elif header and r[header["Permit #"]]:
            pid = str(r[header["Permit #"]]).strip()
            sub, exp = r[header["Submitted"]], r[header["Expected Date"]]
            st = r[header["Structure Type"]]
            recs[pid] = (pli_norm(r[header["Permit Type"]]),
                         st if st in ("Residential", "Commercial") else "Unspecified",
                         sub.date() if sub else None, exp.date() if exp else None)
    if not as_of or not header:
        raise SystemExit("queue spreadsheet layout changed (no 'Date Created:' or header row)")
    snap = OUT / f"pending_permits_{as_of.isoformat()}.xlsx"
    tmp.replace(snap)
    groups = {}
    for pt, st, sub, exp in recs.values():
        for key in ((pt, st), (pt, "All")):
            groups.setdefault(key, []).append((sub, exp))
    vals = []
    for (pt, st), items in sorted(groups.items()):
        ages = [(as_of - s).days for s, _ in items if s]
        sched = [(e - s).days for s, e in items if s and e]
        vals.append(f"({sql_str(pt)}, '{st}', {len(items)}, {_n(median(ages) if ages else None)}, "
                    f"{_n(pct(ages, 80))}, {_n(median(sched) if sched else None)}, {_n(pct(sched, 80))}, "
                    f"'{as_of}', {sql_str(QUEUE_URL)})")
    run_sql(f"""
      delete from public.permit_queue where as_of = '{as_of}';
      insert into public.permit_queue (permit_type, structure_type, pending_count, median_age_days, p80_age_days,
                                       median_scheduled_days, p80_scheduled_days, as_of, source_url)
      values {', '.join(vals)};
    """)
    print(f"  permit_queue: {len(recs)} distinct pending permits as of {as_of}; {len(vals)} rows")


def _n(x):
    return "null" if x is None else str(x)


DATE_COLS = ("application_date", "applied_date", "submitted_date", "submission_date", "filed_date",
             "create_date", "created_date", "intake_date")


def timing():
    """Application-to-issue days over the last 3 years, from the WPRDC PLI Permits dump in
    data/raw/permits.csv -- only if that file carries an application-type date column."""
    con = connect()
    src = f"read_csv('{clean_tsv('permits')}', all_varchar=true, header=true, delim='\\t', quote='', escape='')"
    cols = [c[0] for c in con.execute(
        f"describe select * from {src}").fetchall()]
    app = next((c for c in cols if c.lower() in DATE_COLS), None)
    if not app:
        run_sql("delete from public.permit_timing;")
        print("  permit_timing: SKIPPED -- the WPRDC PLI Permits file has no application/submitted date "
              f"(columns: {', '.join(c for c in cols if 'date' in c.lower())}). Table left empty.")
        return
    date_to = date.today()
    date_from = date_to - timedelta(days=3 * 365)
    df = con.execute(f"""
      select permit_type, coalesce(work_type, 'All') work_type,
             coalesce(commercial_or_residential, 'All') st,
             datediff('day', try_cast(left({app}, 10) as date), try_cast(left(issue_date, 10) as date)) d
      from {src}
      where try_cast(left(issue_date, 10) as date) between '{date_from}' and '{date_to}'
    """).fetchall()
    bad = [r for r in df if r[3] is None or r[3] < 0 or r[3] > 3 * 365]
    good = [r for r in df if r not in bad]
    print(f"  permit_timing: {len(good)} rows used, {len(bad)} excluded (missing, negative, or > 3 years)")
    groups = {}
    run_sql("delete from public.permit_timing;")
    for pt, wt, st, d in good:
        for key in ((pt, wt, st), (pt, "All", st), (pt, "All", "All")):
            groups.setdefault((pli_norm(key[0]), key[1], key[2]), []).append(d)
    vals = [f"({sql_str(pt)}, {sql_str(wt)}, {sql_str(st)}, {len(v)}, {median(v)}, {pct(v, 80)}, "
            f"'{date_from}', '{date_to}')" for (pt, wt, st), v in groups.items() if len(v) >= 5]
    run_sql(f"""insert into public.permit_timing (permit_type, work_type, structure_type, n, median_days,
                p80_days, date_from, date_to) values {', '.join(vals)}
                on conflict (permit_type, work_type, structure_type) do update set n = excluded.n,
                median_days = excluded.median_days, p80_days = excluded.p80_days,
                date_from = excluded.date_from, date_to = excluded.date_to, computed_at = now();""")


def pli_norm(t):
    """Python twin of SQL public.permit_type_norm (082_permit_times.sql)."""
    t = str(t or "")
    for pat, name in ((r"demol", "Demolition"), (r"building|^bda|^bp$", "Building"), (r"electric", "Electrical"),
                      (r"mechanic", "Mechanical"), (r"fire alarm", "Fire Alarm"), (r"suppression", "Suppression System"),
                      (r"flood", "Floodplain"), (r"occupant load", "Occupant Load Placard"),
                      (r"occupancy", "Occupancy Only"), (r"land op", "Land Operations"), (r"storm", "Storm Water"),
                      (r"sign", "Sign")):
        if re.search(pat, t, re.I):
            return name
    return re.sub(r"\s*permit$", "", t.strip(), flags=re.I).title()


if __name__ == "__main__":
    load_env()
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in (("targets", targets), ("queue", queue), ("timing", timing)):
        if step in (name, "all"):
            fn()
