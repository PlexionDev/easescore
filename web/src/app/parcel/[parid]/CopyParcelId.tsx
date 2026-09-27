"use client";

// Parcel ID with a copy button; screen readers hear "Copied" when it works.

import { useState } from "react";

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
    <p className="flex items-center gap-2 text-sm text-slate-600">
      <span>Parcel ID <span className="font-mono tabular-nums text-slate-800">{parid}</span></span>
      <button type="button" onClick={copy} aria-label={`Copy parcel ID ${parid}`}
        className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
        {state === "copied" ? "Copied" : "Copy"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : ""}</span>
    </p>
  );
}
