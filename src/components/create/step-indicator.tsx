import { Fragment } from 'react';
import { cn } from '@/lib/utils';

interface StepIndicatorProps {
  steps: readonly string[];
  /** Index of the current step. Earlier steps read as done. */
  current: number;
}

/** Quiet word-only progress: done, current and upcoming steps joined by hairlines. */
export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return (
    <ol className="flex items-center gap-3 text-sm" aria-label="Progress">
      {steps.map((label, i) => (
        <Fragment key={label}>
          {i > 0 && (
            <li aria-hidden className={cn('h-px min-w-4 flex-1 transition-colors duration-300', i <= current ? 'bg-primary' : 'bg-white/10')} />
          )}
          <li
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'shrink-0 font-medium transition-colors duration-300',
              i === current ? 'text-primary' : i < current ? 'text-white/60' : 'text-white/30'
            )}
          >
            {label}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
