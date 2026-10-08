"use client";

import { motion, useReducedMotion, type TargetAndTransition } from "framer-motion";

interface Field {
  color: string;
  className: string;
  drift: TargetAndTransition;
  duration: number;
}

/**
 * Ambient aurora: a few very large, heavily blurred light fields drifting slowly.
 * Light, never a shape. Static when reduced motion is on.
 */
const FIELDS: Field[] = [
  {
    // Brand green, upper left: the main light source.
    color: "rgba(74,222,128,0.16)",
    className: "-left-[20vmax] -top-[22vmax] h-[60vmax] w-[60vmax]",
    drift: { x: [0, 60, -20], y: [0, 40, 70], scale: [1, 1.08, 0.96] },
    duration: 26,
  },
  {
    // Cool mint/teal, lower right: a quieter counter light.
    color: "rgba(45,212,191,0.10)",
    className: "-right-[22vmax] -bottom-[24vmax] h-[64vmax] w-[64vmax]",
    drift: { x: [0, -70, 10], y: [0, -50, -20], scale: [1, 0.94, 1.06] },
    duration: 30,
  },
  {
    // A faint green wash mid-right so long pages keep a little light.
    color: "rgba(74,222,128,0.06)",
    className: "right-[-10vmax] top-[30vh] h-[40vmax] w-[40vmax]",
    drift: { x: [0, -40, 20], y: [0, 50, -30], scale: [1, 1.1, 1] },
    duration: 22,
  },
];

export function Aurora() {
  const reduceMotion = useReducedMotion();

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      {FIELDS.map((field, i) => (
        <motion.div
          key={i}
          className={`absolute rounded-full will-change-transform ${field.className}`}
          style={{
            background: `radial-gradient(closest-side, ${field.color}, transparent)`,
            filter: "blur(80px)",
          }}
          animate={reduceMotion ? undefined : field.drift}
          transition={{
            duration: field.duration,
            repeat: Number.POSITIVE_INFINITY,
            repeatType: "mirror",
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
