import "server-only";

// Development cost for a scattered-site project: the same pro forma as the parcel page, run once per
// lot for the homes placed on it (rental and for-sale tenure, both from one read), then summed. Ranges come from the pro forma's own
// low / likely / high (assumptions.proFormaRanges). The funding gap is computed from these on the client.

import { assumptions, score, type ParcelFacts } from "@easescore/engine";
import { parcelFactsChecked, quickfitInput } from "@/lib/data";
import { primeRate, tapFeesPerHome } from "@/lib/proforma";
import { loadPane } from "@/lib/pane";
import { Timing } from "@/lib/timing";
import { lotMills, mortgageRate } from "./data";
import type { LotCost, ProjectCost } from "./types";

// Homes per lot → building types to try, in order.
const TRY: Record<number, score.StrategyId[]> = {
  1: ["new_sf"],
  2: ["duplex", "three_four_unit", "townhouse_row"],
  3: ["three_four_unit", "townhouse_row"],
  4: ["three_four_unit", "townhouse_row"],
};

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/**
 * The parcel page's own pane (the stored row when there is one, otherwise computed live with the same
 * loader), so the seat and the parcel page read one set of facts, site-fit layouts and best option.
 * Null on any failure (the standard program below is used instead, labeled).
 */
async function parcelPane(parid: string, asOf: string) {
  try {
    const r = await Promise.race([
      loadPane(parid, asOf, quickfitInput(parid), new Timing("nonprofit/project", parid)),
      new Promise<null>((res) => setTimeout(() => res(null), 20_000)),
    ]);
    return r && r.ok ? r.payload : null;
  } catch {
    return null;
  }
}

/** Target finished size per home by bedrooms (sq ft). Assumption, edit me (logged in DECISIONS). */
const TARGET_SF = [550, 700, 950, 1200, 1450];

type Rng = { low: number; likely: number; high: number };
const add = (a: Rng | null, b: Rng | null): Rng | null => (a && b ? { low: a.low + b.low, likely: a.likely + b.likely, high: a.high + b.high } : null);
/** Hard cost inside the total (the budget's hard lines, low / likely / high), for the Nonprofit seat's GC fee. */
function hardOf(pf: assumptions.ProFormaResult): Rng | null {
  const ids = new Set(pf.budget.filter((b) => b.group === "hard").map((b) => b.id));
  const ls = pf.ranges.lines.filter((l) => ids.has(l.id));
  if (!ls.length || ls.some((l) => !l.range)) return null;
  return ls.reduce<Rng>((t, l) => ({ low: t.low + l.range!.low, likely: t.likely + l.range!.likely, high: t.high + l.range!.high }), { low: 0, likely: 0, high: 0 });
}

/** Mine subsidence applies (same test as the pro forma's site adders). */
function mineOf(f: Record<string, unknown>): boolean {
  const m = f.mines as { in_city_undermined?: boolean | null; in_mined_out?: boolean | null; msi_risk?: string | null } | null | undefined;
  const ov = (f.overlays as { layer: string; share: number }[] | null | undefined) ?? [];
  return m?.in_city_undermined === true || ov.some((x) => x.layer === "undermined_pgh" && x.share > 0) || m?.in_mined_out === true || m?.msi_risk === "confirmed";
}

/** The same plan priced for sale: cost only (the sale price comes from HUD limits in this seat). */
function saleCost(plan: () => assumptions.DevelopmentPlan): LotCost["sale"] {
  try {
    const pf = assumptions.evaluateDevelopment(plan());
    const r = pf.ranges;
    return r.tdc ? { tdc: r.tdc, land: r.land.range, hard: hardOf(pf) } : null;
  } catch {
    return null;
  }
}

