"use client";

// Nonprofit / CDC seat: three steps (need → sites → project) on one page, state in the URL so a view
// can be shared and the advocacy brief can be rendered from the same state.

import { useCallback, useEffect, useRef, useState } from "react";
import { DataDateFooter, ExportMenu, SeatHeader, SeatLayout, SeatSelect, setSelection, useSeatSelection } from "@/components/seats";
import { acsVintage } from "@/lib/nonprofit/receipts";
import { DEFAULT_HOOD, MAX_LOTS, needSummary, stateToQuery, suggestLots, type NeedData, type ProjectCost, type ProjectState, type SitesResult } from "@/lib/nonprofit/types";
import NeedStep from "./NeedStep";
import SitesStep from "./SitesStep";
import ProjectStep from "./ProjectStep";
import "./nonprofit.css";

const STEPS: { id: ProjectState["step"]; n: number; label: string }[] = [
  { id: "need", n: 1, label: "Who needs homes here?" },
  { id: "sites", n: 2, label: "Where could we build?" },
  { id: "project", n: 3, label: "What's the gap?" },
];

// One request per cost key, shared across re-renders and effect re-runs (strict mode, fast refresh),
// so a re-run never cancels a request that is about to answer.
const costRequests = new Map<string, Promise<{ data: ProjectCost | null; error: string | null }>>();
function costRequest(key: string, lots: string[], perLot: number, bedrooms: number) {
  let p = costRequests.get(key);
  if (!p) {
    const q = new URLSearchParams({ lots: lots.join(","), per: String(perLot), br: String(bedrooms) });
    p = fetch(`/api/nonprofit/project?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ProjectCost) => ({ data: d, error: null }))
      .catch(() => { costRequests.delete(key); return { data: null, error: "The database may be busy. Try again in a moment." }; });
    costRequests.set(key, p);
    if (costRequests.size > 50) costRequests.delete(costRequests.keys().next().value!);
  }
  return p;
}

export default function NonprofitApp({ initial, hoods, initialNeed, initialSites, hoodFromUrl }: {
  initial: ProjectState;
  hoods: string[];
  initialNeed: NeedData | null;
  initialSites: SitesResult | null;
  hoodFromUrl: boolean;
}) {
  const [s, setS] = useState<ProjectState>(initial);
  const [need, setNeed] = useState<NeedData | null>(initialNeed);
  const [sites, setSites] = useState<SitesResult | null>(initialSites);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [tracts, setTracts] = useState<GeoJSON.FeatureCollection | null>(null);
  // Cost result tagged with the request it answers; loading = the current request has no answer yet.
  const [costRes, setCostRes] = useState<{ key: string; data: ProjectCost | null; error: string | null } | null>(null);
  const first = useRef({ need: true, sites: true });
  const sel = useSeatSelection();
  const update = useCallback((patch: Partial<ProjectState>) => setS((cur) => ({ ...cur, ...patch })), []);

  // Adopt the neighborhood from the shared seat selection when the URL did not name one.
  useEffect(() => {
    // Syncing from an external store (sessionStorage) once it is readable after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!hoodFromUrl && sel.neighborhood && sel.neighborhood !== s.hood && hoods.includes(sel.neighborhood)) update({ hood: sel.neighborhood, lots: [] });
  }, [sel.neighborhood]); // eslint-disable-line react-hooks/exhaustive-deps

  // URL + shared selection.
  useEffect(() => {
    const q = stateToQuery(s).toString();
    window.history.replaceState(null, "", q ? `/nonprofit?${q}` : "/nonprofit");
  }, [s]);
  useEffect(() => { setSelection({ municipality: "Pittsburgh", neighborhood: s.hood, parids: s.lots }); }, [s.hood, s.lots]);

  // Keep the current step's tab in view on narrow screens (the tab row scrolls sideways).
  useEffect(() => { document.querySelector(".np-steps .on")?.scrollIntoView({ block: "nearest", inline: "center" }); }, [s.step]);

  // Tract map (whole county, cached by the browser for an hour).
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/nonprofit/tracts", { signal: ctrl.signal }).then((r) => (r.ok ? r.json() : null)).then((fc) => fc && setTracts(fc)).catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  // Need for the neighborhood.
  useEffect(() => {
    if (first.current.need) { first.current.need = false; if (initialNeed && initialNeed.area?.hood.toLowerCase() === s.hood.toLowerCase()) return; }
    const ctrl = new AbortController();
    fetch(`/api/nonprofit/need?hood=${encodeURIComponent(s.hood)}`, { signal: ctrl.signal }).then((r) => (r.ok ? r.json() : null)).then((d) => setNeed(d)).catch(() => undefined);
    return () => ctrl.abort();
  }, [s.hood]); // eslint-disable-line react-hooks/exhaustive-deps

  // Candidate lots.
  const filtersKey = JSON.stringify([s.hood, s.filters]);
  useEffect(() => {
    if (first.current.sites) { first.current.sites = false; if (initialSites) return; }
    const ctrl = new AbortController();
    setSitesLoading(true);
    const q = stateToQuery({ ...s, lots: [], step: "need" });
    fetch(`/api/nonprofit/sites?${q}`, { signal: ctrl.signal }).then((r) => (r.ok ? r.json() : null))
      .then((d: SitesResult | null) => {
        setSites(d);
        // A new neighborhood starts with a suggested scattered-site set.
        if (d) setS((cur) => (cur.lots.length ? cur : { ...cur, lots: suggestLots(d.rows, cur.perLot) }));
      })
      .catch(() => undefined)
      .finally(() => { if (!ctrl.signal.aborted) setSitesLoading(false); });
    return () => ctrl.abort();
  }, [filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Project cost: fetched as soon as lots are chosen (so step 3 is ready when opened).
  const costKey = `${s.lots.join(",")}|${s.perLot}|${s.bedrooms}`;
  useEffect(() => {
    if (!s.lots.length) return;
    let live = true;
    costRequest(costKey, s.lots, s.perLot, s.bedrooms).then((r) => { if (live) setCostRes({ key: costKey, ...r }); });
    return () => { live = false; };
  }, [costKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = s.lots.length > 0 && costRes?.key === costKey ? costRes : null;
  const cost = current?.data ?? null;
  const costError = current?.error ?? null;
  const costLoading = s.lots.length > 0 && !current;

  const toggleLot = useCallback((parid: string) => setS((cur) => {
    const has = cur.lots.includes(parid);
    if (!has && cur.lots.length >= MAX_LOTS) return cur;
    return { ...cur, lots: has ? cur.lots.filter((p) => p !== parid) : [...cur.lots, parid] };
  }), []);

  const briefHref = () => {
    const q = stateToQuery(s);
    q.delete("step");
    return `/api/nonprofit/brief?${q}`;
  };
  const exportBrief = async () => {
    const r = await fetch(briefHref());
    if (!r.ok) { alert("The brief could not be rendered right now."); return; }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `EaseScore-Advocacy-Brief-${s.hood.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const n = needSummary(need?.area ?? null);
  const header = (
    <SeatHeader
      seat="nonprofit"
      controls={<SeatSelect label="Neighborhood" hideLabel={false} value={s.hood} onChange={(v) => update({ hood: v, lots: [] })}
        options={(hoods.length ? hoods : [DEFAULT_HOOD]).map((h) => ({ value: h, label: h }))} />}
      actions={<ExportMenu label="Advocacy brief" actions={[
        { id: "brief", label: "Advocacy brief", format: "PDF", description: s.lots.length ? `Need, ${s.lots.length} sites, project, gap, sources` : "Need and sources (pick lots for the project pages)", onSelect: exportBrief },
      ]} />}
    />
  );

  return (
    <SeatLayout header={header} mainLabel="Plan affordable homes" footer={
      <DataDateFooter sources={[
        { name: "Census ACS 5-year (rent burden, income, rent)", date: acsVintage(n?.acsYear ?? null) },
        { name: "HUD Income Limits (Pittsburgh HMFA)", date: need?.il ? `FY${need.il.year}` : "not loaded" },
        { name: "HUD QCT / DDA", date: "current year" },
        { name: "Ease Scores and pro forma", date: cost?.asOf ?? "current engine" },
        ...(need?.datasets ?? []).filter((d) => !d.loaded).map((d) => ({ name: d.name, date: "not loaded yet" })),
      ]} note="Typical ranges for funding sources are planning figures, not awards." />
    }>
      <nav className="np-steps" aria-label="Steps">
        {STEPS.map((st) => (
          <button key={st.id} type="button" className={s.step === st.id ? "on" : ""} aria-current={s.step === st.id ? "step" : undefined} onClick={() => update({ step: st.id })}>
            <i aria-hidden="true">{st.n}</i>{st.label}
          </button>
        ))}
      </nav>
      <div className="np-body">
        {s.step === "need" ? (
          <NeedStep need={need} tracts={tracts} layer={s.layer} onLayer={(layer) => update({ layer })} household={s.household} onHousehold={(household) => update({ household })} onNext={() => update({ step: "sites" })} />
        ) : s.step === "sites" ? (
          <SitesStep hood={s.hood} result={sites} loading={sitesLoading} filters={s.filters} onFilters={(filters) => update({ filters })} selected={s.lots} onToggle={toggleLot}
            perLot={s.perLot} onNext={() => update({ step: "project" })} tracts={tracts} layer={s.layer} outline={need?.area?.outline ?? null} bbox={need?.area?.bbox ?? null} />
        ) : (
          <ProjectStep need={need} lotCount={s.lots.length} cost={cost} costLoading={costLoading} costError={costError} perLot={s.perLot} onPerLot={(perLot) => update({ perLot })}
            bedrooms={s.bedrooms} onBedrooms={(bedrooms) => update({ bedrooms })} mix={s.mix} onMix={(mix) => update({ mix })} sources={s.sources} onSources={(sources) => update({ sources })} onExport={exportBrief} />
        )}
      </div>
    </SeatLayout>
  );
}
