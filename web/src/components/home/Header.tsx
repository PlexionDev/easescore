"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SEARCH_ID } from "./constants";

/** Focus the page's main parcel search, if this page has one. */
export function focusSearch(): boolean {
  const el = document.getElementById(SEARCH_ID);
  if (!(el instanceof HTMLInputElement)) return false;
  const open = document.querySelector<HTMLDialogElement>("dialog[open]");
  if (open) open.close();
  el.focus();
  return true;
}

/** Small icon-only mark (no wordmark), for tight spaces like loading states. */
export function BrandMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/easescore-logo-icon.svg" alt="" aria-hidden="true" style={{ width: "100%", height: "100%" }} />
  );
}

/**
 * Floating site header. On the homepage the section links are in-page anchors; elsewhere they lead back
 * to the homepage sections. ⌘K / Ctrl+K focuses the page's search when it has one.
 */
export default function Header({ home = false }: { home?: boolean }) {
  const [open, setOpen] = useState(false);
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

  return (
    <header className="header" id="site-header">
      <Link className="brand" href="/" aria-label={"EaseScore.AI home"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/easescore-logo-horizontal.svg" alt="" aria-hidden="true" className="brand-logo" />
      </Link>
      <button
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="main-nav"
        aria-label={open ? "Close navigation" : "Open navigation"}
        onClick={() => setOpen((o) => !o)}
      >
        <span />
        <span />
      </button>
      <nav
        id="main-nav"
        aria-label={"Main navigation"}
        className={open ? "open" : undefined}
        onClick={(e) => { if ((e.target as Element).closest("a")) setOpen(false); }}
      >
        <a href={`${base}#who-its-for`}>Who it’s for</a>
        <a href={`${base}#how-it-works`}>How it works</a>
        <a href={`${base}#data`}>Data & methods</a>
      </nav>
    </header>
  );
}
