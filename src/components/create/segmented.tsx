'use client';

import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  /** Selected value; null leaves every option unselected. */
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

/** One rounded track with equal-width options; the selected one is a green pill. */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('flex w-full rounded-full bg-white/[0.04] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]', className)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-11 min-w-0 flex-1 truncate rounded-full px-2 text-sm font-medium outline-none transition-[background-color,border-color,color,transform,scale,box-shadow] duration-200 touch-manipulation active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring/50',
              selected
                ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                : 'text-white/60 hover:bg-white/[0.05] hover:text-white'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
