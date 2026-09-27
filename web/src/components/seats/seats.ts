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
 * - Developer opens its workspace on the selection's neighborhood and chosen lots (?hoods=, ?ids=), with
 *   the focused parcel open in the pane (?parcel=<id>), if any.
 * - Nonprofit reopens the selection's neighborhood and chosen lots (?hood=, ?lots=, at most 6).
 * - The other seats read the shared selection on mount, so their links stay plain paths.
 * Neighborhood names and public parcel ids only; nothing personal goes into a URL.
 */
export function seatHref(id: SeatId, sel: SeatSelection): string {
  const hood = sel.neighborhood;
  const lots = sel.parids ?? [];
  switch (id) {
    case "planner": return "/planner";
    case "policy": return "/policy";
    case "nonprofit": {
      if (!hood) return "/nonprofit";
      const q = new URLSearchParams({ hood });
      if (lots.length) q.set("lots", lots.slice(0, 6).join(","));
      return `/nonprofit?${q}`;
    }
    case "developer": {
      const q = new URLSearchParams();
      if (hood) {
        q.set("hoods", hood);
        if (lots.length) q.set("ids", lots.join(","));
      }
      if (sel.focus) q.set("parcel", sel.focus);
      return q.size ? `/developer?${q}` : "/developer";
    }
  }
}
