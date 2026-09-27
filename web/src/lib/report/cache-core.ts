// Pure helpers behind the Feasibility Study caches (lib/report/load.ts, pdf.ts, pdf-cache.ts).
// No imports on purpose, so node --test can load this file directly (cache-core.test.mjs).

export type Entry<T> = { at: number; p: Promise<T> };

/**
 * Promise cache: one in-flight or recent promise per key, kept `ttlMs`; the oldest key goes first past
 * `max` entries. A result that fails `keep` (or a rejection) is dropped so the next call tries again.
 */
export function memo<T>(map: Map<string, Entry<T>>, key: string, make: () => Promise<T>, keep: (v: T) => boolean, ttlMs: number, max: number, now = Date.now()): Promise<T> {
  const hit = map.get(key);
  if (hit && now - hit.at < ttlMs) return hit.p;
  const p = make();
  map.delete(key);
  map.set(key, { at: now, p });
  while (map.size > max) map.delete(map.keys().next().value!);
  p.then((v) => { if (!keep(v) && map.get(key)?.p === p) map.delete(key); }, () => { if (map.get(key)?.p === p) map.delete(key); });
  return p;
}

type SP = Record<string, string | string[] | undefined>;

/** Cache key for a report query: key order does not matter; fresh/download and today's date (added by the PDF route) are ignored. */
export function reportQueryKey(sp: SP, today: string): string {
  return Object.keys(sp)
    .filter((k) => !["fresh", "download"].includes(k) && !(k === "date" && sp[k] === today) && sp[k] !== undefined)
    .sort()
    .map((k) => `${k}=${Array.isArray(sp[k]) ? (sp[k] as string[]).join(",") : sp[k]}`)
    .join("&");
}

/** The material hashed into a cached PDF's key (the date stays in: it is printed on every page). */
export function pdfKeyMaterial(parid: string, paneVersion: string, reportVersion: string, build: string, query: [string, string][], images?: Record<string, string>): string {
  const q = query.filter(([k]) => k !== "fresh").sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  const img = images && Object.keys(images).length ? Object.keys(images).sort().map((k) => `${k}:${images[k]}`).join("|") : "";
  return [parid, paneVersion, reportVersion, build, q, img].join("\n");
}

/** True when two TOC page maps (section id → page) are identical. */
export function samePageMap(a: Record<string, number>, b: Record<string, number>): boolean {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);
}
