// "Street precedent" card on the parcel pane: what the existing buildings on this block face look like
// (measured from county footprints and parcel lines, migration 130), what Pittsburgh's contextual front
// setback (§925.06.B) allows because of them, which options that flips from "needs a variance" to
// "allowed by matching neighbors", and nearby Zoning Board outcomes for whatever still needs approval.
// Server component; the numbers come from engine score.streetPrecedent (tests: engine/test/precedent.test.ts).

import { score } from "@easescore/engine";

const RULE_WORDS: Record<string, string> = {
  front_setback: "front setback",
  side_setback: "side setback",
  lot_area: "lot size",
  lot_area_per_unit: "lot size per unit",
  stories: "height (stories)",
};
const RELIEF_WORDS: Record<string, string> = {
  dimensional_variance: "Variance",
  special_exception: "Special exception",
  use_variance: "Use variance",
};

const ft = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x)} ft`);
const monthYear = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "");
const titleCase = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

type F1 = { fitStatus?: string; contextualBasis?: string; varianceRules?: string[]; permissionCode?: string };
const f1Of = (s: score.StrategyResult) => (s.factors.find((f) => f.id === "F1")?.inputs ?? {}) as F1;

/** Setbacks along the block as a small bar strip: each bar is one lot, the dashed line is the code. */
function Strip({ lots, subject, codeFt }: { lots: score.StreetPrecedent["lots"]; subject: string; codeFt: number | null }) {
  const shown = lots.slice(0, 40);
  const vals = shown.map((l) => (l.building && l.front != null ? l.front : null));
  const max = Math.max(10, codeFt ?? 0, ...vals.map((v) => v ?? 0)) * 1.1;
  const W = 300, H = 56, bw = W / Math.max(shown.length, 1);
  const y = (v: number) => (v / max) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H + 12}`} className="mt-2 h-auto w-full" role="img"
      aria-label={`Front setbacks of ${vals.filter((v) => v != null).length} buildings along the block${codeFt ? `; the code requires ${codeFt} ft` : ""}`}>
      <text x={0} y={8} className="fill-slate-500" fontSize={7}>street</text>
      {shown.map((l, i) => {
        const v = vals[i];
        const me = l.parid === subject;
        const x = i * bw + bw * 0.15, w = bw * 0.7;
        if (v == null) return <rect key={l.parid} x={x} y={10} width={w} height={2} className={me ? "fill-sky-500" : "fill-slate-200"} />;
        return <rect key={l.parid} x={x} y={10} width={w} height={Math.max(1.5, y(v))} rx={1}
          className={me ? "fill-sky-500" : codeFt != null && v < codeFt - score.TOLERANCE_FT ? "fill-amber-400" : "fill-slate-400"} />;
      })}
      {codeFt != null && codeFt > 0 && (
        <>
          <line x1={0} x2={W} y1={10 + y(codeFt)} y2={10 + y(codeFt)} strokeDasharray="3 2" className="stroke-red-500" strokeWidth={1} />
          <text x={W} y={10 + y(codeFt) - 2} textAnchor="end" fontSize={7} className="fill-red-700">code {codeFt} ft</text>
        </>
      )}
    </svg>
  );
}

