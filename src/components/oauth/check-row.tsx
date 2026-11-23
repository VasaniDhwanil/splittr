'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

interface CheckRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: ReactNode;
  helper?: ReactNode;
}

/** A real checkbox, drawn to match the lit fields. Selected is the one place green marks a choice. */
export function CheckRow({ checked, onChange, disabled, label, helper }: CheckRowProps) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
      <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 size-5 cursor-[inherit] appearance-none rounded-md border border-white/20 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] outline-none transition-colors checked:border-primary checked:bg-primary focus-visible:ring-[3px] focus-visible:ring-primary/40"
        />
        <Check
          className="pointer-events-none relative size-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100"
          strokeWidth={3}
          aria-hidden
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm leading-snug text-white">{label}</span>
        {helper && <span className="mt-0.5 block text-xs leading-relaxed text-white/40">{helper}</span>}
      </span>
    </label>
  );
}
