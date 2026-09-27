// Deterministic template generator for the four answers:
// 1. Can you build here?  2. Does it pencil?  3. What's in the way?  4. What next?
// Same facts in → same sentences out. Jargon only inside {{term:…|…}} markers.

import { derive } from "./derive";
import { capitalize, GLOSSARY, list, money, moneyRange, months, pct, roundMoney, term, weeks } from "./format";
import type { CostRange, NarrativeFacts, NarrativeResult, NarrativeSentence } from "./types";

const t = (text: string): NarrativeSentence => ({ text, source: "template" });

/** Lower-case the first letter, for labels dropped mid-sentence. */
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const trimDot = (s: string) => s.replace(/[.\s]+$/, "");

/** Wrap a phrase in a tooltip marker when it is a glossary term. */
function maybeTerm(phrase: string): string {
  const m = /^(a |an |the )?(.*)$/i.exec(phrase)!;
  const article = m[1] ?? "";
  const rest = m[2]!;
  const key = Object.keys(GLOSSARY).find((k) => k.toLowerCase() === rest.toLowerCase());
  return key ? article + term(key, rest) : phrase;
}

/** "a geotechnical report" → "geotechnical report", for matching callouts to checklist items. */
const bare = (s: string) => trimDot(s).replace(/^(a|an|the)\s+/i, "").toLowerCase();

function costText(c: CostRange | null | undefined): string | null {
  if (!c) return null;
  return `${moneyRange(c.low, c.high)}${c.isDefault ? " (editable default)" : ""}`;
}

function varianceText(items: string[] | undefined): string {
  const names = items && items.length ? items : ["size or setback rules"];
  return `the ${list(names)} ${names.length > 1 ? "need" : "needs"} a ${term("variance")}`;
}

function grantText(f: NarrativeFacts): string {
  const { grantRate, grantCases } = f.zoning;
  if (grantRate == null || grantCases == null || grantCases < 1) return "";
  return ` (the Zoning Board granted ${pct(grantRate * 100)} of ${grantCases} past requests like it)`;
}

// ---------------------------------------------------------------------------------------------
// 1. Can you build here?

