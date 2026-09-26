# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.1", "httpx>=0.27"]
# ///
"""Load Pittsburgh Regional Transit GTFS stops from data/raw/gtfs/ into Supabase.

Usage: uv run scripts/ingest_transit.py stops

Trip frequency is computed against a representative weekday service (Mon-Fri,
no calendar_dates exceptions in the feed's current schedule period) found in
calendar.txt/calendar_dates.txt. A stop is "frequent" when it sees >= 4
trips/hour during the 7-9am weekday peak (every 15 min or better).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest import ROOT, load_env, connect, upload, rows, jsonable  # noqa: E402

GTFS = ROOT / "data" / "raw" / "gtfs"


def pick_weekday_service(con):
    """Pick the calendar.txt service_id that best represents an ordinary weekday:
    runs Mon-Fri only, and is active today (in the feed's current schedule period).
    A handful of calendar_dates holiday removals (e.g. Labor Day) don't disqualify
    it -- they just mean that one specific date isn't a good example weekday."""
    con.execute(f"create table cal as select * from read_csv('{GTFS / 'calendar.txt'}', all_varchar=true, header=true)")
    con.execute(f"create table cd as select * from read_csv('{GTFS / 'calendar_dates.txt'}', all_varchar=true, header=true)")
    today = con.execute("select strftime(current_date, '%Y%m%d')").fetchone()[0]
    candidates = con.execute("""
      select service_id, start_date, end_date
      from cal
      where monday='1' and tuesday='1' and wednesday='1' and thursday='1' and friday='1'
        and saturday='0' and sunday='0' and start_date <= ? and end_date >= ?
      order by start_date desc
    """, [today, today]).fetchall()
    if not candidates:
        raise SystemExit("no Mon-Fri-only service active today found in calendar.txt")
    service_id, start, end = candidates[0]
    exceptions = con.execute(
        "select count(*) from cd where service_id = ? and exception_type = '2'", [service_id]
    ).fetchone()[0]
    if exceptions:
        print(f"  note: service_id {service_id!r} has {exceptions} holiday removal(s) in its period (e.g. Labor Day) -- ignored")
    return service_id, start, end


def stops(con):
    service_id, start, end = pick_weekday_service(con)
    print(f"  using service_id {service_id!r} ({start}-{end}) as representative weekday")

    con.execute(f"create table trips2 as select trip_id from read_csv('{GTFS / 'trips.txt'}', all_varchar=true, header=true) where service_id = '{service_id}'")
    con.execute(f"""
      create table st as
      select t.stop_id, cast(substr(t.arrival_time, 1, 2) as int) hh
      from read_csv('{GTFS / 'stop_times.txt'}', all_varchar=true, header=true) t
      join trips2 using (trip_id)
    """)
    con.execute(f"create table s as select * from read_csv('{GTFS / 'stops.txt'}', all_varchar=true, header=true)")

    total = con.execute("select count(distinct stop_id) from s").fetchone()[0]
    sql = """
      select s.stop_id,
             nullif(trim(s.stop_name), '') as stop_name,
             coalesce(round(f.peak / 2.0, 2), 0) as peak_trips_per_hour,
             coalesce(f.total, 0) as weekday_trips,
             coalesce(f.peak, 0) / 2.0 >= 4 as frequent,
             'SRID=4326;POINT(' || s.stop_lon || ' ' || s.stop_lat || ')' as geom
      from s
      left join (
        select stop_id,
               count(*) filter (where hh between 7 and 8) as peak,
               count(*) as total
        from st
        group by stop_id
      ) f on f.stop_id = s.stop_id
      where s.stop_lat is not null and s.stop_lon is not null
    """
    upload("transit_stops", jsonable(rows(con, sql)), total, batch=1000, on_conflict="stop_id")


DATASETS = {"stops": stops}

if __name__ == "__main__":
    load_env()
    name, *extra = sys.argv[1:]
    DATASETS[name](connect(), *extra)
