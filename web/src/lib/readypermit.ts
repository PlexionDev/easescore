// Optional link from the Developer seat to ReadyPermit. Off unless NEXT_PUBLIC_READYPERMIT_URL is set:
// with it unset, readyPermitHref() returns null and nothing renders. A plain link (new tab, noopener
// noreferrer): EaseScore sends nothing to ReadyPermit's servers. The URL carries only the parcel ID,
// the street address and the project type; never owner, contact or any other personal data.

import { titleCase } from "./planner-query";

/** Base URL. Empty: the link is off. */
export const READYPERMIT_URL = (process.env.NEXT_PUBLIC_READYPERMIT_URL ?? "").trim();

/** Query parameter names ReadyPermit reads. */
export const READYPERMIT_PARAMS = { parcel: "parcel", address: "address", project: "project" } as const;

export type ReadyPermitProject = "addition" | "deck" | "adu_detached";

/** Project types ReadyPermit supports today; the link shows only for these. */
export const SUPPORTED_PROJECTS: readonly ReadyPermitProject[] = ["addition", "deck"];

/**
 * Mapped but disabled. adu_detached: enable when the citywide ADU bill passes and ReadyPermit adds
 * those rules (move it into SUPPORTED_PROJECTS).
 */
export const PENDING_PROJECTS: readonly ReadyPermitProject[] = ["adu_detached"];

/**
 * What the user chose in EaseScore, to a ReadyPermit project slug. In order:
 *   Process checklist "Project type" (?type=):  addition -> addition
 *   Process checklist "Smaller work" (?minor_work=):  deck -> deck
 *   Selected option (?strategy= or the best option):  adu (backyard unit) -> adu_detached
 * Anything else (new single-family, duplex, townhouse row, 3-4 units, rehab, other smaller work) has no slug.
 */
export const CHECKLIST_TYPE_TO_PROJECT: Readonly<Record<string, ReadyPermitProject>> = { addition: "addition" };
export const MINOR_WORK_TO_PROJECT: Readonly<Record<string, ReadyPermitProject>> = { deck: "deck" };
export const STRATEGY_TO_PROJECT: Readonly<Record<string, ReadyPermitProject>> = { adu: "adu_detached" };

/** The project slug for the user's choices, or null when none maps. Does not check support. */
export function permitProject(o: { type?: string | null; minorWork?: string | null; strategy?: string | null }): ReadyPermitProject | null {
  return (o.type && CHECKLIST_TYPE_TO_PROJECT[o.type]) || (o.minorWork && MINOR_WORK_TO_PROJECT[o.minorWork]) || (o.strategy && STRATEGY_TO_PROJECT[o.strategy]) || null;
}

export const READYPERMIT_LABEL = "Get permit-ready with ReadyPermit";
export const READYPERMIT_LINE = "ReadyPermit walks you through the permits you need and builds a ready-to-submit application.";

/**
 * The County street address in title case; a lot with no house number (or "0") gives the street alone;
 * none on record gives null.
 */
export function permitAddress(raw: string | null | undefined): string | null {
  const a = (raw ?? "").trim();
  if (!a) return null;
  const m = /^(\d+[A-Z]?)\s+(.*)$/i.exec(a);
  return titleCase(m && /^0+$/.test(m[1]!) ? m[2]! : a) || null;
}

/**
 * The ReadyPermit link for a parcel, or null to hide it: no base URL configured, not a City of
 * Pittsburgh parcel (ReadyPermit's coverage), or no supported project type.
 */
export function readyPermitHref(o: { parid: string; address: string | null; project: ReadyPermitProject | null; isCity: boolean }): string | null {
  if (!READYPERMIT_URL || !o.isCity || !o.project || !SUPPORTED_PROJECTS.includes(o.project)) return null;
  let url: URL;
  try {
    url = new URL(READYPERMIT_URL);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.searchParams.set(READYPERMIT_PARAMS.parcel, o.parid.trim());
  if (o.address) url.searchParams.set(READYPERMIT_PARAMS.address, o.address);
  url.searchParams.set(READYPERMIT_PARAMS.project, o.project);
  return url.toString();
}
