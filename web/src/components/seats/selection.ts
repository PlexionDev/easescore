"use client";

// Shared seat context: what the user is looking at, carried across seats in sessionStorage so the seat
// switcher can keep it. One key, "es.selection". Per tab (sessionStorage), never sent to the server.
//
//   municipality  e.g. "Pittsburgh"
//   neighborhood  e.g. "Larimer"
//   parids        pinned / selected parcels, most relevant first (max 25)
//   focus         the one parcel currently open, if any; the Developer seat opens it

import { useSyncExternalStore } from "react";

export const SELECTION_KEY = "es.selection";

export type SeatSelection = {
  municipality?: string;
  neighborhood?: string;
  parids: string[];
  focus?: string;
};

const EMPTY: SeatSelection = Object.freeze({ parids: [] }) as SeatSelection;
const EVENT = "es:selection";
const MAX_PARIDS = 25;
const PARID_RE = /^[0-9A-Z]{16}$/;

let cache: SeatSelection | null = null;
let cacheRaw: string | null = null;

function read(): SeatSelection {
  let raw: string | null = null;
  try { raw = window.sessionStorage.getItem(SELECTION_KEY); } catch { return cache ?? EMPTY; }
  if (raw === cacheRaw && cache) return cache;
  cacheRaw = raw;
  cache = parse(raw);
  return cache;
}

function parse(raw: string | null): SeatSelection {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as Partial<SeatSelection>;
    const parids = Array.isArray(v.parids) ? v.parids.filter((p): p is string => typeof p === "string" && PARID_RE.test(p)).slice(0, MAX_PARIDS) : [];
    return {
      municipality: typeof v.municipality === "string" ? v.municipality : undefined,
      neighborhood: typeof v.neighborhood === "string" ? v.neighborhood : undefined,
      parids,
      focus: typeof v.focus === "string" && PARID_RE.test(v.focus) ? v.focus : undefined,
    };
  } catch {
    return EMPTY;
  }
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === SELECTION_KEY) cb(); };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", onStorage); };
}

/** Read the current selection outside React (e.g. in an event handler). */
export function getSelection(): SeatSelection {
  return typeof window === "undefined" ? EMPTY : read();
}

/** Merge a patch into the selection. `parids` replaces the list (deduplicated, capped at 25). */
export function setSelection(patch: Partial<SeatSelection>): void {
  const next: SeatSelection = { ...read(), ...patch };
  next.parids = [...new Set((next.parids ?? []).filter((p) => PARID_RE.test(p)))].slice(0, MAX_PARIDS);
  if (next.focus && !PARID_RE.test(next.focus)) next.focus = undefined;
  try { window.sessionStorage.setItem(SELECTION_KEY, JSON.stringify(next)); } catch { /* private mode: keep in memory */ }
  cacheRaw = null;
  cache = next;
  window.dispatchEvent(new Event(EVENT));
}

export function clearSelection(): void {
  try { window.sessionStorage.removeItem(SELECTION_KEY); } catch { /* ignore */ }
  cache = EMPTY;
  cacheRaw = null;
  window.dispatchEvent(new Event(EVENT));
}

/** React hook: the shared selection (empty on the server and during hydration). */
export function useSeatSelection(): SeatSelection {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
