import { describe, expect, it } from "vitest";
import { narrative } from "../src";
import type { NarrativeFacts } from "../src/narrative";

const { generateNarrative, validateNarrative, validateResult, extractNumbers, mathInWords, parseTerms, stripTerms } = narrative;

// Synthetic facts only: neutral ids, no addresses.
const baseScore = (): NarrativeFacts["score"] => ({
  score: 80,
  band: "Easy",
  range: null,
  insufficientEvidence: false,
  redFlags: [],
  reviewCallouts: [],
  factors: [
    { id: "F1", label: "Zoning permission", weight: 25, subscore: 100, evidence: "complete", oneLiner: "A duplex is allowed by right" },
    { id: "F2", label: "Terrain", weight: 20, subscore: 95, evidence: "complete", oneLiner: "2% of the lot is steeper than 25%" },
  ],
  predictedMonthsToPermit: 3.6,
  unlocks: [],
  configVersion: "ease-score.v0.1",
});

const EASY: NarrativeFacts = {
  parid: "EASY-FLAT-R2",
  strategy: { id: "duplex", label: "Duplex" },
  configVersion: "ease-score.v0.1",
  score: baseScore(),
  zoning: { district: "R2-L", useLabel: "a duplex", use: "by_right", dimensional: "fits", units: 2 },
  proForma: { tenure: "sale", totalCost: 411_873, value: 455_300 },
  requirements: [
    { id: "building_permit", item: "Building permit", status: "REQUIRED", phase: "permits", issuer: "PLI", cost: { low: 2_500, high: 4_000 }, weeks: 6 },
    { id: "zoning_review", item: "Zoning development review", status: "REQUIRED", phase: "zoning", issuer: "City Planning", weeks: 4 },
    { id: "sewer_tap", item: "Sewer tap", status: "LIKELY", phase: "permits" },
  ],
};

const RED_FLAG: NarrativeFacts = {
  parid: "FLOODWAY-SYNTH",
  strategy: { id: "single_family", label: "New single-family home" },
  configVersion: "ease-score.v0.1",
  score: {
    ...baseScore(),
    score: 41,
    band: "Hard",
    redFlags: [{ id: "floodway", label: "Most of the lot is in a floodway", path: null }],
    factors: [
      { id: "F3", label: "Geohazards", weight: 15, subscore: 49, evidence: "complete", oneLiner: "70% of the lot is in the 1% annual flood zone" },
    ],
    predictedMonthsToPermit: 9,
  },
  zoning: { district: "R1D-L", useLabel: "a single-family home", use: "by_right", dimensional: "fits", units: 1 },
  proForma: { tenure: "sale", totalCost: 310_000, value: 290_000 },
  requirements: [{ id: "floodplain_permit", item: "Floodplain development permit", status: "REQUIRED", phase: "permits", issuer: "City Planning", weeks: 8 }],
};

const NO_PRO_FORMA: NarrativeFacts = {
  parid: "HILLSIDE-R1D-H",
  strategy: { id: "single_family", label: "New single-family home" },
  configVersion: "ease-score.v0.1",
  score: {
    ...baseScore(),
    score: 52,
    band: "Hard",
    reviewCallouts: [
      { id: "landslide", label: "The lot is in a landslide-prone area", action: "a geotechnical report", cost: { low: 3_000, high: 6_000 } },
      { id: "undermined", label: "The lot is over old coal mines", action: "grouting", cost: { low: 30_000, high: 50_000, isDefault: true } },
    ],
    factors: [{ id: "F2", label: "Terrain", weight: 20, subscore: 31, evidence: "complete", oneLiner: "84% of the lot is steeper than 25%" }],
    predictedMonthsToPermit: 7,
  },
  zoning: { district: "R1D-H", useLabel: "a single-family home", use: "by_right", dimensional: "variance", varianceItems: ["front setback"], grantRate: 0.62, grantCases: 40 },
  proForma: null,
  requirements: [
    { id: "geotech", item: "Geotechnical report", status: "REQUIRED", phase: "design_engineering", cost: { low: 3_000, high: 6_000 }, weeks: 4 },
    { id: "variance", item: "Zoning variance", status: "REQUIRED", phase: "zoning", issuer: "Zoning Board of Adjustment" },
  ],
};

const PARKS: NarrativeFacts = {
  ...NO_PRO_FORMA,
  parid: "PARKS-DISTRICT-HILLSIDE",
  score: { ...NO_PRO_FORMA.score, score: 22, band: "Very hard" },
  zoning: { district: "P", useLabel: "a single-family home", use: "not_permitted", dimensional: "unknown" },
  requirements: [],
};

const RENTAL: NarrativeFacts = {
  ...EASY,
  parid: "RENTAL-SYNTH",
  proForma: { tenure: "rent", totalCost: 412_000, monthlyRent: 2_400, annualOpex: 9_100, yieldOnCostPct: 4.78, verdict: "thin" },
};

