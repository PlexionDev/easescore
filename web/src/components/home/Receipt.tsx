"use client";

import type { MouseEvent, ReactNode } from "react";
import { useInfoDialog } from "./InfoDialog";

// English text for the keyed lookups below.
const TEXT: Record<string, string> = {
  "rc.steep.name": "Steep land share",
  "rc.steep.source": "Terrain mask / parcel intersection",
  "rc.steep.note": "USGS lidar and a verified parcel boundary would be required.",
  "rc.slope.name": "Average slope",
  "rc.slope.source": "Slope aggregation across the parcel",
  "rc.slope.note": "The averaging method and terrain date must be supplied.",
  "rc.transit.name": "Frequent transit distance",
  "rc.transit.source": "Transit stop distance",
  "rc.transit.note": "Stop data, service frequency, date and distance method must be supplied.",
  "rc.zoning.name": "Zoning",
  "rc.zoning.source": "City zoning code and district map",
  "rc.zoning.note": "The district, applicable code sections and factor calculation must be supplied.",
  "rc.terrain.name": "Terrain",
  "rc.terrain.source": "USGS 1-meter lidar",
  "rc.terrain.note": "A dated terrain surface, slope calculation and scoring rule must be supplied.",
  "rc.hazards.name": "Hazards",
  "rc.hazards.source": "Flood, mine and landslide records",
  "rc.hazards.note": "The mapped intersections, dataset dates and hazard rules must be supplied.",
  "rc.access.name": "Access",
  "rc.access.source": "Transportation and access records",
  "rc.access.note": "The access inputs and calculation must be supplied.",
  "rc.approvals.name": "Approvals",
  "rc.approvals.source": "Permitting requirements and decisions",
  "rc.approvals.note": "The applicable approval path, code sections and dated decisions must be supplied.",
};

// Illustrative receipts for the example card: [displayed value]; name, source and note are in TEXT
// (rc.<key>.*). They describe what a real receipt cites; no parcel is behind them.
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
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        const value = RECEIPTS[id];
        show(`${TEXT[`rc.${id}.name`]} · Source receipt`, (
          <>
            <span className="tag">Illustrative value · Unverified</span>
            <dl>
              <dt>Displayed value</dt><dd>{value}</dd>
              <dt>Value origin</dt><dd>Illustrative example on this page</dd>
              <dt>Source needed</dt><dd>{TEXT[`rc.${id}.source`]}</dd>
              <dt>Source date</dt><dd>Not supplied</dd>
            </dl>
            <p>{TEXT[`rc.${id}.note`]}</p>
            <p>This demonstrates a source receipt. It is not evidence about any real parcel.</p>
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
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("example-parcel")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
    setTimeout(() => document.querySelector<HTMLElement>(".score-row")?.focus({ preventScroll: true }), 50);
  };
  return (
    <a className="report-link" href="#example-parcel" onClick={onClick}>
      {"Open the full report"} <span aria-hidden="true">↗</span>
    </a>
  );
}
