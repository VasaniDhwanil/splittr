'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

interface RevealProps {
  /** Position in the page; each step adds a 40ms delay. */
  index?: number;
  className?: string;
  children: ReactNode;
}

/** Quiet mount fade: 6px rise, 250ms, staggered. Static when reduced motion is on. */
export function Reveal({ index = 0, className, children }: RevealProps) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut', delay: index * 0.04 }}
    >
      {children}
    </motion.div>
  );
}

/** List items past this index appear at once; only the first screenful staggers. */
export const STAGGER_CAP = 8;

/**
 * Motion props for one item in a staggered list: the same 6px rise as Reveal,
 * 40ms apart, capped at the first STAGGER_CAP items. Static when reduced motion is on
 * or when no index is given. `opacity` is the resting opacity (for dimmed rows).
 */
export function useStagger(index?: number, opacity = 1) {
  const reduceMotion = useReducedMotion();
  const staggered = !reduceMotion && index !== undefined && index < STAGGER_CAP;
  return {
    initial: staggered ? { opacity: 0, y: 6 } : false,
    animate: { opacity, y: 0 },
    transition: { duration: 0.25, ease: 'easeOut', delay: (index ?? 0) * 0.04 },
  } as const;
}
