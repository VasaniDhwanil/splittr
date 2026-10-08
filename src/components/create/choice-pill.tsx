'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ChoicePillProps {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}

/** Toggleable rounded pill for picking one of a few named things (a group, a payer). */
export function ChoicePill({ selected, onClick, children, className }: ChoicePillProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-4 text-sm outline-none transition-[background-color,border-color,color,transform,scale,box-shadow] duration-200 touch-manipulation active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring/50',
        selected
          ? 'border-primary bg-primary font-medium text-primary-foreground shadow-md shadow-primary/20'
          : 'border-white/10 bg-white/[0.02] text-white/60 hover:border-white/15 hover:bg-white/[0.05] hover:text-white',
        className
      )}
    >
      {children}
    </button>
  );
}
