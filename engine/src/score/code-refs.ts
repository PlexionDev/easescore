// Pittsburgh Zoning Code sections the Ease Score relies on, checked against the official text on
// ecode360 (read in a browser, 2026-09-26). Summaries are in our own words.

export const CODE_URL = {
  useTable: "https://ecode360.com/45476524", // §911.02 Use Table
  specialPurpose: "https://ecode360.com/45474542", // Chapter 905 (P, H districts)
  nonconformities: "https://ecode360.com/45478965", // Chapter 921
} as const;

export const CITE = {
  useTable: `Pittsburgh Zoning Code §911.02 Use Table (verified, ${CODE_URL.useTable})`,
  pStandards: `Pittsburgh Zoning Code §905.01 P district standards (verified, ${CODE_URL.specialPurpose})`,
  pContextual: "§905.01.C.1: new development in P may use contextual setbacks and heights (§925.06, §925.07)",
  pSitePlan: "§905.01.D.1: Site Plan Review (§922.04) for new construction, additions or exterior renovation on P lots of 2,400 sf or more",
  ncMaintenance: `§921.03.A.1: repair and remodeling of a nonconforming structure allowed without relief if the nonconformity does not grow (${CODE_URL.nonconformities})`,
  ncEnlarge: "§921.03.D.1: a nonconforming structure may be enlarged in compliance with the Code if the nonconformity does not grow",
  ncReconstruct: "§921.03.C.2-3: rebuilding after fire or natural disaster is a ZBA special exception; not allowed after willful destruction",
  lotOfRecord: "§921.04.A: a separately owned lot of record that was vacant when the Code took effect gets single-unit residential as an Administrator Exception, meeting dimensional rules to the extent practicable",
} as const;

/** Districts whose §911.02 cells we checked against the official table. */
export const VERIFIED_USE_DISTRICTS = new Set(["P", "H"]);

/** Site Plan Review triggers verified per district. */
export const SITE_PLAN_REVIEW: Record<string, { minLotSf: number; citation: string }> = {
  P: { minLotSf: 2400, citation: CITE.pSitePlan },
};

/** Single-unit attached permission verified in §911.02 for districts the QuickFit attached rules don't cover. */
export const VERIFIED_ATTACHED: Record<string, "P" | "S" | "N"> = { P: "N" };
