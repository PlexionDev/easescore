"use client";

// Left rail: every §2 filter. Changes apply immediately (the lot-size and number boxes on blur/Enter).

import { useEffect, useState } from "react";
import { CheckboxField, FilterRail, FilterSection, SeatButton } from "@/components/seats";
import { BANDS, BLOCK_NC, DELINQUENT_PUBLIC_NOTE, ONLY_BLOCKED_BY, OWNER_TYPES, publicOnlyIfDelinquent, type Band, type Filters, type PlannerOptions } from "@/lib/planner";

const TRANSIT_FT = [500, 1000, 1500, 2640];

function MultiSelect({ label, values, options, onChange, placeholder }: {
  label: string; values: string[]; options: string[]; onChange: (v: string[]) => void; placeholder: string;
}) {
  return (
    <div>
      <label className="es-field-label">
        {label}
        <select className="pl-multi" value="" onChange={(e) => { if (e.target.value) onChange([...new Set([...values, e.target.value])]); }}>
          <option value="">{values.length ? "Add another…" : placeholder}</option>
          {options.filter((o) => !values.includes(o)).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
      {values.length ? (
        <div className="pl-chips">
          {values.map((v) => (
            <button key={v} type="button" className="pl-chip" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
              {v} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NumberBox({ label, value, onCommit, placeholder = "any" }: { label: string; value: number | undefined; onCommit: (v: number | undefined) => void; placeholder?: string }) {
  const [text, setText] = useState(value?.toString() ?? "");
  useEffect(() => { setText(value?.toString() ?? ""); }, [value]);
  const commit = () => {
    const t = text.replace(/,/g, "").trim();
    const n = t !== "" && Number.isFinite(Number(t)) ? Math.max(0, Number(t)) : undefined;
    if (n !== value) onCommit(n);
  };
  return (
    <label className="es-field-label" style={{ marginBottom: 0 }}>
      <span className="es-sr">{label}</span>
      <input className="pl-num" inputMode="numeric" value={text} placeholder={placeholder} aria-label={label}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
    </label>
  );
}

export default function PlannerFilters({ f, options, set, reset, counts }: {
  f: Filters;
  options: PlannerOptions | null;
  set: (patch: Partial<Filters>) => void;
  reset: () => void;
  counts: { total: number } | null;
}) {
  const active = Object.keys(f).filter((k) => k !== "muni").length;
  return (
    <FilterRail
      intro={counts ? `${counts.total.toLocaleString("en-US")} parcels match.` : undefined}
      footer={<SeatButton variant="ghost" onClick={reset} disabled={!active}>Clear all filters</SeatButton>}
    >
      <FilterSection title="Where">
        <MultiSelect label="Neighborhood" values={f.hoods ?? []} options={options?.neighborhoods ?? []} placeholder="Any neighborhood"
          onChange={(v) => set({ hoods: v })} />
        {options?.council_districts.length ? (
          <label className="es-field-label" style={{ marginTop: 8 }}>
            Council district
            <select className="pl-multi" value={f.district ?? ""} onChange={(e) => set({ district: e.target.value || undefined })}>
              <option value="">Any</option>
              {options.council_districts.map((d) => <option key={d} value={d}>District {d}</option>)}
            </select>
          </label>
        ) : <p className="es-fsec-hint" style={{ marginTop: 8 }}>Council districts not loaded yet.</p>}
        <div style={{ marginTop: 8 }}>
          <MultiSelect label="Zoning district" values={f.zones ?? []} options={options?.zoning ?? []} placeholder="Any district" onChange={(v) => set({ zones: v })} />
        </div>
      </FilterSection>

      <FilterSection title="Land">
        <CheckboxField label="Vacant" checked={f.land === "vacant"} onChange={(c) => set({ land: c ? "vacant" : undefined })} />
        <CheckboxField label="Has a structure" checked={f.land === "structure"} onChange={(c) => set({ land: c ? "structure" : undefined })} />
        <CheckboxField label="Publicly owned (City, URA, Land Bank, HACP, County)"
          checked={f.owner === "public"} onChange={(c) => set(c ? { owner: "public" } : { owner: undefined, delinquent: undefined })} />
        <CheckboxField label="Privately owned" checked={f.owner === "private"} onChange={(c) => set(c ? { owner: "private", delinquent: undefined } : { owner: undefined })} />
        <CheckboxField label="Tax-delinquent (publicly owned only)" hint={f.delinquent ? DELINQUENT_PUBLIC_NOTE : "Open county tax lien, on publicly owned land"} checked={!!f.delinquent}
          onChange={(c) => set(c ? publicOnlyIfDelinquent({ ...f, delinquent: true }) : { delinquent: undefined })} />
        <details style={{ marginTop: 4 }}>
          <summary className="es-field-label" style={{ cursor: "pointer", display: "list-item" }}>Owner type{f.ownerTypes?.length ? ` (${f.ownerTypes.length})` : ""}</summary>
          {OWNER_TYPES.map((o) => (
            <CheckboxField key={o.id} label={o.label} checked={!!f.ownerTypes?.includes(o.id)}
              onChange={(c) => set({ ownerTypes: c ? [...(f.ownerTypes ?? []), o.id] : (f.ownerTypes ?? []).filter((x) => x !== o.id), ...(c && !o.isPublic ? { delinquent: undefined } : {}) })} />
          ))}
          <p className="es-fsec-hint" style={{ marginTop: 4 }}>Public agencies by name only; private owners are never named. The Land Bank shares URA&apos;s address, so it is counted with URA.</p>
        </details>
        <span className="es-field-label" style={{ marginTop: 8 }}>Lot size (sq ft)</span>
        <div className="pl-pair">
          <NumberBox label="Minimum lot size, square feet" value={f.lotMin} onCommit={(v) => set({ lotMin: v })} placeholder="min" />
          <NumberBox label="Maximum lot size, square feet" value={f.lotMax} onCommit={(v) => set({ lotMax: v })} placeholder="max" />
        </div>
      </FilterSection>

      <FilterSection title="Buildability">
        <CheckboxField label="No red flags" hint="Floodway, no street access, cleanup site on the lot" checked={!!f.clean} onChange={(c) => set({ clean: c || undefined })} />
        <CheckboxField label="Exclude floodway" checked={!!f.xFloodway} onChange={(c) => set({ xFloodway: c || undefined })} />
        <CheckboxField label="Exclude landslide-prone" checked={!!f.xLandslide} onChange={(c) => set({ xLandslide: c || undefined })} />
        <CheckboxField label="Exclude undermined" checked={!!f.xUndermined} onChange={(c) => set({ xUndermined: c || undefined })} />
        <CheckboxField label="Exclude slope ≥25%" hint="A quarter or more of the lot steeper than 25%" checked={!!f.xSteep} onChange={(c) => set({ xSteep: c || undefined })} />
        <span className="es-field-label" style={{ marginTop: 8 }}>Score band</span>
        {BANDS.map((b) => (
          <CheckboxField key={b} label={b} checked={!!f.bands?.includes(b)}
            onChange={(c) => set({ bands: c ? [...(f.bands ?? []), b] : (f.bands ?? []).filter((x): x is Band => x !== b) })} />
        ))}
        <span className="es-field-label" style={{ marginTop: 8 }}>Homes by right, at least</span>
        <NumberBox label="Homes by right, at least" value={f.byRightMin} onCommit={(v) => set({ byRightMin: v })} />
      </FilterSection>

      <FilterSection title="Access">
        <label className="es-field-label">
          Within this distance of frequent transit
          <select className="pl-multi" value={f.transitFt ?? ""} onChange={(e) => set({ transitFt: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Any distance</option>
            {TRANSIT_FT.map((ft) => <option key={ft} value={ft}>{ft === 2640 ? "Half a mile (2,640 ft)" : `${ft.toLocaleString("en-US")} ft`}</option>)}
          </select>
        </label>
        <p className="es-fsec-hint" style={{ marginTop: 4 }}>Frequent = a stop with frequent weekday-morning service (PRT GTFS).</p>
      </FilterSection>

      <FilterSection title="Street precedent" hint="Blocks whose existing buildings don't meet today's code">
        <label className="es-field-label">
          Block conformity
          <select className="pl-multi" value={f.blockNc ?? ""} onChange={(e) => set({ blockNc: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Any block</option>
            {BLOCK_NC.map((p) => <option key={p} value={p}>{p}%+ of buildings don&apos;t meet the code</option>)}
          </select>
        </label>
        <p className="es-fsec-hint" style={{ marginTop: 4 }}>Measured from building footprints and lot lines (front and side setbacks, lot size, stories) on block faces with 3+ buildings. Where most of a block is nonconforming, the code, not the lot, is the obstacle.</p>
      </FilterSection>

      <FilterSection title="Only blocked by…" hint="Find lots held back by these rules and nothing else">
        {ONLY_BLOCKED_BY.map((b) => (
          <CheckboxField key={b} label={b} checked={!!f.only?.includes(b)}
            onChange={(c) => set({ only: c ? [...(f.only ?? []), b] : (f.only ?? []).filter((x) => x !== b) })} />
        ))}
      </FilterSection>
    </FilterRail>
  );
}