function ZbaList({ zba }: { zba: score.NearbyZbaCase[] }) {
  if (!zba.length) return <p className="text-[11px] text-slate-500">No decided Zoning Board cases within half a mile in the last 10 years.</p>;
  return (
    <>
      <p className="text-[11px] text-slate-500">Nearby Zoning Board decisions (within half a mile, last 10 years):</p>
      <ul className="mt-0.5 space-y-0.5 text-xs text-slate-700">
        {zba.slice(0, 5).map((z, i) => (
          <li key={`${z.case}-${z.section}-${i}`} className="flex gap-1.5">
            <span className={`shrink-0 rounded px-1 text-[10px] font-semibold ${/^(grant|partial)/i.test(z.outcome ?? "") ? "bg-emerald-100 text-emerald-800" : /^den/i.test(z.outcome ?? "") ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"}`}>{titleCase(z.outcome)}</span>
            <span className="min-w-0 truncate">{RELIEF_WORDS[z.relief ?? ""] ?? z.relief}{z.section ? ` §${z.section}` : ""} · {titleCase(z.address)} · {z.distance_m != null ? `${Math.round(z.distance_m)} m` : ""} · {monthYear(z.decision_date)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

const needsApproval = (result: score.EaseScoreResult | null) =>
  (result?.strategies ?? []).filter((s) => s.applicable && s.strategy !== "rehab_existing" && (f1Of(s).fitStatus === "variance" || ["S", "C"].includes(f1Of(s).permissionCode ?? "")));

export default function StreetPrecedent({ parid, precedent, zbaNearby, result, isCity }: {
  parid: string; precedent: score.StreetPrecedent | null | undefined; zbaNearby: score.NearbyZbaCase[] | null; result: score.EaseScoreResult | null; isCity: boolean;
}) {
  if (!isCity) return null;
  if (!precedent) {
    const still = needsApproval(result);
    return (
      <section aria-labelledby="precedent-h" className="rounded-xl border border-slate-200 bg-white/80 p-3">
        <h2 id="precedent-h" className="text-sm font-semibold text-slate-900">Street precedent</h2>
        <p className="mt-1 text-sm text-slate-600">No City street centerline within 60 ft of this lot, so there is no block face to compare with. The district&apos;s setbacks apply as written.</p>
        {still.length > 0 && zbaNearby && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-slate-800">Still needs approval: {still.map((s) => score.OPTION_NAME[s.strategy]).join(", ")}</p>
            <ZbaList zba={zbaNearby} />
          </div>
        )}
      </section>
    );
  }
  const p = precedent;
  const c = p.contextual;
  const strategies = result?.strategies.filter((s) => s.applicable && s.strategy !== "rehab_existing") ?? [];
  const flipped = strategies.filter((s) => f1Of(s).fitStatus === "contextual" && f1Of(s).contextualBasis === "measured");
  const stillNeeds = needsApproval(result);
  const scopeText = p.scope === "stretch" ? "this stretch of the street (400 ft each way, same side)" : "this block face";
  const top = p.conformity.topRules.slice(0, 3).map((r) => `${RULE_WORDS[r.rule] ?? r.rule} ${r.n}`).join(", ");
  const zba = p.zba;

  return (
    <section aria-labelledby="precedent-h" className="rounded-xl border border-slate-200 bg-white/80 p-3">
      <h2 id="precedent-h" className="text-sm font-semibold text-slate-900">Street precedent</h2>
      <p className="text-[11px] text-slate-500">{titleCase(p.streetName)} · {scopeText}</p>
      <p className="mt-1 text-sm text-slate-800">{p.headline}</p>
      {p.nBuildings > 0 && <Strip lots={p.lots} subject={parid} codeFt={p.districtFrontFt} />}

      {c.applies ? (
        <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-sm text-emerald-900">
          <span className="font-semibold">Allowed by matching neighbors:</span> front setback {c.ft} ft instead of {c.districtFt} ft, because {c.why}.
          <span className="block text-[11px] text-emerald-800">{c.citation}; by right, no hearing. Used in the fit test and Ease Score above.</span>
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-600">Contextual front setback: {c.reason}</p>
      )}

      {flipped.length > 0 && (
        <p className="mt-1.5 text-xs text-slate-700">
          <span className="font-semibold">Flipped from “needs a variance”:</span> {flipped.map((s) => score.OPTION_NAME[s.strategy]).join(", ")} fit only once the front line follows the neighbors.
        </p>
      )}

      <dl className="mt-2 grid grid-cols-4 gap-1.5 text-center">
        {([
          ["Typical lot", p.lotWidthFt != null ? `${Math.round(p.lotWidthFt)} ft wide` : "—"],
          ["Lot size", p.lotAreaSf != null ? `${p.lotAreaSf.toLocaleString("en-US")} sf` : "—"],
          ["Stories", p.stories != null ? String(p.stories) : "—"],
          ["Side yard", ft(p.sideMinFt)],
        ] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-slate-100 px-1 py-1">
            <dt className="text-[10px] uppercase tracking-wide text-slate-500">{k}</dt>
            <dd className="text-xs font-semibold tabular-nums text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-[11px] text-slate-500">Medians over {p.nBuildings} measured {p.nBuildings === 1 ? "building" : "buildings"} ({p.nLots} lots){p.maxUnits != null ? `; up to ${p.maxUnits} ${p.maxUnits === 1 ? "unit" : "units"} per building` : ""}.</p>
      {p.conformity.withBuilding > 0 && (
        <p className="mt-1 text-xs text-slate-700">
          {p.conformity.nonconforming} of {p.conformity.withBuilding} existing buildings here would not meet today&apos;s code{top ? ` (${top})` : ""}.
        </p>
      )}

      {stillNeeds.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-semibold text-slate-800">Still needs approval: {stillNeeds.map((s) => score.OPTION_NAME[s.strategy]).join(", ")}</p>
          <ZbaList zba={zba} />
        </div>
      )}
      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        Measured from Allegheny County building footprints (roof outlines, so porches count) and parcel lines: the gap from the street-side lot line to the building. Approximate; the applicant documents neighbors&apos; setbacks with a survey. Block = the City street centerline segment (intersection to intersection), same side of the street; widened to 400 ft of the same street when that segment has fewer than 3 measured buildings.
      </p>
    </section>
  );
}
