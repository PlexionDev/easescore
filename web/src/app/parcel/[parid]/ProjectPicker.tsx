"use client";

// Quick project picker for an existing home (shown only when the ReadyPermit link is configured, on City
// parcels). Sets the same URL params as the Project questions form (type=addition or minor_work=deck),
// keeping every other param and the #hash, so the checklist and the ReadyPermit link update the same way.

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

export type PickedProject = "" | "addition" | "deck";

export default function ProjectPicker({ value }: { value: PickedProject }) {
  const router = useRouter();
  const pathname = usePathname();
  const [picked, setPicked] = useState<PickedProject>(value);
  const [pending, startTransition] = useTransition();
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setPicked(value); }

  const choose = (v: PickedProject) => {
    setPicked(v);
    const q = new URLSearchParams(window.location.search);
    if (q.get("type") === "addition") q.delete("type");
    if (q.get("minor_work") === "deck") q.delete("minor_work");
    if (v === "addition") q.set("type", "addition");
    if (v === "deck") q.set("minor_work", "deck");
    const s = q.toString();
    startTransition(() => router.replace(`${pathname}${s ? `?${s}` : ""}${window.location.hash}`, { scroll: false }));
  };

  return (
    <div className="flex items-center gap-2 text-xs text-slate-700">
      <label htmlFor="project-picker">Planning work on an existing home?</label>
      <select id="project-picker" value={picked} aria-busy={pending} onChange={(e) => choose(e.target.value as PickedProject)}
        className="rounded border border-slate-400 bg-white px-1.5 py-0.5 text-xs text-slate-900">
        <option value="">Neither</option>
        <option value="addition">An addition</option>
        <option value="deck">A deck</option>
      </select>
    </div>
  );
}
