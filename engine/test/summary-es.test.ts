import { describe, expect, it } from "vitest";
import { narrative } from "../src";

const { generateSummary, validateSummary, resolveSummary, precedentPhraseEs, labelEs, approvalEs, extractNumbers } = narrative;
type SummaryInput = narrative.SummaryInput;

// Synthetic inputs only: neutral ids, no addresses. Same shape the web builds (English phrases).
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
    costDriverEffect: "points to a stepped foundation and retaining walls that add about $42,000",
  },
  withApproval: {
    strategyId: "duplex",
    label: "a duplex (two homes)",
    units: 2,
    tenure: "sale",
    verdict: "thin",
    marginPct: 4.1,
    gap: null,
    costDriver: null,
    costDriverEffect: null,
    approval: "a special exception and a variance for the front setback and minimum lot area",
    reliefType: "special_exception",
    precedent: { granted: 3, decided: 6, sinceYear: 2019 },
  },
  redFlags: [],
});

describe("Spanish summary template", () => {
  it("writes two Spanish sentences from the same JSON, code terms in English with Spanish beside", () => {
    const r = generateSummary(base(), "es");
    expect(r.sentences).toEqual([
      "By right (por derecho), este lote permite una casa unifamiliar, y las cuentas salen, con un margen de alrededor del 9% según las ventas actuales de casas nuevas comparables; la pendiente pronunciada indica una cimentación escalonada y muros de contención que suman unos $42,000.",
      "Un dúplex (dos viviendas) necesitaría una special exception (excepción especial) y una variance (variación) para front setback (retiro frontal) y área mínima del lote, y las solicitudes cercanas como esta han tenido resultados mixtos (3 de 6 aprobadas en R1D-H desde 2019).",
    ]);
    expect(r.source).toBe("template");
  });

  it("the Spanish template passes the validator (numbers, codes, banned words, prose)", () => {
    const i = base();
    expect(validateSummary(generateSummary(i, "es").text, i, "es")).toMatchObject({ ok: true });
  });

  it("covers gap, red flag, no zoning, no approval option and rentals, and each passes", () => {
    const cases: SummaryInput[] = [];
    const gap = base();
    gap.byRight = { ...gap.byRight!, verdict: "no", gap: 23400, marginPct: -6 };
    cases.push(gap);
    const flag = base();
    flag.redFlags = ["In the FEMA floodway"];
    cases.push(flag);
    const noZoning = { ...base(), district: null, municipality: "Example Borough", byRight: null, withApproval: null };
    cases.push(noZoning);
    const rent = base();
    rent.byRight = { ...rent.byRight!, strategyId: "three_four_unit", label: "a 4-unit building", units: 4, tenure: "rent", marginPct: 6.2, costDriver: "construction", costDriverEffect: "at about $265 per finished sq ft is the main cost" };
    rent.withApproval = null;
    cases.push(rent);
    const needs = base();
    needs.byRight = { ...needs.byRight!, strategyId: "rehab_existing", label: "fixing up the existing building", verdict: null, marginPct: null, needs: "your rehab cost", costDriver: null, costDriverEffect: null };
    cases.push(needs);
    for (const c of cases) {
      const r = generateSummary(c, "es");
      const v = validateSummary(r.text, c, "es");
      expect(v, r.text).toMatchObject({ ok: true });
    }
    expect(generateSummary(gap, "es").sentences[0]).toContain("le faltan unos $23,400");
    expect(generateSummary(flag, "es").sentences[0]).toContain("alerta roja (está en el floodway (cauce de inundación) de FEMA)");
    expect(generateSummary(noZoning, "es").sentences[0]).toBe("La zonificación de Example Borough no está en nuestros datos, así que lo que se permite by right (por derecho) debe confirmarse con Example Borough.");
    expect(generateSummary(rent, "es").sentences[0]).toContain("un rendimiento sobre el costo de alrededor del 6%");
    expect(generateSummary(needs, "es").sentences[0]).toContain("se necesita su costo de rehabilitación");
  });

  it("uses the same precedent thresholds as English", () => {
    expect(precedentPhraseEs({ granted: 7, decided: 10, sinceYear: 2025 }, "R2-L")).toBe("las solicitudes cercanas como esta por lo general se han aprobado (7 de 10 aprobadas en R2-L desde 2025)");
    expect(precedentPhraseEs({ granted: 3, decided: 10, sinceYear: null }, null)).toMatch(/por lo general se han negado/);
    expect(precedentPhraseEs({ granted: 4, decided: 4, sinceYear: null }, null)).toBe("hay muy pocos casos cercanos para juzgar");
    expect(precedentPhraseEs(null, null)).toBe("no hay precedentes cercanos registrados");
  });

  it("never leaves an unknown English phrase in the Spanish text", () => {
    expect(labelEs("a castle")).toBe("esta opción");
    expect(approvalEs("a rezoning")).toBe("una aprobación de zonificación");
    expect(approvalEs("a variance for the parking")).toBe("una variance (variación) de las reglas de tamaño");
    const i = base();
    i.byRight = { ...i.byRight!, costDriver: "something new", costDriverEffect: "adds about $9,000" };
    expect(generateSummary(i, "es").sentences[0]).not.toMatch(/something new/);
  });
});

