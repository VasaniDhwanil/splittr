'use client';

import type { ReactNode } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DIALOG_SURFACE } from '@/components/groups/group-dialog';
import { Field, FIELD_INPUT, FIELD_LABEL } from '@/components/create/field';
import { ItemRow } from '@/components/create/item-row';
import { Segmented } from '@/components/create/segmented';
import { ChoicePill } from '@/components/create/choice-pill';
import { cn } from '@/lib/utils';
import type { SplitMode, TipSplit } from '@/types';

export interface EditableItem {
  id?: string;
  name: string;
  price: number;
  quantity: number;
}

export interface EditBillDraft {
  name: string;
  items: EditableItem[];
  tax: number;
  tipPercent: number;
  /** Non-empty = exact $ tip, overrides %. */
  tipExact: string;
  tipSplit: TipSplit;
  splitMode: SplitMode;
  venmo: string;
  cashapp: string;
  paypal: string;
  zelle: string;
  /** null = the creator paid. */
  paidBy: string | null;
}

export interface PayerChoice {
  id: string;
  name: string;
}

interface EditBillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: EditBillDraft;
  onChange: (patch: Partial<EditBillDraft>) => void;
  /** Group bills with more than one member: who fronted the money. */
  payerChoices: PayerChoice[] | null;
  creatorName: string;
  isSaving: boolean;
  onSave: () => void;
}

const SPLIT_MODE_OPTIONS = [
  { value: 'items', label: 'By item' },
  { value: 'even', label: 'Evenly' },
  { value: 'custom', label: 'Custom' },
] as const;

const TIP_SPLIT_OPTIONS = [
  { value: 'proportional', label: 'Follows items' },
  { value: 'even', label: 'Split equally' },
] as const;

