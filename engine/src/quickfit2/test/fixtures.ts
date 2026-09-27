// SYNTHETIC TEST LOTS for building the solver. Real fixtures come from the database export (QUICKFIT-V2.md §2).
// Rules marked "approx" are placeholders shaped like Pittsburgh districts, NOT verified code values (RM-M values are from our report).
import type { ParcelInput, ZoningRules, Pt } from "../src/types";

const rot = (pts: Pt[], deg: number, o: Pt = [1000, 1000]): Pt[] => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return pts.map(([x, y]) => [o[0] + x * c - y * s, o[1] + x * s + y * c]); };
const P = "P" as const, N = "N" as const, S = "S" as const, C = "C" as const;
const sec = { setbacks: "§903.03", parking: "§914.02.A", uses: "§911.02", height: "§903.03", lotSize: "§903.03", contextual: "§925.06" };
export const RULES: Record<string, ZoningRules> = {
  "RM-M": { district: "RM-M", uses: { single_detached: P, single_attached: P, two_unit: P, three_unit: P, multi_unit: P, adu: N }, minLotSqft: 2400, setbacksFt: { front: 25, rear: 25, side: 10, streetSide: 25, sideAttachedPartyWall: 0 }, maxHeightFt: 55, maxStories: 4, parkingPerUnit: { single_detached: 1, two_unit: 1, multi_unit: 1, single_attached: 0 }, codeSections: sec },
  "R1D-M (approx)": { district: "R1D-M", uses: { single_detached: P, single_attached: N, two_unit: N, three_unit: N, multi_unit: N, adu: N }, minLotSqft: 3200, setbacksFt: { front: 15, rear: 15, side: 5, streetSide: 15 }, maxHeightFt: 40, maxStories: 3, parkingPerUnit: { single_detached: 1, two_unit: 1, multi_unit: 1, single_attached: 0 }, codeSections: sec },
  "R1A-H (approx)": { district: "R1A-H", uses: { single_detached: P, single_attached: P, two_unit: N, three_unit: N, multi_unit: N, adu: N }, minLotSqft: 1200, minLotSqftAttachedPerUnit: 1200, setbacksFt: { front: 15, rear: 15, side: 3, streetSide: 10, sideAttachedPartyWall: 0 }, maxHeightFt: 40, maxStories: 3, parkingPerUnit: { single_detached: 1, two_unit: 1, multi_unit: 1, single_attached: 0 }, codeSections: sec },
  "R2-L (approx)": { district: "R2-L", uses: { single_detached: P, single_attached: P, two_unit: P, three_unit: S, multi_unit: N, adu: N }, minLotSqft: 4000, lotAreaPerUnitSqft: 1800, setbacksFt: { front: 25, rear: 25, side: 5, streetSide: 15 }, maxHeightFt: 40, maxStories: 3, parkingPerUnit: { single_detached: 1, two_unit: 1, multi_unit: 1, single_attached: 0 }, codeSections: sec },
  "LNC (approx)": { district: "LNC", uses: { single_detached: C, single_attached: P, two_unit: P, three_unit: P, multi_unit: P, adu: N }, minLotSqft: 0, setbacksFt: { front: 0, rear: 20, side: 0, streetSide: 0 }, maxHeightFt: 45, maxStories: 3, parkingPerUnit: { single_detached: 1, two_unit: 1, multi_unit: 1, single_attached: 0 }, codeSections: sec },
  "P (Parks)": { district: "P", uses: { single_detached: N, single_attached: N, two_unit: N, three_unit: N, multi_unit: N, adu: N }, minLotSqft: 0, setbacksFt: { front: 30, rear: 30, side: 30, streetSide: 30 }, maxHeightFt: 40, maxStories: 3, parkingPerUnit: { single_detached: 1, two_unit: 1, multi_unit: 1, single_attached: 0 }, codeSections: sec },
};
const flat = { elevAt: () => 900 };
const slopeAlong = (ang: number, pct: number) => ({ elevAt: (x: number, y: number) => { const a = ang * Math.PI / 180; const ly = -(x - 1000) * Math.sin(a) + (y - 1000) * Math.cos(a); return 900 + ly * pct / 100; } });
const hill = (ang: number) => ({ elevAt: (x: number, y: number) => { const a = ang * Math.PI / 180; const ly = -(x - 1000) * Math.sin(a) + (y - 1000) * Math.cos(a); return 900 + (ly < 40 ? ly * 0.08 : 3.2 + (ly - 40) * 0.55); } });
const street = (name: string, pts: Pt[], row = 40) => ({ name, centerline: pts, rowWidthFt: row, opened: true });

