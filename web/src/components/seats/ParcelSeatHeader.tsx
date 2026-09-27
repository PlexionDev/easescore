"use client";

import { Suspense, use, useEffect } from "react";
import { useRouter } from "next/navigation";
import SeatHeader, { SeatSelect } from "./SeatHeader";
import { setSelection } from "./selection";
import type { SeatId } from "./seats";

const CITY = "PITTSBURGH";
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
const muniLabel = (n: string) => (n === CITY ? "City of Pittsburgh" : titleCase(n));

/**
 * Where each seat opens from a parcel page, keeping the parcel's context:
 * Planner on its municipality (and City neighborhood), Nonprofit on its neighborhood with the lot picked,
 * Developer with the parcel open in its pane, Policy (City only) as is; it highlights the shared neighborhood.
 * Neighborhood and municipality names and the public parcel id only; nothing personal goes into a URL.
 */
export function parcelSeatHrefs(parid: string, municipality: string | null, neighborhood: string | null): Record<SeatId, string> {
  const muni = (municipality ?? "").trim().toUpperCase() || null;
  const city = !muni || muni === CITY;
  const hood = city ? neighborhood?.trim() || null : null;
  const planner = new URLSearchParams({ muni: muni ?? CITY });
  if (hood) planner.set("hoods", hood);
  const developer = new URLSearchParams();
  if (!city && muni) developer.set("muni", muni);
  developer.set("parcel", parid);
  return {
    planner: `/planner?${planner}`,
    developer: `/developer?${developer}`,
    nonprofit: hood ? `/nonprofit?${new URLSearchParams({ hood, lots: parid })}` : "/nonprofit",
    policy: "/policy",
  };
}

/**
 * The seat header on the parcel page and its Feasibility study (screen only: hidden in print and the PDF).
 * Developer is the current seat. The municipality picker opens the Developer workspace on that municipality.
 * `municipalities` streams in (the page never waits for it); until then the picker lists the parcel's own.
 */
export default function ParcelSeatHeader({ parid, municipality, neighborhood, municipalities }: {
  parid: string;
  municipality: string | null;
  neighborhood: string | null;
  municipalities?: Promise<string[]>;
}) {
  const muni = (municipality ?? "").trim().toUpperCase() || CITY;
  const city = muni === CITY;
  // Share the parcel with the other seats (Policy highlights the neighborhood; Developer reopens the parcel).
  useEffect(() => {
    setSelection({ focus: parid, municipality: titleCase(muni), neighborhood: city ? neighborhood ?? undefined : undefined });
  }, [parid, muni, city, neighborhood]);
  const fallback = <MuniPicker value={muni} names={[muni]} />;
  return (
    <div className="es-noprint es-seat-parcel">
      <SeatHeader seat="developer" heading={false} hrefs={parcelSeatHrefs(parid, muni, neighborhood)}
        controls={municipalities ? <Suspense fallback={fallback}><MuniFromPromise value={muni} names={municipalities} /></Suspense> : fallback} />
    </div>
  );
}

function MuniFromPromise({ value, names }: { value: string; names: Promise<string[]> }) {
  return <MuniPicker value={value} names={use(names)} />;
}

function MuniPicker({ value, names }: { value: string; names: string[] }) {
  const router = useRouter();
  const all = [...new Set([CITY, value, ...names])];
  const options = [CITY, ...all.filter((n) => n !== CITY).sort()].map((n) => ({ value: n, label: muniLabel(n) }));
  return <SeatSelect label="Municipality" value={value} options={options}
    onChange={(v) => router.push(`/developer?${new URLSearchParams({ muni: v })}`)} />;
}
