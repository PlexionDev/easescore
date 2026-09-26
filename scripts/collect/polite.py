"""Polite fetcher shared by every zoning-decision collector.

Implements the collection rules (ZONING-DECISIONS-COLLECTION PART 1):
  - robots.txt checked per domain; disallowed paths are skipped and logged
  - one request at a time per domain (single-threaded + a per-domain file lock
    so two collector processes never hit the same host at once)
  - 3 s + 0-1 s jitter between requests (pass delay=5 for small municipal sites)
  - on 429 / 5xx / network error: back off 60 s, 120 s, 240 s; if the request
    still fails after the third back-off, stop the source (SourceStopped)
  - honest User-Agent "EaseScore-research (contact: <RESEARCH_CONTACT>)", with
    RESEARCH_CONTACT read from .env.local at runtime (never printed or logged)
  - every download cached under data/raw/zoning-decisions/<source>/ with a
    manifest.jsonl (url, fetched_at, sha256, path, status); a URL already in the
    manifest is never fetched again, so collectors are resumable
  - per-domain daily cap of 2,000 requests (robots.txt fetches count)
  - bot protection (403 / "Access Denied") stops the source. It is never evaded:
    no browser User-Agent, no headless browser, no IP rotation.
"""
import fcntl
import hashlib
import json
import random
import time
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "data" / "raw" / "zoning-decisions"
STATE = BASE / "_state"
DAILY_CAP = 2000
BACKOFFS = (60, 120, 240)


class SourceStopped(Exception):
    """The source must stop (repeated errors, bot protection, or daily cap)."""


class Disallowed(Exception):
    """robots.txt (or an explicit deny rule) forbids this URL."""


def _contact():
    for line in (ROOT / ".env.local").read_text().splitlines():
        if line.startswith("RESEARCH_CONTACT="):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            if v:
                return v
    raise SystemExit("RESEARCH_CONTACT is not set in .env.local")


def _now():
    return datetime.now(timezone.utc)


