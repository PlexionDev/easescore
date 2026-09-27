"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import "./seats.css";

/** A titled group in a left rail. `collapsible` uses <details> (keyboard and screen-reader native). */
export function FilterSection({ title, hint, children, collapsible = false, defaultOpen = true, action }: {
  title: string;
  /** One muted line under the title ("Find lots held back by a single rule"). */
  hint?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Small control on the title row, e.g. a "Clear" button. */
  action?: ReactNode;
}) {
  if (collapsible) {
    return (
      <details className="es-fsec" open={defaultOpen}>
        <summary className="es-fsec-title"><span>{title}</span>{action}</summary>
        {hint ? <p className="es-fsec-hint">{hint}</p> : null}
        <div className="es-fsec-body">{children}</div>
      </details>
    );
  }
  return (
    <section className="es-fsec" aria-label={title}>
      <div className="es-fsec-title"><h3>{title}</h3>{action}</div>
      {hint ? <p className="es-fsec-hint">{hint}</p> : null}
      <div className="es-fsec-body">{children}</div>
    </section>
  );
}

/** Native checkbox with a custom box. `count` shows how many results the option would match. */
export function CheckboxField({ label, checked, onChange, hint, count, disabled }: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  count?: number | string;
  disabled?: boolean;
}) {
  return (
    <label className={`es-check${disabled ? " is-disabled" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="es-check-box" aria-hidden="true" />
      <span className="es-check-text">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </span>
      {count !== undefined ? <span className="es-check-count">{typeof count === "number" ? count.toLocaleString("en-US") : count}</span> : null}
    </label>
  );
}

/** On/off switch for a lever or layer (role="switch"). */
export function Switch({ label, checked, onChange, hint, disabled, hideLabel = false }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className={`es-switch-row${disabled ? " is-disabled" : ""}`}>
      <span className="es-switch-text">
        <label htmlFor={id} className={hideLabel ? "es-sr" : "es-switch-label"}>{label}</label>
        {hint ? <small id={`${id}-h`}>{hint}</small> : null}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? `${id}-h` : undefined}
        disabled={disabled}
        className="es-switch"
        onClick={() => onChange(!checked)}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Segmented control (radiogroup). Roving tabindex: Tab reaches the selected option; arrow keys move and
 * select; Home/End jump.
 */
export function Segmented<T extends string>({ label, options, value, onChange, hideLabel = false, size = "md", tone = "light" }: {
  label: string;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  hideLabel?: boolean;
  size?: "sm" | "md";
  /** dark = selected option ink-filled (map toolbars); light = white card on grey (rails). */
  tone?: "light" | "dark";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = useId();
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (idx + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (idx - 1 + options.length) % options.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = options.length - 1;
    if (n < 0) return;
    e.preventDefault();
    onChange(options[n]!.value);
    refs.current[n]?.focus();
  };
  return (
    <div className="es-seg-wrap">
      <span id={labelId} className={hideLabel ? "es-sr" : "es-field-label"}>{label}</span>
      <div role="radiogroup" aria-labelledby={labelId} className={`es-seg es-seg-${size} es-seg-${tone}`} onKeyDown={onKey}>
        {options.map((o, i) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              title={o.title}
              className={on ? "on" : undefined}
              onClick={() => onChange(o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type SliderCommon = {
  label: string;
  min: number;
  max: number;
  step?: number;
  /** Formats the visible and spoken value (aria-valuetext). */
  format?: (n: number) => string;
  /** Labels under the track ends, e.g. ["Current code", "None"]. */
  ends?: [ReactNode, ReactNode];
  hint?: ReactNode;
  disabled?: boolean;
};

/**
 * Range slider on native <input type="range"> (arrow keys, Page Up/Down, Home/End for free).
 * Pass a number for one thumb or a [low, high] pair for two; the thumbs cannot cross.
 */
export function RangeSlider(props: SliderCommon & ({ value: number; onChange: (v: number) => void } | { value: [number, number]; onChange: (v: [number, number]) => void })) {
  const { label, min, max, step = 1, format = String, ends, hint, disabled } = props;
  const id = useId();
  const pct = (v: number) => ((v - min) / (max - min || 1)) * 100;
  const dual = Array.isArray(props.value);
  const [lo, hi] = dual ? (props.value as [number, number]) : [min, props.value as number];
  const fill = { left: `${dual ? pct(lo) : 0}%`, right: `${100 - pct(hi)}%` };
  const shown = dual ? `${format(lo)} – ${format(hi)}` : format(hi);

  return (
    <div className={`es-slider${disabled ? " is-disabled" : ""}${dual ? " is-dual" : ""}`}>
      <div className="es-slider-head">
        <span id={`${id}-l`} className="es-field-label">{label}</span>
        <output htmlFor={dual ? `${id}-a ${id}-b` : `${id}-b`} className="es-slider-out" aria-live="off">{shown}</output>
      </div>
      {hint ? <p className="es-fsec-hint">{hint}</p> : null}
      <div className="es-slider-track">
        <span className="es-slider-rail" aria-hidden="true" />
        <span className="es-slider-fill" style={fill} aria-hidden="true" />
        {dual ? (
          <input
            id={`${id}-a`}
            type="range"
            min={min} max={max} step={step}
            value={lo}
            disabled={disabled}
            aria-label={`${label}, minimum`}
            aria-valuetext={format(lo)}
            onChange={(e) => (props.onChange as (v: [number, number]) => void)([Math.min(Number(e.target.value), hi), hi])}
          />
        ) : null}
        <input
          id={`${id}-b`}
          type="range"
          min={min} max={max} step={step}
          value={hi}
          disabled={disabled}
          aria-label={dual ? `${label}, maximum` : undefined}
          aria-labelledby={dual ? undefined : `${id}-l`}
          aria-valuetext={format(hi)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (dual) (props.onChange as (v: [number, number]) => void)([lo, Math.max(v, lo)]);
            else (props.onChange as (v: number) => void)(v);
          }}
        />
      </div>
      {ends ? <div className="es-slider-ends" aria-hidden="true"><span>{ends[0]}</span><span>{ends[1]}</span></div> : null}
    </div>
  );
}

/** Rail container: stacks FilterSections with dividers and an optional sticky footer (e.g. "Clear all"). */
export default function FilterRail({ children, footer, intro }: { children: ReactNode; footer?: ReactNode; intro?: ReactNode }) {
  return (
    <div className="es-frail">
      {intro ? <p className="es-frail-intro">{intro}</p> : null}
      {children}
      {footer ? <div className="es-frail-foot">{footer}</div> : null}
    </div>
  );
}
