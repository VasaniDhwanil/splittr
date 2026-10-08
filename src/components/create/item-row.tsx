'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';

export interface ItemRowValue {
  name: string;
  price: number;
  quantity: number;
}

interface ItemRowProps {
  item: ItemRowValue;
  index: number;
  onChange: (field: keyof ItemRowValue, value: string) => void;
  onRemove: () => void;
}

const GHOST_INPUT =
  'h-11 min-w-0 rounded-lg border-0 bg-transparent px-2 text-base text-white outline-none transition-colors placeholder:text-white/30 hover:bg-white/[0.02] focus:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring/40 md:text-sm';

const STEP_BUTTON =
  'flex size-11 shrink-0 items-center justify-center rounded-full text-white/50 outline-none transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-30 disabled:hover:bg-transparent';

/** One editable receipt line: name, quantity stepper, price each, and a quiet delete. */
export function ItemRow({ item, index, onChange, onRemove }: ItemRowProps) {
  const label = item.name.trim() || `item ${index + 1}`;
  return (
    <div className="group flex items-start gap-1 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        <input
          placeholder="Item name"
          aria-label={`Name of ${label}`}
          value={item.name}
          onChange={(e) => onChange('name', e.target.value)}
          className={`${GHOST_INPUT} w-full sm:flex-1`}
        />
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <div className="flex items-center">
            <button
              type="button"
              aria-label={`Fewer ${label}`}
              onClick={() => onChange('quantity', String(item.quantity - 1))}
              disabled={item.quantity <= 1}
              className={STEP_BUTTON}
            >
              <Minus className="size-4" />
            </button>
            <input
              type="number"
              min="1"
              inputMode="numeric"
              aria-label={`Quantity of ${label}`}
              value={item.quantity}
              onChange={(e) => onChange('quantity', e.target.value)}
              className={`${GHOST_INPUT} w-10 px-0 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
            />
            <button
              type="button"
              aria-label={`More ${label}`}
              onClick={() => onChange('quantity', String(item.quantity + 1))}
              className={STEP_BUTTON}
            >
              <Plus className="size-4" />
            </button>
          </div>
          <div className="flex flex-col items-end">
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              aria-label={`Price each of ${label}`}
              value={item.price || ''}
              onChange={(e) => onChange('price', e.target.value)}
              className={`${GHOST_INPUT} font-money w-24 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
            />
            {item.quantity > 1 && (
              <span className="font-money px-2 text-xs text-white/35">{formatCurrency(item.price * item.quantity)}</span>
            )}
          </div>
        </div>
      </div>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-white/40 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50 sm:pointer-fine:opacity-0 sm:pointer-fine:group-hover:opacity-100 sm:pointer-fine:group-focus-within:opacity-100"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
