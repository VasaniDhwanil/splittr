"use client";

import { useReducedMotion } from "framer-motion";
import { Aurora } from "./background-paths";
import { FloatingPaths } from "./floating-paths";

// Fine film grain, so the dark reads as a material rather than a void.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Light first (the aurora), then a faint field of slow, flowing lines over it,
// at roughly a third of the intensity the lines used to have on their own.
// Reduced motion keeps the light and drops the lines, which only exist to move.
export function AnimatedBackground() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="fixed top-0 left-0 w-full h-[100lvh] pointer-events-none z-0">
      <Aurora />
      {!reduceMotion && (
        <div aria-hidden className="absolute inset-0 opacity-[0.12]">
          <FloatingPaths position={1} />
          <FloatingPaths position={-1} />
        </div>
      )}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.035]"
        style={{ backgroundImage: GRAIN }}
      />
    </div>
  );
}
