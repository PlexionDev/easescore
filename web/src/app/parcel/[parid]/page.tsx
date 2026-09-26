import Link from "next/link";
import { notFound } from "next/navigation";
import { evaluateRequirements, PHASE_ORDER, type ParcelFacts, type ProjectAnswers, type RequirementResult } from "@easescore/engine";
import { parcelFacts, parcelMap, quickfitInput, rentComps, salesComps } from "@/lib/data";
import QuickFitPanel from "./QuickFitPanel";
import ParcelMap from "./ParcelMap";

const STATUS_STYLE: Record<string, string> = {
  REQUIRED: "bg-red-100 text-red-800",
  LIKELY: "bg-orange-100 text-orange-800",
  POSSIBLE: "bg-yellow-100 text-yellow-800",
  ASK: "bg-blue-100 text-blue-800",
  NOT_NEEDED: "bg-zinc-100 text-zinc-600",
};
const PHASE_LABEL: Record<string, string> = {
  due_diligence: "Due diligence", design_engineering: "Design & engineering", zoning: "Zoning",
  permits: "Permits", construction: "Construction", closeout: "Closeout",
};

function readProject(sp: Record<string, string | string[] | undefined>): ProjectAnswers {
  const s = (k: string) => (typeof sp[k] === "string" && sp[k] !== "" ? (sp[k] as string) : undefined);
  const n = (k: string) => (s(k) !== undefined ? Number(s(k)) : undefined);
  const b = (k: string) => (s(k) === "yes" ? true : s(k) === "no" ? false : undefined);
  return {
    type: s("type") as ProjectAnswers["type"], units: n("units"), stories: n("stories"),
    financed: b("financed"), party_wall: b("party_wall"), touches_street: b("touches_street"),
    new_driveway: b("new_driveway"), lot_split_or_merge: b("lot_split"), cut_fill_over_25: b("cut_fill"),
    minor_work: s("minor_work") as ProjectAnswers["minor_work"],
  };
}

// v0.5 display-only red flags. The scoring algorithm (red flags never averaged into site ease) comes later.
function preliminaryRedFlags(f: ParcelFacts & Record<string, any>, p: ProjectAnswers) {
  const flags: { title: string; reason: string }[] = [];
  const fw = f.flood_evidence?.floodway_share ?? 0;
  if (fw > 0) flags.push({ title: "In the FEMA floodway", reason: `${Math.round(fw * 100)}% of the lot. New buildings and fill are heavily restricted.` });
  if (f.street_frontage === "none") flags.push({ title: "No street access found", reason: "No street centerline within 20 m of the lot: possibly landlocked or reached only by steps. Confirm legal access." });
  if (f.street_frontage === "paper") flags.push({ title: "Only an unopened (paper) street", reason: "The adjoining street is unopened; construction access may require a right-of-way process." });
  if (f.condemned) flags.push({ title: "Condemned / dead-end property", reason: "Active City condemnation record." });
  const hist = f.overlays?.find((o: any) => o.layer === "historic_district_pgh" && o.share > 0);
  if (hist && p.type === "demolition") flags.push({ title: "Demolition in a historic district", reason: `${hist.label}: demolition needs Historic Review Commission approval.` });
  return flags;
}

function money(v: unknown) {
  return typeof v === "number" ? `$${Math.round(v).toLocaleString()}` : "—";
}