async function lotCost(parid: string, units: number, bedrooms: number, asOf: string): Promise<LotCost> {
  const base: LotCost = { parid, address: null, units, strategy: null, strategyLabel: null, needsRelief: false, finishedSf: null, sizeBasis: null, tier: null, tdc: null, land: null, landSource: null, headline: null, sale: null, mine: false, notes: [], source: "error", bestLabel: null, byRightUnits: null, lotSqft: null };
  // The same pane as the parcel page. When it cannot be read or computed, the standard program below (labeled).
  // One retry: a live pane can fail while the database is busy (the parcel page retries the same way on reload).
  const row = (await parcelPane(parid, asOf)) ?? (await parcelPane(parid, asOf));
  if (!row || !Object.keys(row.score?.schemes ?? {}).length) return standardProgram(base, parid, units, bedrooms);
  const loaded = { ok: true as const, payload: row, source: "row" as const };
  const P = loaded.payload;
  const f = P.facts as ParcelFacts & Record<string, unknown>;
  const res = P.score;
  if (!res) return { ...base, source: loaded.source, notes: ["The lot could not be scored, so it cannot be priced."] };
  const fitOf = (s: score.StrategyResult) => (s.factors.find((x) => x.id === "F1")?.inputs as { fitStatus?: string | null } | undefined)?.fitStatus ?? null;
  const bestRes = res.strategies.find((x) => x.strategy === res.best) ?? null;
  const byRightUnits = res.strategies.filter((x) => x.applicable && (fitOf(x) === "by_right" || fitOf(x) === "contextual")).reduce<number | null>((m, x) => Math.max(m ?? 0, x.units ?? 0), null);
  const lotSqft = (f as { lot_area_sqft_gis?: number | null }).lot_area_sqft_gis ?? (f.assessment as { lot_area_sqft?: number | null } | undefined)?.lot_area_sqft ?? null;
  Object.assign(base, { bestLabel: bestRes?.strategyLabel ?? null, byRightUnits, lotSqft: lotSqft != null ? Math.round(lotSqft) : null });
  const tries = TRY[units] ?? TRY[2]!;
  const cands = res.strategies.filter((s) => s.applicable && tries.includes(s.strategy) && res.schemes?.[s.strategy]);
  // Prefer a type that fits this many homes by right; otherwise the first that fits with relief.
  const easy = (s: score.StrategyResult) => fitOf(s) === "by_right" || fitOf(s) === "contextual";
  const byRight = cands.find((s) => (s.units ?? 0) >= units && easy(s));
  const pick = byRight ?? cands.find((s) => (s.units ?? 0) >= units) ?? cands[0] ?? null;
  if (!pick) return { ...base, source: loaded.source, notes: [`No ${units}-home building type fits this lot in the site-fit check.`] };
  const beds = Math.max(1, bedrooms);
  const existing = { livingAreaSqft: (f.assessment as { living_area_sqft?: number | null } | undefined)?.living_area_sqft ?? null, use: (f.assessment as { use?: string | null } | undefined)?.use ?? null };
  const build = (overrides: assumptions.CostOverrides) => assumptions.buildDevelopmentInputs({
    strategy: pick.strategy, facts: f as assumptions.ProFormaFacts, scheme: res.schemes?.[pick.strategy] ?? null,
    selected: score.selectScheme({
      strategy: pick.strategy, scheme: res.schemes?.[pick.strategy] ?? null, result: pick, existing,
      overrides: { units, bedrooms: overrides.bedrooms, storiesAboveGarage: overrides.storiesAboveGarage },
    }),
    comps: P.sfComps, newComps: P.newComps[pick.strategy] ?? null, rents: P.rent as assumptions.RentCompsLike | null,
    primeRate: P.prime?.rate ?? null, primeRateDate: P.prime?.date ?? null,
    permitMonths: pick.predictedMonthsToPermit?.months ?? null, tapFeesPerUnit: P.tapFees, overrides,
  });
  try {
    // Size each home for its bedrooms (TARGET_SF), not the largest building the lot allows: as many floors
    // over the site-fit footprint as it takes to reach about the target.
    let plan = build({ tenure: "rent", units, bedrooms: beds });
    const fp = plan.program?.footprintPerUnitSf ?? null;
    let floors: number | undefined;
    if (fp && fp > 0) {
      const target = TARGET_SF[Math.min(beds, 4)]!;
      floors = Math.min(3, Math.max(1, Math.ceil(target / (fp * 0.85) - 0.25)));
      plan = build({ tenure: "rent", units, bedrooms: beds, storiesAboveGarage: floors });
    }
    const pf = assumptions.evaluateDevelopment(plan);
    const r = pf.ranges;
    return {
      ...base, source: loaded.source, strategy: pick.strategy, strategyLabel: pick.strategyLabel,
      sale: saleCost(() => build({ tenure: "sale", units, bedrooms: beds, storiesAboveGarage: floors })), mine: mineOf(f),
      needsRelief: !easy(pick) || (pick.units ?? 0) < units,
      finishedSf: plan.finishedSf, sizeBasis: plan.sizeBasis, tier: plan.tier.label,
      tdc: r.tdc, hard: hardOf(pf), land: r.land.range, landSource: r.land.source?.label ?? null, headline: r.headline,
      notes: [
        ...(bestRes && bestRes.strategy !== pick.strategy ? [`The parcel page's best option for this lot is ${bestRes.strategyLabel.toLowerCase()}; this project places ${units} home${units === 1 ? "" : "s"} on it as a ${pick.strategyLabel.toLowerCase()}${easy(pick) ? ", which the site-fit check allows by right" : ", which needs zoning relief"}.`] : []),
        ...(plan.exclusions.length ? [`Not included yet: ${plan.exclusions.map((e) => e.label.toLowerCase()).join("; ")}.`] : []),
        // Rents come from HUD limits in this seat, so the market-rent gap does not apply.
        ...plan.missing.filter((m) => !/^No rent/i.test(m)),
      ],
    };
  } catch {
    return { ...base, source: loaded.source, strategy: pick.strategy, strategyLabel: pick.strategyLabel, notes: ["The pro forma could not be computed for this lot."] };
  }
}

