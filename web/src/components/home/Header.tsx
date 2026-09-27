"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import { SEARCH_ID } from "./constants";
import LanguageMenu from "@/components/i18n/LanguageMenu";
import { useT } from "@/lib/i18n/client";

/** Focus the page's main parcel search, if this page has one. */
export function focusSearch(): boolean {
  const el = document.getElementById(SEARCH_ID);
  if (!(el instanceof HTMLInputElement)) return false;
  const open = document.querySelector<HTMLDialogElement>("dialog[open]");
  if (open) open.close();
  el.focus();
  return true;
}

export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="none">
      <path
        d="M3 25c5-1 8-7 14-7s8 4 12 2M3 18c5-1 8-7 14-7s8 4 12 2M3 11c5-1 8-7 14-7s8 4 12 2"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Floating site header. On the homepage the section links are in-page anchors; elsewhere they lead back
 * to the homepage sections. "Check a lot" and ⌘K / Ctrl+K focus the page's search when it has one.
 */
export default function Header({ home = false }: { home?: boolean }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const base = home ? "" : "/";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (document.getElementById(SEARCH_ID)) {
          e.preventDefault();
          setOpen(false);
          focusSearch();
        }
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onCta = (e: MouseEvent<HTMLAnchorElement>) => {
    setOpen(false);
    if (focusSearch()) e.preventDefault();
  };

  return (
    <header className="header" id="site-header">
      <Link className="brand" href="/" aria-label={t("brand.home")}>
        <BrandMark />
        <span>
          EaseScore<span className="brand-ai">.AI</span>
          <small>{t("brand.tagline")}</small>
        </span>
      </Link>
      <LanguageMenu />
      <button
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="main-nav"
        aria-label={open ? t("nav.close") : t("nav.open")}
        onClick={() => setOpen((o) => !o)}
      >
        <span />
        <span />
      </button>
      <nav
        id="main-nav"
        aria-label={t("nav.main")}
        className={open ? "open" : undefined}
        onClick={(e) => { if ((e.target as Element).closest("a")) setOpen(false); }}
      >
        <a href={`${base}#who-its-for`}>{t("nav.who")}</a>
        <a href={`${base}#how-it-works`}>{t("nav.how")}</a>
        <a href={`${base}#data`}>{t("nav.data")}</a>
        <a className="nav-cta" href={home ? `#${SEARCH_ID}` : `/#${SEARCH_ID}`} onClick={onCta}>
          {t("nav.cta")} <span aria-hidden="true">↗</span>
        </a>
      </nav>
    </header>
  );
}
