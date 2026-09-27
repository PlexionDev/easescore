// Feasibility Study: shown for the moment before the first look (read from the parcel pane) arrives.

export default function Loading() {
  return (
    <p role="status" aria-live="polite" style={{ padding: "2rem", fontFamily: "Georgia, serif", color: "#555c65" }}>
      Preparing the Feasibility Study…
    </p>
  );
}
