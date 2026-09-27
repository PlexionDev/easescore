import type { ReactNode } from "react";
import "./seats.css";

export type DataDate = {
  /** Dataset name, e.g. "Allegheny County assessments". */
  name: string;
  /** Vintage or as-of date, e.g. "Sep 2026" or "ACS 2019–2023". */
  date: string;
  url?: string;
};

/**
 * Quiet footer listing the data dates behind the page, plus the standing disclaimer.
 * Use at the bottom of the main column (SeatLayout `footer` prop) or inside a rail.
 */
export default function DataDateFooter({ sources, note, methodsHref = "/methods" }: {
  sources: DataDate[];
  /** One extra plain sentence, e.g. "Scores computed Sep 26, 2026 with engine v0.2". */
  note?: ReactNode;
  methodsHref?: string;
}) {
  return (
    <footer className="es-datefoot">
      <p className="es-datefoot-title">Data dates</p>
      {sources.length ? (
        <ul>
          {sources.map((s) => (
            <li key={s.name}>
              {s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.name}</a> : <span>{s.name}</span>}
              <span className="es-datefoot-date">{s.date}</span>
            </li>
          ))}
        </ul>
      ) : <p className="es-datefoot-none">No datasets loaded for this view yet.</p>}
      {note ? <p className="es-datefoot-note">{note}</p> : null}
      <p className="es-datefoot-note">
        Decision support only. Not legal, financial or zoning advice. <a href={methodsHref}>Methods</a> · <a href="/limitations">Limitations</a>
      </p>
    </footer>
  );
}
