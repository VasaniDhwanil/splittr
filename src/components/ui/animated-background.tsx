"use client";

import { FloatingPaths } from "./background-paths";

export function AnimatedBackground() {
  return (
    <div className="fixed top-0 left-0 w-full h-[100lvh] opacity-30 pointer-events-none z-0">
      <FloatingPaths position={1} />
      <FloatingPaths position={-1} />
    </div>
  );
}
