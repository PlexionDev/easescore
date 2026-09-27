"use client";

import { useState } from "react";

/**
 * The report query with the Pro forma edits made since the page loaded: budget lines, tier and tenure
 * (pf_*) and decision-box criteria (dc_*) live in the page URL (history.replaceState), so the server-built
 * query can be stale. The page URL's pf_* / dc_* replace the query's.
 */
export function liveReportQuery(query: string): string {
  const qp = new URLSearchParams(query.replace(/^\?/, ""));
  try {
    const cur = new URL(window.location.href).searchParams;
    for (const k of [...qp.keys()]) if (k.startsWith("pf_") || k.startsWith("dc_")) qp.delete(k);
    for (const [k, v] of cur) if (k.startsWith("pf_") || k.startsWith("dc_")) qp.set(k, v);
    const t = cur.get("pf_tenure");
    if (t === "sale" || t === "rent") qp.set("tenure", t);
  } catch { /* no window URL */ }
  return qp.toString();
}

/** "Feasibility study" link that opens the report with the current Pro forma edits (see liveReportQuery). */
export function ReportLink({ parid, query, className, children }: { parid: string; query: string; className?: string; children: React.ReactNode }) {
  const base = `/parcel/${encodeURIComponent(parid)}/report`;
  const fresh = (e: React.SyntheticEvent<HTMLAnchorElement>) => {
    const q = liveReportQuery(query);
    e.currentTarget.href = `${base}${q ? `?${q}` : ""}`;
  };
  return (
    <a href={`${base}${query ? `?${query}` : ""}`} target="_blank" rel="noopener" className={className} onClick={fresh} onAuxClick={fresh} onFocus={fresh} onMouseEnter={fresh} onContextMenu={fresh}>
      {children}
    </a>
  );
}

/**
 * "Download Feasibility Study (PDF)" button.
 *
 * - `query`: the parcel page's scenario query string (same keys the report reads: type, units,
 *   stories, strategy, goal, tenure, affordable, ...). Pass `useSearchParams().toString()`.
 * - `getImages`: optional; returns data URLs from the map's "Capture view" for the figure slots.
 *   When given, the PDF is requested with POST so the images travel in the body, not the URL.
 */
export default function DownloadReport({
  parid,
  query = "",
  getImages,
  className,
  label = "Download Feasibility Study (PDF)",
  hint = "About 35 pages. Takes a few seconds.",
  variant = "primary",
}: {
  parid: string;
  query?: string;
  getImages?: () => Promise<{ context?: string; terrain?: string; analysis?: string }>;
  className?: string;
  label?: string;
  hint?: string | null;
  variant?: "primary" | "secondary";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const q = liveReportQuery(query);
      const url = `/api/report/${encodeURIComponent(parid)}${q ? `?${q}` : ""}`;
      const images = getImages ? await getImages() : undefined;
      const res = images
        ? await fetch(`/api/report/${encodeURIComponent(parid)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: q, images }),
          })
        : await fetch(url);
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `EaseScore-Feasibility-${parid}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={download}
        disabled={busy}
        aria-busy={busy}
        className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-70 ${variant === "primary" ? "bg-slate-900 text-white hover:bg-slate-800" : "border border-slate-300 bg-white text-slate-800 hover:border-slate-500"}`}
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
          <path d="M10 2a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42L9 11.6V3a1 1 0 0 1 1-1Zm-7 13a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z" />
        </svg>
        {busy ? "Preparing the study…" : label}
      </button>
      {(error || hint) && (
        <p className="mt-1 text-[11px] text-slate-500">
          {error ? <span className="text-red-700">{`Could not create the PDF: ${error}`}</span> : hint}
        </p>
      )}
    </div>
  );
}
