import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SummaryRowProps {
  label: ReactNode;
  children: ReactNode;
  /** The bottom line: brighter and larger. */
  strong?: boolean;
}

/** Label left, figure right, for totals. */
export function SummaryRow({ label, children, strong }: SummaryRowProps) {
  return (
    <div className={cn('flex min-h-6 items-center justify-between gap-4', strong ? 'text-base text-white' : 'text-sm text-white/60')}>
      <div className={cn('min-w-0', strong && 'font-semibold')}>{label}</div>
      <div className={cn('shrink-0 font-money', strong ? 'text-lg text-white' : 'text-white/80')}>{children}</div>
    </div>
  );
}
