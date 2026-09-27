"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import "./seats.css";

export type ExportAction = {
  id: string;
  /** e.g. "Filtered table" */
  label: string;
  format: "CSV" | "PDF" | "GeoJSON" | "JSON";
  /** One short line, e.g. "214 rows + a sources sheet". */
  description?: string;
  onSelect: () => void | Promise<void>;
  disabled?: boolean;
  /** Why it's disabled, read to screen readers and shown under the label. */
  disabledReason?: string;
};

/**
 * "Export ▾" menu button. Arrow keys move, Enter/Space choose, Escape closes and returns focus.
 * While an action's promise is pending the button shows "Preparing…" (aria-busy).
 */
export default function ExportMenu({ actions, label = "Export", variant = "primary", align = "end" }: {
  actions: ExportAction[];
  label?: string;
  variant?: "primary" | "default";
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([aria-disabled=true])") ?? []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus(); };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") setOpen(false);
  };

  const run = async (a: ExportAction) => {
    if (a.disabled) return;
    close();
    setBusy(a.id);
    try { await a.onSelect(); } finally { setBusy(null); }
  };

  return (
    <div className="es-menu-wrap">
      <button
        ref={btn}
        type="button"
        className={`es-btn${variant === "primary" ? " es-btn-primary" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={busy ? true : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
      >
        {busy ? "Preparing…" : label} <span aria-hidden="true" className="es-caret">▾</span>
      </button>
      {open ? (
        <div ref={menu} id={menuId} role="menu" aria-label={label} className={`es-menu es-menu-${align}`} onKeyDown={onMenuKey}>
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={a.disabled || undefined}
              className="es-menu-item"
              onClick={() => run(a)}
            >
              <span className="es-menu-fmt">{a.format}</span>
              <span className="es-menu-text">
                <span>{a.label}</span>
                {a.disabled && a.disabledReason ? <small>{a.disabledReason}</small> : a.description ? <small>{a.description}</small> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
