"use client";

// Fallback for an unexpected error while loading a parcel: a plain retry message, never a blank crash.

import Link from "next/link";
import { useEffect } from "react";
import { useT } from "@/lib/i18n/client";

export default function ParcelError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto max-w-xl p-6">
      <Link href="/#parcel-search" className="text-xs font-medium text-slate-500 hover:text-slate-800">{t("pane.newSearch")}</Link>
      <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {t("pane.errorBody")}
      </p>
      <button type="button" onClick={() => retry()} className="mt-4 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">{t("pane.tryAgain")}</button>
    </main>
  );
}
