// Parcel page skeleton: streamed at once while the pane loads (a parcel that is not precomputed is
// computed live, which can take a while when the database is busy).


export default async function Loading() {
  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-200" role="status" aria-live="polite">
      <aside className="absolute inset-x-0 bottom-0 z-30 h-[45vh] rounded-t-2xl border border-white/50 bg-white/90 p-5 shadow-2xl md:inset-x-auto md:bottom-4 md:left-4 md:top-4 md:h-auto md:w-[440px] md:rounded-2xl">
        <div className="h-7 w-2/3 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
        <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
        <div className="mt-6 h-36 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
        <div className="mt-4 grid grid-cols-4 gap-1.5">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" />)}
        </div>
        <p className="mt-6 text-sm text-slate-600">Loading this parcel: score, costs and the 3D site plan…</p>
      </aside>
    </div>
  );
}
