'use client';

import { Check } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';

interface BottomBarProps {
  total: number;
  /** Right-hand muted lines, e.g. ["3 items", "+ $4.20 tax & tip"]. */
  details: string[];
  isPaid: boolean;
}

/** Fixed glass bar with the viewer's running total. */
export function BottomBar({ total, details, isPaid }: BottomBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[rgba(11,11,13,0.8)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
      <div className="container mx-auto max-w-2xl px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-white/40">Your total</div>
            <div className="font-money whitespace-nowrap text-3xl text-primary">{formatCurrency(total)}</div>
          </div>
          <div className="min-w-0 text-right text-xs leading-relaxed text-white/40">
            {details.map((line) => (
              <div key={line} className="truncate">
                {line}
              </div>
            ))}
            {isPaid && (
              <div className="flex items-center justify-end gap-1 font-medium text-primary">
                <Check className="size-3.5" strokeWidth={2.5} />
                Paid
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
