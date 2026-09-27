import { describe, expect, it } from "vitest";
import { narrative } from "../src";

const { generateSummary, validateSummary, resolveSummary, precedentPhrase, SUMMARY_FINE_PRINT } = narrative;
type SummaryInput = narrative.SummaryInput;

// Synthetic inputs only: neutral ids, no addresses.
const base = (): SummaryInput => ({
  parid: "SYN-HILLSIDE-1",
  district: "R1D-H",
  municipality: "Pittsburgh",
  byRight: {
    strategyId: "new_sf",
    label: "one single-family home",
    units: 1,
    tenure: "sale",
    verdict: "yes",
    marginPct: 9.4,
    gap: null,
    costDriver: "the steep slope",
    costDriverEffect: "points to a stepped foundation that pushes cost toward the high end",
  },
  withApproval: {
    strategyId: "duplex",
    label: "a duplex",
    units: 2,
    tenure: "sale",
    verdict: "thin",
    marginPct: 4.1,
    gap: null,
    costDriver: null,
    costDriverEffect: null,
    approval: "a special exception",
    reliefType: "special_exception",
    precedent: { granted: 3, decided: 6, sinceYear: 2019 },
  },
  redFlags: [],
});

describe("precedent language", () => {
  it("uses the fixed thresholds", () => {
    expect(precedentPhrase({ granted: 7, decided: 10, sinceYear: 2025 }, "R2-L")).toMatch(/^nearby requests like this have usually been approved \(7 of 10 approved in R2-L since 2025\)$/);
    expect(precedentPhrase({ granted: 4, decided: 10, sinceYear: null }, null)).toMatch(/have been mixed \(4 of 10 approved\)/);
    expect(precedentPhrase({ granted: 69, decided: 100, sinceYear: null }, null)).toMatch(/mixed/);
    expect(precedentPhrase({ granted: 3, decided: 10, sinceYear: null }, null)).toMatch(/usually been denied/);
    expect(precedentPhrase({ granted: 4, decided: 4, sinceYear: 2025 }, "R2-L")).toBe("there are too few nearby cases to judge");
    expect(precedentPhrase({ granted: 0, decided: 0, sinceYear: null }, "R2-L")).toBe("there is no nearby precedent on record");
    expect(precedentPhrase(null, "R2-L")).toBe("there is no nearby precedent on record");
  });
});

describe("generateSummary", () => {
  it("writes two sentences: by right with cost driver, then with approval and precedent", () => {
    const r = generateSummary(base());
    expect(r.sentences).toHaveLength(2);
    expect(r.sentences[0]).toBe(
      "By right, this lot allows one single-family home, and it pencils at about a 9% margin on current new-home sale comps; the steep slope points to a stepped foundation that pushes cost toward the high end.",
    );
    expect(r.sentences[1]).toBe("A duplex would need a special exception, and nearby requests like this have been mixed (3 of 6 approved in R1D-H since 2019).");
    expect(r.source).toBe("template");
    expect(validateSummary(r.text, base()).ok).toBe(true);
  });

  it("states a gap when the by-right option loses money", () => {
    const i = base();
    i.byRight = { ...i.byRight!, verdict: "no", marginPct: -12, gap: 183_412 };
    const r = generateSummary(i);
    expect(r.sentences[0]).toMatch(/comes up short by about \$183,000/);
    expect(validateSummary(r.text, i).ok).toBe(true);
  });

  it("handles no by-right option, no approval option, missing zoning and red flags", () => {
    const i = base();
    i.byRight = null;
    i.withApproval = null;
    i.redFlags = ["In the FEMA floodway"];
    const r = generateSummary(i);
    expect(r.sentences[0]).toBe("Nothing fits by right under R1D-H zoning in our site check, but a red flag (in the FEMA floodway) blocks building until it is resolved.");
    expect(r.sentences[1]).toBe("Our site check found no larger option that zoning relief would allow.");
    const o = { ...i, district: null, municipality: "Mt. Lebanon" };
    const r2 = generateSummary(o);
    expect(r2.sentences[0]).toMatch(/^Zoning for Mt. Lebanon is not in our data/);
    expect(validateSummary(r2.text, o).ok).toBe(true);
  });

  it("says too few cases under five decided requests", () => {
    const i = base();
    i.withApproval = { ...i.withApproval!, precedent: { granted: 2, decided: 3, sinceYear: 2025 } };
    expect(generateSummary(i).sentences[1]).toMatch(/there are too few nearby cases to judge\.$/);
  });

  it("the fine print is fixed", () => {
    expect(SUMMARY_FINE_PRINT).toBe(
      "Summary of the calculated results. Decision support only, not legal, financial or engineering advice. Confirm zoning with the City and costs with local bids.",
    );
  });
});

describe("rental wording", () => {
  const rental = (): SummaryInput => {
    const i = base();
    i.byRight = { ...i.byRight!, strategyId: "three_four_unit", label: "a 3-unit building", units: 3, tenure: "rent", verdict: "thin", marginPct: 2.3 };
    i.withApproval = null;
    return i;
  };
  it("the template calls a rental's return a yield on cost and passes", () => {
    const r = generateSummary(rental());
    expect(r.text).toMatch(/yield on cost/);
    expect(r.text).not.toMatch(/\bmargin/);
    expect(validateSummary(r.text, rental()).ok).toBe(true);
  });
  it("rejects a draft that calls a rental's yield a margin", () => {
    const v = validateSummary("By right the lot allows a 3-unit rental building with a thin 2% margin on cost, mainly because of the steep slope. No approval option was found.", rental());
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/yield on cost/);
  });
  it("still allows 'margin' when an option is for sale", () => {
    expect(narrative.tenureTermProblems("It pencils at a 9% margin.", base())).toEqual([]);
  });
});

