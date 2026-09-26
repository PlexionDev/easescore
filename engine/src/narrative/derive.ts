// Derived figures the narrative is allowed to state. Templates compute from these, and the
// validator adds them to the fact pool, so "derivable from the input JSON" has one definition.

import { mathInWords, roundMoney, type MathSentence, type MathStep } from "./format";
import type { NarrativeFacts, NarrativeProForma } from "./types";

export interface Derived {
  margin: number | null;
  marginPct: number | null;
  annualRent: number | null;
  noi: number | null;
  /** The math sentence for answer 2, when there is one. */
  math: MathSentence | null;
  /** Every derived number (for the validator). */
  values: number[];
}

/** The "does it pencil" arithmetic, shown as a sentence. */
export function proFormaMath(p: NarrativeProForma): MathSentence | null {
  if (p.tenure === "sale" && p.value != null) {
    return mathInWords({ value: p.value, label: "value" }, [
      { op: "minus", term: { value: p.totalCost, label: "cost" }, resultLabel: p.value >= p.totalCost ? "left over" : "short" },
    ]);
  }
  if (p.tenure === "rent" && p.monthlyRent != null) {
    const steps: MathStep[] = [{ op: "times", term: { value: 12, money: false }, resultLabel: "a year" }];
    if (p.annualOpex != null) {
      steps.push({ op: "minus", term: { value: p.annualOpex, label: "in costs" }, resultLabel: "left to pay the loan" });
    }
    return mathInWords({ value: p.monthlyRent, lead: "Rent" }, steps);
  }
  return null;
}

export function derive(facts: NarrativeFacts): Derived {
  const values: number[] = [];
  const p = facts.proForma ?? null;
  let margin: number | null = null;
  let marginPct: number | null = null;
  let annualRent: number | null = null;
  let noi: number | null = null;
  let math: MathSentence | null = null;
  if (p) {
    if (p.margin != null) margin = p.margin;
    else if (p.value != null) margin = p.value - p.totalCost;
    if (p.marginPct != null) marginPct = p.marginPct;
    else if (margin != null && p.totalCost > 0) marginPct = (margin / p.totalCost) * 100;
    if (p.monthlyRent != null) {
      annualRent = p.monthlyRent * 12;
      values.push(12);
    }
    if (p.noi != null) noi = p.noi;
    else if (annualRent != null && p.annualOpex != null) noi = annualRent - p.annualOpex;
    math = proFormaMath(p);
    for (const v of [margin, marginPct, annualRent, noi]) if (v != null) values.push(v);
    // Rounded-then-subtracted margin, which is what the math sentence shows.
    if (p.value != null) values.push(roundMoney(p.value) - roundMoney(p.totalCost));
    if (math) values.push(...math.values);
  }
  return { margin, marginPct, annualRent, noi, math, values };
}