const lotMemo = new Map<string, { at: number; v: Promise<LotCost> }>();
function lotCostCached(parid: string, units: number, bedrooms: number, asOf: string): Promise<LotCost> {
  const k = `${parid}|${units}|${bedrooms}|${asOf}`;
  const hit = lotMemo.get(k);
  if (hit && Date.now() - hit.at < 600_000) return hit.v;
  const v = lotCost(parid, units, bedrooms, asOf);
  lotMemo.set(k, { at: Date.now(), v });
  // Keep only results priced on the parcel page's pane; a fallback (busy database) is retried next time.
  v.then((x) => { if (x.source !== "row") lotMemo.delete(k); }, () => lotMemo.delete(k));
  if (lotMemo.size > 500) lotMemo.delete(lotMemo.keys().next().value!);
  return v;
}

/**
 * Fallback when the full parcel pane cannot be computed (a busy database): the same pro forma on the
 * lot's facts (slope, undermining, flood, land value) with a standard program of `units` homes at the
 * target size, instead of the site-fit layout. Labeled in the notes.
 */
async function standardProgram(base0: LotCost, parid: string, units: number, bedrooms: number): Promise<LotCost> {
  let base = base0;
  let fr = await parcelFactsChecked(parid);
  if (!fr.facts) fr = await parcelFactsChecked(parid);
  if (!fr.facts) return { ...base, notes: ["The parcel data could not be read right now (database busy). Try again in a moment."] };
  const f = fr.facts as ParcelFacts & Record<string, unknown>;
  const gis = (f as { lot_area_sqft_gis?: number | null }).lot_area_sqft_gis ?? (f.assessment as { lot_area_sqft?: number | null } | undefined)?.lot_area_sqft ?? null;
  base = { ...base, lotSqft: gis != null ? Math.round(gis) : null };
  const beds = Math.max(1, bedrooms);
  const per = TARGET_SF[Math.min(beds, 4)]!;
  const strategy: score.StrategyId = units === 1 ? "new_sf" : units === 2 ? "duplex" : "three_four_unit";
  const isPgh = (f.assessment as { is_pittsburgh?: boolean } | undefined)?.is_pittsburgh === true;
  try {
    const [prime, tap] = await Promise.all([primeRate(), tapFeesPerHome(isPgh)]);
    const mk = (tenure: "rent" | "sale") => assumptions.buildDevelopmentInputs({
      strategy, facts: f as assumptions.ProFormaFacts,
      scheme: { units, netFloorAreaSf: per * units, grossFloorAreaSf: Math.round((per * units) / 0.85), stories: 2, typologyLabel: `${units} homes, standard program` },
      comps: null, rents: null, primeRate: prime?.rate ?? null, primeRateDate: prime?.date ?? null, tapFeesPerUnit: tap,
      overrides: { tenure },
    });
    const plan = mk("rent");
    const pf = assumptions.evaluateDevelopment(plan);
    const r = pf.ranges;
    return {
      ...base, source: "facts", sale: saleCost(() => mk("sale")), mine: mineOf(f), strategy, strategyLabel: STRATEGY_LABEL[strategy] ?? null, finishedSf: plan.finishedSf, sizeBasis: plan.sizeBasis, tier: plan.tier.label,
      tdc: r.tdc, hard: hardOf(pf), land: r.land.range, landSource: r.land.source?.label ?? null, headline: r.headline,
      notes: [`Sized as a standard ${units}-home program of about ${per.toLocaleString("en-US")} sq ft per home (this lot's site-fit layout is not precomputed yet).`],
    };
  } catch {
    return { ...base, notes: ["The pro forma could not be computed for this lot."] };
  }
}

const STRATEGY_LABEL: Partial<Record<score.StrategyId, string>> = { new_sf: "Single-family home", duplex: "Duplex", three_four_unit: "3-4 unit building" };

type LotInfo = { parid: string; address: string | null; owner_class: string | null; municipality: string | null; qct: boolean; dda: boolean };

