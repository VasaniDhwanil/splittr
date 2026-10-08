'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

interface InViewProps {
  className?: string;
  /** Extra delay in seconds, for staggering siblings. */
  delay?: number;
  children: ReactNode;
}

/** Scroll reveal: a short fade and rise, once. Static when reduced motion is on. */
export function InView({ className, delay = 0, children }: InViewProps) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, ease: 'easeOut', delay }}
    >
      {children}
    </motion.div>
  );
}