function house(x: number, y: number, w: number, d: number, ang: number, h = 28) { return { footprint: rot([[x, y], [x + w, y], [x + w, y + d], [x, y + d]], ang), heightFt: h }; }
function context(w: number, d: number, ang: number) {
  // neighbor lots left/right with houses set 8–12 ft back (typical older block), and a row across the street
  const nw = 30; const nb: any[] = [];
  for (const [ox, hx, hw, sb] of [[-nw, -nw + 5, 20, 10], [w, w + 5, 20, 8], [-2 * nw, -2 * nw + 4, 22, 12], [w + nw, w + nw + 4, 22, 9]] as number[][]) nb.push({ parcel: rot([[ox, 0], [ox + nw, 0], [ox + nw, d], [ox, d]], ang), building: house(hx, sb, hw, 36, ang, 26 + (hx % 3) * 3) });
  const across: any[] = []; for (let k = -2; k < 4; k++) across.push({ parcel: rot([[k * 32, -40 - 100], [k * 32 + 32, -40 - 100], [k * 32 + 32, -40], [k * 32, -40]], ang), building: house(k * 32 + 5, -40 - 10 - 36, 22, 36, ang, 28) });
  return { neighbors: [...nb, ...across] };
}
function lot(id: string, w: number, d: number, ang: number, rules: string, extra: Partial<ParcelInput> = {}, streetName = "Example St"): ParcelInput {
  const ring = rot([[0, 0], [w, 0], [w, d], [0, d]], ang);
  const cl = rot([[-100, -20], [w + 100, -20]], ang);
  return { parcelId: id, addressStreet: streetName, parcel: ring, streets: [street(streetName, cl)], zoning: RULES[rules], terrain: flat, zbaStats: { dimensional_variance: { granted: 25, denied: 1, years: "2025–2026", scope: "citywide sample (synthetic)" } }, ...(context(w, d, ang) as any), ...extra };
}
export const FIXTURES: { name: string; input: ParcelInput }[] = [
  { name: "Flat interior 40×120, R1D-M", input: lot("T-FLAT", 40, 120, 17, "R1D-M (approx)") },
  { name: "Narrow rowhouse lot 20×100, R1A-H", input: lot("T-NARROW", 20, 100, -8, "R1A-H (approx)") },
  { name: "Wide lot 90×110, R1A-H (townhouse row)", input: lot("T-ROW", 90, 110, 5, "R1A-H (approx)") },
  { name: "Steep lot 40×130, RM-M (hillside)", input: { ...lot("T-STEEP", 40, 130, 32, "RM-M"), terrain: hill(32) } },
  { name: "Deep lot 50×200, R2-L", input: lot("T-DEEP", 50, 200, 0, "R2-L (approx)") },
  { name: "Neighborhood commercial 60×110, LNC", input: lot("T-LNC", 60, 110, -20, "LNC (approx)") },
  { name: "Parks (P) district 40×120", input: lot("T-PARKS", 40, 120, 10, "P (Parks)") },
  { name: "Alley lot 30×110, R1D-M, alley at rear", input: (() => { const L = lot("T-ALLEY", 30, 110, 0, "R1D-M (approx)"); L.alleys = [{ centerline: rot([[-50, 118], [80, 118]], 0) }]; return L; })() },
  { name: "Floodway at rear 60×120, R2-L", input: (() => { const L = lot("T-FLOOD", 60, 120, 0, "R2-L (approx)"); L.floodway = [rot([[-10, 80], [70, 80], [70, 130], [-10, 130]], 0)]; return L; })() },
  { name: "Corner lot 50×100 (Main St front, Oak Ave side), RM-M", input: (() => { const L = lot("T-CORNER", 50, 100, 0, "RM-M", {}, "Main St"); L.streets.push(street("Oak Ave", rot([[70, -60], [70, 160]], 0))); return L; })() },
  { name: "Irregular 6-sided ~7,900 sq ft, RM-M, 28% slope", input: { neighbors: [
      { parcel: rot([[-34, 0], [0, 0], [0, 98], [-34, 98]], -30), building: house(-29, 9, 22, 34, -30, 30) },
      { parcel: rot([[-68, 0], [-34, 0], [-34, 98], [-68, 98]], -30), building: house(-63, 11, 22, 36, -30, 27) },
      { parcel: rot([[57, 0], [92, 0], [92, 38], [57, 38]], -30), building: house(64, 6, 22, 28, -30, 28) },
      { parcel: rot([[92, 0], [126, 0], [126, 60], [92, 60]], -30), building: house(98, 8, 22, 34, -30, 30) },
      ...[-2, -1, 0, 1, 2, 3].map(k => ({ parcel: rot([[k * 34, -140], [k * 34 + 34, -140], [k * 34 + 34, -40], [k * 34, -40]], -30), building: house(k * 34 + 6, -86, 22, 36, -30, 28) }))],
    parcelId: "T-IRREG", addressStreet: "Heldman", parcel: rot([[0, 0], [57, 0], [57, 40], [95, 70], [70, 130], [0, 98]], -30), streets: [street("Heldman St", rot([[-60, -20], [120, -20]], -30))], zoning: RULES["RM-M"], terrain: slopeAlong(-30, 28), zbaStats: { dimensional_variance: { granted: 25, denied: 1, years: "2025–2026", scope: "RM-M" } } } },
];