describe("templates", () => {
  it("ranks steps by decision impact and keeps routine items out of the top three", () => {
    const f: NarrativeFacts = {
      ...EASY,
      proForma: { ...EASY.proForma!, steps: ["Get a builder's bid for this layout."], risks: ["Too few new-home sales nearby to price a new house."] },
      requirements: [
        { id: "realty_transfer_tax", item: "Realty transfer tax", status: "REQUIRED", phase: "due_diligence", issuer: "PA Dept. of Revenue" },
        { id: "title", item: "Title search & title insurance", status: "REQUIRED", phase: "due_diligence", issuer: "Title company" },
        { id: "geotech", item: "Geotechnical report", status: "REQUIRED", phase: "design_engineering", issuer: "Geotechnical engineer" },
      ],
    };
    const r = generateNarrative(f);
    expect(r.nextSteps.map((s) => s.text)).toEqual(["Get the {{term:geotechnical report|geotechnical report}} from Geotechnical engineer.", "Get a builder's bid for this layout."]);
    expect(r.barriers.map((b) => b.text)).toContain("Too few new-home sales nearby to price a new house.");
  });

  it("easy case", () => {
    const r = generateNarrative(EASY);
    expect(stripTerms(r.canBuild.text)).toBe("Yes, a duplex is allowed by right and fits the lot's size and setback rules (2-5 months to a building permit, review time only).");
    expect(r.pencils.text).toBe(
      "Yes: it costs about $412,000 to build and would be worth about $455,000, a $43,000 {{term:margin|profit}} (11%).",
    );
    expect(r.pencilsMath?.text).toBe("$455,000 value minus $412,000 cost = $43,000 left over.");
    // Routine permits stay in the checklist; they are not barriers or top steps.
    expect(r.barriers).toEqual([{ text: "No major barriers found in our data.", source: "template" }]);
    expect(r.nextSteps.map((s) => s.text)).toEqual(["See the checklist below for the permits this plan needs."]);
    expect(r.source).toBe("template");
    expect(validateResult(r, EASY)).toEqual({ ok: true, offending: [] });
  });

  it("red-flag case leads with the block in every answer", () => {
    const r = generateNarrative(RED_FLAG);
    expect(r.canBuild.text).toBe("No, not as things stand: most of the lot is in a floodway, so a single-family home is blocked unless that is resolved.");
    expect(r.pencils.text).toBe("No: it costs about $310,000 to build but would be worth only about $290,000, a loss of $20,000.");
    expect(r.barriers[0]!.text).toBe("Blocked: most of the lot is in a floodway.");
    expect(r.barriers[1]!.text).toBe("70% of the lot is in the 1% annual flood zone.");
    expect(r.nextSteps[0]!.text).toBe("Confirm with the City that most of the lot is in a floodway before paying for any design.");
    expect(validateResult(r, RED_FLAG).ok).toBe(true);
  });

  it("missing pro forma says so plainly; callouts sorted most costly first", () => {
    const r = generateNarrative(NO_PRO_FORMA);
    expect(r.pencils.text).toBe("We can't tell yet: the cost and value estimate for this plan isn't available.");
    expect(r.pencilsMath).toBeNull();
    expect(stripTerms(r.canBuild.text)).toBe("Yes, a single-family home is allowed by right, but the front setback needs a variance (5-9 months to a building permit, review time only).");
    expect(r.barriers.map((b) => stripTerms(b.text))).toEqual([
      "The lot is over old coal mines: plan on grouting, $30,000 to $50,000 (editable default).",
      "The lot is in a landslide-prone area: plan on a geotechnical report, $3,000 to $6,000.",
      "A variance is needed for the front setback (the Zoning Board granted 62% of 40 past requests like it).",
    ]);
    expect(r.nextSteps.map((s) => stripTerms(s.text))).toEqual([
      "Apply to the Zoning Board for a variance on the front setback.",
      "Get the geotechnical report: about 4 weeks, $3,000 to $6,000.",
      "Get the zoning variance from Zoning Board of Adjustment.",
    ]);
    expect(validateResult(r, NO_PRO_FORMA).ok).toBe(true);
  });

  it("parks district: not permitted is a zoning answer, not a red flag; callouts stay visible", () => {
    const r = generateNarrative(PARKS);
    expect(r.canBuild.text).toBe("No, a single-family home is not allowed in the P district, and there is no clear path to approval.");
    expect(r.barriers[0]!.text).toMatch(/^Zoning: a single-family home is not allowed/);
    expect(r.barriers.some((b) => b.text.includes("old coal mines"))).toBe(true);
    expect(validateResult(r, PARKS).ok).toBe(true);
  });

  it("rental pro forma uses the money math sentence", () => {
    const r = generateNarrative(RENTAL);
    expect(r.pencilsMath?.text).toBe("Rent $2,400 × 12 = $28,800 a year; minus $9,100 in costs = $19,700 left to pay the loan.");
    expect(stripTerms(r.pencils.text)).toBe(
      "Thin margin: it costs about $412,000 to build and would bring in about $19,700 a year after running costs (net income), a 5% yearly return on cost.",
    );
    expect(validateResult(r, RENTAL).ok).toBe(true);
  });

  it("is deterministic", () => {
    for (const f of [EASY, RED_FLAG, NO_PRO_FORMA, PARKS, RENTAL]) {
      expect(JSON.stringify(generateNarrative(f))).toBe(JSON.stringify(generateNarrative(structuredClone(f))));
    }
  });
});

