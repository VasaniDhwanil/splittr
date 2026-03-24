"use client";

import { FloatingPaths } from "./background-paths";

export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 opacity-20 pointer-events-none z-0">
      <FloatingPaths position={1} />
      <FloatingPaths position={-1} />
    </div>
  );
}
