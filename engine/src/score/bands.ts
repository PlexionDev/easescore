// Ease Score band words shown to people. Stored data (parcel_scores, parcel_pane, the config) keeps the
// short band codes ("Easy", "Moderate", "Hard", "Very hard"); every screen, export and report maps a code
// to its label here, so the words live in one place.

import type { Band } from "./types";
import { isCityParcel } from "./adapter";

export const BAND_LABEL: Record<Band, string> = {
  Easy: "Few barriers",
  Moderate: "Some barriers",
  Hard: "Significant barriers",
  "Very hard": "Major barriers",
};

/** Band codes in order, fewest barriers first. */
export const BAND_CODES: Band[] = ["Easy", "Moderate", "Hard", "Very hard"];

/** Label for parcels whose municipality's zoning is not loaded (no numeric score). */
export const PARTIAL = "Partial";

/** Caption under every displayed score. */
export const SCORE_CAPTION = "Measures barriers to building, not whether it's a good investment.";

/** "Easy" → "Few barriers"; "Partial" stays; null/unknown → fallback. */
export function bandLabel(band: string | null | undefined, fallback = "No score"): string {
  if (!band) return fallback;
  return (BAND_LABEL as Record<string, string>)[band] ?? band;
}

/** Replace band codes inside stored text ("Capped at Hard: …") with the labels. */
export function relabelBands(text: string): string {
  return text.replace(/\b(Capped at |at )(Very hard|Easy|Moderate|Hard)\b/g, (_m, pre: string, b: Band) => `${pre}${BAND_LABEL[b]}`);
}

/**
 * Is the parcel's zoning loaded? The same test the score's zoning factor uses: a City of Pittsburgh
 * parcel with a zoning district whose rules are transcribed. Elsewhere there is no numeric Ease Score.
 */
export function zoningLoaded(facts: unknown): boolean {
  const f = facts as { zoning?: { code?: string | null; rules?: unknown } | null } & Parameters<typeof isCityParcel>[0];
  return !!f && isCityParcel(f) && !!f.zoning?.code && f.zoning.rules != null;
}

/** "Partial screen: zoning not available for Turtle Creek" (municipality in title case). */
export function partialHeadline(municipality: string | null | undefined): string {
  const m = (municipality ?? "").trim();
  const name = m && m === m.toUpperCase() ? m.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : m;
  return `Partial screen: zoning not available for ${name || "this municipality"}`;
}
