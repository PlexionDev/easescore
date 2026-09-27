// Report cache helpers. Run: node --test web/src/lib/report/cache-core.test.mjs
// (Node 22.6+ strips the TypeScript types in cache-core.ts; it has no imports on purpose.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { memo, pdfKeyMaterial, reportQueryKey, samePageMap } from "./cache-core.ts";

const PARID = "0011A00151000000"; // public demo parcel

test("memo: one computation per key while fresh; recomputed after the TTL", async () => {
  const m = new Map();
  let calls = 0;
  const make = () => Promise.resolve(++calls);
  assert.equal(await memo(m, "a", make, () => true, 1000, 10, 0), 1);
  assert.equal(await memo(m, "a", make, () => true, 1000, 10, 500), 1);
  assert.equal(await memo(m, "a", make, () => true, 1000, 10, 1500), 2);
});

test("memo: failures and unwanted results are not kept", async () => {
  const m = new Map();
  await assert.rejects(memo(m, "x", () => Promise.reject(new Error("db timeout")), () => true, 1000, 10, 0));
  await new Promise((r) => setImmediate(r));
  assert.equal(m.has("x"), false);
  await memo(m, "y", () => Promise.resolve(null), (v) => v !== null, 1000, 10, 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(m.has("y"), false);
});

test("memo: oldest key evicted past the cap", async () => {
  const m = new Map();
  for (const k of ["a", "b", "c"]) await memo(m, k, () => Promise.resolve(k), () => true, 1000, 2, 0);
  assert.deepEqual([...m.keys()], ["b", "c"]);
});

test("report query key: order-free; today's date, fresh and download ignored; other dates kept", () => {
  const today = "2026-09-27";
  const a = reportQueryKey({ strategy: "duplex", tenure: "rent" }, today);
  assert.equal(reportQueryKey({ tenure: "rent", strategy: "duplex", date: today, fresh: "1", download: "0" }, today), a);
  assert.notEqual(reportQueryKey({ strategy: "duplex", tenure: "rent", date: "2026-01-02" }, today), a);
  assert.notEqual(reportQueryKey({ strategy: "single_family", tenure: "rent" }, today), a);
});

test("PDF key: changes with the pane/config version, report version, build, query, date and images; not with fresh or order", () => {
  const q = [["date", "2026-09-27"], ["strategy", "duplex"]];
  const k = pdfKeyMaterial(PARID, "pane.10|x", "report v0.1", "abc", q);
  assert.equal(pdfKeyMaterial(PARID, "pane.10|x", "report v0.1", "abc", [["strategy", "duplex"], ["fresh", "1"], ["date", "2026-09-27"]]), k);
  for (const other of [
    pdfKeyMaterial(PARID, "pane.11|x", "report v0.1", "abc", q),
    pdfKeyMaterial(PARID, "pane.10|x", "report v0.2", "abc", q),
    pdfKeyMaterial(PARID, "pane.10|x", "report v0.1", "def", q),
    pdfKeyMaterial(PARID, "pane.10|x", "report v0.1", "abc", [["date", "2026-09-28"], ["strategy", "duplex"]]),
    pdfKeyMaterial(PARID, "pane.10|x", "report v0.1", "abc", q, { context: "data:image/png;base64,AAA" }),
  ]) assert.notEqual(other, k);
});

test("page maps: equal only when every section starts on the same page", () => {
  assert.equal(samePageMap({ s1: 3, s2: 5 }, { s2: 5, s1: 3 }), true);
  assert.equal(samePageMap({ s1: 3, s2: 5 }, { s1: 3, s2: 6 }), false);
  assert.equal(samePageMap({ s1: 3 }, { s1: 3, s2: 5 }), false);
});
