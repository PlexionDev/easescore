"use client";

// Nonprofit / CDC seat: three steps (need → sites → project) on one page, state in the URL so a view
// can be shared and the advocacy brief can be rendered from the same state.

import { useCallback, useEffect, useRef, useState } from "react";
import { DataDateFooter, ExportMenu, SeatHeader, SeatLayout, SeatSelect, setSelection, useSeatSelection } from "@/components/seats";
import { acsVintage } from "@/lib/nonprofit/receipts";
import { DEFAULT_HOOD, DEFAULT_MIX, MAX_LOTS, defaultSources, needSummary, stateToQuery, suggestLots, type NeedData, type ProjectCost, type ProjectState, type SitesResult, type Tenure } from "@/lib/nonprofit/types";
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
  const [bgs, setBgs] = useState<(GeoJSON.FeatureCollection & { vintage?: string }) | null>(null);
  const [bgError, setBgError] = useState(false);
  const [needLoading, setNeedLoading] = useState(false);
  // The "Try this" line shows on a fresh landing (no shared URL state) until the user moves on.
  const [tryThis, setTryThis] = useState(!hoodFromUrl && initial.step === "need");
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

  // Block-group map: fetched only when that level is chosen (about 700 KB, cached by the browser for an hour).
  useEffect(() => {
    if (s.geo !== "bg" || bgs) return;
    const ctrl = new AbortController();
    fetch("/api/nonprofit/blockgroups", { signal: ctrl.signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((fc) => { setBgs(fc); setBgError(false); })
      .catch(() => { if (!ctrl.signal.aborted) setBgError(true); });
    return () => ctrl.abort();
  }, [s.geo, bgs]);

  // Need for the neighborhood.
  useEffect(() => {
    if (first.current.need) { first.current.need = false; if (initialNeed && initialNeed.area?.hood.toLowerCase() === s.hood.toLowerCase()) return; }
    const ctrl = new AbortController();
    setNeedLoading(true);
    fetch(`/api/nonprofit/need?hood=${encodeURIComponent(s.hood)}`, { signal: ctrl.signal }).then((r) => (r.ok ? r.json() : null)).then((d) => setNeed(d)).catch(() => undefined)
      .finally(() => { if (!ctrl.signal.aborted) setNeedLoading(false); });
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

  const setTenure = (tenure: Tenure) => { if (tenure !== s.tenure) update({ tenure, mix: { ...DEFAULT_MIX[tenure] }, sources: defaultSources(tenure) }); };
  const goStep = (step: ProjectState["step"]) => { setTryThis(false); update({ step }); };
  // Arrow keys move between the step tabs (Home / End jump to the first / last).
  const onStepKey = (e: React.KeyboardEvent<HTMLElement>) => {
    const i = STEPS.findIndex((x) => x.id === s.step);
    const n = e.key === "ArrowRight" ? (i + 1) % STEPS.length : e.key === "ArrowLeft" ? (i + STEPS.length - 1) % STEPS.length : e.key === "Home" ? 0 : e.key === "End" ? STEPS.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault();
    goStep(STEPS[n]!.id);
    (e.currentTarget.querySelectorAll("button")[n] as HTMLButtonElement | undefined)?.focus();
  };
  // Need data shown only when it belongs to the chosen neighborhood.
  const needShown = need && need.area?.hood.toLowerCase() !== s.hood.toLowerCase() && needLoading ? null : need;
  const mapData = s.geo === "bg" ? bgs : tracts;

  const n = needSummary(need?.area ?? null);
  const header = (
    <SeatHeader
      seat="nonprofit"
      controls={<SeatSelect label="Neighborhood" hideLabel={false} value={s.hood} onChange={(v) => update({ hood: v, lots: [] })}
        options={(hoods.length ? hoods : [DEFAULT_HOOD]).map((h) => ({ value: h, label: h }))} />}
      actions={<ExportMenu label="Advocacy brief" actions={[
        { id: "brief", label: "Advocacy brief", format: "PDF", description: s.lots.length ? `Need, ${s.lots.length} sites, ${s.tenure === "sale" ? "for-sale" : "rental"} project, gap, sources` : "Need and sources (pick lots for the project pages)", onSelect: exportBrief },
      ]} />}
    />
  );

  return (
    <SeatLayout header={header} mainLabel="Plan affordable homes" footer={
      <DataDateFooter sources={[
        { name: `Census ACS 5-year (rent burden, income, rent${s.geo === "bg" ? "; block groups" : ""})`, date: acsVintage(n?.acsYear ?? null) },
        { name: "HUD Income Limits (Pittsburgh HMFA)", date: need?.il ? `FY${need.il.year}` : "not loaded" },
        { name: "HUD QCT / DDA", date: "current year" },
        { name: "Ease Scores and pro forma", date: cost?.asOf ?? "current engine" },
        ...(s.tenure === "sale" ? [{ name: "30-year mortgage rate (FRED MORTGAGE30US)", date: cost?.mortgage?.date ?? "not loaded (assumption used)" }] : []),
        ...(need?.datasets ?? []).filter((d) => !d.loaded).map((d) => ({ name: d.name, date: "not loaded yet" })),
      ]} note="Typical ranges for funding sources are planning figures, not awards." />
    }>
      <nav className="np-steps" aria-label="Steps (left and right arrow keys move between them)" onKeyDown={onStepKey}>
        {STEPS.map((st) => (
          <button key={st.id} type="button" className={s.step === st.id ? "on" : ""} aria-current={s.step === st.id ? "step" : undefined} tabIndex={s.step === st.id ? 0 : -1} onClick={() => goStep(st.id)}>
            <i aria-hidden="true">{st.n}</i>{st.label}
          </button>
        ))}
      </nav>
      {tryThis ? (
        <div className="np-try" role="note">
          <p><b>Try this:</b> {s.hood} is preselected. Read who needs homes here, then see the gap for {s.lots.length || 3} public lots as rentals or as for-sale homes at 80% of the area median.</p>
          <button type="button" className="es-btn es-btn-primary" onClick={() => goStep("project")}>Show me the gap →</button>
          <button type="button" className="es-btn np-try-x" aria-label="Hide this tip" onClick={() => setTryThis(false)}>×</button>
        </div>
      ) : null}
      <div className="np-body">
        {s.step === "need" ? (
          <NeedStep need={needShown} loading={needLoading} hoodName={s.hood} tracts={mapData} geo={s.geo} onGeo={(geo) => update({ geo })} geoVintage={s.geo === "bg" ? bgs?.vintage ?? null : null} geoError={s.geo === "bg" && bgError}
            layer={s.layer} onLayer={(layer) => update({ layer })} household={s.household} onHousehold={(household) => update({ household })} onNext={() => goStep("sites")} />
        ) : s.step === "sites" ? (
          <SitesStep hood={s.hood} result={sites} loading={sitesLoading} filters={s.filters} onFilters={(filters) => update({ filters })} selected={s.lots} onToggle={toggleLot}
            perLot={s.perLot} onNext={() => goStep("project")} tracts={mapData} layer={s.layer} outline={need?.area?.outline ?? null} bbox={need?.area?.bbox ?? null} />
        ) : (
          <ProjectStep need={need} lotCount={s.lots.length} cost={cost} costLoading={costLoading} costError={costError} tenure={s.tenure} onTenure={setTenure} own={s.own} onOwn={(own) => update({ own })} perLot={s.perLot} onPerLot={(perLot) => update({ perLot })}
            bedrooms={s.bedrooms} onBedrooms={(bedrooms) => update({ bedrooms })} mix={s.mix} onMix={(mix) => update({ mix })} sources={s.sources} onSources={(sources) => update({ sources })} onExport={exportBrief} />
        )}
      </div>
    </SeatLayout>
  );
}
