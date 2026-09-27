// Feasibility Study: shown for the moment before the first look (read from the parcel pane) arrives.
import { BrandMark } from "@/components/home/Header";

export default function Loading() {
  return (
    <p role="status" aria-live="polite" style={{ padding: "2rem", display: "flex", alignItems: "center", gap: "0.6rem", fontFamily: "Georgia, serif", color: "#555c65" }}>
      <span style={{ display: "inline-flex", width: "1.1rem", height: "1.1rem" }}><BrandMark /></span>
      Preparing the Feasibility Study…
    </p>
  );
}
