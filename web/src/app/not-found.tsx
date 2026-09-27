import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found — EaseScore.AI" };

// Site-wide 404 (also used by notFound() for parcel IDs that are not in the county roll).
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center text-slate-900">
      <Link href="/" aria-label="EaseScore.AI home" className="mb-8 inline-flex items-center gap-2 text-lg font-semibold">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/easescore-logo-horizontal.svg" alt="" aria-hidden="true" className="h-7 w-auto" />
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">We couldn&apos;t find that page</h1>
      <p className="mt-3 max-w-md text-slate-600">
        The link may be old, or the parcel ID may not be in the Allegheny County assessment roll.
        Search by address or parcel ID instead.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm font-semibold">
        <Link href="/#parcel-search" className="rounded-lg bg-slate-900 px-4 py-2 text-white hover:bg-slate-800">Search a parcel</Link>
        <Link href="/" className="rounded-lg border border-slate-300 px-4 py-2 text-slate-800 hover:bg-white">Home</Link>
      </div>
    </main>
  );
}
