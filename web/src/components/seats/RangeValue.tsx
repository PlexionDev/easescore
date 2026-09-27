import { formatter, orderRange, roundRange, type Range, type RangeFormat } from "./format";
import "./seats.css";

/**
 * An estimate as a range: "2,900 to 3,600" with "likely 3,200" beneath. Rounded to 2 significant figures
 * by default (one step for the whole range), always ordered low ≤ likely ≤ high. `null` shows a dash with
 * a screen-reader "not available".
 */
export default function RangeValue({ value, format = "count", sig = 2, signed = false, size = "md", showLikely = true, unit, label }: {
  value: Range | null | undefined;
  format?: RangeFormat;
  /** Significant figures; false = show as given. */
  sig?: number | false;
  /** Prefix "+" on positive values (deltas like "+2,900 homes"). */
  signed?: boolean;
  /** sm = table cell, md = card, lg = headline number. */
  size?: "sm" | "md" | "lg";
  showLikely?: boolean;
  /** Trailing unit, e.g. "homes" or "/ yr". */
  unit?: string;
  /** Accessible prefix, e.g. "More homes allowed by right". */
  label?: string;
}) {
  if (!value) {
    return <span className={`es-range es-range-${size} is-na`}><span aria-hidden="true">—</span><span className="es-sr">{label ? `${label}: ` : ""}not available</span></span>;
  }
  const r = sig === false ? (([low, likely, high]) => ({ low, likely, high }))(orderRange(value)) : roundRange(value, sig);
  const f = formatter(format);
  const s = (n: number) => (signed && n > 0 ? `+${f(n)}` : f(n));
  const single = r.low === r.high;
  const sep = format === "money" ? "–" : " to ";
  const spoken = single ? s(r.likely) : `${s(r.low)} to ${f(r.high)}, likely ${f(r.likely)}`;
  return (
    <span className={`es-range es-range-${size}`}>
      <span className="es-sr">{label ? `${label}: ` : ""}{spoken}{unit ? ` ${unit}` : ""}</span>
      <span aria-hidden="true">
        <span className="es-range-main">
          {single ? s(r.likely) : <>{s(r.low)}<span className="es-range-sep">{sep}</span>{f(r.high)}</>}
          {unit ? <span className="es-range-unit"> {unit}</span> : null}
        </span>
        {showLikely && !single ? <span className="es-range-likely">likely {f(r.likely)}</span> : null}
      </span>
    </span>
  );
}
