// Nonprofit / CDC seat: shared types and pure helpers (safe for client and server).
// Census numbers here are area context only; nothing in this file feeds a parcel score.

export interface AreaTract {
  geoid: string;
  name: string;
  acs_year: number | null;
  population: number | null;
  median_income: number | null;
  median_rent: number | null;
  rent_burden_30_pct: number | null;
  rent_burden_50_pct: number | null;
  vacancy_rate: number | null;
  qct: boolean;
  dda: boolean;
  opportunity_zone: boolean;
  households?: number | null;
  renter_hh?: number | null;
  rent_burden_universe?: number | null;
  rent_burden_30_n?: number | null;
  rent_burden_50_n?: number | null;
  poverty_pct?: number | string | null;
  poverty_n?: number | null;
  poverty_universe?: number | null;
  /** HUD CHAS counts for the tract (chas_tract), or null when not loaded. */
  chas?: ChasRow | null;
  /** Share of the neighborhood's area in this tract. */
  share_of_hood: number;
  /** Share of this tract's area inside the neighborhood. */
  share_of_tract: number;
}

export interface ChasRow {
  vintage: string | null;
  hh_total: number | null;
  hh_le30: number | null; hh_30_50: number | null; hh_50_80: number | null; hh_80_100: number | null; hh_gt100: number | null;
  cb_le30: number | null; cb_30_50: number | null; cb_50_80: number | null; cb_80_100: number | null;
  rental_units_total: number | null; rental_units_afford_le30: number | null; rental_units_afford_le50: number | null; rental_units_afford_le80: number | null;
}

export interface LihtcNear {
  hud_id: string;
  project: string | null;
  address: string | null;
  n_units: number | null;
  li_units: number | null;
  yr_pis: number | null;
  credit: string | null;
  inside: boolean;
  distance_mi: number | string;
}

export interface Area {
  hood: string;
  lihtc?: LihtcNear[];
  bbox: [number, number, number, number];
  outline: GeoJSON.Geometry;
  tracts: AreaTract[];
}

/** A dataset the data agent is loading; `loaded` false shows a labeled empty state. */
export interface OptionalDataset {
  id: "chas" | "lihtc" | "acs_detail" | "owner_class";
  name: string;
  table: string | null;
  loaded: boolean;
}

export interface IncomeLimitsRowLite {
  year: number;
  area_code: string;
  county_name: string | null;
  median_income: string | number;
  [k: string]: unknown;
}

export interface NeedData {
  area: Area | null;
  il: IncomeLimitsRowLite | null;
  datasets: OptionalDataset[];
}

export interface Site {
  parid: string;
  address: string | null;
  score: number | null;
  band: string | null;
  best_strategy: string | null;
  by_right_units: number | null;
  units_with_relief: number | null;
  months_to_permit: number | null;
  red_flag_count: number;
  red_flags: { id: string; title: string }[] | null;
  top_blocker: string | null;
  zoning: string | null;
  lot_sqft: number | null;
  vacant: boolean | null;
  owner_class: string | null;
  tax_delinquent: boolean | null;
  municipality: string | null;
  lon: number | null;
  lat: number | null;
  preliminary: boolean | null;
  agency: string | null;
  agency_status: string | null;
  /** parcel_owner_class class (city, ura, land_bank, hacp, county, other_public) when loaded. */
  agency_class?: string | null;
  city_program?: string | null;
  geoid: string | null;
  qct: boolean;
  dda: boolean;
}

export interface SitesResult {
  total: number;
  rows: Site[];
}

export interface SiteFilters {
  public: boolean;
  vacant: boolean;
  clean: boolean;
  /** Only lots that allow at least this many homes by right. */
  minUnits: number;
}

export const DEFAULT_HOOD = "Larimer";
export const DEFAULT_FILTERS: SiteFilters = { public: true, vacant: true, clean: true, minUnits: 2 };
export const MAX_LOTS = 6;

