"use client";

// Goal seek: "What would it take to unlock N homes?" Searches the lever states already computed and
// lists the smallest sets of changes that reach the goal, with their trade-offs.

import { useEffect, useRef, useState } from "react";
import { RangeValue, SeatButton, Segmented } from "@/components/seats";
import { leverSentence, type GoalOption, type PolicyState } from "@/lib/policy/model";

export default function GoalSeek({ states, onClose, onApply, rank }: {
  states: PolicyState[];
  onClose: () => void;
  onApply: (key: string) => void;
  rank: (s: PolicyState[], goal: number, measure: "homes" | "pencil", conservative?: boolean) => GoalOption[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [goal, setGoal] = useState(5000);
  const [measure, setMeasure] = useState<"homes" | "pencil">("homes");
  const [cons, setCons] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  const done = states.filter((s) => s.status === "done" && s.key !== "base");
  const opts = rank(states, goal, measure, cons).slice(0, 6);
  return (
    <dialog ref={ref} className="pol-dialog" aria-labelledby="pol-goal-title" onClose={onClose} onCancel={onClose}>
      <div className="pol-dialog-inner">
        <h2 id="pol-goal-title">What would it take?</h2>
        <p className="pol-muted">Searches the {done.length} rule combinations already computed and lists the fewest changes that reach your goal.</p>
        <label className="pol-goal-field">
          <span>Goal: homes</span>
          <input type="number" min={0} step={100} value={goal} onChange={(e) => setGoal(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <Segmented label="Count" size="sm" value={measure} onChange={setMeasure}
          options={[{ value: "homes", label: "Allowed by right" }, { value: "pencil", label: "Likely to pencil" }]} />
        <label className="pol-check"><input type="checkbox" checked={cons} onChange={(e) => setCons(e.target.checked)} /> Use the low end of the range</label>
        {opts.length ? (
          <ol className="pol-goal-list">
            {opts.map((o) => (
              <li key={o.key}>
                <p><strong>{o.changes} change{o.changes === 1 ? "" : "s"}:</strong> {leverSentence(o.levers)}</p>
                <p className="pol-goal-nums">
                  <span>Homes by right <RangeValue value={o.homes} size="sm" signed /></span>
                  <span>Pencil <RangeValue value={o.pencil} size="sm" /></span>
                  <span>{o.summary.newly_buildable.toLocaleString()} parcels newly buildable</span>
                </p>
                <SeatButton onClick={() => onApply(o.key)}>Apply</SeatButton>
              </li>
            ))}
          </ol>
        ) : (
          <p className="pol-empty-goal">No computed combination reaches {goal.toLocaleString()} {measure === "homes" ? "homes by right" : "homes that pencil"}. Try a smaller goal, or turn on more levers: new combinations are computed in the background.</p>
        )}
        <div className="pol-dialog-foot"><SeatButton variant="primary" onClick={() => ref.current?.close()}>Close</SeatButton></div>
      </div>
    </dialog>
  );
}
