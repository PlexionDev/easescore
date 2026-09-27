// Hover card facts for a neighboring parcel: address, zoning and owner type only (never an owner's name, and
// never tax status). One small keyed read of parcel_scores per parcel, cached for the page session.

export type Brief = { parid: string; address: string; zoning: string | null; owner: string | null };

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const cache = new Map<string, Promise<Brief>>();

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (x) => x.toUpperCase());
const OWNER: Record<string, string> = { public: "Public owner", private: "Private owner", nonprofit: "Nonprofit owner" };

/** "225 Dinwiddie St"; a lot with no house number reads "No official address · near Reed St". */
export function addressLine(raw: string | null | undefined): string {
  const a = (raw ?? "").trim();
  if (!a) return "No official address";
  const m = /^(\d+[A-Z]?)\s+(.*)$/i.exec(a);
  if (!m || /^0+$/.test(m[1]!)) return `No official address · near ${titleCase(m ? m[2]! : a)}`;
  return titleCase(a);
}

type Row = { parid: string; address: string | null; zoning: string | null; owner_class: string | null };
const toBrief = (parid: string, r: Row | undefined): Brief => ({
  parid, address: addressLine(r?.address), zoning: r?.zoning ?? null, owner: r?.owner_class ? OWNER[r.owner_class] ?? "Owner type not recorded" : null,
});

/** Facts for these parcels (one request for the ones not cached yet). A failed read still gives the parcel ID. */
export function briefs(ids: string[]): Promise<Brief[]> {
  const todo = [...new Set(ids.filter((id) => /^[0-9A-Z]{8,20}$/i.test(id) && !cache.has(id)))];
  if (todo.length) {
    const req = fetch(`${URL}/rest/v1/parcel_scores?select=parid,address,zoning,owner_class,config_version&parid=in.(${todo.join(",")})&order=config_version.desc`,
      { headers: { apikey: KEY }, signal: AbortSignal.timeout(6000) })
      .then((r) => (r.ok ? (r.json() as Promise<Row[]>) : []))
      .catch(() => [] as Row[]);
    for (const id of todo) {
      const p = req.then((rows) => toBrief(id, rows.find((r) => r.parid === id)));
      cache.set(id, p);
      // A network failure is not remembered: the next hover asks again.
      req.then((rows) => { if (!rows.length) cache.delete(id); });
    }
  }
  return Promise.all(ids.map((id) => cache.get(id) ?? Promise.resolve(toBrief(id, undefined))));
}
