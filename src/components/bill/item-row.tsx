'use client';

import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { AvatarStack, getPersonHex } from '@/components/avatar-initials';
import { formatCurrency, formatQuantity, formatShare } from '@/lib/calculations';
import type { BillItem, Participant } from '@/types';

export interface ItemClaimer {
  participant: Participant;
  share: number;
}

interface ItemRowProps {
  item: BillItem;
  claimers: ItemClaimer[];
  /** The current participant's share of this item, or null. */
  myShare: number | null;
  /** Whether the row opens the split sheet (items mode only). */
  interactive: boolean;
  /** A claim on this row is being written: the viewer's marker fades in. */
  pending: boolean;
  onTap: () => void;
  onUnclaim: () => void;
}

/** One bill line: name, who has it, the line price, and the viewer's part. */
export function ItemRow({ item, claimers, myShare, interactive, pending, onTap, onUnclaim }: ItemRowProps) {
  const lineTotal = item.price * item.quantity;
  const totalShares = claimers.reduce((sum, c) => sum + c.share, 0);
  // Portions are absolute until the item is over-claimed (must match
  // calculateSplits so the list and totals agree)
  const shareDenominator = Math.max(totalShares, item.quantity);
  const mine = myShare !== null && myShare > 0;
  const myPortion = mine && shareDenominator > 0 ? (lineTotal * myShare) / shareDenominator : 0;

  // Equal shares collapse to one line ("Split 3 ways · $2.67 each");
  // per-person breakdowns are for uneven splits only
  const equalSplit =
    claimers.length > 1 && claimers.every((c) => Math.abs(c.share - claimers[0].share) < 0.005);
  const equalPerHead = equalSplit ? (lineTotal * claimers[0].share) / shareDenominator : 0;

  let note: string | null = null;
  if (equalSplit) {
    note = `Split ${claimers.length} ways · ${formatCurrency(equalPerHead)} each`;
  } else if (item.quantity > 1 && totalShares > 0) {
    const progress =
      totalShares >= item.quantity - 0.01 ? 'Fully claimed' : `${formatQuantity(totalShares)}/${item.quantity} claimed`;
    const who = claimers.map((c) => `${c.participant.name} ${formatQuantity(c.share)}`).join(', ');
    note = claimers.length > 1 ? `${progress} · ${who}` : progress;
  } else if (item.quantity === 1 && totalShares > 0 && (claimers.length > 1 || claimers.some((c) => c.share !== 1))) {
    // Uneven portions on a shared single item (e.g. ⅔ / ⅓ of a pasta)
    note = claimers.map((c) => `${c.participant.name} ${formatShare(c.share / shareDenominator)}`).join(' · ');
  }

  const myLabel =
    item.quantity > 1
      ? `${formatQuantity(myShare ?? 0)}× = ${formatCurrency(myPortion)}`
      : claimers.length === 1 && myShare === 1
        ? 'Yours'
        : `${formatShare((myShare ?? 0) / shareDenominator)} · ${formatCurrency(myPortion)}`;

  // Quiet tint: the viewer's rows in the primary, a lone claimer's in their color
  const style: CSSProperties = {};
  if (!mine && claimers.length === 1) {
    const hex = getPersonHex(claimers[0].participant.name);
    style.backgroundColor = `${hex}0f`;
    style.boxShadow = `inset 2px 0 0 ${hex}80`;
  } else if (!mine && claimers.length > 1) {
    style.backgroundColor = 'rgb(255 255 255 / 0.02)';
  }

  return (
    <div
      className={`relative flex min-h-16 items-start gap-3 px-4 py-3.5 ${interactive ? 'tactile cursor-pointer' : ''} ${
        mine ? 'bg-primary/[0.06] shadow-[inset_2px_0_0_var(--primary)]' : ''
      }`}
      style={style}
      onClick={onTap}
    >
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="truncate font-medium text-white">
          {item.quantity > 1 && <span className="text-white/40">{item.quantity}× </span>}
          <span>{item.name}</span>
        </div>
        {claimers.length > 0 && (
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <AvatarStack
              names={claimers.map((c) => c.participant.name)}
              max={4}
              size="sm"
              className="shrink-0 [&>*]:shadow-none [&>*]:ring-[#121214]"
            />
            {note && <span className="min-w-0 truncate text-xs text-white/40">{note}</span>}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <div className="font-money whitespace-nowrap pt-0.5 text-[15px] text-white">{formatCurrency(lineTotal)}</div>
        {mine && (
          <>
            <div
              className={`mt-2 flex h-6 items-center gap-1 whitespace-nowrap text-sm font-medium text-primary ${
                pending ? 'animate-in fade-in-0 duration-300 motion-reduce:animate-none' : ''
              }`}
            >
              <Check className="size-4" strokeWidth={2.5} />
              <span className="tabular-nums">{myLabel}</span>
            </div>
            <button
              type="button"
              className="-mr-2 -mb-2 min-h-9 rounded-full px-2 text-xs text-white/40 outline-none transition-colors touch-manipulation hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={(e) => {
                e.stopPropagation();
                onUnclaim();
              }}
            >
              unclaim
            </button>
          </>
        )}
      </div>
    </div>
  );
}