export interface LotCost {
  parid: string;
  address: string | null;
  units: number;
  strategy: string | null;
  strategyLabel: string | null;
  /** True when this many homes needs zoning relief on this lot. */
  needsRelief: boolean;
  /** Finished floor area, all homes on the lot. */
  finishedSf: number | null;
  sizeBasis: string | null;
  /** Construction quality tier used for the cost per sq ft. */
  tier: string | null;
  tdc: { low: number; likely: number; high: number } | null;
  land: { low: number; likely: number; high: number } | null;
  landSource: string | null;
  headline: string | null;
  /** The same plan priced with for-sale tenure (cost only), or null when it could not be priced. */
  sale: { tdc: { low: number; likely: number; high: number }; land: { low: number; likely: number; high: number } | null } | null;
  /** The lot is over undermined ground (mine subsidence insurance applies to a homeowner). */
  mine: boolean;
  notes: string[];
  /** row = precomputed parcel pane (site-fit layout); facts = standard program on the lot's facts. */
  source: "row" | "facts" | "error";
}

export interface ProjectCost {
  lots: LotCost[];
  tdc: { low: number; likely: number; high: number } | null;
  land: { low: number; likely: number; high: number } | null;
  /** The same lots priced with for-sale tenure. */
  sale: { tdc: { low: number; likely: number; high: number } | null; land: { low: number; likely: number; high: number } | null } | null;
  /** Latest FRED 30-year mortgage rate (decimal), or null when not loaded. */
  mortgage: { rate: number; date: string; source: string } | null;
  context: { qct: boolean; dda: boolean; allPublicLand: boolean; inCity: boolean; lots: number; millsTotal: number | null; millsSource: string | null; mineSubsidence: boolean };
  asOf: string;
  costConfig: string;
}

// ------------------------------------------------------------------------------ need (pure)

const has = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const num = (x: unknown): number | null => (x == null ? null : Number.isFinite(Number(x)) ? Number(x) : null);

export interface ChasSummary {
  vintage: string | null;
  /** Households by income band (HAMFI), area-weighted. */
  bands: Record<"le30" | "30_50" | "50_80" | "80_100" | "gt100", number>;
  burdened: Record<"le30" | "30_50" | "50_80" | "80_100", number>;
  under50: number;
  /** Rental homes priced for households at or below 50% HAMFI. */
  afford50: number;
  gap: number;
}

export interface NeedSummary {
  tracts: number;
  acsYear: number | null;
  rb30: number | null;
  rb50: number | null;
  poverty: number | null;
  income: number | null;
  rent: number | null;
  population: number;
  renters: number | null;
  qct: boolean;
  dda: boolean;
  method: string;
  chas: ChasSummary | null;
}

