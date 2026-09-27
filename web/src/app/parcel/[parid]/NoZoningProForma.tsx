// Pro forma where zoning is not loaded (outside the City of Pittsburgh, or no district rules): the same
// pro forma (ProFormaPanel, live) on a building the user chooses — type, homes, sq ft per home — priced by
// lib/parcel-plan.ts userBuildingPlan. The form re-requests the page with ub_* keys, so the Feasibility study
// link and PDF carry the same building. A banner stays pinned over every number: zoning was not checked.

import { assumptions, score } from "@easescore/engine";
import type { UserBuildingPlan } from "@/lib/parcel-plan";
import ProFormaPanel from "./ProFormaPanel";

type SP = Record<string, string | string[] | undefined>;
const K = score.USER_BUILDING_KEYS;

export function ZoningNotCheckedBanner({ municipality, sticky }: { municipality: string | null; sticky?: boolean }) {
  return (
    <p role="note" className={`${sticky ? "sticky top-0 z-10 " : ""}rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-[13px] font-semibold text-amber-950 shadow-sm`}>
      {score.zoningNotCheckedBanner(municipality)}
    </p>
  );
}

export default function NoZoningProForma({ parid, sp, plan, municipality, overrides }: {
  parid: string;
  sp: SP;
  plan: UserBuildingPlan;
  municipality: string | null;
  overrides: Parameters<typeof ProFormaPanel>[0]["overrides"];
}) {
  const b = plan.building;
  const keep = Object.entries(sp).filter(([k, v]) => typeof v === "string" && !Object.values(K).includes(k as never)) as [string, string][];
  const label = score.USER_BUILDING_TYPES.find((t) => t.id === b.type)!.label;
  const nearby = assumptions.nearbyNewHomeSizeText(plan.pf?.plan.valueComps as assumptions.CompSet | null | undefined);
  return (
    <div className="space-y-2">
      <ZoningNotCheckedBanner municipality={municipality} sticky />
      <section aria-labelledby="ub-h" className="rounded-xl border border-slate-200 bg-white/80 p-3">
        <h3 id="ub-h" className="text-sm font-semibold text-slate-900">The building you entered</h3>
        <p className="text-[11px] text-slate-600">
          Zoning rules are not loaded for {score.municipalityName(municipality)}, so EaseScore cannot place a building on this lot. Choose one to price;
          the costs, comps, taxes and transfer tax are the same as everywhere else.
        </p>
        <form method="get" action={`/parcel/${encodeURIComponent(parid)}#drawer=pencils`} className="mt-2 grid grid-cols-3 gap-2">
          {keep.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label className="flex flex-col text-xs text-slate-600">Building type
            <select name={K.type} defaultValue={b.type} className="mt-0.5 min-h-8 rounded border border-slate-300 bg-white px-1.5 py-1 text-sm text-slate-900">
              {score.USER_BUILDING_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-600">Homes
            <input name={K.units} type="number" inputMode="numeric" min={score.USER_BUILDING_LIMITS.units[0]} max={score.USER_BUILDING_LIMITS.units[1]} defaultValue={b.units}
              className="mt-0.5 min-h-8 rounded border border-slate-300 bg-white px-1.5 py-1 text-sm text-slate-900" />
          </label>
          <label className="flex flex-col text-xs text-slate-600">Sq ft per home
            <input name={K.sfPerHome} type="number" inputMode="numeric" min={score.USER_BUILDING_LIMITS.sfPerHome[0]} max={score.USER_BUILDING_LIMITS.sfPerHome[1]} step={50} defaultValue={b.sfPerHome}
              className="mt-0.5 min-h-8 rounded border border-slate-300 bg-white px-1.5 py-1 text-sm text-slate-900" />
          </label>
          <div className="col-span-3 flex flex-wrap items-center gap-2">
            <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800">Price this building</button>
            <p className="text-[11px] text-slate-600">Pricing: {score.userBuildingText(b)} ({label.toLowerCase()}). Finished sq ft; a duplex is 2 homes.{nearby ? ` ${nearby}.` : ""}</p>
          </div>
        </form>
      </section>
      {plan.pf && plan.selected ? (
        <ProFormaPanel parid={parid} result={plan.pf} strategyLabel={`The building you entered (${score.userBuildingText(b)})`} sp={sp} overrides={overrides}
          live={{ fin: plan.fin, strategy: plan.strategy, scheme: plan.scheme, stepping: null }} />
      ) : (
        <p className="text-sm text-slate-600">No cost and value estimate for this building yet.</p>
      )}
    </div>
  );
}
