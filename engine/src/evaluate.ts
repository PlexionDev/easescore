import { CATALOG, type CatalogItem } from "./catalog";
import { isPittsburgh, municipality } from "./helpers";
import {
  PHASE_ORDER, STATUS_RANK,
  type ParcelFacts, type ProjectAnswers, type RequirementResult, type Status, type Trigger,
} from "./types";

export type Overrides = Record<string, { status: Status; note?: string }>;

function strongest(triggers: Trigger[]): Trigger[] {
  return [...triggers].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status]);
}

export function evaluateItem(item: CatalogItem, facts: ParcelFacts, project: ProjectAnswers): RequirementResult {
  const reasons = strongest(item.rule(facts, project));
  const top = reasons[0] ?? { status: "POSSIBLE" as Status, reason: "No rule output." };
  const notes = ["Verify with the issuing office."];
  if (!isPittsburgh(facts)) notes.unshift(`Requirements differ by municipality: confirm with ${municipality(facts)}.`);
  return {
    id: item.id,
    item: item.item,
    category: item.category,
    phase: item.phase,
    issuer: item.issuer,
    status: top.status,
    confirm: reasons.some((r) => r.status === top.status && r.confirm === true),
    reasons,
    citation: item.citation,
    notes,
    cost: null,
    duration: null,
  };
}

/**
 * Run every catalog rule for one parcel + project. Deterministic: same input, same output.
 * User overrides replace the computed status but keep the computed reasons for reference.
 */
export function evaluateRequirements(
  facts: ParcelFacts,
  project: ProjectAnswers = {},
  overrides: Overrides = {},
): (RequirementResult & { overridden?: { from: Status; note?: string } })[] {
  return CATALOG.map((item) => {
    const r = evaluateItem(item, facts, project);
    const o = overrides[item.id];
    return o ? { ...r, status: o.status, overridden: { from: r.status, note: o.note } } : r;
  }).sort(
    (a, b) =>
      PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) ||
      STATUS_RANK[b.status] - STATUS_RANK[a.status] ||
      a.item.localeCompare(b.item),
  );
}
