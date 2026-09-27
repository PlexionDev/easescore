"use client";

import type { MouseEvent, ReactNode } from "react";
import { useInfoDialog } from "./InfoDialog";

// Illustrative receipts for the example card. They describe what a real receipt cites; no parcel is behind them.
const RECEIPTS = {
  steep: ["Steep land share", "62%", "Terrain mask / parcel intersection", "USGS lidar and a verified parcel boundary would be required."],
  slope: ["Average slope", "31%", "Slope aggregation across the parcel", "The averaging method and terrain date must be supplied."],
  transit: ["Frequent transit distance", "380 m", "Transit stop distance", "Stop data, service frequency, date and distance method must be supplied."],
  zoning: ["Zoning", "70 / 100", "City zoning code and district map", "The district, applicable code sections and factor calculation must be supplied."],
  terrain: ["Terrain", "15 / 100", "USGS 1-meter lidar", "A dated terrain surface, slope calculation and scoring rule must be supplied."],
  hazards: ["Hazards", "65 / 100", "Flood, mine and landslide records", "The mapped intersections, dataset dates and hazard rules must be supplied."],
  access: ["Access", "60 / 100", "Transportation and access records", "The access inputs and calculation must be supplied."],
  approvals: ["Approvals", "55 / 100", "Permitting requirements and decisions", "The applicable approval path, code sections and dated decisions must be supplied."],
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
        const [name, value, source, note] = RECEIPTS[id];
        show(`${name} · Source receipt`, (
          <>
            <span className="tag">Illustrative value · Unverified</span>
            <dl>
              <dt>Displayed value</dt><dd>{value}</dd>
              <dt>Value origin</dt><dd>Illustrative example on this page</dd>
              <dt>Source needed</dt><dd>{source}</dd>
              <dt>Source date</dt><dd>Not supplied</dd>
            </dl>
            <p>{note}</p>
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
      Open the full report <span aria-hidden="true">↗</span>
    </a>
  );
}
