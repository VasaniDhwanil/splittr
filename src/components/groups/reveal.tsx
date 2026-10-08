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
