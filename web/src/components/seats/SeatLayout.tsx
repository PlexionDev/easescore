"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from "react";
import { brandSans } from "@/components/home/font";
import "./seats.css";

const SHEET_QUERY = "(max-width: 899.98px)";

type Side = "left" | "right";
type LayoutCtx = { isSheet: boolean; open: Side | null; openSheet: (s: Side) => void; closeSheet: () => void };
const Ctx = createContext<LayoutCtx>({ isSheet: false, open: null, openSheet: () => {}, closeSheet: () => {} });

/** Open/close the rail sheets from inside the page (e.g. a "Show filters" link in an empty state). */
export function useSeatLayout(): LayoutCtx {
  return useContext(Ctx);
}

/** True when the viewport matches `query` (false on the server). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(query).matches,
    () => false,
  );
}

/**
 * App layout for a seat: header, left rail (filters / levers), main (map, table, tabs), right rail
 * (summary), optional bottom tray (compare). The center column scrolls on its own; rails scroll on their own.
 *
 * Under 900px the rails become sheets opened from a bar under the header ("Filters" / "Summary"),
 * with Escape to close, focus moved in and back, and the rest of the page inert behind a backdrop.
 */
export default function SeatLayout({
  header, left, right, children, bottom, footer,
  leftLabel = "Filters", rightLabel = "Summary",
  leftWidth = 280, rightWidth = 320,
  mainLabel,
}: {
  /** Usually a <SeatHeader>. */
  header: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  /** Main column content. */
  children: ReactNode;
  /** Bottom tray (e.g. compare tray). Sits under the main column; pass null to hide. */
  bottom?: ReactNode;
  /** Footer under the main content, e.g. <DataDateFooter>. */
  footer?: ReactNode;
  leftLabel?: string;
  rightLabel?: string;
  leftWidth?: number;
  rightWidth?: number;
  /** Accessible name for the main region. */
  mainLabel?: string;
}) {
  const isSheet = useMediaQuery(SHEET_QUERY);
  const [openState, setOpen] = useState<Side | null>(null);
  // Back on desktop no sheet is open, whatever was open before.
  const open = isSheet ? openState : null;
  const trigger = useRef<HTMLElement | null>(null);
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);

  const openSheet = useCallback((s: Side) => {
    trigger.current = document.activeElement as HTMLElement | null;
    setOpen(s);
  }, []);
  const closeSheet = useCallback(() => {
    setOpen(null);
    const t = trigger.current;
    trigger.current = null;
    if (t && document.contains(t)) requestAnimationFrame(() => t.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const el = (open === "left" ? leftRef : rightRef).current;
    el?.querySelector<HTMLElement>("[data-sheet-close]")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); closeSheet(); } };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, closeSheet]);

  const ctx = useMemo(() => ({ isSheet, open, openSheet, closeSheet }), [isSheet, open, openSheet, closeSheet]);
  const style = { "--es-left": `${leftWidth}px`, "--es-right": `${rightWidth}px` } as CSSProperties;
  const cols = `${left ? "has-left " : ""}${right ? "has-right" : ""}`;
  const behind = isSheet && open !== null;

  return (
    <Ctx.Provider value={ctx}>
      <div className={`es-seat es-layout ${cols} ${brandSans.variable}`} style={style}>
        <a className="es-skip" href="#es-main">Skip to content</a>
        <div inert={behind || undefined}>{header}</div>
        {(left || right) ? (
          <div className="es-mobilebar" inert={behind || undefined}>
            {left ? <button type="button" className="es-btn" aria-controls="es-rail-left" aria-expanded={open === "left"} onClick={() => openSheet("left")}>{leftLabel}</button> : null}
            {right ? <button type="button" className="es-btn" aria-controls="es-rail-right" aria-expanded={open === "right"} onClick={() => openSheet("right")}>{rightLabel}</button> : null}
          </div>
        ) : null}
        <div className="es-body">
          {left ? <Rail ref={leftRef} side="left" label={leftLabel} isSheet={isSheet} open={open === "left"} onClose={closeSheet}>{left}</Rail> : null}
          <div className="es-center" inert={behind || undefined}>
            <main id="es-main" className="es-main" aria-label={mainLabel} tabIndex={-1}>
              {children}
              {footer}
            </main>
            {bottom ? <div className="es-tray">{bottom}</div> : null}
          </div>
          {right ? <Rail ref={rightRef} side="right" label={rightLabel} isSheet={isSheet} open={open === "right"} onClose={closeSheet}>{right}</Rail> : null}
        </div>
        {behind ? <div className="es-backdrop" aria-hidden="true" onClick={closeSheet} /> : null}
      </div>
    </Ctx.Provider>
  );
}

function Rail({ ref, side, label, isSheet, open, onClose, children }: {
  ref: RefObject<HTMLElement | null>;
  side: Side;
  label: string;
  isSheet: boolean;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      ref={ref}
      id={`es-rail-${side}`}
      className={`es-rail es-rail-${side}${open ? " is-open" : ""}`}
      aria-label={label}
      {...(isSheet ? { role: "dialog", "aria-modal": open ? true : undefined, inert: !open } : {})}
    >
      {isSheet ? (
        <div className="es-sheet-head">
          <strong>{label}</strong>
          <button type="button" className="es-btn es-btn-ghost" data-sheet-close onClick={onClose}>Done</button>
        </div>
      ) : null}
      <div className="es-rail-body">{children}</div>
    </aside>
  );
}
