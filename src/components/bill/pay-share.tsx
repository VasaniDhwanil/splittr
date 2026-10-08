'use client';

import { ArrowUpRight, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/calculations';
import type { PaymentOption, ZelleInfo } from '@/lib/payment-links';
import { onPayLinkClick, ZellePanel } from '@/components/pay-links';

interface PayShareProps {
  amount: number;
  payerName: string;
  isPaid: boolean;
  payOptions: PaymentOption[];
  zelle: ZelleInfo | null;
  isUpdating: boolean;
  onTogglePaid: () => void;
}

/** The viewer's settle-up surface: what they owe, how to pay, and the paid toggle. */
export function PayShare({ amount, payerName, isPaid, payOptions, zelle, isUpdating, onTogglePaid }: PayShareProps) {
  const hasWays = payOptions.length > 0 || Boolean(zelle);
  return (
    <div className="surface space-y-5 rounded-2xl p-5">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm text-white/50">{isPaid ? 'You paid' : `You owe ${payerName}`}</p>
          <p className="font-money mt-1 whitespace-nowrap text-4xl text-primary">{formatCurrency(amount)}</p>
        </div>
        {isPaid && (
          <span className="mb-1.5 inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
            <Check className="size-4" strokeWidth={2.5} />
            Paid
          </span>
        )}
      </div>

      {isPaid ? (
        <p className="text-sm text-white/50">You are marked as paid. Thanks for settling up!</p>
      ) : hasWays ? (
        <div className="space-y-3">
          {payOptions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {payOptions.map((option) => (
                <a
                  key={option.key}
                  href={option.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onPayLinkClick(option)}
                  title={`${option.label} ${option.handle}`}
                  aria-label={`Pay ${payerName} ${formatCurrency(amount)} with ${option.label} (${option.handle})`}
                  className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.02] px-4 text-sm font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-white"
                >
                  {option.label}
                  <span className="truncate font-normal text-white/40">{option.handle}</span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-white/35" />
                </a>
              ))}
            </div>
          )}
          {zelle && <ZellePanel zelle={zelle} amount={amount} />}
        </div>
      ) : (
        <p className="text-sm text-white/50">Pay {payerName} however you usually do, then mark yourself paid.</p>
      )}

      <Button
        variant={isPaid ? 'ghost' : 'secondary'}
        className={`w-full ${isPaid ? 'text-white/60 hover:bg-white/[0.06] hover:text-white' : ''}`}
        onClick={onTogglePaid}
        disabled={isUpdating}
      >
        {isUpdating && <Loader2 className="animate-spin" />}
        {isPaid ? 'Undo, not paid yet' : "I've paid my share"}
      </Button>
    </div>
  );
}