export default async function ParcelPage({ params, searchParams }: PageProps<"/parcel/[parid]">) {
  const { parid } = await params;
  const sp = await searchParams;
  const [facts, sales, rent, mapData, qfInput] = await Promise.all([parcelFacts(parid), salesComps(parid), rentComps(parid), parcelMap(parid), quickfitInput(parid)]);
  if (!facts) notFound();
  const f = facts as unknown as ParcelFacts & Record<string, any>;
  const project = readProject(sp);
  const results = evaluateRequirements(f, project);
  const flags = preliminaryRedFlags(f, project);
  const a = f.assessment;
  const byPhase = PHASE_ORDER.map((ph) => [ph, results.filter((r) => r.phase === ph)] as const);
  const counts = results.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  const s = sales as any, r = rent as any;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">← Search</Link>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-amber-700">v0.5 internal test build</p>
      <h1 className="text-2xl font-bold">{a?.address || parid}</h1>
      <p className="text-zinc-600">
        {a?.municipality} · {f.zoning?.code ? `Zoned ${f.zoning.code}` : "Zoning not available"} · {a?.use} · Parcel {parid}
      </p>

      {mapData && <section className="mt-4"><ParcelMap data={mapData} /></section>}

      {/* 1. Red flags — above everything, never averaged in */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold">Red flags <span className="text-xs font-normal text-zinc-500">(preliminary)</span></h2>
        {flags.length ? (
          <ul className="mt-2 space-y-2">
            {flags.map((x) => (
              <li key={x.title} className="rounded border border-red-300 bg-red-50 px-3 py-2"><b>{x.title}.</b> {x.reason}</li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm text-zinc-600">None found in our data.</p>}
      </section>

      {/* 2. Site ease — placeholder until the algorithm phase */}
      <section className="mt-6 rounded border border-dashed border-zinc-300 p-4">
        <h2 className="text-lg font-semibold">Site ease</h2>
        <p className="text-sm text-zinc-600">Not scored yet. The scoring algorithm is built after the data is complete. Financial results are shown separately.</p>
      </section>

      {/* QuickFit: what fits on this lot */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold">QuickFit: what fits here <span className="text-xs font-normal text-zinc-500">(single-family, duplex, townhouse row)</span></h2>
        {qfInput ? <QuickFitPanel input={qfInput} rules={(f.zoning as any)?.rules ?? null} zoneCode={f.zoning?.code ?? null} /> : <p className="text-sm text-zinc-600">No lot geometry available.</p>}
      </section>

      {/* Project answers */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold">Your project</h2>
        <form className="mt-2 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <label className="flex flex-col">Project type
            <select name="type" defaultValue={String(sp.type ?? "")} className="rounded border px-2 py-1">
              <option value="">— not set —</option><option value="new_build">New build</option><option value="addition">Addition</option>
              <option value="rehab">Rehab</option><option value="demolition">Demolition</option><option value="conversion">Conversion</option>
            </select></label>
          <label className="flex flex-col">Units<input name="units" type="number" min={1} defaultValue={String(sp.units ?? "")} className="rounded border px-2 py-1" /></label>
          <label className="flex flex-col">Stories<input name="stories" type="number" min={1} defaultValue={String(sp.stories ?? "")} className="rounded border px-2 py-1" /></label>
          <label className="flex flex-col">Smaller work
            <select name="minor_work" defaultValue={String(sp.minor_work ?? "")} className="rounded border px-2 py-1">
              <option value="">—</option><option value="deck">Deck</option><option value="porch">Porch</option><option value="parking_pad">Parking pad</option>
              <option value="stoop">Stoop</option><option value="balcony">Balcony</option><option value="retaining_wall">Retaining wall</option>
            </select></label>
          {([["financed", "Financed?"], ["party_wall", "Rowhouse / party wall?"], ["touches_street", "Work blocks street/sidewalk?"],
             ["new_driveway", "New driveway?"], ["lot_split", "Combine or split lots?"], ["cut_fill", "Cut/fill slopes over 25%?"]] as const).map(([k, label]) => (
            <label key={k} className="flex flex-col">{label}
              <select name={k} defaultValue={String(sp[k] ?? "")} className="rounded border px-2 py-1">
                <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
              </select></label>
          ))}
          <button className="col-span-2 rounded bg-zinc-900 px-3 py-2 text-white md:col-span-4">Update checklist</button>
        </form>
      </section>

      {/* 3. Requirements checklist */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Process checklist</h2>
        <p className="text-sm text-zinc-600">
          {Object.entries(counts).map(([k, v]) => `${v} ${k.replace("_", " ").toLowerCase()}`).join(" · ")}
        </p>
        {byPhase.map(([ph, items]) => items.length > 0 && (
          <div key={ph} className="mt-4">
            <h3 className="font-semibold text-zinc-700">{PHASE_LABEL[ph]}</h3>
            <ul className="mt-1 divide-y divide-zinc-100 rounded border border-zinc-200">
              {items.map((it: RequirementResult) => (
                <li key={it.id} className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[it.status]}`}>{it.status.replace("_", " ")}</span>
                    <div className="min-w-0">
                      <p className="font-medium">{it.item} <span className="text-xs font-normal text-zinc-500">· {it.issuer}</span></p>
                      {it.reasons.slice(0, 3).map((t, i) => (
                        <p key={i} className="text-sm text-zinc-700">{i > 0 && <span className="text-zinc-400">also: </span>}{t.reason}{t.source && <span className="text-zinc-400"> [{t.source}]</span>}</p>
                      ))}
                      {it.advisories.map((adv, i) => (
                        <p key={`a${i}`} className="mt-1 rounded bg-sky-50 px-2 py-1 text-sm text-sky-900">ⓘ {adv}</p>
                      ))}
                      {it.citation && <p className="mt-0.5 text-xs text-zinc-500">Citation: {it.citation}</p>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* 4. Financial evidence — separate from site ease */}
      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded border border-zinc-200 p-4">
          <h2 className="text-lg font-semibold">Sales comps</h2>
          <p className="text-sm">
            <span className={s?.status === "ok" ? "text-green-700" : "text-red-700"}>{s?.status ?? "unavailable"}</span>
            {s && ` · ${s.count} ${s.comparable_use} sales · within ${s.radius_mi} mi · ${s.date_range?.from ?? "?"} → ${s.date_range?.to ?? "?"}`}
          </p>
          {s?.fallback_note && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">{s.fallback_note}</p>}
          {s?.note && <p className="mt-1 text-sm text-zinc-600">{s.note}</p>}
          {s?.status === "ok" && <p className="mt-1 text-sm">Median {money(s.median_price)} · {money(s.median_price_per_sqft)}/sq ft</p>}
          <ul className="mt-2 max-h-56 overflow-auto text-xs text-zinc-600">
            {(s?.comps ?? []).map((c: any) => (
              <li key={`${c.parid}${c.sale_date}`}>{c.sale_date} · {money(c.price)} · {c.address} · {c.distance_mi} mi</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-400">{s?.rules}</p>
        </div>
        <div className="rounded border border-zinc-200 p-4">
          <h2 className="text-lg font-semibold">Rent evidence</h2>
          {r?.note && <p className="text-sm text-zinc-600">{r.note}</p>}
          {r?.zori && <p className="mt-1 text-sm">Zillow rent index (ZIP {r.zori.zip}): {money(r.zori.latest_rent)}/mo ({r.zori.latest_month}); a year earlier {money(r.zori.rent_12m_ago)}</p>}
          {r?.hud_fmr && <p className="mt-1 text-sm">HUD Fair Market Rent {r.hud_fmr.year} ({r.hud_fmr.level}): 1BR {money(r.hud_fmr.br1)} · 2BR {money(r.hud_fmr.br2)} · 3BR {money(r.hud_fmr.br3)}</p>}
          <p className="mt-1 text-sm text-zinc-500">RentEase: {r?.rentease?.status ?? "not available"}</p>
        </div>
      </section>

      {/* Raw facts for checking the data */}
      <details className="mt-8 rounded border border-zinc-200 p-3">
        <summary className="cursor-pointer font-semibold">All parcel facts (raw data, for checking)</summary>
        <pre className="mt-2 max-h-[32rem] overflow-auto text-xs">{JSON.stringify(facts, null, 2)}</pre>
      </details>

      <p className="mt-8 text-xs text-zinc-500">Decision support only. Verify with your lender, accountant, and the permitting office.</p>
    </main>
  );
}
