'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { AvatarInitials, AvatarStack, getPersonHex } from '@/components/avatar-initials';
import { formatCurrency } from '@/lib/calculations';

const ME = 'Ines';
const PEOPLE = ['Priya', 'Marcus', 'Ines', 'Tomás'];
const TAX = 4.35;
const TIP = 9.8;

interface SampleItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  /** Claims per phase: index 0 is the resting state, 1 and 2 add the viewer's claims. */
  claims: [string[], string[], string[]];
}

const ITEMS: SampleItem[] = [
  { id: 'birria', name: 'Birria tacos', quantity: 1, price: 18, claims: [['Priya'], ['Priya'], ['Priya']] },
  { id: 'elote', name: 'Elote', quantity: 1, price: 7.5, claims: [['Marcus'], ['Marcus'], ['Marcus']] },
  { id: 'yuzu', name: 'Yuzu lemonade', quantity: 1, price: 6.5, claims: [[], [ME], [ME]] },
  { id: 'churros', name: 'Churros', quantity: 2, price: 6, claims: [['Tomás'], ['Tomás'], ['Tomás', ME]] },
  { id: 'horchata', name: 'Horchata', quantity: 1, price: 5, claims: [['Tomás'], ['Tomás'], ['Tomás']] },
];

const SUBTOTAL = ITEMS.reduce((sum, item) => sum + item.price * item.quantity, 0);

type Phase = 0 | 1 | 2;

/** One claim is one unit of the item, matching how the bill page splits quantities. */
function portion(item: SampleItem, claimers: string[]): number {
  if (claimers.length === 0) return 0;
  const denominator = Math.max(claimers.length, item.quantity);
  return (item.price * item.quantity) / denominator;
}

function shareFor(phase: Phase): number {
  const mine = ITEMS.reduce((sum, item) => {
    const claimers = item.claims[phase];
    return claimers.includes(ME) ? sum + portion(item, claimers) : sum;
  }, 0);
  if (mine === 0) return 0;
  const ratio = mine / SUBTOTAL;
  return mine + TAX * ratio + TIP * ratio;
}

function rowStyle(claimers: string[]): CSSProperties {
  const hexes = claimers.map(getPersonHex);
  const mine = claimers.includes(ME);
  if (hexes.length === 1) {
    return {
      backgroundColor: `${hexes[0]}17`,
      boxShadow: `inset 0 0 0 1.5px ${hexes[0]}${mine ? '73' : '40'}`,
    };
  }
  if (hexes.length > 1) {
    return {
      background: `linear-gradient(100deg, ${hexes
        .map((hex, i) => `${hex}1f ${(i / (hexes.length - 1)) * 100}%`)
        .join(', ')})`,
      boxShadow: mine ? `inset 0 0 0 1.5px ${getPersonHex(ME)}59` : undefined,
    };
  }
  return {};
}

function claimNote(item: SampleItem, claimers: string[]): string | null {
  if (item.quantity === 1 || claimers.length === 0) return null;
  if (claimers.length >= item.quantity) {
    return `Split ${claimers.length} ways · ${formatCurrency(portion(item, claimers))} each`;
  }
  return `${claimers.length}/${item.quantity} claimed`;
}

interface BillPreviewProps {
  className?: string;
}

/**
 * A sample bill drawn with the bill page's own row language. On first view the
 * viewer claims two items in sequence, then it holds still.
 */
export function BillPreview({ className }: BillPreviewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduceMotion = useReducedMotion();
  const [animatedPhase, setAnimatedPhase] = useState<Phase>(0);

  useEffect(() => {
    if (!inView || reduceMotion) return;
    const first = window.setTimeout(() => setAnimatedPhase(1), 900);
    const second = window.setTimeout(() => setAnimatedPhase(2), 1800);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [inView, reduceMotion]);

  const phase: Phase = reduceMotion ? 2 : animatedPhase;
  const share = shareFor(phase);
  const myHex = getPersonHex(ME);

  return (
    <div
      ref={ref}
      className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6 ${className ?? ''}`}
      aria-label="Sample bill: Friday tacos, split four ways"
      role="img"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold tracking-tight text-white">Friday tacos</p>
          <p className="mt-0.5 text-sm text-white/40">Hosted by Priya · 4 people</p>
        </div>
        <AvatarStack names={PEOPLE} max={4} size="sm" className="shrink-0 pt-1" />
      </div>

      <div className="space-y-2.5">
        {ITEMS.map((item) => {
          const claimers = item.claims[phase];
          const changed = !reduceMotion && claimers.length !== item.claims[0].length;
          const mine = claimers.includes(ME);
          const note = claimNote(item, claimers);
          const total = item.price * item.quantity;
          const myPortion = mine ? portion(item, claimers) : 0;

          return (
            <div
              key={item.id}
              className={`rounded-xl p-3.5 transition-smooth sm:p-4 ${claimers.length === 0 ? 'bg-muted/50' : 'shadow-sm'}`}
              style={rowStyle(claimers)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium text-white sm:text-base">
                    {item.quantity > 1 && <span className="text-muted-foreground">{item.quantity}× </span>}
                    {item.name}
                  </div>
                  {claimers.length > 0 && (
                    <motion.div
                      key={claimers.join(',')}
                      className="mt-2 flex items-center gap-2"
                      initial={changed ? { opacity: 0, scale: 0.6, x: -4 } : false}
                      animate={{ opacity: 1, scale: 1, x: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                    >
                      <AvatarStack names={claimers} max={4} size="sm" />
                      {note && <span className="truncate text-xs text-muted-foreground">{note}</span>}
                    </motion.div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[15px] font-semibold tabular-nums text-white sm:text-base">
                    {formatCurrency(total)}
                  </div>
                  {mine && (
                    <motion.div
                      className="mt-1 flex items-center justify-end gap-1 text-sm"
                      style={{ color: myHex }}
                      initial={changed ? { opacity: 0, y: 4 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    >
                      <Check className="size-4" strokeWidth={2} />
                      <span className="tabular-nums">
                        {item.quantity > 1 ? `1× = ${formatCurrency(myPortion)}` : 'Yours'}
                      </span>
                    </motion.div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <dl className="mt-5 space-y-1.5 border-t border-white/10 pt-4 text-sm">
        <div className="flex justify-between text-white/50">
          <dt>Subtotal</dt>
          <dd className="tabular-nums">{formatCurrency(SUBTOTAL)}</dd>
        </div>
        <div className="flex justify-between text-white/50">
          <dt>Tax</dt>
          <dd className="tabular-nums">{formatCurrency(TAX)}</dd>
        </div>
        <div className="flex justify-between text-white/50">
          <dt>Tip (20%)</dt>
          <dd className="tabular-nums">{formatCurrency(TIP)}</dd>
        </div>
      </dl>

      <div className="mt-4 flex items-center justify-between gap-4 rounded-xl bg-white/[0.04] px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <AvatarInitials name={ME} size="sm" className="shadow-none" />
          <span className="text-sm font-medium text-white/70">Your share</span>
        </div>
        <motion.span
          key={share.toFixed(2)}
          className="font-money text-2xl text-primary"
          initial={phase === 0 || reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {formatCurrency(share)}
        </motion.span>
      </div>
    </div>
  );
}
