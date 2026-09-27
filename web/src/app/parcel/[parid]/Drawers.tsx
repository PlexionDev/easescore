"use client";

// Drawers beside the parcel pane (pro forma, change the plan, process checklist, details) and the small
// receipt sheet behind each factor bar. Drawer contents stay mounted while closed, so the site-fit
// solver inside "Change the plan" keeps drawing its layout on the map. A drawer opens from any
// <OpenDrawer> button, or from "#drawer=<id>" in the URL (forms inside a drawer return to it).

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n/client";

const EVENT = "easescore:drawer";

export type DrawerId = "pencils" | "plan" | "process" | "details";

export function OpenDrawer({ id, className, children, label }: { id: DrawerId; className?: string; children: ReactNode; label?: string }) {
  return (
    <button type="button" aria-label={label} className={className} onClick={() => window.dispatchEvent(new CustomEvent(EVENT, { detail: id }))}>
      {children}
    </button>
  );
}

export function DrawerHost({ drawers }: { drawers: { id: DrawerId; title: string; content: ReactNode }[] }) {
  const t = useT();
  const [open, setOpen] = useState<DrawerId | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ids = drawers.map((d) => d.id).join(",");
  useEffect(() => {
    const onOpen = (e: Event) => setOpen((e as CustomEvent<DrawerId>).detail);
    const fromHash = () => {
      const id = /drawer=(\w+)/.exec(window.location.hash)?.[1] as DrawerId | undefined;
      if (id && ids.split(",").includes(id)) setOpen(id);
    };
    fromHash();
    window.addEventListener(EVENT, onOpen);
    window.addEventListener("hashchange", fromHash);
    return () => { window.removeEventListener(EVENT, onOpen); window.removeEventListener("hashchange", fromHash); };
  }, [ids]);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) { opener.current?.focus?.(); opener.current = null; return; }
    // Remember what had focus so closing the drawer returns there.
    if (!opener.current && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) opener.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const close = () => {
    setOpen(null);
    if (/drawer=/.test(window.location.hash)) window.history.replaceState(null, "", window.location.pathname + window.location.search + window.location.hash.replace(/[#&]?drawer=\w+/, ""));
  };

  return (
    <>
      {drawers.map((d) => {
        const on = open === d.id;
        return (
          <div key={d.id} role="dialog" aria-modal={on} aria-label={d.title} aria-hidden={!on}
            className={`fixed inset-0 z-50 ${on ? "flex" : "hidden"} flex-col overflow-hidden bg-white md:inset-auto md:bottom-4 md:left-[472px] md:top-4 md:w-[500px] md:rounded-2xl md:border md:border-slate-200 md:shadow-2xl`}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-900">{d.title}</h2>
              <button ref={on ? closeRef : undefined} type="button" onClick={close} className="rounded-full px-2 py-1 text-sm text-slate-600 hover:bg-slate-100" aria-label={t("drawer.closeNamed", { title: d.title })}>
                {t("drawer.close")} ✕
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" tabIndex={0} role="region" aria-label={t("drawer.content", { title: d.title })}>{d.content}</div>
          </div>
        );
      })}
    </>
  );
}

/** Small sheet opened by a text button (factor receipts). */
export function SheetButton({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const [on, setOn] = useState(false);
  const id = useId();
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOn = useRef(false);
  useEffect(() => {
    // Closing returns focus to the button that opened the sheet (keyboard and screen-reader users keep their place).
    if (!on) { if (wasOn.current) trigger.current?.focus(); wasOn.current = false; return; }
    wasOn.current = true;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOn(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);
  return (
    <>
      <button ref={trigger} type="button" aria-haspopup="dialog" aria-controls={on ? id : undefined} onClick={() => setOn(true)}
        className="min-h-6 text-[11px] font-medium text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-800">
        {label}
      </button>
      {on && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/30 md:items-center" onClick={() => setOn(false)}>
          <div id={id} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 text-[13px] leading-snug text-slate-700 shadow-2xl md:w-[420px] md:rounded-2xl">
            <div className="mb-2 flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
              <button type="button" autoFocus onClick={() => setOn(false)} className="min-h-6 min-w-6 rounded-full px-2 text-sm text-slate-500 hover:bg-slate-100" aria-label={t("drawer.close")}>✕</button>
            </div>
            {children}
          </div>
        </div>
      )}
    </>
  );
}
