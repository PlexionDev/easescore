// One canonical approvals record per studied scheme. Built once (report loader) from the selected
// scheme's use permission and QuickFit's zoning checks, then read by every report section, the PDF
// and the checklist, so a variance the scheme needs can never also be listed as "Not needed".
// Deterministic templates only: no AI-written text or numbers.

/** The scheme fields the record reads (QuickFit v1 scheme shape, which the v2 adapter also emits). */
export interface ApprovalSchemeLike {
  typologyLabel: string;
  units: number;
  byRight: boolean;
  permission: { code: string | null; use: string };
  approvals: { kind: string; rule: string; label: string }[];
  parkingSpaces?: number | null;
  parkingRequired?: number | null;
}

export type ApprovalType = "admin_exception" | "special_exception" | "conditional_use" | "use_variance" | "variance";
export type ApprovalTopic = "use" | "parking" | "lot_size" | "density" | "setback" | "height" | "other";

export interface ApprovalItem {
  type: ApprovalType;
  topic: ApprovalTopic;
  /** Plain name, e.g. "Variance for parking". */
  name: string;
  /** What the scheme breaks, from the zoning check. */
  detail: string;
  /** Who decides. */
  body: string;
  /** Code section(s) behind it. */
  citation: string;
}

export type ApprovalPath = "unknown" | "no_scheme" | "by_right" | "admin_exception" | "special_exception" | "conditional_use" | "variance" | "not_permitted";

export interface ApprovalsRecord {
  zoningLoaded: boolean;
  district: string | null;
  municipality: string | null;
  /** True when no layout fit and the record describes the closest one tried. */
  closest: boolean;
  scheme: { label: string; units: number; phrase: string } | null;
  useCode: string | null;
  items: ApprovalItem[];
  /** Dimensional items only (setbacks, height, lot size, density, parking). */
  dimensional: ApprovalItem[];
  byRight: boolean;
  needsVariance: boolean;
  needsSpecialException: boolean;
  needsConditionalUse: boolean;
  needsAdminException: boolean;
  path: ApprovalPath;
  /** The three plain answers for the summary (one sentence each). */
  answers: { use: string; fit: string; approval: string };
}

/** "one townhouse", "3 townhouses": the count and the noun agree; 1 is always written "one". */
export function countNoun(n: number, one: string, many = `${one}s`): string {
  return `${n === 1 ? "one" : n} ${n === 1 ? one : many}`;
}

const NOUN: [RegExp, string, string][] = [
  [/townhouse|row/i, "townhouse", "townhouses"],
  [/duplex|two-unit|two unit/i, "duplex", "duplexes"],
  [/cottage|adu/i, "backyard cottage", "backyard cottages"],
  [/single/i, "single-family home", "single-family homes"],
];

/** "one townhouse", "a row of 3 townhouses", "a 4-unit building", "one single-family home". */
export function schemePhrase(label: string, units: number): string {
  const l = label.toLowerCase();
  if (/townhouse|row/.test(l)) return units === 1 ? "one townhouse" : `a row of ${countNoun(units, "townhouse")}`;
  if (/duplex|two-unit|two unit/.test(l)) return "a duplex (two homes)";
  if (/stacked|3-4|three|multi|unit building/.test(l)) return units === 1 ? "a one-unit building" : `a ${units}-unit building`;
  const hit = NOUN.find(([re]) => re.test(l));
  if (hit) return countNoun(units, hit[1], hit[2]);
  return `${l} with ${countNoun(units, "home")}`;
}

const ZBA = "Zoning Board of Adjustment (public hearing)";
const VARIANCE_SEC = "§922.09 variances (confirm)";

function topicOf(rule: string): ApprovalTopic {
  if (/park/.test(rule)) return "parking";
  if (/per_unit|density/.test(rule)) return "density";
  if (/lot_area|lotSize|lot_size/.test(rule)) return "lot_size";
  if (/setback|front|rear|side/.test(rule)) return "setback";
  if (/height|stories/.test(rule)) return "height";
  return "other";
}

const SETBACK_WORD: Record<string, string> = { front_setback: "front setback", rear_setback: "rear setback", side_setback: "side setback", exterior_side_setback: "street-side setback" };

function varianceItem(a: { rule: string; label: string }, s: ApprovalSchemeLike, rulesCitation: string | null): ApprovalItem {
  const topic = topicOf(a.rule);
  const std = rulesCitation ?? "district dimensional standards";
  const detail = a.label.replace(/\.$/, "");
  switch (topic) {
    case "parking": {
      const need = s.parkingRequired != null && s.parkingSpaces != null ? ` (${s.parkingRequired} required, ${s.parkingSpaces} fit)` : "";
      return { type: "variance", topic, name: "Variance for parking", detail: `fewer off-street parking spaces than the code requires${need}; a parking reduction under §914.04 may apply instead`, body: ZBA, citation: `Pittsburgh Zoning Code §914.02.A (parking required); ${VARIANCE_SEC}` };
    }
    case "setback":
      return { type: "variance", topic, name: `Variance for the ${SETBACK_WORD[a.rule] ?? "setback"}`, detail, body: ZBA, citation: `${std}; ${VARIANCE_SEC}` };
    case "height":
      return { type: "variance", topic, name: "Variance for height", detail, body: ZBA, citation: `${std}; ${VARIANCE_SEC}` };
    case "lot_size":
      return { type: "variance", topic, name: "Variance for lot size", detail, body: ZBA, citation: `${std}; ${VARIANCE_SEC}` };
    case "density":
      return { type: "variance", topic, name: "Variance for lot area per home", detail, body: ZBA, citation: `${std}; ${VARIANCE_SEC}` };
    default:
      return { type: "variance", topic, name: "Variance", detail, body: ZBA, citation: VARIANCE_SEC };
  }
}

