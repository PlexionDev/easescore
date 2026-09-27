"use client";

import Form from "next/form";
import { useRef } from "react";

/**
 * Public example for the "Try" button: a vacant, URA-owned lot on Heldman St in Crawford-Roberts
 * (Lower Hill), zoned RM-M. Map-block-lot search resolves it to parcel 0011A00151000000.
 */
export const EXAMPLE_QUERY = "11-A-151";

const EMPTY = "Enter an address or parcel ID.";

/** Parcel search. Submits to /check?q=… with client-side navigation (a plain GET without JavaScript). */
export default function SearchBox({
  id,
  icon = false,
  shortcut = false,
  tryExample = false,
  defaultValue,
  autoFocus = false,
}: {
  id: string;
  icon?: boolean;
  shortcut?: boolean;
  tryExample?: boolean;
  defaultValue?: string;
  autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <Form
      className="search-form"
      action="/check"
      role="search"
      onSubmit={(e) => {
        const el = input.current;
        if (el && !el.value.trim()) {
          e.preventDefault();
          el.setCustomValidity(EMPTY);
          el.reportValidity();
        }
      }}
    >
      <label className="sr-only" htmlFor={id}>Address or parcel ID</label>
      <div className="search-field">
        {icon && (
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        )}
        <input
          ref={input}
          id={id}
          name="q"
          type="search"
          placeholder="Enter an address or parcel ID"
          required
          maxLength={180}
          autoComplete="street-address"
          defaultValue={defaultValue}
          autoFocus={autoFocus}
          onInput={(e) => e.currentTarget.setCustomValidity("")}
          onInvalid={(e) => { if (!e.currentTarget.value) e.currentTarget.setCustomValidity(EMPTY); }}
        />
        {shortcut && <kbd aria-hidden="true">⌘ K</kbd>}
        <button type="submit" aria-label="Check this lot">
          <span className="search-label">Check this lot</span>
          <span aria-hidden="true">↗</span>
        </button>
      </div>
      {tryExample && (
        <p className="search-hint">
          No account needed.{" "}
          <button
            type="button"
            onClick={() => {
              const el = input.current;
              if (!el) return;
              el.value = EXAMPLE_QUERY;
              el.setCustomValidity("");
              el.focus();
            }}
          >
            Try a URA-owned housing site in the Lower Hill <span aria-hidden="true">→</span>
          </button>
        </p>
      )}
    </Form>
  );
}
