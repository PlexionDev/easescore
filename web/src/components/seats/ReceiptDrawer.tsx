"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import "./seats.css";

/** Every number has a receipt: where it came from, how old it is, how it was computed. */
export type Receipt = {
  /** What the number is, e.g. "Renters paying 30%+ of income". */
  label: string;
  /** The value as displayed (optional; the drawer can explain a whole panel). */
  value?: ReactNode;
  /** Dataset and publisher, e.g. "ACS 5-year 2019–2023, table B25070 (U.S. Census Bureau)". */
  source: string;
  /** Link to the source page or table. */
  url?: string;
  /** Vintage or as-of date, e.g. "2019–2023 (released Dec 2024)". */
  date: string;
  /** How it was computed, in plain English. */
  method: ReactNode;
  /** data = from a dataset; assumption = editable default; input = the user's own; sample = labeled sample. */
  kind?: "data" | "assumption" | "input" | "sample";
  /** Caveats and limits. */
  notes?: ReactNode;
};

const KIND_LABEL: Record<NonNullable<Receipt["kind"]>, string> = {
  data: "From a dataset",
  assumption: "Assumption, editable",
  input: "Your input",
  sample: "Sample, not real data",
};

/**
 * Right-side drawer listing one or more receipts. Modal <dialog>: focus is trapped, Escape closes,
 * focus returns to the opener.
 */
export function ReceiptDrawer({ open, onClose, receipts, title = "Receipt" }: {
  open: boolean;
  onClose: () => void;
  receipts: Receipt[];
  title?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="es-seat es-drawer"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="es-drawer-inner">
        <div className="es-drawer-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="es-btn es-btn-ghost" onClick={onClose} autoFocus>Close</button>
        </div>
        <div className="es-drawer-body">
          {receipts.map((r, i) => (
            <section key={`${r.label}-${i}`} className="es-receipt">
              <div className="es-receipt-top">
                <h3>{r.label}</h3>
                {r.kind ? <span className={`es-tag es-tag-${r.kind}`}>{KIND_LABEL[r.kind]}</span> : null}
              </div>
              {r.value !== undefined ? <p className="es-receipt-value">{r.value}</p> : null}
              <dl>
                <dt>Source</dt>
                <dd>{r.url ? <a href={r.url} target="_blank" rel="noreferrer noopener">{r.source}<span className="es-sr"> (opens in a new tab)</span></a> : r.source}</dd>
                <dt>Data date</dt>
                <dd>{r.date}</dd>
                <dt>How computed</dt>
                <dd>{r.method}</dd>
                {r.notes ? <><dt>Limits</dt><dd>{r.notes}</dd></> : null}
              </dl>
            </section>
          ))}
        </div>
        <p className="es-drawer-foot">Decision support only. Not legal, financial or zoning advice. <a href="/methods">How the numbers work</a></p>
      </div>
    </dialog>
  );
}

/** A small "Receipt" link that opens the drawer for one or more receipts. */
export function ReceiptButton({ receipt, receipts, title, children = "Receipt", className }: {
  receipt?: Receipt;
  receipts?: Receipt[];
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Mounted on first open, then kept, so closing goes through <dialog>.close() and focus returns here.
  const [mounted, setMounted] = useState(false);
  const list = receipts ?? (receipt ? [receipt] : []);
  return (
    <>
      <button type="button" className={`es-receipt-link${className ? ` ${className}` : ""}`} aria-haspopup="dialog" onClick={() => { setMounted(true); setOpen(true); }}>
        {children}
        {typeof children === "string" && list[0] ? <span className="es-sr">: {list[0].label}</span> : null}
      </button>
      {mounted ? <ReceiptDrawer open={open} onClose={() => setOpen(false)} receipts={list} title={title ?? (list.length === 1 ? `Receipt: ${list[0]!.label}` : "Receipts")} /> : null}
    </>
  );
}

export default ReceiptDrawer;
