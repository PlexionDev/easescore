"use client";

// Parcel ID with a copy button; screen readers hear "Copied" when it works. Also links to the county's
// Real Estate portal. The portal has no deep link to a parcel, so the link copies the ID for its search box.

import { useState } from "react";

const COUNTY_PORTAL = "https://realestate.alleghenycounty.us/search";

export default function CopyParcelId({ parid }: { parid: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(parid);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  };
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
      <span>Parcel ID <span className="font-mono tabular-nums text-slate-800">{parid}</span></span>
      <button type="button" onClick={copy} aria-label={`Copy parcel ID ${parid}`}
        className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
        {state === "copied" ? "Copied" : "Copy"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : ""}</span>
      <a href={COUNTY_PORTAL} target="_blank" rel="noopener noreferrer" onClick={() => { void copy(); }}
        title="Opens the county portal and copies this parcel ID; paste it into the portal's Parcel ID search."
        className="text-[11px] font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900">
        View on the Allegheny County Real Estate portal<span className="sr-only"> (opens in a new tab; parcel ID copied for its search)</span> ↗
      </a>
    </p>
  );
}
