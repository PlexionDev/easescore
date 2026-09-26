import Link from "next/link";
import { searchParcels } from "@/lib/data";

export default async function Home({ searchParams }: PageProps<"/">) {
  const q = String((await searchParams).q ?? "");
  const hits = q ? await searchParcels(q) : [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">v0.5 internal test build — not the product design</p>
      <h1 className="mt-1 text-3xl font-bold">EaseScore.AI</h1>
      <p className="mt-2 text-zinc-600">Look up any Allegheny County parcel by address (city, state, and ZIP are fine), parcel ID with or without dashes, or map-block-lot.</p>

      <form className="mt-6 flex gap-2" action="/">
        <input name="q" defaultValue={q} placeholder="e.g. 1835 Forbes Avenue, Pittsburgh 15219  ·  0011-J-00056-0000-00  ·  11-J-56"
               className="flex-1 rounded border border-zinc-300 px-3 py-2" aria-label="Address or parcel ID" />
        <button className="rounded bg-zinc-900 px-4 py-2 text-white">Search</button>
      </form>

      {q && (
        <section className="mt-6">
          <p className="text-sm text-zinc-500">{hits.length === 25 ? "First 25 matches" : `${hits.length} match(es)`}</p>
          <ul className="mt-2 divide-y divide-zinc-200 rounded border border-zinc-200">
            {hits.map((h) => (
              <li key={h.parid}>
                <Link href={`/parcel/${h.parid}`} className="block px-3 py-2 hover:bg-zinc-50">
                  <span className="font-medium">{[h.house_num !== "0" ? h.house_num : null, h.address].filter(Boolean).join(" ")}</span>
                  <span className="ml-2 text-sm text-zinc-500">{h.muni_desc} · {h.zip} · {h.use_desc} · {h.parid}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 text-xs text-zinc-500">Decision support only. Verify with the permitting office, your lender, and your accountant.</p>
    </main>
  );
}