/** Area figures from its tracts: counts summed × the share of each tract inside the area; medians weighted by population × share. */
export function needSummary(area: Area | null): NeedSummary | null {
  if (!area || !area.tracts.length) return null;
  const ts = area.tracts.map((t) => {
    const share = Math.min(1, num(t.share_of_tract) ?? 0);
    return { ...t, share, w: (num(t.population) ?? 0) * share };
  });
  const avg = (k: keyof AreaTract) => {
    const xs = ts.filter((t) => has(num(t[k])) && t.w > 0);
    const W = xs.reduce((s, t) => s + t.w, 0);
    return W > 0 ? xs.reduce((s, t) => s + num(t[k])! * t.w, 0) / W : null;
  };
  // Share from counts when the ACS detail table is loaded (exact for one tract, area-weighted for several).
  const ratio = (nk: keyof AreaTract, dk: keyof AreaTract, fallback: keyof AreaTract) => {
    const xs = ts.filter((t) => has(num(t[nk])) && has(num(t[dk])) && t.share > 0);
    const d = xs.reduce((s, t) => s + num(t[dk])! * t.share, 0);
    return d > 0 ? (100 * xs.reduce((s, t) => s + num(t[nk])! * t.share, 0)) / d : avg(fallback);
  };
  const withChas = ts.filter((t) => t.chas && t.share > 0);
  const sumC = (k: keyof ChasRow) => Math.round(withChas.reduce((s, t) => s + (num(t.chas![k]) ?? 0) * t.share, 0));
  const chas: ChasSummary | null = withChas.length
    ? (() => {
        const bands = { le30: sumC("hh_le30"), "30_50": sumC("hh_30_50"), "50_80": sumC("hh_50_80"), "80_100": sumC("hh_80_100"), gt100: sumC("hh_gt100") };
        const under50 = bands.le30 + bands["30_50"];
        const afford50 = sumC("rental_units_afford_le50");
        return {
          vintage: withChas[0]!.chas!.vintage, bands,
          burdened: { le30: sumC("cb_le30"), "30_50": sumC("cb_30_50"), "50_80": sumC("cb_50_80"), "80_100": sumC("cb_80_100") },
          under50, afford50, gap: Math.max(0, under50 - afford50),
        };
      })()
    : null;
  const renters = ts.some((t) => has(num(t.renter_hh))) ? Math.round(ts.reduce((s, t) => s + (num(t.renter_hh) ?? 0) * t.share, 0)) : null;
  const one = ts.length === 1;
  return {
    tracts: ts.length,
    acsYear: ts.find((t) => t.acs_year)?.acs_year ?? null,
    rb30: ratio("rent_burden_30_n", "rent_burden_universe", "rent_burden_30_pct"),
    rb50: ratio("rent_burden_50_n", "rent_burden_universe", "rent_burden_50_pct"),
    poverty: ratio("poverty_n", "poverty_universe", "poverty_pct"),
    income: avg("median_income"),
    rent: avg("median_rent"),
    population: Math.round(ts.reduce((s, t) => s + t.w, 0)),
    renters,
    qct: ts.some((t) => t.qct && t.share_of_hood >= 0.1),
    dda: ts.some((t) => t.dda && t.share_of_hood >= 0.1),
    method: one
      ? `Census tract ${ts[0]!.name} covers ${Math.round(ts[0]!.share_of_hood * 100)}% of ${area.hood}; its figures are used as they are.`
      : `${ts.length} census tracts overlap ${area.hood}. Counts are summed after multiplying each tract by the share of its area inside the neighborhood; medians are averaged, weighted by population × that share.`,
    chas,
  };
}

/** "About 6 in 10" from a percent. */
export function inTen(pct: number): string {
  const n = Math.round(pct / 10);
  if (n <= 0) return "Fewer than 1 in 10";
  if (n >= 10) return "Nearly all";
  return `About ${n} in 10`;
}

export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const usdK = (n: number) => (Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : Math.round(n / 1000) === 0 ? "$0" : `$${Math.round(n / 1000)}K`);

export const STRATEGY_TEXT: Record<string, string> = {
  new_sf: "New single-family",
  duplex: "Duplex",
  three_four_unit: "3–4 units",
  townhouse_row: "Townhouse row",
  adu: "Backyard unit",
  rehab_existing: "Rehab",
};

