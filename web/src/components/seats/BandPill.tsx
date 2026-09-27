import "./seats.css";

export type Band = "Easy" | "Moderate" | "Hard" | "Very hard";

const CLASS: Record<Band, string> = { Easy: "easy", Moderate: "moderate", Hard: "hard", "Very hard": "veryhard" };

/** Ease Score band pill ("Easy", "Moderate", "Hard", "Very hard"); anything else shows a grey "No score". */
export default function BandPill({ band, score }: { band: string | null | undefined; score?: number | null }) {
  const known = band && band in CLASS ? (band as Band) : null;
  return (
    <span className={`es-band es-band-${known ? CLASS[known] : "none"}`}>
      {score != null ? <span className="es-sr">Score {score}, </span> : null}
      {known ?? "No score"}
    </span>
  );
}
