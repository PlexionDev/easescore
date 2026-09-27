"use client";

// 7. The two-sentence summary and its fine print. Shows the template at once; asks /api/summary for
// an AI rewording, which the server only returns after it passes the number, code and banned-word checks.

import { useEffect, useState } from "react";
import { narrative } from "@easescore/engine";

export default function SummaryText({ input, template }: { input: narrative.SummaryInput; template: narrative.SummaryResult }) {
  const [r, setR] = useState(template);
  const key = JSON.stringify(input);
  useEffect(() => {
    setR(template);
    const ctl = new AbortController();
    fetch("/api/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }), signal: ctl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((x: narrative.SummaryResult | null) => {
        if (x && x.source === "ai" && typeof x.text === "string") setR(x);
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section aria-label="Summary">
      <p className="text-[15px] leading-snug text-slate-900">{r.sentences[0]} {r.sentences[1]}</p>
      <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{narrative.SUMMARY_FINE_PRINT}</p>
      {r.source === "ai" && <p className="text-[10px] text-slate-400">Worded by AI from the calculated results; every number checked against them.</p>}
    </section>
  );
}
