"use client";

// Scenario data loop (TODO item 6), browser side: the "Don't use my numbers" toggle, the notice, the
// debounced send, and the "Community median (n=…)" hint for budget lines.
// Privacy: nothing is sent unless collection is on (server flag) AND the visitor unticked "Don't use my
// numbers" next to the notice (opt-in). The choice lives in localStorage only. Requests omit cookies
// and the referrer; the body is parcel + pf_/qf params + a few computed numbers, nothing personal.

import { useEffect, useRef, useState } from "react";
import { maybeSend, PREF_KEY, type MedianRow, type Pref, type ScenarioInput, type ScenarioSummary } from "@/lib/scenarios/core";

// Notice text approved by the owner (TONIGHT-FOR-CODE A8), verbatim.
const NOTICE =
  "Scenarios you model help improve EaseScore's estimates. We keep the property and the numbers (like costs per square foot, rents and sale prices), never who entered them: no name, email, IP address or account.";

function readPref(): Pref {
  try {
    const v = window.localStorage.getItem(PREF_KEY);
    return v === "share" || v === "dont" ? v : null;
  } catch {
    return null;
  }
}
function writePref(p: Pref) {
  try {
    if (p) window.localStorage.setItem(PREF_KEY, p); else window.localStorage.removeItem(PREF_KEY);
  } catch { /* storage blocked: the default (send nothing) applies */ }
}

/** Whether collection is on, and community medians (n >= 5) for this parcel's strategy + tier. */
export function useCommunity(parid: string, strategy: string, tier: string | null) {
  const [state, setState] = useState<{ enabled: boolean; medians: Record<string, MedianRow> }>({ enabled: false, medians: {} });
  useEffect(() => {
    const ac = new AbortController();
    const q = new URLSearchParams({ parid, strategy, ...(tier ? { tier } : {}) });
    fetch(`/api/scenarios/community?${q}`, { signal: ac.signal, credentials: "omit" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setState({ enabled: j.enabled === true, medians: j.medians ?? {} }); })
      .catch(() => {});
    return () => ac.abort();
  }, [parid, strategy, tier]);
  return state;
}

/** "Community median $X/SF (n=…)" under a budget line; renders nothing below n = 5 or when collection is off. */
export function CommunityMedian({ m, enabled }: { m: MedianRow | undefined; enabled: boolean }) {
  if (!enabled || !m || m.n < 5) return null;
  return (
    <span className="block text-[11px] text-slate-500" title="Median of numbers other visitors typed for this line (one per lot per day). A suggestion only; our estimate is unchanged.">
      Community median ${Math.round(m.median_per_sf).toLocaleString("en-US")}/SF (n={m.n}{m.scope === "area" ? ", this municipality" : ""})
    </span>
  );
}

/** Toggle + notice + debounced send of the current scenario. */
export function ScenarioShare({ enabled, parid, strategy, scheme, tier, summary, anyEdits, editsKey }: {
  enabled: boolean; parid: string; strategy: string; scheme: string | null; tier: string | null;
  summary: ScenarioSummary; anyEdits: boolean; editsKey: string;
}) {
  const [pref, setPref] = useState<Pref>(null);
  useEffect(() => { setPref(readPref()); }, []);
  const lastSent = useRef<string | null>(null);
  const summaryRef = useRef(summary);
  useEffect(() => { summaryRef.current = summary; }, [summary]);

  useEffect(() => {
    if (!enabled || pref !== "share" || !anyEdits) return;
    const t = window.setTimeout(() => {
      let params: Record<string, string> = {};
      try { params = Object.fromEntries(new URL(window.location.href).searchParams); } catch { return; }
      const payload: ScenarioInput = { parid, strategy, scheme: scheme ?? "none", tier, params, summary: summaryRef.current };
      const key = JSON.stringify(payload.params);
      if (key === lastSent.current) return;
      lastSent.current = key;
      void maybeSend({ enabled, pref, payload, fetchImpl: fetch });
    }, 5000);
    return () => window.clearTimeout(t);
  }, [enabled, pref, anyEdits, editsKey, parid, strategy, scheme, tier]);

  // With collection off, unticking only clears the choice: consent is given next to the notice, never before it.
  const dont = enabled ? pref !== "share" : pref === "dont";
  const set = (p: Pref) => { writePref(p); setPref(p); };
  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 text-[11px] ${enabled && pref == null ? "border-sky-200 bg-sky-50 text-sky-950" : "border-slate-200 bg-slate-50/70 text-slate-600"}`}>
      {enabled
        ? <p>{NOTICE}</p>
        : <p>Your numbers stay in your browser: this site does not collect scenarios.</p>}
      <label className="mt-1 flex items-center gap-1.5 font-medium text-slate-800">
        <input type="checkbox" checked={dont} onChange={(e) => set(e.target.checked ? "dont" : enabled ? "share" : null)} />
        Don&apos;t use my numbers
      </label>
    </div>
  );
}
