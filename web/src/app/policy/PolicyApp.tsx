"use client";

// Policy Analyst seat: "Test a rule change". Levers on the left, the outcome headline row, the policy
// wave map, and tabs (Where / Who / Fiscal ledger / Method). Every number comes from the precomputed
// lever state (public.policy_states / policy_results) and the stored inputs (policy_meta); a state
// nobody has computed yet is queued for the background job and shown with its progress.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import {
  DataDateFooter, EmptyState, ExportMenu, FilterRail, RangeSlider, RangeValue, ReceiptButton, Segmented, SeatButton,
  SeatHeader, SeatLayout, SeatSelect, StatCard, Switch, fmtMoney, formatRange, roundRange, roundSig, useSeatSelection, type Receipt,
} from "@/components/seats";
import type { PolicyPoint, Who } from "@/lib/policy/data";
import {
  ADU_RULES, CONTEXTUAL_FRONT_FT, DEFAULT_ABATEMENT, HEIGHT_ADD, LEVER_METHOD, MATCH_BLOCK, NOT_COMPUTED_NOTE, activeLevers, parseKey as parseLevers, fiscal, goalSeek, homesRange, leverSentence, newlyRange, normalize, scenarioToQuery, stateKey,
  type LeverState, type Places, type PolicyMeta, type PolicyState, type Scenario,
} from "@/lib/policy/model";
import { FiscalTab, MethodTab, WhereTab, WhoTab } from "./PolicyTabs";
import GoalSeek from "./GoalSeek";
import "./policy.css";

const PolicyMap = dynamic(() => import("./PolicyMap"), { ssr: false, loading: () => <div className="pol-map-loading">Loading map…</div> });

type Tab = "where" | "who" | "fiscal" | "method";
const TABS: { id: Tab; label: string }[] = [
  { id: "where", label: "Where" }, { id: "who", label: "Who" }, { id: "fiscal", label: "Fiscal ledger" }, { id: "method", label: "Method" },
];
const SAVED_KEY = "es.policy.scenarios";
// Saved scenarios live in this browser only (a per-viewer convenience); every read is guarded.
function readSavedRaw(): string {
  try { return localStorage.getItem(SAVED_KEY) ?? "[]"; } catch { return "[]"; }
}
function parseSaved(raw: string): Saved[] {
  try { const x = JSON.parse(raw); return Array.isArray(x) ? (x as Saved[]) : []; } catch { return []; }
}
function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
const PRESETS: { value: string; label: string }[] = [
  { value: "a35.m0", label: "Starter homes" },
  { value: "a35", label: "Attached on narrow lots" },
  { value: "m0", label: "No minimum lot size" },
  { value: "pt", label: "Transit parking" },
  { value: "a35.m0.pn", label: "All three levers" },
  { value: "adu", label: "ADUs by right" },
  { value: "cs", label: "Contextual front setback" },
  { value: "h1", label: "One more story" },
];

interface Saved { name: string; q: string }

