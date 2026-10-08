'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ChevronRight, Loader2, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AvatarInitials } from '@/components/avatar-initials';
import { formatCurrency, formatQuantity } from '@/lib/calculations';
import { BillItem, ItemClaim, Participant } from '@/types';

export interface SplitEntry {
  participant_id: string;
  share: number;
}

interface SplitSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: BillItem | null;
  participants: Participant[];
  claims: ItemClaim[];
  currentParticipantId: string | null;
  isSubmitting: boolean;
  /** Called with the claims to write and a ready-made success toast. */
  onSubmit: (item: BillItem, entries: SplitEntry[], successMessage: string) => void;
}

/** Fraction ladders are in twelfths so quarters and thirds share one scale. */
const CUSTOM_LADDER = [2, 3, 4, 6, 8, 9, 12, 15, 16, 18, 21, 24];
const SINGLE_LADDER = [3, 4, 6, 8, 9, 12]; // ¼ ⅓ ½ ⅔ ¾ all

/** Glyph for a share when it renders cleanly (⅔, 1½ …), else null; money leads. */
function cleanGlyph(value: number): string | null {
  const g = formatQuantity(value);
  return /[½⅓⅔¼¾⅙⅚]/.test(g) || /^\d+$/.test(g) ? g : null;
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

export function SplitSheet({
  open,
  onOpenChange,
  item,
  participants,
  claims,
  currentParticipantId,
  isSubmitting,
  onSubmit,
}: SplitSheetProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [unitsHalf, setUnitsHalf] = useState(0); // group units in half-steps
  // Until the stepper is touched, units track the full available pool, so
  // selecting existing claimers grows the split to cover their shares too.
  const [unitsTouched, setUnitsTouched] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customTw, setCustomTw] = useState(6); // custom share in twelfths

  const itemClaims = useMemo(
    () => (item ? claims.filter((c) => c.item_id === item.id) : []),
    [claims, item]
  );
  const claimByPid = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of itemClaims) map[c.participant_id] = c.share;
    return map;
  }, [itemClaims]);

  const qty = item?.quantity ?? 1;
  const multi = qty > 1;

  // Units available to a group split: the bill's quantity minus claims held
  // by people NOT in the split; selecting an existing claimer folds their
  // share back into the pool (their claim gets replaced by the new split).
  const selectedIds = participants.filter((p) => selected[p.id]).map((p) => p.id);
  const n = selectedIds.length;
  const pool = multi
    ? Math.max(
        0,
        qty -
          itemClaims
            .filter((c) => !selected[c.participant_id])
            .reduce((sum, c) => sum + c.share, 0)
      )
    : 1;
  const maxHalf = Math.floor(pool * 2 + 1e-9);
  // Less than ½ left but not zero (e.g. a stray ⅓): offer exactly the rest
  const takeRest = multi && maxHalf < 1 && pool > 0.01;

  // Custom mode is always a solo claim for the current participant, and
  // ignores the people-picker: its budget excludes only *others'* claims.
  const customPool = multi
    ? Math.max(
        0,
        qty -
          itemClaims
            .filter((c) => c.participant_id !== currentParticipantId)
            .reduce((sum, c) => sum + c.share, 0)
      )
    : 1;
  const customLadder = multi
    ? CUSTOM_LADDER.filter((t) => t <= Math.floor(customPool * 12 + 1e-9))
    : SINGLE_LADDER;

  // Reset to "just me, everything that's left" each time the sheet opens.
  // Keyed on open + item id only: a realtime refetch mid-gesture must NOT
  // wipe the picker state out from under the user.
  const itemId = item?.id;
  useEffect(() => {
    if (!open || !itemId) return;
    setSelected(currentParticipantId ? { [currentParticipantId]: true } : {});
    setCustomOpen(false);
    setCustomTw(6);
    setUnitsTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemId, currentParticipantId]);

  if (!item) return null;

  const effUnitsHalf = unitsTouched
    ? Math.max(1, Math.min(unitsHalf, Math.max(maxHalf, 1)))
    : Math.max(maxHalf, 1);
  const units = takeRest ? pool : multi ? effUnitsHalf / 2 : pool;

  const effCustomTw = customLadder.includes(customTw)
    ? customTw
    : customLadder[customLadder.length - 1] ?? 0;
  const customShare = effCustomTw / 12;
  const customIdx = customLadder.indexOf(effCustomTw);

  // What's already gone, independent of selection, for the header line
  const totalClaimed = itemClaims.reduce((sum, c) => sum + c.share, 0);
  const remainingNow = Math.max(0, qty - totalClaimed);

  // Money previews. Single items are weight-normalized (overlapping claims
  // shrink everyone's slice), so the preview must honor the weights too.
  const itemTotal = item.price * qty;
  const perShare = n > 0 ? (multi ? units / n : 1 / n) : 0;
  let eachMoney = 0;
  if (n > 0) {
    if (multi) {
      eachMoney = item.price * perShare;
    } else {
      const otherWeights = itemClaims
        .filter((c) => !selected[c.participant_id])
        .reduce((sum, c) => sum + Math.min(c.share, 1), 0);
      const denom = Math.max(otherWeights + 1, 1);
      eachMoney = (itemTotal * perShare) / denom;
    }
  }
  let customMoney = 0;
  if (customOpen) {
    if (multi) {
      customMoney = item.price * customShare;
    } else {
      const otherWeights = itemClaims
        .filter((c) => c.participant_id !== currentParticipantId)
        .reduce((sum, c) => sum + Math.min(c.share, 1), 0);
      customMoney = (itemTotal * customShare) / Math.max(otherWeights + customShare, 1);
    }
  }

  const soloTarget = n === 1 ? participants.find((p) => p.id === selectedIds[0]) : null;
  const soloIsMe = soloTarget?.id === currentParticipantId;
  const replacedNames = participants
    .filter((p) => selected[p.id] && claimByPid[p.id] !== undefined)
    .map((p) => (p.id === currentParticipantId ? 'your' : `${p.name}'s`));

  const groupBlocked = multi && pool <= 0.01;
  const customBlocked = customOpen && (multi ? customLadder.length === 0 : false);
  const ctaDisabled =
    isSubmitting || (customOpen ? customBlocked : n === 0 || groupBlocked);

  const unitsGlyph = formatQuantity(units);
  const shareGlyph = cleanGlyph(perShare);

  let ctaLabel: string;
  let previewLabel: string;
  let previewMoney: string;
  let previewNote: string | null = null;

  if (customOpen) {
    const g = formatQuantity(customShare);
    ctaLabel = customBlocked ? 'Nothing left to claim' : `Claim ${g} for yourself`;
    previewLabel = 'You pay';
    previewMoney = formatCurrency(customBlocked ? 0 : customMoney);
  } else if (n === 0) {
    ctaLabel = 'Pick at least one person';
    previewLabel = 'Nobody selected';
    previewMoney = formatCurrency(0);
  } else if (groupBlocked) {
    ctaLabel = 'All claimed already';
    previewLabel = 'Select claimers to re-split';
    previewMoney = formatCurrency(0);
  } else if (n === 1) {
    const what = multi ? formatQuantity(units) : 'it';
    ctaLabel = soloIsMe ? `Claim ${what} for yourself` : `Claim ${what} for ${soloTarget?.name}`;
    previewLabel = soloIsMe ? 'You pay' : `${soloTarget?.name} pays`;
    previewMoney = formatCurrency(eachMoney);
  } else {
    ctaLabel = `Split between ${n} people`;
    previewLabel = `${n === participants.length ? `All ${n}` : `${n} people`} · ${
      multi ? `${unitsGlyph} unit${units === 1 ? '' : 's'}` : 'the whole thing'
    }`;
    previewMoney = `${formatCurrency(eachMoney)} each`;
    if (shareGlyph && multi) {
      previewNote = `${shareGlyph} of one each`;
    }
  }

  const handleSubmit = () => {
    if (ctaDisabled) return;
    if (customOpen) {
      if (!currentParticipantId) return;
      onSubmit(
        item,
        [{ participant_id: currentParticipantId, share: round4(customShare) }],
        `Claimed ${formatQuantity(customShare)} of ${item.name}. ${formatCurrency(customMoney)}`
      );
      return;
    }
    const share = round4(perShare);
    const entries = selectedIds.map((id) => ({ participant_id: id, share }));
    const message =
      n === 1
        ? soloIsMe
          ? `Claimed ${multi ? formatQuantity(units) : ''} ${item.name}. ${formatCurrency(eachMoney)}`.replace('  ', ' ')
          : `Claimed ${item.name} for ${soloTarget?.name}. ${formatCurrency(eachMoney)}`
        : `Split ${item.name} ${n} ways. ${formatCurrency(eachMoney)} each`;
    onSubmit(item, entries, message);
  };

  const stepButton =
    'flex size-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] outline-none transition-[background-color,color,scale] duration-150 touch-manipulation hover:bg-white/[0.08] hover:text-white active:scale-95 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30';
  const quietButton =
    'inline-flex min-h-9 items-center rounded-full px-3 text-xs font-medium text-white/50 outline-none transition-colors touch-manipulation hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-ring/50';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[90dvh] w-full max-w-md gap-0 overflow-y-auto rounded-t-3xl border-x-0 border-t border-white/10 bg-[#0f0f12] p-0 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_-24px_64px_-24px_rgba(0,0,0,0.7)] sm:border-x [&>button]:top-5 [&>button]:right-4 [&>button]:flex [&>button]:size-9 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-full [&>button]:text-white/50 [&>button]:ring-offset-0 [&>button:hover]:bg-white/[0.06]"
      >
        <div className="px-5 pt-2.5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto h-1 w-9 rounded-full bg-white/15" aria-hidden />

          {/* Item and line price */}
          <div className="mt-4 pr-10">
            <SheetTitle className="text-xl font-semibold tracking-tight text-white">
              {qty > 1 && <span className="font-normal text-white/40">{qty}× </span>}
              {item.name}
            </SheetTitle>
            <SheetDescription className="mt-1 text-sm text-white/40">
              <span className="font-money text-white/80">{formatCurrency(itemTotal)}</span>
              {multi &&
                (totalClaimed <= 0.01
                  ? ' · nothing claimed yet'
                  : remainingNow <= 0.01
                    ? ` · all ${qty} claimed`
                    : ` · ${formatQuantity(remainingNow)} of ${qty} left`)}
              {!multi && itemClaims.length > 0 && ` · shared by ${itemClaims.length} so far`}
            </SheetDescription>
          </div>

          {/* Split-together zone */}
          <div
            className={cn(
              'mt-6 transition-opacity duration-200',
              customOpen && 'pointer-events-none opacity-40'
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-white/70">Who&apos;s sharing this?</span>
              <span className="-mr-3 flex shrink-0">
                <button
                  type="button"
                  onClick={() => setSelected(Object.fromEntries(participants.map((p) => [p.id, true])))}
                  className={quietButton}
                >
                  Everyone
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(currentParticipantId ? { [currentParticipantId]: true } : {})}
                  className={quietButton}
                >
                  Just me
                </button>
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {participants.map((p) => {
                const on = Boolean(selected[p.id]);
                const isMe = p.id === currentParticipantId;
                const existing = claimByPid[p.id];
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSelected((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                    className={cn(
                      'inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border py-1 pr-4 pl-1.5 text-sm outline-none transition-[background-color,border-color,color,scale] duration-200 touch-manipulation active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring/50',
                      on
                        ? 'border-primary/60 bg-primary/15 font-medium text-white'
                        : 'border-white/10 bg-white/[0.02] text-white/60 hover:border-white/15 hover:bg-white/[0.05] hover:text-white'
                    )}
                  >
                    <AvatarInitials
                      name={p.name}
                      size="md"
                      className={cn('shrink-0 shadow-none', !on && 'opacity-50')}
                    />
                    <span className="min-w-0 truncate">{isMe ? 'You' : p.name}</span>
                    {multi && existing !== undefined && (
                      <span className="shrink-0 text-xs font-normal text-white/40">
                        has {formatQuantity(existing)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Units stepper: only meaningful on multi-quantity items */}
            {multi && !takeRest && !groupBlocked && (
              <div className="mt-6">
                <div className="text-center text-sm text-white/50">How many of the {qty} are you splitting?</div>
                <div className="flex items-center justify-center gap-6 pt-3">
                  <button
                    type="button"
                    className={stepButton}
                    onClick={() => {
                      setUnitsTouched(true);
                      setUnitsHalf(Math.max(1, effUnitsHalf - 1));
                    }}
                    disabled={effUnitsHalf <= 1}
                    aria-label="Fewer units"
                  >
                    <Minus className="size-4" />
                  </button>
                  <div className="min-w-20 text-center">
                    <div className="font-money text-5xl leading-none text-white">{unitsGlyph}</div>
                    <div className="mt-1.5 text-xs text-white/40">unit{units === 1 ? '' : 's'}</div>
                  </div>
                  <button
                    type="button"
                    className={stepButton}
                    onClick={() => {
                      setUnitsTouched(true);
                      setUnitsHalf(Math.min(maxHalf, effUnitsHalf + 1));
                    }}
                    disabled={effUnitsHalf >= maxHalf}
                    aria-label="More units"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              </div>
            )}
            {takeRest && (
              <p className="mt-4 text-center text-sm text-white/50">
                Only {formatQuantity(pool)} left, so you&apos;re splitting that.
              </p>
            )}
            {!customOpen && replacedNames.length > 0 && (
              <p className="mt-4 text-center text-xs text-white/40">
                This replaces {replacedNames.join(' and ')} current share
                {replacedNames.length > 1 ? 's' : ''} on this item.
              </p>
            )}
          </div>

          {/* Custom solo claim */}
          <button
            type="button"
            onClick={() => setCustomOpen((v) => !v)}
            aria-expanded={customOpen}
            className="mt-6 flex min-h-12 w-full items-center justify-between gap-3 border-t border-white/10 pt-1 text-left text-sm text-white/50 outline-none transition-colors hover:text-white focus-visible:text-white"
          >
            <span>
              Had your own odd amount? <span className="font-medium text-primary">Custom</span>
            </span>
            <ChevronRight
              className={cn('size-4 shrink-0 transition-transform duration-200', customOpen && 'rotate-90')}
            />
          </button>
          {customOpen &&
            (customBlocked ? (
              <p className="py-2 text-center text-sm text-white/50">
                Nothing left to claim. Everything is spoken for.
              </p>
            ) : (
              <div
                role="radiogroup"
                aria-label="Your share"
                className={cn(
                  'mt-1 flex flex-wrap bg-white/[0.04] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
                  customLadder.length > 6 ? 'rounded-3xl' : 'rounded-full'
                )}
              >
                {customLadder.map((tw) => {
                  const on = tw === effCustomTw;
                  return (
                    <button
                      key={tw}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setCustomTw(tw)}
                      className={cn(
                        'font-money min-h-11 basis-1/6 rounded-full text-base outline-none transition-[background-color,color,scale] duration-200 touch-manipulation active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring/50',
                        on
                          ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                          : 'text-white/60 hover:bg-white/[0.05] hover:text-white'
                      )}
                    >
                      {formatQuantity(tw / 12)}
                    </button>
                  );
                })}
              </div>
            ))}
          {customOpen && !customBlocked && customIdx >= 0 && (
            <p className="mt-2 text-center text-xs text-white/40">
              {customShare <= 1 ? 'of one' : 'units'}
            </p>
          )}

          {/* Preview + CTA */}
          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-white/60">{previewLabel}</span>
              <span className="font-money shrink-0 whitespace-nowrap text-2xl text-primary">{previewMoney}</span>
            </div>
            {previewNote && <div className="mt-0.5 text-right text-xs text-white/40">{previewNote}</div>}
            <Button className="mt-4 w-full" size="lg" onClick={handleSubmit} disabled={ctaDisabled}>
              {isSubmitting && <Loader2 className="animate-spin" />}
              {ctaLabel}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