describe("Spanish validator", () => {
  it("rejects a number not in the input, in digits or Spanish words", () => {
    const i = base();
    expect(validateSummary("By right (por derecho), este lote permite una casa unifamiliar con un margen del 15%. Un dúplex necesitaría una special exception (excepción especial).", i, "es").numbers).toEqual(["15%"]);
    expect(validateSummary("By right (por derecho), este lote permite siete casas. Un dúplex necesitaría una special exception (excepción especial).", i, "es").numbers).toEqual(["siete"]);
    expect(validateSummary("By right (por derecho), este lote permite dos viviendas. Un dúplex necesitaría una special exception (excepción especial).", i, "es").numbers).toEqual([]);
  });

  it("reads Spanish number forms", () => {
    expect(extractNumbers("unos $42 mil y un 9 por ciento", "es").map((t) => [t.value, t.percent])).toEqual([[42000, false], [9, true]]);
    // "once" is only a number in Spanish text.
    expect(extractNumbers("once approved", "en")).toEqual([]);
    expect(extractNumbers("once casas", "es").map((t) => t.value)).toEqual([11]);
  });

  it("rejects district codes not in the input", () => {
    expect(validateSummary("By right (por derecho), este lote permite una casa unifamiliar. En RM-M se permite más.", base(), "es").codes).toEqual(["RM-M"]);
  });

  it("rejects Spanish banned words", () => {
    const i = base();
    const bad = (w: string) => validateSummary(`By right (por derecho), este lote permite una casa unifamiliar ${w}. Un dúplex necesitaría una special exception (excepción especial).`, i, "es").banned;
    expect(bad("y es una ganga")).toContain("gran oferta / ganga");
    expect(bad("con ganancia garantizada")).toContain("garantizado");
    expect(bad("y usted debería comprar")).toContain("debería comprar / no comprar");
    expect(bad("pero es riesgoso")).toContain("riesgoso");
    expect(bad("y es perfecto")).toContain("perfecto");
    expect(bad("que conviene evitar")).toContain("evitar");
    expect(bad("en un lote tranquilo")).toEqual([]);
  });

  it("calls a rental's return a yield on cost, never a margin", () => {
    const i = base();
    i.byRight = { ...i.byRight!, tenure: "rent" };
    i.withApproval = { ...i.withApproval!, tenure: "rent" };
    const v = validateSummary("By right (por derecho), este lote permite una casa unifamiliar con un margen del 9%. Un dúplex necesitaría una special exception (excepción especial).", i, "es");
    expect(v.problems.join(" ")).toMatch(/rendimiento sobre el costo/);
  });

  it("the prose sanitizer runs on Spanish text (accents, ¿ ¡ allowed; markdown, URLs rejected)", () => {
    const i = base();
    const ok = "By right (por derecho), este lote permite una casa unifamiliar. ¿Un dúplex? Necesitaría una special exception (excepción especial).";
    expect(validateSummary(ok, i, "es").problems).toContain("expected 2 sentences, got 3");
    const md = "**By right**, este lote permite una casa unifamiliar. Un dúplex necesitaría más, vea easescore.ai.";
    expect(validateSummary(md, i, "es").problems).toEqual(expect.arrayContaining(["markdown", "URL"]));
    const accentEnd = "By right (por derecho), este lote permite una casa unifamiliar y un dúplex. Un dúplex necesitaría una aprobación que aún no está.";
    expect(validateSummary(accentEnd, i, "es").problems).toEqual([]);
  });
});

describe("resolveSummary in Spanish", () => {
  it("keeps a valid Spanish AI draft and falls back to the Spanish template after 2 failures", async () => {
    const i = base();
    const good = "By right (por derecho), este lote permite una casa unifamiliar con un margen de alrededor del 9%. Un dúplex necesitaría una special exception (excepción especial), y los casos cercanos han sido mixtos (3 de 6 aprobadas).";
    const r = await resolveSummary(i, async () => good, 2, "es");
    expect(r).toMatchObject({ source: "ai", failures: 0, text: good });
    const bad = await resolveSummary(i, async () => "Este lote es una ganga con un margen del 30%. Compre ya.", 2, "es");
    expect(bad).toMatchObject({ source: "template", failures: 2 });
    expect(bad.text).toBe(generateSummary(i, "es").text);
  });

  it("English stays the default", () => {
    expect(generateSummary(base()).sentences[0]).toMatch(/^By right, this lot allows one single-family home/);
  });
});
