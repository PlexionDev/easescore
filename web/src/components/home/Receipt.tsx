"use client";

import type { MouseEvent, ReactNode } from "react";
import { useInfoDialog } from "./InfoDialog";
import { useT } from "@/lib/i18n/client";

// Illustrative receipts for the example card: [displayed value]; name, source and note come from the
// dictionary (rc.<key>.*). They describe what a real receipt cites; no parcel is behind them.
const RECEIPTS = {
  steep: "62%",
  slope: "31%",
  transit: "380 m",
  zoning: "70 / 100",
  terrain: "15 / 100",
  hazards: "65 / 100",
  access: "60 / 100",
  approvals: "55 / 100",
} as const;

export type ReceiptKey = keyof typeof RECEIPTS;

/** A fact or factor bar on the example card that opens its source receipt. */
export function ReceiptButton({ id, className, children }: { id: ReceiptKey; className?: string; children: ReactNode }) {
  const show = useInfoDialog();
  const t = useT();
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        const value = RECEIPTS[id];
        show(t("rc.sourceReceipt", { name: t(`rc.${id}.name`) }), (
          <>
            <span className="tag">{t("rc.tag")}</span>
            <dl>
              <dt>{t("rc.displayed")}</dt><dd>{value}</dd>
              <dt>{t("rc.origin")}</dt><dd>{t("rc.originValue")}</dd>
              <dt>{t("rc.sourceNeeded")}</dt><dd>{t(`rc.${id}.source`)}</dd>
              <dt>{t("rc.sourceDate")}</dt><dd>{t("rc.notSupplied")}</dd>
            </dl>
            <p>{t(`rc.${id}.note`)}</p>
            <p>{t("rc.demo")}</p>
          </>
        ));
      }}
    >
      {children}
    </button>
  );
}

/** "Open the full report" on the example card: for now it returns to the example and focuses its first factor. */
export function ExampleReportLink() {
  const t = useT();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("example-parcel")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
    setTimeout(() => document.querySelector<HTMLElement>(".score-row")?.focus({ preventScroll: true }), 50);
  };
  return (
    <a className="report-link" href="#example-parcel" onClick={onClick}>
      {t("ex.reportLink")} <span aria-hidden="true">↗</span>
    </a>
  );
}
