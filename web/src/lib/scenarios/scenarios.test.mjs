// Scenario data loop tests. Run: node --test web/src/lib/scenarios/scenarios.test.mjs
// (Node 22.6+ strips the TypeScript types in core.ts; core.ts has no imports on purpose.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { applyMinN, buildRow, dedupeMaterial, maybeSend, MIN_N, pickMedians, ROW_FIELDS, sanitizeScenario } from "./core.ts";

const PARID = "0011A00151000000"; // public demo parcel
const base = () => ({
  parid: PARID, strategy: "new_sf", scheme: "sf-1", tier: "good",
  params: { pf_tier: "good", pf_line_hard_base: 300000, qf_s: 2 },
  summary: { units: 1, finishedSf: 1500, tdc: 410000, verdict: "no", tenure: "sale" },
});

test("identifier stripping: no ip/ua/cookie/session/request/free-text fields reach the insert", () => {
  const hostile = {
    ...base(),
    ip: "203.0.113.9", userAgent: "Mozilla/5.0", ua: "x", cookie: "sid=abc", cookies: { sid: "abc" }, sessionId: "s1", session_id: "s1",
    requestId: "r1", email: "a@b.c", name: "Pat", phone: "412-555-0100", referrer: "https://x", fingerprint: "fp", created_at: "2026-09-27T10:11:12Z", note: "call me",
    params: { ...base().params, ip: "203.0.113.9", pf_note: "call me at 412 555 0100", pf_email: "a@b.c", utm_source: "x", sid: "abc" },
    summary: { ...base().summary, ip: "1.2.3.4", comment: "hi", verdict: "maybe" },
  };
  const s = sanitizeScenario(hostile);
  assert.ok(s);
  const row = buildRow(s, "2026-09-27");
  assert.deepEqual(Object.keys(row).sort(), [...ROW_FIELDS].sort());
  const json = JSON.stringify(row);
  for (const bad of ["203.0.113.9", "Mozilla", "sid=abc", "a@b.c", "Pat", "412", "call me", "fp", "T10:11", "utm_source", "hi", "maybe", "1.2.3.4"]) {
    assert.ok(!json.includes(bad), `row leaked ${bad}: ${json}`);
  }
  assert.deepEqual(Object.keys(row.params), ["pf_line_hard_base", "pf_tier", "qf_s"]);
  assert.deepEqual(Object.keys(row.summary).sort(), ["finishedSf", "tdc", "tenure", "units"]);
  assert.equal(row.line_per_sf.hard_base, 200);
  assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);
});

test("rejects bad parcel IDs, bad strategies and scenarios with no edits", () => {
  assert.equal(sanitizeScenario({ ...base(), parid: "not-a-parcel" }), null);
  assert.equal(sanitizeScenario({ ...base(), strategy: "DROP TABLE" }), null);
  assert.equal(sanitizeScenario({ ...base(), params: { qf_s: 2 } }), null);
  assert.equal(sanitizeScenario(null), null);
});

test("dedupe key: same parcel + scheme + day + params (any key order) → same key; any change → new key", () => {
  const h = (row) => createHash("sha256").update(dedupeMaterial(row)).digest("hex");
  const a = buildRow(sanitizeScenario(base()), "2026-09-27");
  const b = buildRow(sanitizeScenario({ ...base(), params: { qf_s: 2, pf_line_hard_base: "300000", pf_tier: "good" } }), "2026-09-27");
  assert.equal(h(a), h(b));
  assert.notEqual(h(a), h({ ...a, day: "2026-09-28" }));
  assert.notEqual(h(a), h({ ...a, scheme: "sf-2" }));
  assert.notEqual(h(a), h({ ...a, parid: "0011A00152000000" }));
  assert.notEqual(h(a), h({ ...a, params: { ...a.params, pf_line_hard_base: 300001 } }));
  // Summary numbers are not part of the key (same edits = same scenario).
  assert.equal(h(a), h({ ...a, summary: { tdc: 1 } }));
});

test("n >= 5 rule: groups below 5 are never shown; area preferred over all", () => {
  assert.equal(MIN_N, 5);
  const rows = [
    { line_id: "hard_base", scope: "all", median_per_sf: 210, n: 5 },
    { line_id: "hard_base", scope: "area", median_per_sf: 190, n: 4 },
    { line_id: "land", scope: "all", median_per_sf: 20, n: 4 },
    { line_id: "ae", scope: "area", median_per_sf: 9, n: 6 },
    { line_id: "ae", scope: "all", median_per_sf: 8, n: 12 },
  ];
  assert.deepEqual(applyMinN(rows).map((r) => `${r.line_id}/${r.scope}`), ["hard_base/all", "ae/area", "ae/all"]);
  const m = pickMedians(rows);
  assert.equal(m.hard_base.median_per_sf, 210);
  assert.equal(m.land, undefined);
  assert.equal(m.ae.scope, "area");
});

test("toggle off → no request sent", async () => {
  const calls = [];
  const fetchImpl = async (...a) => { calls.push(a); return new Response(null, { status: 204 }); };
  const payload = sanitizeScenario(base());
  assert.equal(await maybeSend({ enabled: true, pref: "dont", payload, fetchImpl }), false);
  assert.equal(await maybeSend({ enabled: true, pref: null, payload, fetchImpl }), false); // not yet chosen next to the notice
  assert.equal(await maybeSend({ enabled: false, pref: "share", payload, fetchImpl }), false); // collection off
  assert.equal(calls.length, 0);
  assert.equal(await maybeSend({ enabled: true, pref: "share", payload, fetchImpl }), true);
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, "/api/scenarios");
  assert.equal(init.credentials, "omit");
  assert.equal(init.referrerPolicy, "no-referrer");
});
