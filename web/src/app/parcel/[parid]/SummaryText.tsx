"use client";

// 7. The two-sentence summary and its fine print. Shows the template at once; asks /api/summary for
// an AI rewording, which the server only returns after it passes the number, code and banned-word checks.
// In Spanish, the template is the engine's Spanish template from the same JSON, and the API is asked
// for Spanish (the same validator runs on it).

import { useEffect, useState } from "react";
import { narrative } from "@easescore/engine";
import { useLocale, useT } from "@/lib/i18n/client";

export default function SummaryText({ input, template }: { input: narrative.SummaryInput; template: narrative.SummaryResult }) {
  const lang = useLocale();
  const t = useT();
  const tpl = lang === "es" ? narrative.generateSummary(input, "es") : template;
  const [r, setR] = useState(tpl);
  const key = JSON.stringify(input);
  useEffect(() => {
    setR(tpl);
    const ctl = new AbortController();
    fetch("/api/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, lang }), signal: ctl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((x: narrative.SummaryResult | null) => {
        if (x && x.source === "ai" && typeof x.text === "string") setR(x);
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [key, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section aria-label={t("summary.aria")}>
      <p className="text-[15px] leading-snug text-slate-900">{r.sentences[0]} {r.sentences[1]}</p>
      <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{lang === "es" ? t("summary.fine") : narrative.SUMMARY_FINE_PRINT}</p>
      {r.source === "ai" && <p className="text-[10px] text-slate-400">{t("summary.ai")}</p>}
    </section>
  );
}
