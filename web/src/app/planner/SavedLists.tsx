"use client";

// Saved lists: the current filters, sort and pinned parcels under a name and date, kept in this
// browser (no accounts). Opening one restores all three.

import { useEffect, useRef, useState } from "react";
import { SeatButton } from "@/components/seats";
import { describeFilters, parseFilters } from "@/lib/planner";

export type SavedList = { id: string; name: string; savedAt: string; query: string; pinned: string[] };
const KEY = "easescore.planner.savedLists";

export function loadLists(): SavedList[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? (v as SavedList[]).filter((x) => x && typeof x.name === "string" && typeof x.query === "string") : [];
  } catch { return []; }
}
function store(lists: SavedList[]) {
  try { window.localStorage.setItem(KEY, JSON.stringify(lists)); } catch { /* storage unavailable */ }
}

export default function SavedLists({ open, onClose, query, pinned, onOpen, onCount }: {
  open: boolean; onClose: () => void;
  /** Current filters + sort as a query string. */
  query: string;
  pinned: string[];
  onOpen: (l: SavedList) => void;
  onCount: (n: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [lists, setLists] = useState<SavedList[]>([]);
  const [name, setName] = useState("");
  useEffect(() => { const l = loadLists(); setLists(l); onCount(l.length); }, [onCount]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const update = (next: SavedList[]) => { setLists(next); store(next); onCount(next.length); };

  return (
    <dialog ref={ref} className="es-seat pl-dialog" aria-labelledby="pl-lists-h" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="pl-dialog-inner">
        <h2 id="pl-lists-h">Saved lists</h2>
        <p className="pl-hint">A list keeps the filters, sort and pinned parcels. Saved in this browser only.</p>
        <form style={{ display: "flex", gap: 8 }} onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim() || `List ${lists.length + 1}`;
          update([{ id: `${Date.now()}`, name: n, savedAt: new Date().toISOString(), query, pinned }, ...lists].slice(0, 30));
          setName("");
        }}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this list" aria-label="List name" />
          <SeatButton type="submit" variant="primary">Save current</SeatButton>
        </form>
        <div className="pl-list">
          {lists.length ? lists.map((l) => (
            <div key={l.id} className="pl-list-item">
              <div>
                <strong>{l.name}</strong>
                <small>{new Date(l.savedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · {l.pinned.length} pinned</small>
                <small>{describeFilters(parseFilters(new URLSearchParams(l.query))).join(" · ")}</small>
              </div>
              <SeatButton onClick={() => { onOpen(l); onClose(); }}>Open</SeatButton>
              <SeatButton variant="ghost" onClick={() => update(lists.filter((x) => x.id !== l.id))} aria-label={`Delete ${l.name}`}>Delete</SeatButton>
            </div>
          )) : <p className="pl-hint">No saved lists yet.</p>}
        </div>
        <div><SeatButton variant="ghost" onClick={onClose}>Close</SeatButton></div>
      </div>
    </dialog>
  );
}