export function canBuildSentence(f: NarrativeFacts): string {
  const z = f.zoning;
  const use = z.useLabel;
  const s = f.score;
  const where = z.district ? `the ${z.district} district` : "this zoning district";
  const tail = s.predictedMonthsToPermit != null ? ` (${months(s.predictedMonthsToPermit)} to a building permit, review time only)` : "";

  if (s.redFlags.length > 0) {
    const labels = list(s.redFlags.map((r) => lc(trimDot(r.label))));
    return `No, not as things stand: ${labels}, so ${use} is blocked unless that is resolved.`;
  }

  const andVar = z.dimensional === "variance" ? `, and ${varianceText(z.varianceItems)}` : "";
  switch (z.use) {
    case "by_right": {
      const lead = `Yes, ${use} is allowed ${term("by right")}`;
      if (z.dimensional === "fits") return `${lead} and fits the lot's size and ${term("setback")} rules${tail}.`;
      if (z.dimensional === "contextual") return `${lead} if you use the ${term("contextual setback", "line-up-with-the-neighbors front setback")}${tail}.`;
      if (z.dimensional === "variance") return `${lead}, but ${varianceText(z.varianceItems)}${tail}.`;
      return `${lead}, but we could not check the size and ${term("setback")} rules${tail}.`;
    }
    case "special_exception":
      return `Maybe: ${use} needs a ${term("special exception")} from the Zoning Board${andVar}${tail}.`;
    case "administrator_exception":
      return `Maybe: ${use} needs an ${term("administrator exception")} from the Zoning Administrator${andVar}${tail}.`;
    case "conditional_use":
      return `Maybe: ${use} needs ${term("conditional use")} approval from City Council${andVar}${tail}.`;
    case "use_variance":
      return `Only with a ${term("use variance")}, which is hard to get: ${use} is not normally allowed in ${where}.`;
    case "not_permitted":
      return `No, ${use} is not allowed in ${where}, and there is no clear path to approval.`;
    default:
      return `We can't say yet: zoning rules for this lot aren't loaded, so confirm with ${z.municipality ?? "the municipality"}.`;
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Does it pencil?

export function pencilsSentence(f: NarrativeFacts): string {
  const p = f.proForma;
  if (!p) return "We can't tell yet: the cost and value estimate for this plan isn't available.";
  const d = derive(f);
  const cost = money(p.totalCost);
  const gap = p.fundingGap != null && p.fundingGap > 0 ? `, leaving a ${term("funding gap", "money gap")} of ${money(p.fundingGap)}` : "";

  if (p.tenure === "sale") {
    if (p.value == null) return `We can't tell yet: it costs about ${cost} to build, but there is no value estimate.`;
    const shown = roundMoney(p.value) - roundMoney(p.totalCost);
    const verdict = p.verdict ?? (shown > 0 ? "yes" : "no");
    const pctText = d.marginPct != null ? ` (${pct(d.marginPct)})` : "";
    if (verdict === "no" && shown > 0)
      return `No: it costs about ${cost} to build and would be worth about ${money(p.value)}, a ${money(shown)} ${term("margin", "profit")}${pctText}, below the target profit margin${gap}.`;
    if (verdict === "no" || shown <= 0) {
      return `No: it costs about ${cost} to build but would be worth only about ${money(p.value)}, a loss of ${money(shown)}${gap}.`;
    }
    const word = verdict === "thin" ? "Thin margin" : "Yes";
    const thin = verdict === "thin" ? "thin " : "";
    return `${word}: it costs about ${cost} to build and would be worth about ${money(p.value)}, a ${thin}${money(shown)} ${term("margin", "profit")}${pctText}${gap}.`;
  }

  // Rental
  if (d.noi == null) return `We can't tell yet: it costs about ${cost} to build, but the rent and running costs aren't estimated.`;
  const yieldText = p.yieldOnCostPct != null ? `, a ${pct(p.yieldOnCostPct)} ${term("yield on cost", "yearly return on cost")}` : "";
  const income = `about ${money(d.noi)} a year after running costs (${term("NOI", "net income")})`;
  const verdict = p.verdict ?? (d.noi <= 0 ? "no" : null);
  if (verdict === "no") return `No: it costs about ${cost} to build and would bring in ${income}${yieldText}${gap}.`;
  if (verdict === "yes") return `Yes: it costs about ${cost} to build and would bring in ${income}${yieldText}${gap}.`;
  if (verdict === "thin") return `Thin margin: it costs about ${cost} to build and would bring in ${income}${yieldText}${gap}.`;
  return `Unlevered (before any loan payments): it costs about ${cost} to build and would bring in ${income}${yieldText}${gap}.`;
}

// ---------------------------------------------------------------------------------------------
// 3. What's in the way? Top 3, most costly first.

/**
 * Routine transaction and permit items: always part of a project, never decisive. They stay in the
 * full checklist but are kept out of the top-3 barriers and next steps.
 */
export const ROUTINE_REQUIREMENTS = new Set([
  "realty_transfer_tax", "title", "survey_boundary", "appraisal", "construction_loan", "builders_risk", "contractor_license",
  "site_facilities", "dumpster", "dumpster_street", "row_closure", "electrical_permit", "mechanical_permit", "plumbing_permit",
  "building_permit", "certificate_occupancy", "as_built", "energy_code", "accessibility", "tap_fees", "utility_letters",
  "sewer_lateral", "point_of_sale", "tax_jump", "back_taxes_liens", "architectural", "zoning_approval", "rco_meeting", "lead_rrp",
  "sidewalk", "street_tree", "curb_cut", "street_opening", "utility_disconnect", "sewage_planning", "erosion_sediment",
  "stormwater", "fire_protection", "civil_site_plan", "parking", "radon", "lead_service_line", "tax_abatement",
]);

/**
 * Decision impact of a checklist item (higher = more likely to kill the project or move the cost a lot).
 * Items not listed here and not routine rank below every listed item.
 */
export const DECISION_IMPACT: Record<string, number> = {
  access: 95, paper_street: 80, geotech: 90, hillside_repair: 85, mine_subsidence_paths: 85, mine_subsidence: 85,
  phase2_esa: 82, phase1_esa: 78, flood_determination: 75, wetland_stream: 70, retaining_wall: 68, flood_insurance: 60,
  variance: 88, special_exception: 86, conditional_use: 86, historic_coa: 70, subdivision: 62, inclusionary: 45,
  grading_permit: 45, party_wall: 40, structural: 35, survey_topo: 30, demolition_permit: 30, asbestos: 30, oil_tank: 30,
  utility_upgrade: 30, historic_delay: 40,
};
/** Where pro forma steps (bids, pricing) sit in that ranking. */
const PRO_FORMA_STEP_IMPACT = 50;

interface Barrier {
  key: string;
  /** Lower = earlier. 0 red flag, 1 known cost, 2 approval, 3 weak factor. */
  tier: number;
  /** Within a tier: larger first. */
  weight: number;
  text: string;
}

export function barrierLines(f: NarrativeFacts): string[] {
  const out: Barrier[] = [];
  const s = f.score;
  const z = f.zoning;

  for (const r of s.redFlags) {
    out.push({ key: `flag:${r.id}`, tier: 0, weight: 0, text: `Blocked: ${lc(trimDot(r.label))}.` });
  }

  const costedIds = new Set<string>();
  const coveredItems = new Set<string>();
  for (const c of s.reviewCallouts) {
    const cost = costText(c.cost);
    const action = c.action ? `plan on ${maybeTerm(c.action)}` : "a review is required";
    const detail = [cost, c.months != null ? months(c.months) : null].filter(Boolean).join(", ");
    out.push({
      key: `callout:${c.id}`,
      tier: c.cost ? 1 : 2,
      weight: c.cost?.high ?? 0,
      text: `${capitalize(trimDot(c.label))}: ${action}${detail ? `, ${detail}` : ""}.`,
    });
    costedIds.add(c.id);
    if (c.requirementId) costedIds.add(c.requirementId);
    if (c.action) coveredItems.add(bare(c.action));
  }

  if (s.redFlags.length === 0) {
    if (z.use === "not_permitted") {
      const where = z.district ? `the ${z.district} district` : "this zoning district";
      out.push({ key: "zoning:use", tier: 0, weight: -1, text: `Zoning: ${z.useLabel} is not allowed in ${where}, with no clear path to approval.` });
    }
    const approval: Partial<Record<typeof z.use, string>> = {
      special_exception: `a ${term("special exception")}`,
      administrator_exception: `an ${term("administrator exception")}`,
      conditional_use: `${term("conditional use")} approval`,
      use_variance: `a ${term("use variance")}`,
    };
    const what = approval[z.use];
    if (what) {
      out.push({ key: "zoning:use", tier: z.use === "use_variance" ? 0 : 2, weight: z.use === "use_variance" ? -2 : 2, text: `Zoning approval: ${z.useLabel} needs ${what}, which adds time and is not guaranteed.` });
    }
    if (z.dimensional === "variance") {
      const names = z.varianceItems && z.varianceItems.length ? list(z.varianceItems) : "size or setback rules";
      out.push({ key: "zoning:variance", tier: 2, weight: 1, text: `A ${term("variance")} is needed for the ${names}${grantText(f)}.` });
    }
  }

  for (const r of f.requirements) {
    if (r.status !== "REQUIRED" || !r.cost || costedIds.has(r.id) || coveredItems.has(bare(r.item)) || ROUTINE_REQUIREMENTS.has(r.id)) continue;
    out.push({ key: `req:${r.id}`, tier: 1, weight: r.cost.high, text: `Required: ${maybeTerm(lc(trimDot(r.item)))}, ${costText(r.cost)}.` });
  }

  (f.proForma?.risks ?? []).forEach((t, i) => out.push({ key: `money:${i}`, tier: 2, weight: 0, text: t }));

  const weak = s.factors
    .filter((x) => x.subscore != null && x.subscore < 50 && x.oneLiner)
    .sort((a, b) => a.subscore! - b.subscore! || a.id.localeCompare(b.id));
  for (const x of weak) out.push({ key: `factor:${x.id}`, tier: 3, weight: 100 - x.subscore!, text: `${capitalize(trimDot(x.oneLiner!))}.` });

  out.sort((a, b) => a.tier - b.tier || b.weight - a.weight || a.key.localeCompare(b.key));
  const lines = out.slice(0, 3).map((b) => b.text);
  return lines.length ? lines : ["No major barriers found in our data."];
}

// ---------------------------------------------------------------------------------------------
// 4. What next? Top 3 steps, with time and cost where known.

export function nextStepLines(f: NarrativeFacts): string[] {
  const steps: string[] = [];
  const s = f.score;
  const z = f.zoning;

  if (s.redFlags.length > 0) {
    const r = s.redFlags[0]!;
    steps.push(
      r.path
        ? `Before paying for any design, find out what it takes to clear the block: ${lc(trimDot(r.path))}.`
        : `Confirm with the City that ${lc(trimDot(r.label))} before paying for any design.`,
    );
  }
  if (z.use === "unknown") steps.push(`Confirm the zoning with ${z.municipality ?? "the municipality"}.`);
  if (s.redFlags.length === 0) {
    if (z.use === "special_exception") steps.push(`Apply to the Zoning Board for a ${term("special exception")}.`);
    if (z.use === "administrator_exception") steps.push(`Apply to the Zoning Administrator for an ${term("administrator exception")}.`);
    if (z.use === "conditional_use") steps.push(`Apply for ${term("conditional use")} approval through City Planning.`);
    if (z.use === "not_permitted") steps.push(`Ask City Planning whether any path exists for ${z.useLabel} here before paying for any design.`);
    if (z.use === "use_variance") steps.push(`Ask City Planning whether a ${term("use variance")} has a real chance before applying.`);
    if (z.dimensional === "variance") {
      const names = z.varianceItems && z.varianceItems.length ? list(z.varianceItems) : "size or setback rules";
      steps.push(`Apply to the Zoning Board for a ${term("variance")} on the ${names}.`);
    }
  }

  // Decisive items only, ranked by decision impact (can it kill the project, how much can it cost);
  // routine transaction and permit items stay in the full checklist.
  const ranked: { impact: number; cost: number; key: string; text: string }[] = [];
  for (const r of f.requirements) {
    if (r.status !== "REQUIRED" && r.status !== "LIKELY") continue;
    const impact = DECISION_IMPACT[r.id];
    if (impact === undefined || ROUTINE_REQUIREMENTS.has(r.id)) continue;
    const detail = [r.weeks != null ? weeks(r.weeks) : null, costText(r.cost)].filter(Boolean).join(", ");
    const from = r.issuer ? ` from ${r.issuer}` : "";
    ranked.push({ impact, cost: r.cost?.high ?? 0, key: r.id, text: `Get the ${maybeTerm(lc(trimDot(r.item)))}${from}${detail ? `: ${detail}` : ""}.` });
  }
  (f.proForma?.steps ?? []).forEach((t, i) => ranked.push({ impact: PRO_FORMA_STEP_IMPACT - i, cost: 0, key: `pf${i}`, text: t }));
  ranked.sort((a, b) => b.impact - a.impact || b.cost - a.cost || a.key.localeCompare(b.key));
  for (const r of ranked) if (!steps.includes(r.text)) steps.push(r.text);

  const out = steps.slice(0, 3);
  return out.length ? out : ["See the checklist below for the permits this plan needs."];
}

// ---------------------------------------------------------------------------------------------

export function generateNarrative(f: NarrativeFacts): NarrativeResult {
  const math = derive(f).math;
  return {
    parid: f.parid,
    strategy: f.strategy.id,
    configVersion: f.configVersion,
    canBuild: t(canBuildSentence(f)),
    pencils: t(pencilsSentence(f)),
    pencilsMath: math ? t(`${capitalize(math.text)}.`) : null,
    barriers: barrierLines(f).map(t),
    nextSteps: nextStepLines(f).map(t),
    source: "template",
  };
}