describe("validateSummary", () => {
  it("rejects numbers not in the input", () => {
    const v = validateSummary("By right, one home fits and pencils at about a 14% margin. A duplex would need a special exception.", base());
    expect(v.ok).toBe(false);
    expect(v.numbers).toContain("14%");
  });

  it("rejects district codes not in the input", () => {
    const v = validateSummary("By right, one home fits in R2-L. A duplex would need a special exception.", base());
    expect(v.codes).toContain("R2-L");
    expect(v.ok).toBe(false);
  });

  it("rejects banned words", () => {
    for (const w of ["guaranteed", "definitely", "perfect", "a great deal", "avoid", "impossible", "can't lose", "should buy", "should not buy", "risky"]) {
      const v = validateSummary(`By right, one home fits and it is ${w}. A duplex would need a special exception.`, base());
      expect(v.banned.length, w).toBeGreaterThan(0);
    }
  });

  it("requires exactly two sentences", () => {
    expect(validateSummary("By right, one home fits.", base()).problems[0]).toMatch(/2 sentences/);
  });
});

describe("resolveSummary", () => {
  it("uses the template with no AI", async () => {
    const r = await resolveSummary(base());
    expect(r.source).toBe("template");
  });

  it("keeps a valid AI draft", async () => {
    const text = "By right, this lot fits one single-family home at about a 9% margin; the steep slope is the main cost driver. A duplex would need a special exception, and nearby requests like this have been mixed (3 of 6 approved since 2019).";
    const r = await resolveSummary(base(), async () => text);
    expect(r.source).toBe("ai");
    expect(r.text).toBe(text);
  });

  it("regenerates once, then falls back to the template after 2 failures", async () => {
    const calls: number[] = [];
    const r = await resolveSummary(base(), async (attempt) => {
      calls.push(attempt);
      return "By right, one home pencils at a 30% margin. A duplex is guaranteed.";
    });
    expect(calls).toEqual([1, 2]);
    expect(r.source).toBe("template");
    expect(r.failures).toBe(2);
    expect(r.text).toBe(generateSummary(base()).text);
  });

  it("accepts a second draft after one failure", async () => {
    const good = generateSummary(base()).text.replace("By right, this lot allows", "By right, the lot allows");
    const r = await resolveSummary(base(), async (attempt) => (attempt === 1 ? "Definitely buy it. It pencils at 50%." : good));
    expect(r.source).toBe("ai");
    expect(r.failures).toBe(1);
  });
});

describe("missing inputs", () => {
  it("says what pricing needs when the estimate is incomplete", () => {
    const i = base();
    i.byRight = { ...i.byRight!, strategyId: "rehab_existing", label: "fixing up the existing building", verdict: null, marginPct: null, costDriver: null, costDriverEffect: null, needs: "your rehab cost" };
    const r = generateSummary(i);
    expect(r.sentences[0]).toBe("By right, this lot allows fixing up the existing building, and pricing it needs your rehab cost.");
    expect(validateSummary(r.text, i).ok).toBe(true);
  });
});

describe("summary lead (the visitor's selected option)", () => {
  it("sentence 1 describes the selected option; sentence 2 names the featured by-right option", () => {
    const i = base();
    i.lead = i.withApproval;
    const r = generateSummary(i);
    expect(r.sentences[0]).toBe("A duplex would need a special exception, and it pencils only thinly, at about a 4% margin on current new-home sale comps.");
    expect(r.sentences[1]).toBe("By right, this lot allows one single-family home, and it pencils at about a 9% margin on current new-home sale comps.");
    expect(validateSummary(r.text, i).ok).toBe(true);
  });
});

describe("summary sanitizer", () => {
  const good = () => generateSummary(base()).text;
  it("accepts the template", () => expect(validateSummary(good(), base()).ok).toBe(true));
  it.each([
    ["a stray JSON tail", (t: string) => `${t}"}`],
    ["braces", (t: string) => t.replace("one single-family home", "{one single-family home}")],
    ["brackets", (t: string) => t.replace("a special exception", "[a special exception]")],
    ["unbalanced parentheses", (t: string) => t.replace("(3 of 6", "3 of 6")],
    ["unbalanced quotes", (t: string) => t.replace("By right", "\"By right")],
    ["markdown", (t: string) => `**${t.slice(0, -1)}**.`],
    ["a URL", (t: string) => t.replace("By right,", "By right (see https://example.org),")],
    ["no final period", (t: string) => t.slice(0, -1)],
    ["odd characters", (t: string) => t.replace("By right,", "By right <b>")],
  ])("rejects %s and falls back to the template", async (_n, mutate) => {
    const bad = mutate(good());
    expect(validateSummary(bad, base()).ok).toBe(false);
    const r = await resolveSummary(base(), async () => bad, 2);
    expect(r.source).toBe("template");
  });
});