describe("mathInWords", () => {
  it("builds A − B = C sentences that add up on their face", () => {
    const m = mathInWords({ value: 455_300, label: "value" }, [{ op: "minus", term: { value: 411_873, label: "cost" }, resultLabel: "left over" }]);
    expect(m.text).toBe("$455,000 value minus $412,000 cost = $43,000 left over");
    expect(m.result).toBe(43_000);
  });
});

describe("validator", () => {
  it("extracts money, percents, counts, decimals, suffixes and number words", () => {
    const got = extractNumbers("$412,000 or $412k, 10%, 1,234 sq ft, 2.5 stories, twelve months, 84 percent, R1D-H").map((t) => [t.value, t.percent]);
    expect(got).toEqual([
      [412_000, false], [412_000, false], [10, true], [1_234, false], [2.5, false], [84, true], [12, false],
    ]);
  });

  it("catches injected numbers", () => {
    expect(validateNarrative("It would be worth about $500,000.", EASY)).toEqual({ ok: false, offending: ["$500,000"] });
    expect(validateNarrative("That is a 15% margin.", EASY).offending).toEqual(["15%"]);
    expect(validateNarrative("You could fit twelve units.", EASY).offending).toEqual(["twelve"]);
    expect(validateNarrative("Permits take 3.7 months.", EASY).offending).toEqual(["3.7"]);
    expect(validateNarrative("Costs about $420k.", EASY).offending).toEqual(["$420k"]);
    // Numbers in tooltip markers are checked too.
    expect(validateNarrative("A {{term:IRR 99|return}} here.", EASY).ok).toBe(false);
  });

  it("allows values rounded to the displayed precision", () => {
    expect(validateNarrative("It costs about $412,000, or $412k.", EASY).ok).toBe(true); // 411,873
    expect(validateNarrative("Worth $455,300 exactly, about $455k.", EASY).ok).toBe(true);
    expect(validateNarrative("A 10.5% margin, about 11%.", EASY).ok).toBe(true); // 43,427 / 411,873 = 10.54
    expect(validateNarrative("About 4 months, or 3.6 months.", EASY).ok).toBe(true);
    expect(validateNarrative("Two units and a 62% grant rate over 40 cases.", NO_PRO_FORMA).ok).toBe(true);
    expect(validateNarrative("84% of the lot is steep.", NO_PRO_FORMA).ok).toBe(true);
  });

  it("does not accept a looser rounding than the display implies", () => {
    // $411,873 shown as $411,900 is fine (nearest 100), but $411,000 is not (nearest 1,000 is $412,000).
    expect(validateNarrative("$411,900", EASY).ok).toBe(true);
    expect(validateNarrative("$411,000", EASY).ok).toBe(false);
  });
});

describe("terms", () => {
  it("parses tooltip markers with glossary definitions", () => {
    const segs = parseTerms("A {{term:NOI|net income}} of $5.");
    expect(segs[1]).toMatchObject({ kind: "term", jargon: "NOI", text: "net income" });
    expect((segs[1] as { definition: string }).definition).toMatch(/rent collected/);
  });
});

describe("adapter", () => {
  it("maps a score-engine StrategyResult; undermined gets the editable-default grouting cost", () => {
    const facts = narrative.fromStrategyResult({
      parid: "HILLSIDE-R1D-H",
      result: {
        strategy: "new_sf", strategyLabel: "New single-family home", applicable: true, score: 48, band: "Hard", labels: [], evidenceShare: 1,
        redFlags: [], reviewCallouts: [
          { id: "undermined", severity: "amber", title: "Undermined area", reason: "", checklist: [], costNotes: [], citations: [], source: "" },
        ],
        factors: [], predictedMonthsToPermit: null, planningBadge: { status: "", points: 0, evaluatedWeight: 0, tier: null, criteria: [] },
        unlocks: [], units: 1, notes: [], configVersion: "ease-score.v0.1",
      },
      zoning: narrative.zoningFromFit(
        { status: "variance", varianceRules: ["front_setback"], envelopeAreaSf: 900, units: 1, permissionCode: "P", needsSubdivision: false, notes: [] },
        { useLabel: "a single-family home", district: "R1D-H" },
      ),
      requirements: [],
    });
    expect(facts.zoning).toMatchObject({ use: "by_right", dimensional: "variance", varianceItems: ["front setback"] });
    const r = generateNarrative(facts);
    expect(stripTerms(r.barriers[0]!.text)).toBe("Undermined area: plan on grouting, $30,000 to $50,000 (editable default).");
    expect(validateResult(r, facts).ok).toBe(true);
  });
});