function useItem(code: string | null, use: string): ApprovalItem | null {
  const u = use.toLowerCase();
  if (code === "S") return { type: "special_exception", topic: "use", name: "Special exception for the use", detail: `${u} is listed as a special exception in this district`, body: ZBA, citation: "Pittsburgh Zoning Code §911.02 Use Table; §922.07" };
  if (code === "C") return { type: "conditional_use", topic: "use", name: "Conditional use approval", detail: `${u} is listed as a conditional use in this district`, body: "Planning Commission review and City Council approval", citation: "Pittsburgh Zoning Code §911.02 Use Table; §922.06" };
  if (code === "A") return { type: "admin_exception", topic: "use", name: "Administrator exception for the use", detail: `${u} needs an administrator exception in this district`, body: "Zoning Administrator (no hearing)", citation: "Pittsburgh Zoning Code §911.02 Use Table" };
  if (code === "N") return { type: "use_variance", topic: "use", name: "Use variance or rezoning", detail: `${u} is not permitted in this district`, body: `${ZBA}, or City Council for a rezoning`, citation: `Pittsburgh Zoning Code §911.02 Use Table; ${VARIANCE_SEC}` };
  return null;
}

const TYPE_NOUN: Record<ApprovalType, string> = {
  admin_exception: "an administrator exception",
  special_exception: "a special exception",
  conditional_use: "conditional use approval",
  use_variance: "a use variance or rezoning",
  variance: "a variance",
};