/** Start a file download from an API route (the response is an attachment, so the page stays). */
function download(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** True when two-significant-figure rounding of the whole range hides a nonzero likely value. */
const hiddenLikely = (r: { low: number; likely: number; high: number }) => r.likely > 0 && roundRange(r).likely === 0;

export interface DataFlags { acs: boolean; geo: boolean }

export default function PolicyApp({ initial, initialState, meta, states, flags }: {
  initial: Scenario; initialState: PolicyState; meta: PolicyMeta | null; states: PolicyState[]; flags: DataFlags;
}) {
  const [sc, setSc] = useState<Scenario>(initial);
  const [fetched, setFetched] = useState<PolicyState | null>(null);
  const [pts, setPts] = useState<{ key: string; points: PolicyPoint[] } | null>(null);
  const [ctx, setCtx] = useState<{ key: string; places: Places | null; who: Who | null } | null>(null);
  const [tab, setTab] = useState<Tab>("where");
  const [name, setName] = useState("");
  const [savedLocal, setSavedLocal] = useState<Saved[] | null>(null);
  const savedRaw = useSyncExternalStore(subscribeStorage, readSavedRaw, () => "[]");
  const saved = useMemo(() => savedLocal ?? parseSaved(savedRaw), [savedLocal, savedRaw]);
  const [goalOpen, setGoalOpen] = useState(false);
  const [allStates, setAllStates] = useState<PolicyState[]>(states);
  const selection = useSeatSelection();
  const key = stateKey(sc.levers);
  const reqId = useRef(0);

  // Keep the URL shareable (lever state + abatement), without a navigation.
  useEffect(() => {
    const q = scenarioToQuery(sc);
    window.history.replaceState(null, "", `/policy?${q.toString()}`);
  }, [sc]);

  // The state for the current levers: the server's copy when it matches, else what we fetched.
  const placeholder: PolicyState = { key, status: "queued", done: 0, total: null, summary: null, computed_at: null, config_version: null };
  const st: PolicyState = fetched?.key === key ? fetched : key === initialState.key ? initialState : placeholder;

  // Load the state; poll while the background job works on it.
  useEffect(() => {
    const id = ++reqId.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const r = await fetch(`/api/policy/state?s=${encodeURIComponent(key)}`, { cache: "no-store" });
        const s = (await r.json()) as PolicyState;
        if (id !== reqId.current) return;
        setFetched(s);
        if (!["done", "missing", "cancelled", "failed"].includes(s.status) && key !== "base") timer = setTimeout(load, 8000);
      } catch {
        if (id === reqId.current) timer = setTimeout(load, 15000);
      }
    };
    if (key !== initialState.key || initialState.status !== "done") void load();
    return () => { if (timer) clearTimeout(timer); };
  }, [key, initialState]);

  // Map points and geography/census context: reload when the state changes or the job makes progress.
  const progressMark = `${st.key}:${st.status}:${st.done}`;
  useEffect(() => {
    if (key === "base") return;
    let live = true;
    fetch(`/api/policy/points?s=${encodeURIComponent(key)}`).then((r) => r.json()).then((p: PolicyPoint[]) => {
      if (live) setPts({ key, points: p });
    }).catch(() => {});
    fetch(`/api/policy/context?s=${encodeURIComponent(key)}`, { cache: "no-store" }).then((r) => r.json()).then((c: { places: Places | null; who: Who | null }) => {
      if (live) setCtx({ key, ...c });
    }).catch(() => {});
    return () => { live = false; };
  }, [key, progressMark]);
  const points = pts?.key === key ? pts.points : [];
  const places = ctx?.key === key ? ctx.places : null;
  const who = ctx?.key === key ? ctx.who : null;

  const setLevers = useCallback((l: Partial<LeverState>) => setSc((s) => ({ ...s, levers: normalize({ ...s.levers, ...l }) })), []);
  const summary = st.key === key ? st.summary : null;
  const fis = useMemo(() => (summary ? fiscal(summary, meta, sc.abatement, places) : null), [summary, meta, sc.abatement, places]);
  const active = activeLevers(sc.levers);
  const pctDone = st.total ? Math.round((100 * st.done) / st.total) : 0;
  const finished = st.status === "done";

  const exportQ = () => {
    const q = scenarioToQuery(sc);
    if (name.trim()) q.set("name", name.trim());
    return q.toString();
  };

  const onPreset = (v: string) => {
    const hit = saved.find((s) => `saved:${s.name}` === v);
    const q = new URLSearchParams(hit ? hit.q : `s=${v}`);
    const lv = q.get("s") ?? "base";
    const m = /^(\d{1,3})x(\d{1,2})$/.exec(q.get("abate") ?? "");
    setSc({ levers: normalize(parseLevers(lv)), abatement: m ? { on: true, sharePct: Number(m[1]), years: Number(m[2]) } : DEFAULT_ABATEMENT });
    if (hit) setName(hit.name);
  };
  const save = () => {
    const nm = name.trim() || leverSentence(sc.levers).slice(0, 60);
    const next = [{ name: nm, q: scenarioToQuery(sc).toString() }, ...saved.filter((s) => s.name !== nm)].slice(0, 12);
    setSavedLocal(next);
    setName(nm);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* storage unavailable: keep in memory */ }
  };

  const openGoal = async () => {
    setGoalOpen(true);
    try { setAllStates((await (await fetch("/api/policy/state?all=1", { cache: "no-store" })).json()) as PolicyState[]); } catch { /* keep the list we have */ }
  };

  // ------------------------------------------------------------------------------ receipts
  const dates = meta?.sales_window ? `${meta.sales_window.earliest} to ${meta.sales_window.latest}` : "not loaded";
  const rHomes: Receipt[] = [{
    label: "Additional homes allowed by right", source: "EaseScore.AI engine (QuickFit lot-fit test + Ease Score config v0.2) on City of Pittsburgh parcels",
    date: summary?.computed_at?.slice(0, 10) ?? "computing", kind: "data",
    method: "For each parcel a lever applies to, the zoning rules are rewritten for the lever and the lot-fit test is rerun. Homes allowed by right = the most homes any new-building option fits with the use permitted and no dimensional relief. The number is the sum of (after − before) over parcels that gain. Likely: every home the fit test finds. Low end: only homes that need no lot split (townhouse rows need a subdivision plan) and, for ADUs, only lots where the ADU footprint check passes. High end: adds lots the fit test could not finish in time, at the average gain per lot tested, so when nearly every lot finished, likely and high round to the same number.",
    notes: "Capacity is not production: it says what the rules would allow, not what will be built or when.",
  }, ...(sc.levers.adu ? [{
    label: "ADUs by right (scenario ADU rules)", source: "EaseScore.AI policy lever; county assessment use and building footprint; zoning table setbacks",
    date: summary?.computed_at?.slice(0, 10) ?? "computing", kind: "assumption" as const,
    method: LEVER_METHOD.adu,
    notes: `ADU rules are a scenario setting (size cap ${ADU_RULES.maxFloorAreaSf} sq ft; footprint ${ADU_RULES.minWidthFt} × ${ADU_RULES.minDepthFt} ft minimum; ${ADU_RULES.separationFt} ft from the house), not Pittsburgh code.`,
  }] : []), ...(sc.levers.contextual ? [{
    label: "Contextual front setback", source: `Ease Score config v0.2 contextual front setback assumption (${CONTEXTUAL_FRONT_FT} ft); Pittsburgh Zoning Code §925.06`,
    date: "config v0.2", kind: "assumption" as const, method: LEVER_METHOD.contextual,
  }] : []), ...(sc.levers.height ? [{
    label: "One more story", source: "EaseScore.AI zoning table (max stories and height per district)",
    date: "config v0.2", kind: "assumption" as const, method: LEVER_METHOD.height,
  }] : [])];
  const rNewly: Receipt[] = [{
    label: "Parcels newly buildable by right", source: rHomes[0]!.source, date: rHomes[0]!.date, kind: "data",
    method: "Parcels a lever applies to that allow no new home by right under today's code and allow at least one after the change (same lot-fit test as the homes count). Low end: only parcels that need no lot split. High end: adds lots the fit test could not finish in time, in proportion to the lots tested.",
    notes: "A parcel counts once however many homes it gains.",
  }, ...rHomes.slice(1)];
  const rPencil: Receipt[] = meta ? [{
    label: "Homes that plausibly pencil at today's prices", source: "Allegheny County sales and assessments (new-construction sales); cost assumptions v0.1 (Pittsburgh builder published ranges)",
    date: dates, kind: "assumption",
    method: `Sale value = nearby new-construction price per finished sq ft (low quartile / median / high quartile) × the scheme's finished area. Cost = construction $${meta.cost_basis.costPsf.low}/$${meta.cost_basis.costPsf.likely}/$${meta.cost_basis.costPsf.high} per sq ft (low/likely/high scenario) × gross area × (1 + soft costs ${Math.round(meta.cost_basis.softShare.likely * 100)}% + contingency ${Math.round(meta.cost_basis.contingencyShare * 100)}%) + the lot at its assessed value. Pencils when the margin after ${Math.round(meta.cost_basis.brokerShare * 100)}% selling costs is at least ${Math.round(meta.cost_basis.minMargin * 100)}% of cost. Low = low prices and high costs; high = high prices and low costs.`,
    notes: `${meta.rule} Parcels with no nearby new-construction sales use the City-wide quartiles (${meta.citywide.n} sales).`,
  }] : [];
  const rTax: Receipt[] = meta && fis ? [{
    label: "New tax revenue at build-out, per year", source: fis.rows.map((r) => `${r.body.name} ${r.body.mills} mills (${r.body.year})`).join("; "),
    url: fis.rows[0]?.body.sourceUrl, date: String(fis.rows[0]?.body.year ?? ""), kind: "data",
    method: `For homes that pencil in each scenario: added assessed value = the added homes’ share of the scheme’s sale value (homes added ÷ homes in the scheme) × assessment ratio ${meta.ratio.p50} (median assessed value ÷ sale price of ${meta.ratio.n} recent new-construction sales in the City) − the existing building’s assessed value on lots that had no by-right home before. Homes the current code already allows are not credited to the change. Revenue = added assessed value × mills ÷ 1,000, per taxing body.`,
    notes: "Assumes every home that pencils is built. Earned income, wage and other taxes are not counted.",
  }] : [];

  // ------------------------------------------------------------------------------ render
  const header = (
    <SeatHeader
      seat="policy"
      controls={
        <>
          <SeatSelect label="Geography" value="pgh" onChange={() => {}} options={[
            { value: "pgh", label: "City of Pittsburgh" },
            { value: "other", label: "Other municipalities (zoning not loaded)", disabled: true },
          ]} />
          <SeatSelect label="Scenario" value={PRESETS.some((p) => p.value === key) ? key : ""} onChange={onPreset} options={[
            { value: "", label: "Scenario: custom" },
            ...PRESETS.map((p) => ({ value: p.value, label: `Scenario: ${p.label}` })),
            ...saved.map((s) => ({ value: `saved:${s.name}`, label: `Saved: ${s.name}` })),
          ]} />
        </>
      }
      actions={
        <>
          <SeatButton onClick={openGoal}>Goal seek</SeatButton>
          <SeatButton onClick={save}>Save</SeatButton>
          <ExportMenu label="Council packet" actions={[
            { id: "packet", label: "Council packet (3 pages)", format: "PDF", description: "Fiscal note, housing outcome with map, assumptions and sources",
              disabled: !summary || key === "base", disabledReason: "Turn on a lever first",
              onSelect: () => { download(`/api/policy/packet?${exportQ()}`); } },
            { id: "csv", label: "Parcels that gain homes", format: "CSV", description: "Each parcel that gains homes by right: before and after, pencils, added assessed value",
              disabled: key === "base", disabledReason: "Turn on a lever first",
              onSelect: () => { download(`/api/policy/csv?${exportQ()}`); } },
            { id: "csv-all", label: "Every parcel a lever applies to (full City)", format: "CSV", description: "Also the parcels that gain nothing; about 100,000 rows, takes about half a minute",
              disabled: key === "base", disabledReason: "Turn on a lever first",
              onSelect: () => { download(`/api/policy/csv?${exportQ()}&all=1`); } },
          ]} />
        </>
      }
    />
  );

  const left = (
    <FilterRail intro="Change the rules. Results update for every parcel the change applies to; nothing else is recomputed.">
      <div className="pol-levers">
      <label className="pol-name">
        <span className="es-field-label">Scenario name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Starter homes 2026" maxLength={80} />
      </label>
      <div className={`pol-lever${sc.levers.attached.on ? " is-on" : ""}`}>
        <Switch label="Attached homes by right" checked={sc.levers.attached.on} onChange={(v) => setLevers({ attached: { ...sc.levers.attached, on: v } })}
          hint="Two homes sharing a wall on one narrow lot, in single-unit districts (R1D, R1A)" />
        <RangeSlider label="On lots up to" min={25} max={50} step={5} value={sc.levers.attached.maxWidthFt}
          format={(v) => `${v} ft`} ends={["25 ft", "50 ft"]} disabled={!sc.levers.attached.on}
          onChange={(v: number) => setLevers({ attached: { on: true, maxWidthFt: v } })} />
      </div>
      <div className={`pol-lever${sc.levers.minLot.on ? " is-on" : ""}`}>
        <Switch label="Minimum lot size" checked={sc.levers.minLot.on} onChange={(v) => setLevers({ minLot: { on: v, share: v ? 0 : 1 } })}
          hint="Minimum lot size and lot area per unit, from today's code down to none" />
        <RangeSlider label="Share of today's minimum" min={0} max={75} step={25} value={Math.round(sc.levers.minLot.share * 100)}
          format={(v) => (v === 0 ? "None" : `${v}%`)} ends={["None", "75% of today"]} disabled={!sc.levers.minLot.on}
          onChange={(v: number) => setLevers({ minLot: { on: true, share: v / 100 } })} />
      </div>
      <div className={`pol-lever${sc.levers.parking !== "current" ? " is-on" : ""}`}>
        <Segmented label="Parking minimums" size="sm" value={sc.levers.parking} onChange={(v) => setLevers({ parking: v })}
          options={[{ value: "current", label: "Current" }, { value: "transit", label: "None near transit", title: "No minimum within ¼ mile of a frequent-transit stop" }, { value: "none", label: "Eliminated" }]} />
      </div>
      <div className={`pol-lever${sc.levers.adu ? " is-on" : ""}`}>
        <Switch label="ADUs by right" checked={sc.levers.adu} onChange={(v) => setLevers({ adu: v })}
          hint={`One backyard home up to ${ADU_RULES.maxFloorAreaSf} sq ft beside a detached house (R1D, R1A, R2, R3, RM). Scenario ADU rules; our zoning table has none.`} />
      </div>
      <div className={`pol-lever${sc.levers.contextual ? " is-on" : ""}`}>
        <Switch label="Contextual front setback" checked={sc.levers.contextual} onChange={(v) => setLevers({ contextual: v })}
          hint={`Front setback = the neighbors' average, by right (assumed ${CONTEXTUAL_FRONT_FT} ft; neighbors are not measured)`} />
      </div>
      <div className={`pol-lever${sc.levers.height ? " is-on" : ""}`}>
        <Switch label="One more story" checked={sc.levers.height} onChange={(v) => setLevers({ height: v })}
          hint={`+${HEIGHT_ADD.stories} story and +${HEIGHT_ADD.ft} ft on today's height limit in residential districts`} />
      </div>
      <div className={`pol-lever${sc.levers.matchBlock ? " is-on" : ""}`}>
        <Switch label="Match the block" checked={!!sc.levers.matchBlock} onChange={(v) => setLevers({ matchBlock: v })}
          hint={`New buildings matching the block's measured pattern (front line within ${MATCH_BLOCK.frontToleranceFt} ft, side yards, lot size) approved administratively`} />
      </div>
      <div className={`pol-lever${sc.abatement.on ? " is-on" : ""}`}>
        <Switch label="Tax abatement for new homes" checked={sc.abatement.on} onChange={(v) => setSc((s) => ({ ...s, abatement: { ...s.abatement, on: v } }))}
          hint="LERTA-style phase-in of the added value (illustrative terms). Changes the fiscal ledger only." />
        <RangeSlider label="Share abated" min={10} max={100} step={10} value={sc.abatement.sharePct} disabled={!sc.abatement.on}
          format={(v) => `${v}%`} onChange={(v: number) => setSc((s) => ({ ...s, abatement: { ...s.abatement, sharePct: v } }))} />
        <RangeSlider label="Years" min={1} max={15} step={1} value={sc.abatement.years} disabled={!sc.abatement.on}
          format={(v) => `${v} yr`} onChange={(v: number) => setSc((s) => ({ ...s, abatement: { ...s.abatement, years: v } }))} />
      </div>
      </div>

      <p className="pol-muted pol-try pol-pad">Try this: attached homes on lots up to 35 ft plus no minimum lot size (the “Starter homes” scenario), then open the Fiscal ledger.</p>
    </FilterRail>
  );

  const doneKeys = new Set(allStates.filter((x) => x.status === "done").map((x) => x.key));
  // Presets whose state is finished; while the batch is still finishing them, the five it precomputes.
  const donePresets = PRESETS.filter((p) => doneKeys.has(p.value));
  const computedPresets = donePresets.length ? donePresets : PRESETS.slice(0, 5);
  const h = summary ? homesRange(summary) : null;
  const nb = summary ? newlyRange(summary) : null;

  return (
    <SeatLayout header={header} left={left} leftLabel="Levers" leftWidth={320} mainLabel="Policy test results"
      footer={<DataDateFooter
        sources={[
          { name: "Parcel results (EaseScore.AI engine, config v0.2)", date: summary?.computed_at?.slice(0, 10) ?? "computing" },
          { name: "Allegheny County new-construction sales", date: meta?.sales_window?.latest ?? "not loaded" },
          { name: "Millage (County Treasurer)", date: fis?.rows[0]?.body.year ? String(fis.rows[0].body.year) : "not loaded" },
        ]}
        note="Capacity is not production. Scenario analysis for discussion, not a forecast or a legal reading of the Zoning Code."
      />}
    >
      <div className="pol-main">
        {key === "base" ? (
          <div className="pol-banner">Every lever is off: this is today’s code, so nothing changes. Turn on a lever to see what it unlocks.</div>
        ) : st === placeholder ? (
          <div className="pol-banner" role="status" aria-live="polite">Checking whether this combination is computed…</div>
        ) : st.status === "missing" || st.status === "cancelled" || st.status === "failed" ? (
          <div className="pol-banner" role="status" aria-live="polite">
            {NOT_COMPUTED_NOTE[key]
              ? <><strong>{NOT_COMPUTED_NOTE[key]}</strong> {key === "cs" ? LEVER_METHOD.contextual : key === "h1" ? LEVER_METHOD.height : key === "mb" ? <MatchBlockScreen /> : ""}</>
              : <strong>Not precomputed for this demo — try a preset.</strong>}
            {computedPresets.length ? (
              <span className="pol-presetlinks"> {donePresets.length ? "Computed" : "Precomputed scenarios"}: {computedPresets.map((p, i) => (
                <span key={p.value}>{i ? " · " : ""}<button type="button" className="pol-linkbtn" onClick={() => onPreset(p.value)}>{p.label}</button></span>
              ))}</span>
            ) : null}
          </div>
        ) : !finished ? (
          <div className="pol-banner" role="status" aria-live="polite">
            {st.status === "queued"
              ? <><strong>Queued: computing overnight (position {(st.ahead ?? 0) + 1}).</strong> This combination has not been computed yet; results appear here as parcels are done (a full City run takes a few hours). Precomputed now: Starter homes, each of the first three levers alone, and all three.</>
              : `Computing this combination in the background: ${st.done} of ${st.total ?? "?"} parcel batches (${pctDone}%). Numbers so far cover only the parcels done; they will grow.`}
            <span className="pol-progress" aria-hidden="true"><span style={{ width: `${pctDone}%` }} /></span>
          </div>
        ) : null}

        <section className="pol-headline" aria-label="Outcome">
          <StatCard variant="band" label="More homes allowed by right" receipt={<ReceiptButton receipts={rHomes} />}
            value={h ? <RangeValue value={h} size="lg" signed /> : <span className="pol-dash">—</span>}
            sub={active.length ? "vs. today’s code" : "no rule change"} />
          <StatCard variant="band" label="Parcels newly buildable by right" receipt={<ReceiptButton receipts={rNewly} />}
            value={nb ? <RangeValue value={nb} size="lg" /> : <span className="pol-dash">—</span>}
            sub={summary ? `of ${summary.eligible.toLocaleString()} parcels a lever applies to` : " "} />
          <StatCard variant="band" label="Likely to pencil at today’s prices" receipt={rPencil.length ? <ReceiptButton receipts={rPencil} /> : undefined}
            value={summary ? <RangeValue value={summary.homes_pencil} size="lg" /> : <span className="pol-dash">—</span>}
            sub="homes · capacity is not production" />
          <StatCard variant="band" label="New tax revenue at build-out" receipt={rTax.length ? <ReceiptButton receipts={rTax} /> : undefined}
            value={fis ? <RangeValue value={fis.total} format="money" size="lg" /> : summary ? <span className="pol-dash">Millage not loaded</span> : <span className="pol-dash">—</span>}
            sub={fis ? <>{fis.abatement ? `per year after the abatement; ${formatRange(fis.abatementTotal, { format: "money" })}/yr forgone while it runs` : "per year, all taxing bodies"}{hiddenLikely(fis.total) ? ` · likely about ${fmtMoney(roundSig(fis.total.likely))}` : ""}</> : " "} />
        </section>

        <div className="pol-mapwrap">
          <PolicyMap points={points} loading={key !== "base" && pts?.key !== key} levers={[...new Set(points.map((p) => p[4]))]} />
        </div>

        <div className="pol-tabs" role="tablist" aria-label="Result details">
          {TABS.map((t) => (
            <button key={t.id} role="tab" id={`pol-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`pol-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1} className={tab === t.id ? "is-active" : ""} onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                const i = TABS.findIndex((x) => x.id === tab);
                const n = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : -1;
                if (n >= 0) { setTab(TABS[n]!.id); document.getElementById(`pol-tab-${TABS[n]!.id}`)?.focus(); }
              }}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="pol-panel" role="tabpanel" id={`pol-panel-${tab}`} aria-labelledby={`pol-tab-${tab}`}>
          {!summary && key !== "base" ? (["missing", "cancelled", "failed"].includes(st.status) && st !== placeholder
            ? <EmptyState title="Not computed for this demo">Pick a precomputed scenario from the Scenario menu or the list above.</EmptyState>
            : <EmptyState title="Results are still being computed" tone="pending">The first parcels appear here within a minute or two.</EmptyState>) : null}
          {summary && tab === "where" ? <WhereTab summary={summary} flags={flags} places={places} highlight={selection.neighborhood ?? null} /> : null}
          {tab === "who" ? <WhoTab flags={flags} who={who} computing={!finished} /> : null}
          {summary && tab === "fiscal" ? <FiscalTab summary={summary} fis={fis} meta={meta} /> : null}
          {tab === "method" ? <MethodTab meta={meta} levers={sc.levers} summary={summary} /> : null}
        </div>
      </div>
      {goalOpen ? (
        <GoalSeek states={allStates} onClose={() => setGoalOpen(false)} onApply={(k) => { setSc((s) => ({ ...s, levers: parseLevers(k) })); setGoalOpen(false); }} rank={goalSeek} />
      ) : null}
    </SeatLayout>
  );
}


