import type { ReactNode } from "react";
import "./seats.css";

/**
 * Honest empty state. With `dataset`, the title reads "<dataset> not loaded yet" (never fake numbers in
 * its place). Without it, pass your own `title` (e.g. "No parcels match these filters").
 */
export default function EmptyState({ dataset, title, children, action, tone = "pending", compact = false }: {
  /** e.g. "Census income data" → "Census income data not loaded yet". */
  dataset?: string;
  title?: ReactNode;
  /** One or two plain sentences: what's missing and what still works. */
  children?: ReactNode;
  /** A button or link, e.g. "Clear filters". */
  action?: ReactNode;
  /** pending = data not loaded; empty = nothing matches; error = failed to load. */
  tone?: "pending" | "empty" | "error";
  /** Smaller, inline variant for cards and table cells. */
  compact?: boolean;
}) {
  const heading = title ?? (dataset ? `${dataset} not loaded yet` : "Nothing to show yet");
  return (
    <div className={`es-empty es-empty-${tone}${compact ? " is-compact" : ""}`} role={tone === "error" ? "alert" : "status"}>
      <svg className="es-empty-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        {tone === "error"
          ? <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.4v.1" /></>
          : tone === "empty"
            ? <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5M8.5 11h5" /></>
            : <><ellipse cx="12" cy="6" rx="7.5" ry="2.8" /><path d="M4.5 6v6c0 1.5 3.4 2.8 7.5 2.8M19.5 6v4M4.5 12v6c0 1.5 3.4 2.8 7.5 2.8" /><path d="M16.5 15.5h5M19 13v5" strokeDasharray="0" /></>}
      </svg>
      <div>
        <p className="es-empty-title">{heading}</p>
        {children ? <div className="es-empty-body">{children}</div> : null}
        {action ? <div className="es-empty-action">{action}</div> : null}
      </div>
    </div>
  );
}