const NUMBER_INPUT = `${FIELD_INPUT} font-money h-11 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-white/10 pt-5">
      <h3 className="text-sm font-semibold tracking-tight text-white">{title}</h3>
      {children}
    </section>
  );
}

export function EditBillDialog({
  open,
  onOpenChange,
  draft,
  onChange,
  payerChoices,
  creatorName,
  isSaving,
  onSave,
}: EditBillDialogProps) {
  const setItem = (index: number, field: keyof EditableItem, value: string) => {
    const next = [...draft.items];
    if (field === 'name') next[index] = { ...next[index], name: value };
    if (field === 'quantity') next[index] = { ...next[index], quantity: parseInt(value) || 1 };
    if (field === 'price') next[index] = { ...next[index], price: parseFloat(value) || 0 };
    onChange({ items: next });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(DIALOG_SURFACE, 'max-h-[88dvh] overflow-y-auto sm:max-w-lg')}>
        <DialogHeader className="gap-1.5 text-left">
          <DialogTitle className="text-lg font-semibold tracking-tight text-white">Edit bill</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-white/50">
            Update items, amounts, split mode, and payment details.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <Field htmlFor="editBillName" label="Bill name">
            <Input
              id="editBillName"
              value={draft.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className={`${FIELD_INPUT} h-11`}
            />
          </Field>

          <Group title="Items">
            <div className="-mx-2 divide-y divide-white/[0.06]">
              {draft.items.map((item, index) => (
                <ItemRow
                  key={item.id ?? `new-${index}`}
                  item={item}
                  index={index}
                  onChange={(field, value) => setItem(index, field, value)}
                  onRemove={() => onChange({ items: draft.items.filter((_, i) => i !== index) })}
                />
              ))}
            </div>
            <Button
              variant="ghost"
              className="w-full border border-dashed border-white/10 text-white/60 hover:bg-white/[0.04] hover:text-white"
              onClick={() => onChange({ items: [...draft.items, { name: '', price: 0, quantity: 1 }] })}
            >
              <Plus />
              Add item
            </Button>
            <p className="text-xs text-white/35">Removing an item also removes everyone&apos;s claims on it.</p>
          </Group>

          <Group title="Tax and tip">
            <div className="grid grid-cols-3 gap-3">
              <Field htmlFor="editTax" label="Tax">
                <Input
                  id="editTax"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={draft.tax || ''}
                  onChange={(e) => onChange({ tax: parseFloat(e.target.value) || 0 })}
                  className={NUMBER_INPUT}
                />
              </Field>
              <Field htmlFor="editTip" label="Tip %">
                <Input
                  id="editTip"
                  type="number"
                  step="1"
                  inputMode="decimal"
                  value={draft.tipPercent || ''}
                  onChange={(e) => onChange({ tipPercent: parseFloat(e.target.value) || 0, tipExact: '' })}
                  className={NUMBER_INPUT}
                />
              </Field>
              <Field htmlFor="editTipExact" label="Tip $">
                <Input
                  id="editTipExact"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="exact"
                  value={draft.tipExact}
                  onChange={(e) => onChange({ tipExact: e.target.value })}
                  className={NUMBER_INPUT}
                />
              </Field>
            </div>
            <p className="-mt-1 text-xs text-white/35">An exact tip overrides the percentage.</p>
            <div className="space-y-2">
              <p className={FIELD_LABEL}>Tip split</p>
              <Segmented
                ariaLabel="Tip split"
                options={TIP_SPLIT_OPTIONS}
                value={draft.tipSplit}
                onChange={(tipSplit) => onChange({ tipSplit })}
              />
            </div>
          </Group>

          <Group title="Splitting">
            <div className="space-y-2">
              <p className={FIELD_LABEL}>Split mode</p>
              <Segmented
                ariaLabel="Split mode"
                options={SPLIT_MODE_OPTIONS}
                value={draft.splitMode}
                onChange={(splitMode) => onChange({ splitMode })}
              />
            </div>
            {payerChoices && (
              <div className="space-y-2">
                <p className={FIELD_LABEL}>Who paid?</p>
                <div className="flex flex-wrap gap-2">
                  <ChoicePill selected={draft.paidBy === null} onClick={() => onChange({ paidBy: null })}>
                    <span className="truncate">{creatorName} (creator)</span>
                  </ChoicePill>
                  {payerChoices.map((m) => (
                    <ChoicePill key={m.id} selected={draft.paidBy === m.id} onClick={() => onChange({ paidBy: m.id })}>
                      <span className="truncate">{m.name}</span>
                    </ChoicePill>
                  ))}
                </div>
              </div>
            )}
          </Group>

          <Group title="Payment handles">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field htmlFor="editVenmo" label="Venmo">
                <Input
                  id="editVenmo"
                  placeholder="@your-venmo"
                  value={draft.venmo}
                  onChange={(e) => onChange({ venmo: e.target.value })}
                  className={`${FIELD_INPUT} h-11`}
                />
              </Field>
              <Field htmlFor="editCashapp" label="Cash App">
                <Input
                  id="editCashapp"
                  placeholder="$yourcashtag"
                  value={draft.cashapp}
                  onChange={(e) => onChange({ cashapp: e.target.value })}
                  className={`${FIELD_INPUT} h-11`}
                />
              </Field>
              <Field htmlFor="editPaypal" label="PayPal.Me">
                <Input
                  id="editPaypal"
                  placeholder="yourpaypalme"
                  value={draft.paypal}
                  onChange={(e) => onChange({ paypal: e.target.value })}
                  className={`${FIELD_INPUT} h-11`}
                />
              </Field>
              <Field htmlFor="editZelle" label="Zelle">
                <Input
                  id="editZelle"
                  placeholder="Email or US phone"
                  value={draft.zelle}
                  onChange={(e) => onChange({ zelle: e.target.value })}
                  className={`${FIELD_INPUT} h-11`}
                />
              </Field>
            </div>
          </Group>

          <Button className="w-full" size="lg" onClick={onSave} disabled={isSaving}>
            {isSaving && <Loader2 className="animate-spin" />}
            {isSaving ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
