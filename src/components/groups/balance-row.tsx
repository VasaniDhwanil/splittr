'use client';

import { ArrowUpRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AvatarInitials } from '@/components/avatar-initials';
import { formatCurrency } from '@/lib/calculations';
import type { PaymentOption } from '@/lib/payment-links';

interface BalanceRowProps {
  name: string;
  /** Guests have no account and are matched across bills by name. */
  isGuest: boolean;
  /** Positive: you owe them. Negative: they owe you. */
  amount: number;
  payOptions: PaymentOption[];
  isSettling: boolean;
  onSettle: () => void;
}

export function BalanceRow({ name, isGuest, amount, payOptions, isSettling, onSettle }: BalanceRowProps) {
  const iOwe = amount > 0;

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-3">
        <AvatarInitials name={name} size="md" className="shrink-0 shadow-none" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-white">{iOwe ? `You owe ${name}` : `${name} owes you`}</p>
          {isGuest && <p className="text-xs text-white/35">Guest, matched by name</p>}
        </div>
        <span
          className={`font-money shrink-0 whitespace-nowrap text-lg ${iOwe ? 'text-foreground' : 'text-primary'}`}
        >
          {formatCurrency(Math.abs(amount))}
        </span>
      </div>

      {iOwe && payOptions.length === 0 && (
        <p className="mt-2 text-xs leading-relaxed text-white/40 sm:pl-11">
          {name} hasn&apos;t added payment handles. Pay however you usually do, then settle up.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-11">
        {iOwe &&
          payOptions.map((option) => (
            <a
              key={option.key}
              href={option.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${option.label} ${option.handle}`}
              aria-label={`Pay ${name} ${formatCurrency(amount)} with ${option.label} (${option.handle})`}
              className="inline-flex h-9 items-center gap-1 rounded-full border border-white/10 px-3.5 text-xs font-medium text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white"
            >
              {option.label}
              <ArrowUpRight className="size-3 text-white/35" />
            </a>
          ))}
        <Button
          variant={iOwe ? 'secondary' : 'ghost'}
          size="sm"
          className={iOwe ? 'ml-auto h-10' : 'ml-auto h-10 text-white/50 hover:bg-white/[0.06] hover:text-white'}
          disabled={isSettling}
          onClick={onSettle}
        >
          {isSettling && <Loader2 className="animate-spin" />}
          {iOwe ? 'Settle up' : 'Mark settled'}
        </Button>
      </div>
    </div>
  );
}