/** "0124N00167000002" → "0124-N-00167-0000-02" style short id for display. */
export function shortParid(p: string): string {
  const s = p.trim();
  return /^\d{4}[A-Z]\d{5}\d{6}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 5)}-${s.slice(5, 10)}` : s;
}

// ------------------------------------------------------------------------------ project state (URL)

export type Tenure = "rent" | "sale";
export type GeoLevel = "tract" | "bg";

export interface ProjectState {
  hood: string;
  step: "need" | "sites" | "project";
  tenure: Tenure;
  /** Need map level: census tracts or block groups. */
  geo: GeoLevel;
  /** For-sale assumptions you changed (null = the labeled default): down payment share, insurance $/yr, PMI share of loan/yr. */
  own: { down: number | null; ins: number | null; pmi: number | null };
  lots: string[];
  /** Homes per lot. */
  perLot: number;
  bedrooms: number;
  /** Homes at each AMI level, e.g. {50: 3, 60: 3}. */
  mix: Record<number, number>;
  sources: string[];
  household: number;
  layer: "rb30" | "rb50" | "income" | "poverty";
  filters: SiteFilters;
}

export const DEFAULT_SOURCES = ["lihtc4", "home", "land"];
export const DEFAULT_SALE_SOURCES = ["hba", "land"];
export const AMI_BY_TENURE: Record<Tenure, number[]> = { rent: [30, 50, 60, 80], sale: [80, 100, 120] };
export const DEFAULT_MIX: Record<Tenure, Record<number, number>> = { rent: { 50: 3, 60: 3 }, sale: { 80: 6 } };
const mixText = (m: Record<number, number>) => Object.entries(m).filter(([, n]) => n > 0).map(([a, n]) => `${a}:${n}`).join(",");
export const defaultSources = (t: Tenure) => (t === "sale" ? DEFAULT_SALE_SOURCES : DEFAULT_SOURCES);

const PARID = /^[0-9A-Z]{16}$/;

/** A number from the URL inside [lo, hi], else null (use the default). */
const numIn = (v: string | null, lo: number, hi: number): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) && x >= lo && x <= hi ? x : null;
};

export function parseState(q: URLSearchParams): ProjectState {
  const step = q.get("step");
  const tenure: Tenure = q.get("ten") === "sale" ? "sale" : "rent";
  const mix: Record<number, number> = {};
  for (const part of (q.get("mix") ?? mixText(DEFAULT_MIX[tenure])).split(",")) {
    const [a, n] = part.split(":").map(Number);
    if (AMI_BY_TENURE[tenure].includes(a!) && Number.isInteger(n) && n! >= 0 && n! <= 60) mix[a!] = n!;
  }
  const clampInt = (v: string | null, lo: number, hi: number, d: number) => {
    const x = Number(v);
    return v != null && Number.isInteger(x) && x >= lo && x <= hi ? x : d;
  };
  const layer = q.get("layer");
  return {
    hood: (q.get("hood") ?? DEFAULT_HOOD).slice(0, 60),
    step: step === "sites" || step === "project" ? step : "need",
    tenure,
    geo: q.get("geo") === "bg" ? "bg" : "tract",
    own: { down: numIn(q.get("dp"), 0, 0.5), ins: numIn(q.get("hi"), 0, 10000), pmi: numIn(q.get("pmi"), 0, 0.02) },
    lots: (q.get("lots") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => PARID.test(s)).slice(0, MAX_LOTS),
    perLot: clampInt(q.get("per"), 1, 4, 2),
    bedrooms: clampInt(q.get("br"), 0, 4, 2),
    mix: Object.keys(mix).length ? mix : { ...DEFAULT_MIX[tenure] },
    sources: q.has("src") ? (q.get("src") ?? "").split(",").filter((s) => /^[a-z0-9]{2,14}$/.test(s)) : defaultSources(tenure),
    household: clampInt(q.get("hh"), 1, 6, 3),
    layer: layer === "rb50" || layer === "income" || layer === "poverty" ? layer : "rb30",
    filters: {
      public: q.get("pub") !== "0",
      vacant: q.get("vac") !== "0",
      clean: q.get("clean") !== "0",
      minUnits: clampInt(q.get("min"), 0, 4, 2),
    },
  };
}

export function stateToQuery(s: ProjectState): URLSearchParams {
  const q = new URLSearchParams();
  if (s.hood !== DEFAULT_HOOD) q.set("hood", s.hood);
  if (s.step !== "need") q.set("step", s.step);
  if (s.tenure !== "rent") q.set("ten", s.tenure);
  if (s.geo !== "tract") q.set("geo", s.geo);
  if (s.own.down != null) q.set("dp", String(s.own.down));
  if (s.own.ins != null) q.set("hi", String(s.own.ins));
  if (s.own.pmi != null) q.set("pmi", String(s.own.pmi));
  if (s.lots.length) q.set("lots", s.lots.join(","));
  if (s.perLot !== 2) q.set("per", String(s.perLot));
  if (s.bedrooms !== 2) q.set("br", String(s.bedrooms));
  const mix = mixText(s.mix);
  if (mix && mix !== mixText(DEFAULT_MIX[s.tenure])) q.set("mix", mix);
  if (s.sources.join(",") !== defaultSources(s.tenure).join(",")) q.set("src", s.sources.join(","));
  if (s.household !== 3) q.set("hh", String(s.household));
  if (s.layer !== "rb30") q.set("layer", s.layer);
  if (!s.filters.public) q.set("pub", "0");
  if (!s.filters.vacant) q.set("vac", "0");
  if (!s.filters.clean) q.set("clean", "0");
  if (s.filters.minUnits !== 2) q.set("min", String(s.filters.minUnits));
  return q;
}

/** Unit groups for the engine from the mix, scaled to the homes the lots hold. */
export function unitGroups(mix: Record<number, number>, totalUnits: number, bedrooms: number): { count: number; bedrooms: number; amiPct: number }[] {
  const entries = Object.entries(mix).map(([a, n]) => [Number(a), n] as const).filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]);
  const sum = entries.reduce((t, [, n]) => t + n, 0);
  if (!sum || !totalUnits) return [];
  if (sum === totalUnits) return entries.map(([a, n]) => ({ count: n, bedrooms, amiPct: a }));
  // Scale to the total, largest remainders first, so the counts add up.
  const raw = entries.map(([a, n]) => ({ a, x: (n * totalUnits) / sum }));
  const out = raw.map((r) => ({ a: r.a, n: Math.floor(r.x), rem: r.x - Math.floor(r.x) }));
  let left = totalUnits - out.reduce((t, r) => t + r.n, 0);
  for (const r of [...out].sort((p, q) => q.rem - p.rem)) { if (left <= 0) break; r.n++; left--; }
  return out.filter((r) => r.n > 0).map((r) => ({ count: r.n, bedrooms, amiPct: r.a }));
}

/** Suggested scattered-site set: up to 3 lots with no red flags that fit `perLot` homes by right; lots the City lists as available first, each group in score order. */
export function suggestLots(rows: Site[], perLot: number): string[] {
  const ok = rows.filter((r) => (r.by_right_units ?? 0) >= perLot && (r.red_flag_count ?? 0) === 0);
  const avail = (r: Site) => (/available/i.test(r.agency_status ?? "") ? 0 : 1);
  return [...ok].sort((a, b) => avail(a) - avail(b)).slice(0, 3).map((r) => r.parid.trim());
}

/**
 * The engine input for the chosen tenure: rental uses the rental pro forma; for-sale uses the same lots
 * priced for sale, plus the homebuyer's mortgage rate (FRED), the lots' millage and mine subsidence.
 * Shared by the page and the advocacy brief so both compute the same numbers.
 */
export function projectInput(cost: ProjectCost, tenure: Tenure, units: { count: number; bedrooms: number; amiPct: number }[], own?: ProjectState["own"]) {
  const tdc = tenure === "sale" ? cost.sale?.tdc ?? null : cost.tdc;
  if (!tdc || !units.length) return null;
  return {
    units, tdc,
    land: tenure === "sale" ? cost.sale?.land ?? null : cost.land,
    context: { ...cost.context, tenure },
    sale: tenure === "sale"
      ? { rate: cost.mortgage?.rate ?? null, rateSource: cost.mortgage?.source ?? null, mills: cost.context.millsTotal, millsSource: cost.context.millsSource, mineSubsidence: !!cost.context.mineSubsidence, downPaymentShare: own?.down ?? undefined, insurancePerYear: own?.ins ?? undefined, pmiAnnualShare: own?.pmi ?? undefined }
      : undefined,
  };
}
