import { SeatHeader, SeatLayout } from "@/components/seats";
import "./nonprofit.css";

// Instant first paint while the neighborhood's census figures and lots load.
export default function Loading() {
  return (
    <SeatLayout header={<SeatHeader seat="nonprofit" />} mainLabel="Plan affordable homes">
      <nav className="np-steps" aria-label="Steps">
        {["Who needs homes here?", "Where could we build?", "What's the gap?"].map((l, i) => (
          <button key={l} type="button" className={i === 0 ? "on" : ""} disabled><i aria-hidden="true">{i + 1}</i>{l}</button>
        ))}
      </nav>
      <div className="np-body">
        <div className="np-grid">
          <div className="np-col"><div className="np-map-skel" /></div>
          <div className="np-col">
            <p className="np-q">Plan affordable homes</p>
            <p className="np-sub" role="status">Loading the neighborhood&apos;s census figures and public lots…</p>
          </div>
        </div>
      </div>
    </SeatLayout>
  );
}