/** Address, owner class, municipality and the tract's QCT / DDA flags for the chosen lots (small indexed reads). */
const infoMemo = new Map<string, { at: number; v: Promise<Map<string, LotInfo>> }>();
function lotInfo(lots: string[]): Promise<Map<string, LotInfo>> {
  const k = lots.join(",");
  const hit = infoMemo.get(k);
  if (hit && Date.now() - hit.at < 600_000) return hit.v;
  const v = lotInfoRead(lots);
  infoMemo.set(k, { at: Date.now(), v });
  v.then((m) => { if (m.size < lots.length) infoMemo.delete(k); }, () => infoMemo.delete(k));
  if (infoMemo.size > 200) infoMemo.delete(infoMemo.keys().next().value!);
  return v;
}

async function lotInfoRead(lots: string[]): Promise<Map<string, LotInfo>> {
  const get = async <T,>(q: string): Promise<T[]> => {
    try {
      const r = await fetch(`${URL}/rest/v1/${q}`, { headers: { apikey: KEY }, cache: "no-store", signal: AbortSignal.timeout(5000) });
      return r.ok ? ((await r.json()) as T[]) : [];
    } catch {
      return [];
    }
  };
  const ids = lots.join(",");
  const [rows, tracts] = await Promise.all([
    get<{ parid: string; address: string | null; owner_class: string | null; municipality: string | null }>(`parcel_scores?select=parid,address,owner_class,municipality&parid=in.(${ids})`),
    get<{ parid: string; geoid: string }>(`parcel_tract?select=parid,geoid&parid=in.(${ids})`),
  ]);
  const geoids = [...new Set(tracts.map((t) => t.geoid))];
  const des = geoids.length ? await get<{ geoid: string; qct: boolean; dda: boolean }>(`tract_designations?select=geoid,qct,dda&geoid=in.(${geoids.join(",")})`) : [];
  const tractOf = new Map(tracts.map((t) => [t.parid.trim(), t.geoid]));
  const desOf = new Map(des.map((d) => [d.geoid, d]));
  return new Map(rows.map((r) => {
    const d = desOf.get(tractOf.get(r.parid.trim()) ?? "");
    return [r.parid.trim(), { ...r, parid: r.parid.trim(), qct: !!d?.qct, dda: !!d?.dda }];
  }));
}

/** Cost of `perLot` homes on each lot, summed; plus the project context the eligibility rules read. */
export async function projectCost(lots: string[], perLot: number, bedrooms: number): Promise<ProjectCost> {
  const asOf = new Date().toISOString().slice(0, 10);
  const [costs, mills, info, rate] = await Promise.all([
    Promise.all(lots.map((p) => lotCostCached(p, perLot, bedrooms, asOf))),
    lotMills(lots),
    lotInfo(lots),
    mortgageRate(),
  ]);
  for (const c of costs) c.address = info.get(c.parid)?.address ?? null;
  const known = lots.map((p) => info.get(p)).filter(Boolean);
  const allKnown = known.length === lots.length;
  const inCity = allKnown && known.every((s) => (s!.municipality ?? "").toUpperCase() === "PITTSBURGH");
  const tdc = costs.reduce<Rng | null>((t, c, i) => (i === 0 ? c.tdc : add(t, c.tdc)), null);
  const land = costs.reduce<Rng | null>((t, c, i) => (i === 0 ? c.land : add(t, c.land)), null);
  const sTdc = costs.reduce<Rng | null>((t, c, i) => (i === 0 ? c.sale?.tdc ?? null : add(t, c.sale?.tdc ?? null)), null);
  const sLand = costs.reduce<Rng | null>((t, c, i) => (i === 0 ? c.sale?.land ?? null : add(t, c.sale?.land ?? null)), null);
  const hard = costs.reduce<Rng | null>((t, c, i) => (i === 0 ? c.hard ?? null : add(t, c.hard ?? null)), null);
  const sHard = costs.reduce<Rng | null>((t, c, i) => (i === 0 ? c.sale?.hard ?? null : add(t, c.sale?.hard ?? null)), null);
  return {
    lots: costs,
    tdc: costs.every((c) => c.tdc) ? tdc : null,
    land: costs.every((c) => c.land) ? land : null,
    hard,
    sale: costs.every((c) => c.sale?.tdc) ? { tdc: sTdc, land: costs.every((c) => c.sale?.land) ? sLand : null, hard: sHard } : null,
    mortgage: rate,
    context: {
      qct: known.some((s) => s!.qct), dda: known.some((s) => s!.dda),
      allPublicLand: allKnown && known.every((s) => s!.owner_class === "public"),
      inCity, lots: lots.length,
      millsTotal: mills ? mills.total : null,
      millsSource: mills ? mills.text : null,
      mineSubsidence: costs.some((c) => c.mine),
    },
    asOf,
    costConfig: assumptions.COST_CONFIG.version,
  };
}
