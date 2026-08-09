'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChevronRight, Loader2, Minus, Plus } from 'lucide-react';
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

/** Glyph for a share when it renders cleanly (⅔, 1½ …), else null — money leads. */
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
  // Until the stepper is touched, units track the full available pool — so
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
  // by people NOT in the split — selecting an existing claimer folds their
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

  // What's already gone, independent of selection — for the header line
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
    previewLabel = 'Just you';
    previewMoney = customBlocked ? '—' : formatCurrency(customMoney);
  } else if (n === 0) {
    ctaLabel = 'Pick at least one person';
    previewLabel = 'Nobody selected';
    previewMoney = '—';
  } else if (groupBlocked) {
    ctaLabel = 'All claimed already';
    previewLabel = 'Select claimers to re-split';
    previewMoney = '—';
  } else if (n === 1) {
    const what = multi ? formatQuantity(units) : 'it';
    ctaLabel = soloIsMe ? `Claim ${what} for yourself` : `Claim ${what} for ${soloTarget?.name}`;
    previewLabel = soloIsMe ? 'Just you' : `${soloTarget?.name} only`;
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
        `Claimed ${formatQuantity(customShare)} of ${item.name} — ${formatCurrency(customMoney)}`
      );
      return;
    }
    const share = round4(perShare);
    const entries = selectedIds.map((id) => ({ participant_id: id, share }));
    const message =
      n === 1
        ? soloIsMe
          ? `Claimed ${multi ? formatQuantity(units) : ''} ${item.name} — ${formatCurrency(eachMoney)}`.replace('  ', ' ')
          : `Claimed ${item.name} for ${soloTarget?.name} — ${formatCurrency(eachMoney)}`
        : `Split ${item.name} ${n} ways — ${formatCurrency(eachMoney)} each`;
    onSubmit(item, entries, message);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {qty > 1 && <span className="text-muted-foreground font-normal">{qty}× </span>}
            {item.name}
          </DialogTitle>
          <DialogDescription>
            {formatCurrency(itemTotal)}
            {multi &&
              (totalClaimed <= 0.01
                ? ' — nothing claimed yet'
                : remainingNow <= 0.01
                ? ` — all ${qty} claimed`
                : ` — ${formatQuantity(remainingNow)} of ${qty} left`)}
            {!multi && itemClaims.length > 0 && ` — shared by ${itemClaims.length} so far`}
          </DialogDescription>
        </DialogHeader>

        {/* Split-together zone */}
        <div className={customOpen ? 'opacity-40 pointer-events-none transition-smooth' : 'transition-smooth'}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Who&apos;s sharing this?
            </span>
            <span className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setSelected(Object.fromEntries(participants.map((p) => [p.id, true])))}
                className="px-2.5 py-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-xs transition-smooth"
              >
                Everyone
              </button>
              <button
                type="button"
                onClick={() => setSelected(currentParticipantId ? { [currentParticipantId]: true } : {})}
                className="px-2.5 py-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-xs transition-smooth"
              >
                Just me
              </button>
            </span>
          </div>

          <div className="flex flex-wrap gap-1">
            {participants.map((p) => {
              const on = Boolean(selected[p.id]);
              const isMe = p.id === currentParticipantId;
              const existing = claimByPid[p.id];
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                  className={`flex flex-col items-center gap-1 w-16 py-1.5 rounded-lg transition-smooth hover:bg-white/5 ${
                    on ? '' : 'opacity-35'
                  }`}
                >
                  <AvatarInitials
                    name={p.name}
                    size="lg"
                    className={on ? 'ring-2 ring-white/80' : ''}
                  />
                  <span className="text-[10px] leading-tight text-muted-foreground max-w-full truncate px-0.5">
                    {isMe ? 'You' : p.name}
                  </span>
                  {multi && existing !== undefined && (
                    <span className="text-[9px] leading-none text-primary -mt-0.5">
                      has {formatQuantity(existing)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Units stepper — only meaningful on multi-quantity items */}
          {multi && !takeRest && !groupBlocked && (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-center">
                How many of the {qty} are you splitting?
              </div>
              <div className="flex items-center justify-center gap-5 pt-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full h-11 w-11"
                  onClick={() => {
                    setUnitsTouched(true);
                    setUnitsHalf(Math.max(1, effUnitsHalf - 1));
                  }}
                  disabled={effUnitsHalf <= 1}
                  aria-label="Fewer units"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <div className="text-center min-w-20">
                  <div className="text-3xl font-bold leading-tight">{unitsGlyph}</div>
                  <div className="text-xs text-muted-foreground">
                    unit{units === 1 ? '' : 's'}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full h-11 w-11"
                  onClick={() => {
                    setUnitsTouched(true);
                    setUnitsHalf(Math.min(maxHalf, effUnitsHalf + 1));
                  }}
                  disabled={effUnitsHalf >= maxHalf}
                  aria-label="More units"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          {takeRest && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Only {formatQuantity(pool)} left — splitting that.
            </p>
          )}
          {!customOpen && replacedNames.length > 0 && (
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              This replaces {replacedNames.join(' and ')} current share
              {replacedNames.length > 1 ? 's' : ''} on this item.
            </p>
          )}
        </div>

        {/* Custom solo claim */}
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          className="w-full border-t border-white/10 pt-3 text-left text-sm text-muted-foreground hover:text-foreground transition-smooth flex items-center justify-between"
        >
          <span>
            Had your own odd amount? <span className="text-primary font-medium">Custom</span>
          </span>
          <ChevronRight
            className={`h-4 w-4 transition-transform ${customOpen ? 'rotate-90' : ''}`}
          />
        </button>
        {customOpen && (
          <div>
            {customBlocked ? (
              <p className="text-center text-sm text-muted-foreground py-2">
                Nothing left to claim — everything is spoken for.
              </p>
            ) : (
              <div className="flex items-center justify-center gap-5">
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full h-11 w-11"
                  onClick={() => customIdx > 0 && setCustomTw(customLadder[customIdx - 1])}
                  disabled={customIdx <= 0}
                  aria-label="Smaller share"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <div className="text-center min-w-20">
                  <div className="text-3xl font-bold leading-tight">
                    {formatQuantity(customShare)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {customShare <= 1 ? 'of one' : 'units'}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full h-11 w-11"
                  onClick={() =>
                    customIdx < customLadder.length - 1 && setCustomTw(customLadder[customIdx + 1])
                  }
                  disabled={customIdx >= customLadder.length - 1}
                  aria-label="Bigger share"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Preview + CTA */}
        <div className="border-t border-white/10 pt-3">
          <div className="flex justify-between items-baseline gap-3">
            <span className="text-sm text-muted-foreground">{previewLabel}</span>
            <span className="text-xl font-bold text-primary font-money whitespace-nowrap">
              {previewMoney}
            </span>
          </div>
          {previewNote && (
            <div className="text-right text-xs text-muted-foreground mt-0.5">{previewNote}</div>
          )}
          <Button className="w-full mt-3" size="lg" onClick={handleSubmit} disabled={ctaDisabled}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {ctaLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
