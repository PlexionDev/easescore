"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { brandSans } from "@/components/home/font";
import { SEATS, seatFromPath, seatHref, type SeatId } from "./seats";
import { useSeatSelection } from "./selection";
import "./seats.css";

/**
 * Compact app header for the seat pages: logo → home, the four-seat switcher (current seat highlighted),
 * then page controls (geography picker, scenario) and actions (saved lists, export) as slots.
 *
 * The Developer link opens /developer with the focused parcel from the shared selection
 * (`setSelection({ focus })`) open in its pane, if there is one.
 */
export default function SeatHeader({ seat, controls, actions, hrefs, heading = true }: {
  /** Current seat. Defaults to the one matching the URL. */
  seat?: SeatId;
  /** Left-aligned page controls after the switcher, e.g. a <SeatSelect> geography picker. */
  controls?: ReactNode;
  /** Right-aligned actions, e.g. saved lists and an <ExportMenu>. */
  actions?: ReactNode;
  /** Override a seat's link (rare; the defaults keep context through the shared selection). */
  hrefs?: Partial<Record<SeatId, string>>;
  /** Render the screen-reader h1 (the seat's job). Off on pages that have their own h1 (parcel page, report). */
  heading?: boolean;
}) {
  const pathname = usePathname();
  const current = seat ?? seatFromPath(pathname);
  const sel = useSeatSelection();

  return (
    <header className={`es-seat es-seat-header ${brandSans.variable}`}>
      <Link className="es-seat-brand" href="/" aria-label="EaseScore.AI home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/easescore-logo-horizontal.svg" alt="" aria-hidden="true" />
      </Link>
      {/* The page's one heading for screen readers: the seat's job ("Compare and rank sites"). */}
      {heading ? <h1 className="es-sr-only">{SEATS.find((s) => s.id === current)?.job ?? "EaseScore.AI"}</h1> : null}
      <nav className="es-seat-switch" aria-label="Switch seat">
        {SEATS.map((s) => {
          const on = s.id === current;
          return (
            <Link
              key={s.id}
              href={hrefs?.[s.id] ?? seatHref(s.id, sel)}
              aria-current={on ? "page" : undefined}
              className={on ? "on" : undefined}
              title={s.job}
              prefetch={false}
            >
              <span className="es-seat-long">{s.label}</span>
              <span className="es-seat-short" aria-hidden="true">{s.short}</span>
            </Link>
          );
        })}
      </nav>
      {controls ? <div className="es-seat-controls">{controls}</div> : null}
      <div className="es-seat-spacer" />
      {actions ? <div className="es-seat-actions">{actions}</div> : null}
    </header>
  );
}

/** A labeled native select styled for the header (geography picker, scenario picker). */
export function SeatSelect<T extends string>({ label, value, options, onChange, hideLabel = true, disabled }: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  /** Label is visually hidden by default (still read by screen readers). */
  hideLabel?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="es-select">
      <span className={hideLabel ? "es-sr" : "es-select-label"}>{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** Header/tool button. `variant="primary"` is the one green action per header. */
export function SeatButton({ children, variant = "default", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" }) {
  return (
    <button type="button" {...rest} className={`es-btn${variant === "primary" ? " es-btn-primary" : variant === "ghost" ? " es-btn-ghost" : ""}${rest.className ? ` ${rest.className}` : ""}`}>
      {children}
    </button>
  );
}
