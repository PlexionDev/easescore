import type { ReactNode } from "react";
import "./seats.css";

/**
 * One headline number with a label, a plain-English line under it, and an optional receipt.
 * Put a <RangeValue size="lg"> in `value` for estimates. `variant="band"` is the flat, borderless
 * version for a row of outcome numbers (the Policy headline row).
 */
export default function StatCard({ label, value, sub, receipt, variant = "card", children }: {
  label: ReactNode;
  value: ReactNode;
  /** Short plain sentence under the value ("of 9,700 vacant or teardown lots"). */
  sub?: ReactNode;
  /** Usually a <ReceiptButton>. */
  receipt?: ReactNode;
  variant?: "card" | "band";
  /** Extra content under the value, e.g. a small stacked bar. */
  children?: ReactNode;
}) {
  return (
    <div className={`es-stat es-stat-${variant}`}>
      <div className="es-stat-top">
        <p className="es-stat-label">{label}</p>
        {receipt}
      </div>
      <div className="es-stat-value">{value}</div>
      {sub ? <p className="es-stat-sub">{sub}</p> : null}
      {children}
    </div>
  );
}