type BlockScreen = { parcels: number; vacant: number; neighborhoods: number; by_rule: { front: number; side: number; lot_area: number }; top_vacant: { neighborhood: string; vacant: number }[] | null };

/** "Match the block" screen: lots whose block is looser than the code (precomputed, migration 131). Not a rescoring. */
function MatchBlockScreen() {
  const [d, setD] = useState<BlockScreen | null>(null);
  useEffect(() => {
    fetch("/api/policy/block-screen").then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null));
  }, []);
  const n = (x: number) => x.toLocaleString("en-US");
  return (
    <span className="pol-block-screen">
      {LEVER_METHOD.matchBlock}
      {d ? (
        <span style={{ display: "block", marginTop: 6 }}>
          <strong>Screen (eligibility, not homes):</strong> {n(d.parcels)} residential lots in {d.neighborhoods} neighborhoods sit on blocks looser than the code
          ({n(d.by_rule.front)} on the front setback, {n(d.by_rule.side)} side, {n(d.by_rule.lot_area)} lot size); {n(d.vacant)} of them are vacant
          {d.top_vacant?.length ? ` (most in ${d.top_vacant.slice(0, 3).map((t) => `${t.neighborhood} ${n(t.vacant)}`).join(", ")})` : ""}.
        </span>
      ) : null}
    </span>
  );
}