const TOPIC_WORD: Record<ApprovalTopic, string> = { use: "the use", parking: "parking", lot_size: "lot size", density: "lot area per home", setback: "setbacks", height: "height", other: "a dimensional rule" };

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function buildApprovalsRecord(a: {
  zoningLoaded: boolean;
  municipality?: string | null;
  district?: string | null;
  /** First part of the zoning_rules citation (district dimensional standards). */
  rulesCitation?: string | null;
  scheme: ApprovalSchemeLike | null;
  /** True when `scheme` is the closest layout tried (nothing fit as studied). */
  closest?: boolean;
}): ApprovalsRecord {
  const district = a.district ?? null;
  const municipality = a.municipality ?? null;
  const s = a.scheme;
  const where = district ? `${district} zoning` : "this district";
  const phrase = s ? schemePhrase(s.typologyLabel, s.units) : null;

  if (!a.zoningLoaded) {
    const place = municipality ?? "this municipality";
    return {
      zoningLoaded: false, district, municipality, closest: !!a.closest, scheme: s ? { label: s.typologyLabel, units: s.units, phrase: phrase! } : null, useCode: null,
      items: [], dimensional: [], byRight: false, needsVariance: false, needsSpecialException: false, needsConditionalUse: false, needsAdminException: false, path: "unknown",
      answers: {
        use: `Not known: zoning rules for ${place} are not in our data.`,
        fit: s ? `Not checked against zoning: the studied layout (${phrase}) is priced as you chose it, without ${place}'s setbacks or height limits.` : "Not checked: no layout was studied.",
        approval: `Not known: ask ${place}'s zoning office which approvals apply.`,
      },
    };
  }

  if (!s) {
    return {
      zoningLoaded: true, district, municipality, closest: false, scheme: null, useCode: null, items: [], dimensional: [], byRight: false,
      needsVariance: false, needsSpecialException: false, needsConditionalUse: false, needsAdminException: false, path: "no_scheme",
      answers: {
        use: `Not checked: no building type was placed on this lot, so no use was tested against ${where}.`,
        fit: "No. No building type fit inside this lot's setbacks and rules in our site-fit check.",
        approval: "Not known until a layout fits; the Zoning Administrator can say which relief a design would need.",
      },
    };
  }

  const code = s.permission.code;
  const items: ApprovalItem[] = [];
  const ui = useItem(code, s.permission.use);
  if (ui) items.push(ui);
  const seen = new Set<string>();
  for (const ap of s.approvals) {
    if (ap.kind === "use") continue; // the use permission code above is canonical
    const it = varianceItem(ap, s, a.rulesCitation ?? null);
    const key = `${it.topic}:${it.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(it);
  }
  const dimensional = items.filter((i) => i.topic !== "use");
  const has = (t: ApprovalType) => items.some((i) => i.type === t);
  const path: ApprovalPath =
    code === "N" ? "not_permitted"
      : has("variance") ? "variance"
        : has("conditional_use") ? "conditional_use"
          : has("special_exception") ? "special_exception"
            : has("admin_exception") ? "admin_exception"
              : "by_right";
  const useLc = s.permission.use.toLowerCase();

  const use =
    code === "P" ? `Yes. ${cap(useLc)} is allowed by right under ${where}.`
      : code === "S" ? `Only with a special exception: ${useLc} needs a Zoning Board of Adjustment hearing under ${where}.`
        : code === "C" ? `Only as a conditional use: ${useLc} needs Planning Commission review and City Council approval under ${where}.`
          : code === "A" ? `Yes, with an administrator exception from the Zoning Administrator under ${where}.`
            : code === "N" ? `No. ${cap(useLc)} is not permitted under ${where}; it would need a use variance or a rezoning.`
              : `Not known: the use table has no entry for ${useLc} under ${where}.`;

  const lead = a.closest ? `No layout fits as studied; the closest one tried (${phrase})` : `The studied layout (${phrase})`;
  const fit = dimensional.length
    ? `Not without relief. ${lead} breaks the ${joinAnd([...new Set(dimensional.map((d) => TOPIC_WORD[d.topic]))])} rule${dimensional.length === 1 ? "" : "s"}.`
    : a.closest ? `No. ${lead} still needs relief for the use.`
      : `Yes. ${lead} fits the setbacks, height, lot-size and parking rules.`;

  const approval = items.length
    ? `${cap(joinAnd(items.map((i) => (i.type === "variance" ? `a variance for ${TOPIC_WORD[i.topic]}` : i.type === "special_exception" ? "a special exception for the use" : TYPE_NOUN[i.type]))))}${items.some((i) => i.body.startsWith("Zoning Board")) ? ", decided at a Zoning Board of Adjustment hearing" : ""}.`
    : "None for zoning: it is allowed by right. Building and other permits are still needed (Section 5).";

  return {
    zoningLoaded: true, district, municipality, closest: !!a.closest,
    scheme: { label: s.typologyLabel, units: s.units, phrase: phrase! },
    useCode: code, items, dimensional, byRight: items.length === 0,
    needsVariance: has("variance") || has("use_variance"),
    needsSpecialException: has("special_exception"),
    needsConditionalUse: has("conditional_use"),
    needsAdminException: has("admin_exception"),
    path,
    answers: { use, fit, approval },
  };
}

function cap(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

interface RequirementLike {
  id: string;
  status: string;
  reasons: { status: string; reason: string; source?: string }[];
  citation: string | null;
}

/**
 * Makes the checklist agree with the record: the variance, special exception, conditional use and
 * parking items follow the studied scheme. An approval the scheme needs is REQUIRED (the cited
 * section requires it for this layout) and is never "Not needed".
 */
export function reconcileRequirements<R extends RequirementLike>(reqs: R[], rec: ApprovalsRecord): R[] {
  if (!rec.zoningLoaded || !rec.scheme) return reqs;
  const src = "QuickFit site-fit check against the zoning rules";
  const req = (items: ApprovalItem[]) => items.map((i) => ({ status: "REQUIRED", reason: `${i.name}: ${i.detail} (${i.citation}).`, source: src }));
  const notNeeded = (reason: string) => [{ status: "NOT_NEEDED", reason, source: src }];
  return reqs.map((r) => {
    if (r.id === "variance") {
      const v = rec.items.filter((i) => i.type === "variance" || i.type === "use_variance");
      if (v.length) return { ...r, status: "REQUIRED", reasons: req(v), citation: [...new Set(v.map((i) => i.citation))].join("; ") };
      if (!rec.closest) return { ...r, status: "NOT_NEEDED", reasons: notNeeded(`The studied layout (${rec.scheme!.phrase}) meets the district's setbacks, height, lot-size and parking rules.`) };
      return r;
    }
    if (r.id === "special_exception") {
      const v = rec.items.filter((i) => i.type === "special_exception" || i.type === "admin_exception");
      if (v.length) return { ...r, status: v.some((i) => i.type === "special_exception") ? "REQUIRED" : "LIKELY", reasons: req(v).map((x, k) => ({ ...x, status: v[k]!.type === "special_exception" ? "REQUIRED" : "LIKELY" })) };
      if (r.status !== "NOT_NEEDED" && !rec.closest) return { ...r, status: "NOT_NEEDED", reasons: notNeeded("The studied use does not need a special exception here.") };
      return r;
    }
    if (r.id === "conditional_use") {
      const v = rec.items.filter((i) => i.type === "conditional_use");
      if (v.length) return { ...r, status: "REQUIRED", reasons: req(v) };
      if (r.status !== "NOT_NEEDED" && !rec.closest) return { ...r, status: "NOT_NEEDED", reasons: notNeeded("The studied use is not a conditional use here.") };
      return r;
    }
    if (r.id === "parking") {
      const v = rec.items.filter((i) => i.topic === "parking");
      if (v.length) return { ...r, status: "REQUIRED", reasons: [...req(v), ...r.reasons.filter((x) => x.status !== "NOT_NEEDED")] };
      return r;
    }
    return r;
  });
}
