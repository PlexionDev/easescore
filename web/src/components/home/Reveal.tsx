"use client";

import { useEffect } from "react";

/**
 * Fades sections in as they scroll into view. Content is visible by default: the hidden start state
 * applies only once this runs, and never when the visitor prefers reduced motion.
 */
export default function Reveal() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".es-home");
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    if (!root || !("IntersectionObserver" in window) || motion.matches) return;
    root.classList.add("animate");
    const observer = new IntersectionObserver((entries) => {
      for (const x of entries) {
        if (x.isIntersecting) {
          x.target.classList.add("seen");
          observer.unobserve(x.target);
        }
      }
    }, { threshold: 0.06 });
    root.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
    const onChange = () => { if (motion.matches) root.classList.remove("animate"); };
    motion.addEventListener("change", onChange);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", onChange);
      root.classList.remove("animate");
    };
  }, []);
  return null;
}
