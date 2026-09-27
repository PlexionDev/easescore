// The four Track 1 seats. Every seat page shows all four in the header switcher.

import type { SeatSelection } from "./selection";

export type SeatId = "planner" | "developer" | "nonprofit" | "policy";

export type Seat = {
  id: SeatId;
  /** Label in the switcher. */
  label: string;
  /** Short label for narrow screens. */
  short: string;
  /** What the seat is for (tooltip and screen-reader description). */
  job: string;
};

export const SEATS: readonly Seat[] = [
  { id: "planner", label: "Municipal Planner", short: "Planner", job: "Compare and rank sites" },
  { id: "developer", label: "Developer", short: "Developer", job: "Find and check lots" },
  { id: "nonprofit", label: "Nonprofit / CDC", short: "Nonprofit", job: "Plan affordable homes" },
  { id: "policy", label: "Policy Analyst", short: "Policy", job: "Test a rule change" },
];

/** Which seat a pathname belongs to (null for pages outside the four seats). */
export function seatFromPath(pathname: string | null | undefined): SeatId | null {
  if (!pathname) return null;
  if (pathname.startsWith("/planner")) return "planner";
  if (pathname.startsWith("/nonprofit")) return "nonprofit";
  if (pathname.startsWith("/policy")) return "policy";
  if (pathname.startsWith("/developer")) return "developer";
  return null;
}

/**
 * Where a seat link goes, keeping context where it makes sense:
 * - Developer opens its workspace with the focused parcel open in the pane (?parcel=<id>), if any.
 * - The other seats read the shared selection on mount (municipality / neighborhood), so their links
 *   stay plain paths; nothing personal goes into a URL.
 */
export function seatHref(id: SeatId, sel: SeatSelection): string {
  switch (id) {
    case "planner": return "/planner";
    case "nonprofit": return "/nonprofit";
    case "policy": return "/policy";
    case "developer": {
      const p = sel.focus;
      return p ? `/developer?parcel=${p}` : "/developer";
    }
  }
}
