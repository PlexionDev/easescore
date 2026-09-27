import "./seats.css";
import { score as es } from "@easescore/engine";

export type Band = "Easy" | "Moderate" | "Hard" | "Very hard";

const CLASS: Record<Band, string> = { Easy: "easy", Moderate: "moderate", Hard: "hard", "Very hard": "veryhard" };

/**
 * Ease Score band pill: the stored band code shown as its label ("Few barriers" … "Major barriers");
 * "Partial" (zoning not loaded, no numeric score) and anything else show grey.
 */
export default function BandPill({ band, score }: { band: string | null | undefined; score?: number | null }) {
  const known = band && band in CLASS ? (band as Band) : null;
  const partial = band === es.PARTIAL;
  return (
    <span className={`es-band es-band-${known ? CLASS[known] : "none"}`} title={partial ? "Partial screen, no numeric score: zoning not loaded here, or the score did not see a building on the lot" : undefined}>
      {score != null ? <span className="es-sr">Score {score}, </span> : null}
      {known ? es.bandLabel(known) : partial ? "Partial" : "No score"}
    </span>
  );
}