class PoliteFetcher:
    def __init__(self, source, delay=3.0, deny=()):
        self.source = source
        self.delay = delay
        self.deny = tuple(deny)  # extra URL substrings never to fetch
        self.dir = BASE / source
        self.dir.mkdir(parents=True, exist_ok=True)
        STATE.mkdir(parents=True, exist_ok=True)
        self.manifest_path = self.dir / "manifest.jsonl"
        self.log_path = self.dir / "progress.log"
        self.manifest = {}
        if self.manifest_path.exists():
            for line in self.manifest_path.read_text().splitlines():
                if line.strip():
                    rec = json.loads(line)
                    self.manifest[rec["url"]] = rec
        self.ua = f"EaseScore-research (contact: {_contact()})"
        self.client = httpx.Client(headers={"User-Agent": self.ua}, timeout=60,
                                   follow_redirects=True)
        self.robots = {}
        self.requests_made = 0
        self.cache_hits = 0

    # ---------- logging ----------
    def log(self, msg):
        line = f"{_now().isoformat(timespec='seconds')} {msg}"
        with self.log_path.open("a") as f:
            f.write(line + "\n")
        print(f"[{self.source}] {msg}", flush=True)

    # ---------- per-domain state: last request time + daily count ----------
    def _state_file(self, host):
        return STATE / f"{host}.json"

    def _wait_turn(self, host):
        """Hold the domain lock, sleep out the politeness delay, count the request."""
        lock = open(STATE / f"{host}.lock", "w")
        fcntl.flock(lock, fcntl.LOCK_EX)
        sf = self._state_file(host)
        st = json.loads(sf.read_text()) if sf.exists() else {}
        today = _now().date().isoformat()
        count = st.get("counts", {}).get(today, 0)
        if count >= DAILY_CAP:
            fcntl.flock(lock, fcntl.LOCK_UN)
            lock.close()
            raise SourceStopped(f"daily cap {DAILY_CAP} reached for {host}")
        wait = st.get("last", 0) + self.delay + random.uniform(0, 1) - time.time()
        if wait > 0:
            time.sleep(wait)
        return lock, sf, st, today, count

    def _done_turn(self, lock, sf, st, today, count):
        st["last"] = time.time()
        st["counts"] = {today: count + 1}
        sf.write_text(json.dumps(st))
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()
        self.requests_made += 1

    def _get(self, url):
        host = urlsplit(url).hostname
        turn = self._wait_turn(host)
        try:
            return self.client.get(url)
        finally:
            self._done_turn(*turn)

    # ---------- robots ----------
    def allowed(self, url):
        if any(d in url for d in self.deny):
            return False
        parts = urlsplit(url)
        key = f"{parts.scheme}://{parts.netloc}"
        if key not in self.robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self._get(f"{key}/robots.txt")
                if r.status_code == 200:
                    # urllib.robotparser does not understand '*' wildcards; cut each
                    # rule at its first '*' so it becomes a (stricter) prefix rule.
                    # It also drops a group whose "User-agent" line is followed by a
                    # blank line, so blank lines are removed (groups still split on
                    # each new User-agent line).
                    rp.parse([ln.split("*", 1)[0] if ln.lower().startswith(("disallow:", "allow:"))
                              else ln for ln in r.text.splitlines() if ln.strip()])
                    (self.dir / f"robots-{parts.netloc}.txt").write_text(r.text)
                else:  # no robots.txt (404 etc.) means no restrictions
                    rp.parse([])
            except httpx.HTTPError as e:
                self.log(f"robots.txt fetch failed for {key}: {type(e).__name__}; treating as disallow-all")
                rp.parse(["User-agent: *", "Disallow: /"])
            self.robots[key] = rp
        return self.robots[key].can_fetch(self.ua, url)

    # ---------- fetch ----------
    def fetch(self, url, ext=None):
        """Return the manifest record for url (downloading it if not cached).

        Raises Disallowed for robots-blocked URLs, SourceStopped when the source
        must stop. Non-retryable HTTP errors (404 etc.) are recorded and returned.
        """
        if url in self.manifest:
            self.cache_hits += 1
            return self.manifest[url]
        if not self.allowed(url):
            self.log(f"SKIP disallowed by robots/deny rule: {url}")
            raise Disallowed(url)
        attempt = 0
        while True:
            try:
                r = self._get(url)
                status, err = r.status_code, None
            except httpx.HTTPError as e:
                r, status, err = None, None, type(e).__name__
            if status == 403 or (r is not None and "text/html" in r.headers.get("content-type", "")
                                 and "<TITLE>ACCESS DENIED</TITLE>" in r.text[:1000].upper()):
                self.log(f"BLOCKED by bot protection (HTTP {status}) at {url}; stopping source, not evading")
                raise SourceStopped(f"bot protection at {url}")
            if status is not None and status != 429 and status < 500:
                break
            if attempt >= len(BACKOFFS):
                self.log(f"STOP after {attempt} back-offs: last status={status} err={err} url={url}")
                raise SourceStopped(f"repeated failures at {url}")
            wait = BACKOFFS[attempt]
            attempt += 1
            self.log(f"status={status} err={err}; backing off {wait}s ({url})")
            time.sleep(wait)
        body = r.content
        if ext is None:
            ctype = r.headers.get("content-type", "")
            ext = ".pdf" if "pdf" in ctype else ".json" if "json" in ctype else ".html"
        name = hashlib.sha1(url.encode()).hexdigest()[:20] + ext
        path = self.dir / name
        if status == 200:
            path.write_bytes(body)
        rec = {
            "url": url,
            "fetched_at": _now().isoformat(timespec="seconds"),
            "sha256": hashlib.sha256(body).hexdigest(),
            "path": str(path.relative_to(ROOT)) if status == 200 else None,
            "status": status,
        }
        with self.manifest_path.open("a") as f:
            f.write(json.dumps(rec) + "\n")
        self.manifest[url] = rec
        return rec

    def read(self, rec):
        return (ROOT / rec["path"]).read_bytes() if rec.get("path") else None

    def close(self):
        self.client.close()
