"use client";

// Drawers beside the parcel pane (pro forma, change the plan, process checklist, details) and the small
// receipt sheet behind each factor bar. Drawer contents stay mounted while closed, so the site-fit
// solver inside "Change the plan" keeps drawing its layout on the map. A drawer opens from any
// <OpenDrawer> button, or from "#drawer=<id>" in the URL (forms inside a drawer return to it).

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

const EVENT = "easescore:drawer";

export type DrawerId = "pencils" | "plan" | "process" | "details" | "options";

export function OpenDrawer({ id, className, children, label }: { id: DrawerId; className?: string; children: ReactNode; label?: string }) {
  return (
    <button type="button" aria-label={label} className={className} onClick={() => window.dispatchEvent(new CustomEvent(EVENT, { detail: id }))}>
      {children}
    </button>
  );
}

/** Switches the map area to a view tab (the shell reads #view=<mode> on hashchange), e.g. "build" = QuickFit. */
export function OpenView({ view, className, children }: { view: string; className?: string; children: ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => {
      const h = window.location.hash.replace(/^#/, "").split("&").filter((x) => x && !x.startsWith("view=") && !x.startsWith("drawer="));
      window.location.hash = [`view=${view}`, ...h].join("&");
    }}>
      {children}
    </button>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
/** Keeps Tab and Shift+Tab inside `root` (modal dialogs). */
function trapTab(e: KeyboardEvent, root: HTMLElement | null) {
  if (e.key !== "Tab" || !root) return;
  const els = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
  if (!els.length) return;
  const first = els[0]!, last = els[els.length - 1]!;
  const inside = root.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
}

export function DrawerHost({ drawers }: { drawers: { id: DrawerId; title: string; content: ReactNode }[] }) {
  const [open, setOpen] = useState<DrawerId | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLDivElement>(null);
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
    const onKey = (e: KeyboardEvent) => {
      // A receipt sheet open on top of the drawer handles its own keys.
      if (document.querySelector("[data-es-sheet]")) return;
      if (e.key === "Escape") setOpen(null); else trapTab(e, openRef.current);
    };
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
          <div key={d.id} ref={on ? openRef : undefined} role="dialog" aria-modal={on} aria-label={d.title} aria-hidden={!on}
            className={`fixed inset-0 z-50 ${on ? "flex" : "hidden"} flex-col overflow-hidden bg-white md:inset-auto md:bottom-4 md:left-[472px] md:top-[calc(var(--es-hdr,0px)+1rem)] md:w-[500px] md:rounded-2xl md:border md:border-slate-200 md:shadow-2xl`}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-base font-semibold text-slate-900">{d.title}</h2>
              <button ref={on ? closeRef : undefined} type="button" onClick={close} className="rounded-full px-2 py-1 text-sm text-slate-600 hover:bg-slate-100" aria-label={`Close ${d.title}`}>
                {"Close"} ✕
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" tabIndex={0} role="region" aria-label={`${d.title} content`}>{d.content}</div>
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
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOn = useRef(false);
  useEffect(() => {
    // Closing returns focus to the button that opened the sheet (keyboard and screen-reader users keep their place).
    if (!on) { if (wasOn.current) trigger.current?.focus(); wasOn.current = false; return; }
    wasOn.current = true;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOn(false); else trapTab(e, document.getElementById(id)); };
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
        <div data-es-sheet className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/30 md:items-center" onClick={() => setOn(false)}>
          <div id={id} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 text-[13px] leading-snug text-slate-700 shadow-2xl md:w-[420px] md:rounded-2xl">
            <div className="mb-2 flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
              <button type="button" autoFocus onClick={() => setOn(false)} className="min-h-6 min-w-6 rounded-full px-2 text-sm text-slate-500 hover:bg-slate-100" aria-label={"Close"}>✕</button>
            </div>
            {children}
          </div>
        </div>
      )}
    </>
  );
}
