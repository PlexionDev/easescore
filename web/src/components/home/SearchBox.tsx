"use client";

import Form from "next/form";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EXAMPLE_QUERY, SEARCH_ID } from "./constants";
import type { SearchHit } from "@/lib/data";
import { useT } from "@/lib/i18n/client";

const MIN_CHARS = 3;
const DEBOUNCE_MS = 150;

function hitLabel(h: SearchHit): string {
  return [h.house_num && h.house_num !== "0" ? h.house_num : null, h.address].filter(Boolean).join(" ");
}

/** Parcel search on the homepage. One match opens the parcel; several open the list; no separate results page.
 *  Without JavaScript the form GETs /check, which redirects (one match → parcel, else back to /?q=). */
export default function SearchBox({
  id,
  icon = false,
  shortcut = false,
  tryExample = false,
  defaultValue,
  autoFocus = false,
  landmarkLabel,
}: {
  id: string;
  /** Name of the search landmark; give each search on a page its own (axe landmark-unique). */
  landmarkLabel?: string;
  icon?: boolean;
  shortcut?: boolean;
  tryExample?: boolean;
  defaultValue?: string;
  autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const t = useT();
  const EMPTY = t("search.empty");

  const [value, setValue] = useState(defaultValue ?? "");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [announce, setAnnounce] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listboxId = `${id}-listbox`;

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  function scheduleSearch(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = q.trim();
    if (trimmed.length < MIN_CHARS) {
      abortRef.current?.abort();
      setLoading(false);
      setHits([]);
      setActive(-1);
      setAnnounce("");
      return;
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=8`, { signal: controller.signal });
        const data = (await res.json()) as { hits: SearchHit[] };
        setHits(data.hits);
        setActive(-1);
        setAnnounce(data.hits.length === 1 ? t("search.results1") : t("search.resultsN", { n: data.hits.length }));
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          setHits([]);
          setAnnounce("");
        }
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
  }

  // Arriving with ?q= (e.g. the no-JS fallback): prefill this box and show the matches.
  useEffect(() => {
    if (defaultValue) return;
    const q = new URLSearchParams(window.location.search).get("q")?.trim();
    if (!q || document.getElementById(id) !== input.current || id !== SEARCH_ID) return;
    setValue(q);
    setOpen(true);
    scheduleSearch(q);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submitSearch(q: string) {
    abortRef.current?.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setOpen(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`, { signal: controller.signal });
      const data = (await res.json()) as { hits: SearchHit[] };
      if (data.hits.length === 1) { goToHit(data.hits[0]); return; }
      setHits(data.hits);
      setActive(data.hits.length ? 0 : -1);
      setAnnounce(data.hits.length === 1 ? t("search.results1") : t("search.resultsN", { n: data.hits.length }));
      input.current?.focus();
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") setHits([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onDocClick = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const showDropdown = open && value.trim().length >= MIN_CHARS;

  function goToHit(h: SearchHit) {
    setOpen(false);
    router.push(`/parcel/${h.parid}`);
  }

  return (
    <Form
      className="search-form"
      action="/check"
      role="search"
      aria-label={landmarkLabel ?? t("search.landmark")}
      onSubmit={(e) => {
        const el = input.current;
        if (el && !el.value.trim()) {
          e.preventDefault();
          el.setCustomValidity(EMPTY);
          el.reportValidity();
          return;
        }
        // Stay on this page: one match opens the parcel, several show the list.
        e.preventDefault();
        if (el) void submitSearch(el.value.trim());
      }}
    >
      <label className="sr-only" htmlFor={id}>{t("search.label")}</label>
      <div className="search-field-wrap" ref={wrap}>
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
            placeholder={t("search.placeholder")}
            required
            maxLength={180}
            autoComplete="street-address"
            value={value}
            autoFocus={autoFocus}
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${id}-option-${active}` : undefined}
            onInput={(e) => e.currentTarget.setCustomValidity("")}
            onInvalid={(e) => { if (!e.currentTarget.value) e.currentTarget.setCustomValidity(EMPTY); }}
            onChange={(e) => {
              const next = e.currentTarget.value;
              setValue(next);
              setOpen(true);
              scheduleSearch(next);
            }}
            onFocus={() => { if (value.trim().length >= MIN_CHARS) setOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                if (!showDropdown || !hits.length) return;
                e.preventDefault();
                setActive((i) => (i + 1) % hits.length);
              } else if (e.key === "ArrowUp") {
                if (!showDropdown || !hits.length) return;
                e.preventDefault();
                setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
              } else if (e.key === "Enter") {
                if (showDropdown && active >= 0 && hits[active]) {
                  e.preventDefault();
                  goToHit(hits[active]);
                }
              } else if (e.key === "Escape") {
                if (open) {
                  setOpen(false);
                  setActive(-1);
                }
              }
            }}
          />
          {shortcut && <kbd aria-hidden="true">⌘ K</kbd>}
          <button type="submit" aria-label={t("search.submit")}>
            <span className="search-label">{t("search.submit")}</span>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
        {showDropdown && (
          <div className="search-suggest" id={listboxId} role="listbox" aria-label={t("search.suggest")}>
            {loading && hits.length === 0 ? (
              <p className="search-suggest-note">{t("search.searching")}</p>
            ) : hits.length ? (
              hits.map((h, i) => (
                <button
                  type="button"
                  key={h.parid}
                  id={`${id}-option-${i}`}
                  role="option"
                  aria-selected={active === i}
                  className={`search-suggest-item${active === i ? " is-active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => goToHit(h)}
                >
                  <span className="search-suggest-addr">{hitLabel(h)}</span>
                  <span className="search-suggest-meta">{h.muni_desc} · {h.zip} · {h.use_desc}</span>
                  <span className="search-suggest-parid">{h.parid}</span>
                </button>
              ))
            ) : (
              <p className="search-suggest-note">{t("search.none")}</p>
            )}
          </div>
        )}
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </div>
      {tryExample && (
        <p className="search-hint">
          {t("search.noAccount")}{" "}
          <button
            type="button"
            onClick={() => {
              const el = input.current;
              if (!el) return;
              el.value = EXAMPLE_QUERY;
              setValue(EXAMPLE_QUERY);
              el.setCustomValidity("");
              el.focus();
              setOpen(true);
              scheduleSearch(EXAMPLE_QUERY);
            }}
          >
            {t("search.try")} <span aria-hidden="true">→</span>
          </button>
        </p>
      )}
    </Form>
  );
}
