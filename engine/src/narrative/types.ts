// Input and output shapes for the plain-English "four answers" layer.
// NarrativeFacts is decoupled from the score engine on purpose: anything that can fill this
// shape (score output, zoning result, pro forma, checklist) can be narrated.

export type Band = "Easy" | "Moderate" | "Hard" | "Very hard";

/** How the chosen use is allowed in the zoning district. */
export type UsePath =
  | "by_right"
  | "special_exception"
  | "administrator_exception"
  | "conditional_use"
  | "use_variance"
  | "not_permitted"
  | "unknown";

/** How the building fits the dimensional rules (setbacks, height, lot size). */
export type DimensionalFit = "fits" | "contextual" | "variance" | "unknown";

export interface CostRange {
  low: number;
  high: number;
  /** True when the figure is an editable default rather than a quote or public record. */
  isDefault?: boolean;
}

export interface NarrativeRedFlag {
  id: string;
  /** Plain words, e.g. "Most of the lot is in a floodway". */
  label: string;
  /** How it could be resolved, if there is a path, e.g. "a use variance from the Zoning Board". */
  path?: string | null;
}

export interface NarrativeCallout {
  id: string;
  /** Plain words, e.g. "The lot is in a landslide-prone area". */
  label: string;
  /** What it means you must do, e.g. "a geotechnical report". */
  action?: string | null;
  cost?: CostRange | null;
  months?: number | null;
  /** Checklist item this callout already covers (so it isn't listed twice). */
  requirementId?: string | null;
}

export interface NarrativeFactor {
  id: string;
  label: string;
  weight: number;
  subscore: number | null;
  evidence: "complete" | "partial" | "missing";
  /** e.g. "84% of the lot is steeper than 25%". Numbers inside it count as facts. */
  oneLiner?: string | null;
}

export interface NarrativeUnlock {
  /** e.g. "Removing the parking minimum" */
  label: string;
  scoreGain?: number | null;
  unitGain?: number | null;
}

export interface NarrativeScore {
  score: number | null;
  band: Band | null;
  range?: { min: number; max: number } | null;
  insufficientEvidence?: boolean;
  redFlags: NarrativeRedFlag[];
  reviewCallouts: NarrativeCallout[];
  factors: NarrativeFactor[];
  predictedMonthsToPermit: number | null;
  unlocks: NarrativeUnlock[];
  configVersion?: string | null;
}

export interface NarrativeZoning {
  /** e.g. "R1D-H" */
  district?: string | null;
  /** e.g. "a duplex" (article included, lower case). */
  useLabel: string;
  use: UsePath;
  dimensional: DimensionalFit;
  /** Plain names of rules that need relief, e.g. ["front setback"]. */
  varianceItems?: string[];
  /** Historic grant rate for the needed relief, 0–1, when known. */
  grantRate?: number | null;
  /** Number of past cases behind grantRate. */
  grantCases?: number | null;
  units?: number | null;
  /** Municipality to confirm with when zoning is unknown. */
  municipality?: string | null;
}

export interface NarrativeProForma {
  tenure: "sale" | "rent";
  totalCost: number;
  /** Sale: expected sale value. Rent: stabilized value if known. */
  value?: number | null;
  /** value − totalCost; derived if omitted. */
  margin?: number | null;
  /** margin ÷ totalCost × 100; derived if omitted. */
  marginPct?: number | null;
  monthlyRent?: number | null;
  annualOpex?: number | null;
  /** annual rent − annualOpex; derived if omitted. */
  noi?: number | null;
  /** noi ÷ totalCost × 100 */
  yieldOnCostPct?: number | null;
  /** Positive = subsidy needed (affordable mode). */
  fundingGap?: number | null;
  /** The pro forma's own verdict, if it has one. Otherwise margin > 0 = yes. */
  verdict?: "yes" | "thin" | "no" | null;
  /** Decisive money risks for "What's in the way?" (plain words, no numbers), e.g. thin comps. */
  risks?: string[] | null;
  /** Decisive next steps from the pro forma (plain words, no numbers), e.g. get a builder's bid. */
  steps?: string[] | null;
}

export interface NarrativeRequirement {
  id: string;
  /** Plain words, e.g. "Geotechnical report". */
  item: string;
  status: "REQUIRED" | "LIKELY" | "POSSIBLE" | "ASK" | "NOT_NEEDED";
  phase?: string | null;
  issuer?: string | null;
  cost?: CostRange | null;
  /** Typical time in weeks, if known. */
  weeks?: number | null;
}

export interface NarrativeFacts {
  parid: string;
  strategy: { id: string; label: string };
  configVersion: string;
  score: NarrativeScore;
  zoning: NarrativeZoning;
  /** Absent/null = cost and value estimate not available yet. */
  proForma?: NarrativeProForma | null;
  requirements: NarrativeRequirement[];
}

export type SentenceSource = "template" | "ai";

export interface NarrativeSentence {
  /** May contain tooltip markers: {{term:JARGON|plain words}}. */
  text: string;
  source: SentenceSource;
}

export interface NarrativeResult {
  parid: string;
  strategy: string;
  configVersion: string;
  canBuild: NarrativeSentence;
  pencils: NarrativeSentence;
  /** The pencil math as "A − B = C" in words, e.g. "$455,000 value minus $412,000 cost = $43,000 left over". Null without a pro forma. */
  pencilsMath: NarrativeSentence | null;
  /** Up to 3, most costly first. */
  barriers: NarrativeSentence[];
  /** Up to 3, in order. */
  nextSteps: NarrativeSentence[];
  /** "template" when nothing came from AI, "ai" when all did, else "mixed". */
  source: "template" | "ai" | "mixed";
}

export interface ValidationResult {
  ok: boolean;
  /** Each number token (as written) that isn't derivable from the facts. */
  offending: string[];
}
