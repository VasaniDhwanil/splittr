'use client';

import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AvatarInitials, getPersonHex } from '@/components/avatar-initials';
import { LIT_FIELD } from '@/components/create/field';
import { formatCurrency } from '@/lib/calculations';
import type { ParticipantSplit, SplitMode } from '@/types';

interface OwesListProps {
  splits: ParticipantSplit[];
  splitMode: SplitMode;
  currentParticipantId: string | null;
  isCreator: boolean;
  payingParticipantId: string | null;
  /** Custom mode, host only: the draft text per participant id. */
  customDrafts: Record<string, string>;
  onCustomDraft: (participantId: string, value: string) => void;
  onCustomCommit: (participantId: string) => void;
  onTogglePaid: (participantId: string) => void;
}

/** Hairline rows: who, what they had, and what they owe in their own color. */
export function OwesList({
  splits,
  splitMode,
  currentParticipantId,
  isCreator,
  payingParticipantId,
  customDrafts,
  onCustomDraft,
  onCustomCommit,
  onTogglePaid,
}: OwesListProps) {
  return (
    <div className="surface divide-y divide-white/[0.06] overflow-hidden rounded-2xl">
      {splits.map((split) => {
        const p = split.participant;
        const isPaid = !p.is_creator && p.payment_status === 'paid';
        const isMe = p.id === currentParticipantId;
        const itemCount = `${split.items.length} item${split.items.length !== 1 ? 's' : ''}`;
        return (
          <div key={p.id} className={`px-4 py-3.5 ${isMe ? 'bg-white/[0.02]' : ''}`}>
            <div className="flex min-h-11 items-center gap-3">
              <AvatarInitials name={p.name} size="md" className="shrink-0 shadow-none" />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-baseline gap-1.5 text-sm font-medium text-white">
                  <span className="truncate">{p.name}</span>
                  {isMe && <span className="shrink-0 font-normal text-white/40">you</span>}
                  {isPaid && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 self-center text-xs font-medium text-primary">
                      <Check className="size-3.5" strokeWidth={2.5} />
                      Paid
                    </span>
                  )}
                </p>
                {splitMode === 'items' && (
                  <p className="mt-0.5 truncate text-xs tabular-nums text-white/40">
                    {itemCount} {formatCurrency(split.itemsTotal)} · tax {formatCurrency(split.taxShare)} · tip{' '}
                    {formatCurrency(split.tipShare)}
                  </p>
                )}
              </div>
              {splitMode === 'custom' && isCreator ? (
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-sm text-white/40">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    aria-label={`Amount for ${p.name}`}
                    className={`${LIT_FIELD} font-money h-11 w-24 text-right text-white`}
                    value={customDrafts[p.id] ?? (p.custom_amount != null ? String(p.custom_amount) : '')}
                    placeholder="0.00"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onCustomDraft(p.id, e.target.value)}
                    onBlur={() => onCustomCommit(p.id)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </div>
              ) : (
                <span className="font-money shrink-0 whitespace-nowrap text-xl" style={{ color: getPersonHex(p.name) }}>
                  {formatCurrency(split.total)}
                </span>
              )}
            </div>
            {/* Host can toggle anyone's paid status */}
            {isCreator && !p.is_creator && (
              <div className="mt-1 pl-11">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 h-10 text-xs text-white/50 hover:bg-white/[0.06] hover:text-white"
                  disabled={payingParticipantId === p.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePaid(p.id);
                  }}
                >
                  {payingParticipantId === p.id && <Loader2 className="animate-spin" />}
                  {isPaid ? 'Mark unpaid' : 'Mark paid'}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
