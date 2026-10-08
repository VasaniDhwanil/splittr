"use client";

import { Aurora } from "./background-paths";

// Fine film grain, so the dark reads as a material rather than a void.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function AnimatedBackground() {
  return (
    <div className="fixed top-0 left-0 w-full h-[100lvh] pointer-events-none z-0">
      <Aurora />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.035]"
        style={{ backgroundImage: GRAIN }}
      />
    </div>
  );
}
