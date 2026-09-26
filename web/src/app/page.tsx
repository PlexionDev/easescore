import Link from "next/link";
import { searchParcels } from "@/lib/data";
import HeroBackdrop from "./_hero/HeroBackdrop";

export default async function Home({ searchParams }: PageProps<"/">) {
  const q = String((await searchParams).q ?? "");
  const hits = q ? await searchParcels(q) : [];
  const photoreal = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY; // photoreal hero replaces the topo texture

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <HeroBackdrop />
      <div className="pointer-events-none absolute inset-0"
           style={{ background: "radial-gradient(1100px 600px at 15% 5%, #1d4ed844, transparent), radial-gradient(900px 500px at 90% 90%, #0d948844, transparent)" }} />
      {!photoreal && <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.10]" aria-hidden>
        <defs>
          <pattern id="topo" width="240" height="240" patternUnits="userSpaceOnUse">
            {[18, 40, 62, 84, 106].map((r) => <ellipse key={r} cx="120" cy="120" rx={r * 1.15} ry={r} fill="none" stroke="#e2e8f0" strokeWidth="1" />)}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#topo)" />
      </svg>}

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-6 pt-24">
        <span className="w-fit rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-300">v0.5 test build</span>
        <h1 className="mt-5 text-5xl font-bold tracking-tight">EaseScore<span className="text-sky-400">.AI</span></h1>
        <p className="mt-3 max-w-xl text-lg text-slate-300">Every parcel in Allegheny County: what it takes to build, what fits, and what it&apos;s worth. Sourced, cited, and rendered in 3D from 1-meter lidar.</p>

        <form className="mt-8 flex gap-2 rounded-2xl border border-white/10 bg-white/5 p-2 shadow-2xl backdrop-blur-xl" action="/">
          <input name="q" defaultValue={q} autoFocus placeholder="Address, parcel ID (0011-J-00056-0000-00), or map-block-lot (11-J-56)"
                 className="flex-1 bg-transparent px-3 py-3 text-base text-white placeholder:text-slate-400 focus:outline-none" aria-label="Address or parcel ID" />
          <button className="rounded-xl bg-sky-500 px-5 py-3 font-semibold text-slate-950 hover:bg-sky-400">Search</button>
        </form>

        {q && (
          <section className="mt-4">
            <p className="text-sm text-slate-400">{hits.length === 25 ? "First 25 matches" : `${hits.length} match${hits.length === 1 ? "" : "es"}`}</p>
            <ul className="mt-2 divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl">
              {hits.map((h) => (
                <li key={h.parid}>
                  <Link href={`/parcel/${h.parid}`} className="flex items-baseline justify-between gap-4 px-4 py-3 hover:bg-white/10">
                    <span className="font-medium">{[h.house_num !== "0" ? h.house_num : null, h.address].filter(Boolean).join(" ")}</span>
                    <span className="text-right text-xs text-slate-400">{h.muni_desc} · {h.zip} · {h.use_desc} · {h.parid}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-auto pb-14 pt-16 text-xs text-slate-500">Decision support only. Verify with the permitting office, your lender, and your accountant.</p>
      </div>
    </main>
  );
}
