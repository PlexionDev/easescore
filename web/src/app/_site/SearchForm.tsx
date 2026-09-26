"use client";

import Form from "next/form";
import { useRef } from "react";
import s from "./site.module.css";

const EXAMPLE = "34 Soffel St, Pittsburgh";

/** The one search box: submits to /check?q=… with client-side navigation (plain GET without JS). */
export default function SearchForm({ defaultValue = "", autoFocus = false, showExample = true }: {
  defaultValue?: string;
  autoFocus?: boolean;
  showExample?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Form className={s.search} action="/check" role="search">
      <label htmlFor="q">Address or parcel ID</label>
      <div className={s.field}>
        <input
          ref={input}
          id="q"
          name="q"
          type="search"
          autoComplete="street-address"
          placeholder={EXAMPLE}
          defaultValue={defaultValue}
          autoFocus={autoFocus}
          required
        />
        <button type="submit">Check this lot</button>
      </div>
      {showExample && (
        <p className={s.hint}>
          No account needed. Try{" "}
          <button type="button" onClick={() => { if (input.current) { input.current.value = EXAMPLE; input.current.focus(); } }}>
            34 Soffel St
          </button>
          , a steep lot on Mt. Washington.
        </p>
      )}
    </Form>
  );
}
