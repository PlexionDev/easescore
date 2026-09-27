"use client";

// Developer filter rail: search, neighborhood, lot size, vacant / has a structure, ownership type, homes
// zoning allows by right, no red flags, steep land. Every filter maps to a stored parcel_scores column
// (the Planner's filter model); money filters are not stored per lot, so they are not offered here.

import { useState } from "react";
import { CheckboxField, FilterRail, FilterSection, SeatButton } from "@/components/seats";
import SearchBox from "@/components/home/SearchBox";
import type { SearchHit } from "@/lib/data";
import type { Filters, PlannerOptions } from "@/lib/planner";

/** Homes by right, at least N (our lot-fit test of each building type under the zoning rules). */
const ALLOWS: { min: number | undefined; label: string }[] = [
  { min: undefined, label: "Any" },
  { min: 1, label: "At least a single-family home (1+)" },
  { min: 2, label: "At least a duplex (2+)" },
  { min: 3, label: "3 or more homes" },
  { min: 4, label: "4 or more homes" },
];

function NumberBox({ label, value, onCommit, placeholder }: { label: string; value: number | undefined; onCommit: (v: number | undefined) => void; placeholder: string }) {
  // Keyed by value by the caller, so a cleared filter resets the box.
  const [text, setText] = useState(value?.toString() ?? "");
  const commit = () => {
    const t = text.replace(/,/g, "").trim();
    const n = t !== "" && Number.isFinite(Number(t)) ? Math.max(0, Number(t)) : undefined;
    if (n !== value) onCommit(n);
  };
  return (
    <input className="pl-num" inputMode="numeric" value={text} placeholder={placeholder} aria-label={label}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
  );
}

export default function DeveloperFilters({ f, options, set, reset, total, onPick }: {
  f: Filters;
  options: PlannerOptions | null;
  set: (patch: Partial<Filters>) => void;
  reset: () => void;
  total: number | null;
  onPick: (h: SearchHit) => void;
}) {
  const active = Object.keys(f).filter((k) => k !== "muni").length;
  const hood = f.hoods?.length === 1 ? f.hoods[0]! : "";
  return (
    <FilterRail
      heading="Find lots"
      intro={total != null ? `${total.toLocaleString("en-US")} lots match.` : undefined}
      footer={<SeatButton variant="ghost" onClick={reset} disabled={!active}>Clear all filters</SeatButton>}
    >
      <div className="dv-search">
        <SearchBox id="developer-search" landmarkLabel="Find a parcel" onPick={onPick} />
        <p className="es-fsec-hint">Opens the parcel in the pane, whatever the filters.</p>
      </div>

      <FilterSection title="Where">
        <label className="es-field-label">
          Neighborhood
          <select className="pl-multi" value={hood} onChange={(e) => set({ hoods: e.target.value ? [e.target.value] : undefined })}>
            <option value="">Any neighborhood</option>
            {(options?.neighborhoods ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </FilterSection>

      <FilterSection title="Lot">
        <span className="es-field-label">Lot size (sq ft)</span>
        <div className="pl-pair">
          <NumberBox key={`min${f.lotMin ?? ""}`} label="Minimum lot size, square feet" value={f.lotMin} onCommit={(v) => set({ lotMin: v })} placeholder="min" />
          <NumberBox key={`max${f.lotMax ?? ""}`} label="Maximum lot size, square feet" value={f.lotMax} onCommit={(v) => set({ lotMax: v })} placeholder="max" />
        </div>
        <CheckboxField label="Vacant" checked={f.land === "vacant"} onChange={(c) => set({ land: c ? "vacant" : undefined })} />
        <CheckboxField label="Has a structure" checked={f.land === "structure"} onChange={(c) => set({ land: c ? "structure" : undefined })} />
      </FilterSection>

      <FilterSection title="Ownership" hint="Owner type only. Owners are never named.">
        <CheckboxField label="Public (City, URA / Land Bank, HACP, County)" checked={f.owner === "public"} onChange={(c) => set({ owner: c ? "public" : undefined })} />
        <CheckboxField label="Private" checked={f.owner === "private"} onChange={(c) => set({ owner: c ? "private" : undefined })} />
      </FilterSection>

      <FilterSection title="What zoning allows" hint="Homes by right from our lot-fit test of each building type (single-family, duplex, 3–4 units, townhouse row) under the zoning rules">
        <label className="es-field-label">
          Homes allowed by right
          <select className="pl-multi" value={f.byRightMin ?? ""} onChange={(e) => set({ byRightMin: e.target.value ? Number(e.target.value) : undefined })}>
            {ALLOWS.map((a) => <option key={a.label} value={a.min ?? ""}>{a.label}</option>)}
          </select>
        </label>
        <p className="es-fsec-hint" style={{ marginTop: 4 }}>Each lot&apos;s best option (for example a townhouse row) shows in the table and the pane.</p>
      </FilterSection>

      <FilterSection title="Site">
        <CheckboxField label="No red flags" hint="Floodway, no street access, cleanup site on the lot" checked={!!f.clean} onChange={(c) => set({ clean: c || undefined })} />
        <CheckboxField label="Skip steep lots" hint="Leaves out lots where a quarter or more of the land is steeper than 25% (lidar). The stored scores keep this share, not an average slope." checked={!!f.xSteep} onChange={(c) => set({ xSteep: c || undefined })} />
      </FilterSection>

      <p className="es-fsec-hint dv-railnote">Whether a lot pencils (margin, residual land value) is priced per lot in the quick view&apos;s Pencil calculator; it is not stored for every lot, so there is no filter for it.</p>
    </FilterRail>
  );
}
