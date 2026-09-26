import type { CSSProperties } from "react";
import { CONTOUR_INDEX, CONTOUR_THIN } from "./contours";
import s from "./site.module.css";

/** Static contour art (server-rendered SVG). Index contours draw in once, unless reduced motion is requested. */
export default function HeroContours() {
  return (
    <div className={s.art} aria-hidden="true">
      <svg viewBox="0 0 450 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g fill="none" strokeLinejoin="round">
          <path className={s.cThin} d={CONTOUR_THIN} />
          {/* pathLength normalises the dash so the draw-in covers every index line, whatever its true length */}
          <path className={s.cIndex} d={CONTOUR_INDEX} pathLength={1000} style={{ "--len": 1000 } as CSSProperties} />
        </g>
      </svg>
    </div>
  );
}
