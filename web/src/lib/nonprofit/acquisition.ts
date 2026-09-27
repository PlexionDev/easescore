// How a nonprofit typically gets a lot, by who holds it. Typical steps and timelines only, labeled as
// such: every agency sets its own process, and the user should confirm with the agency.

export interface AcquisitionPath {
  id: string;
  title: string;
  steps: string[];
  typicalMonths: [number, number];
  note: string;
  where: string;
}

export const TYPICAL_NOTE = "Typical steps and timing, not a commitment. Confirm with the agency.";

const PATHS: Record<string, AcquisitionPath> = {
  city: {
    id: "city",
    title: "City of Pittsburgh lot (City Real Estate / Pittsburgh Land Bank)",
    steps: [
      "Confirm the lot's status on the City's public property list",
      "Submit a purchase application with the project plan and funding sources",
      "Agency review and community notice",
      "Approval (City Council or Land Bank board)",
      "Closing, often at a nominal price for affordable homes",
    ],
    typicalMonths: [6, 12],
    note: "Scattered lots are often packaged together for one developer.",
    where: "City of Pittsburgh Department of Finance, Real Estate Division; Pittsburgh Land Bank",
  },
  ura: {
    id: "ura",
    title: "Urban Redevelopment Authority lot",
    steps: [
      "Watch for a URA request for proposals, or ask about an unsolicited proposal",
      "Proposal with development team, design and financing",
      "URA board approval and a disposition agreement",
      "Closing when financing is committed",
    ],
    typicalMonths: [4, 9],
    note: "Price and terms set in the disposition agreement.",
    where: "Urban Redevelopment Authority of Pittsburgh",
  },
  county: {
    id: "county",
    title: "Other public owner",
    steps: ["Contact the owning agency about its disposition process", "Application or proposal", "Board approval", "Closing"],
    typicalMonths: [6, 12],
    note: "Processes differ by agency.",
    where: "The owning agency",
  },
  tax: {
    id: "tax",
    title: "Tax-delinquent private lot (treasurer or sheriff sale)",
    steps: ["Check the lot's tax-sale status", "Bid at a treasurer's or sheriff sale, or acquire through the Land Bank", "Quiet title if needed", "Closing"],
    typicalMonths: [6, 18],
    note: "Title and redemption rights add time and risk.",
    where: "Allegheny County Treasurer / Sheriff; Pittsburgh Land Bank",
  },
};

/** The typical path for a lot from its agency and the City's status field. */
export function acquisitionPath(agency: string | null, taxDelinquent: boolean | null, ownerClass: string | null): AcquisitionPath | null {
  const a = (agency ?? "").toLowerCase();
  if (a.includes("urban redevelopment") || a === "ura") return PATHS.ura!;
  if (a.includes("pittsburgh") || a.includes("land bank")) return PATHS.city!;
  if (ownerClass === "public") return PATHS.county!;
  if (taxDelinquent) return PATHS.tax!;
  return null;
}

/** Plain note on the City's status field for the lot. */
export function statusNote(status: string | null): { tone: "ok" | "caution"; text: string } | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s.includes("available")) return { tone: "ok", text: "Listed as available for sale" };
  if (s.includes("pending")) return { tone: "caution", text: `Status: ${status.toLowerCase()} (another sale may be in progress)` };
  if (s.includes("hold")) return { tone: "caution", text: "Held for study, not offered yet" };
  if (s.includes("permanent")) return { tone: "caution", text: "Marked for permanent City ownership" };
  return { tone: "caution", text: `Status: ${status}` };
}
