'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Plus } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import { ScannedReceipt, SplitMode, TipSplit } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { AvatarInitials } from '@/components/avatar-initials';
import { StepIndicator } from '@/components/create/step-indicator';
import { StepSurface, StepActions } from '@/components/create/step-surface';
import { ReceiptPicker } from '@/components/create/receipt-picker';
import { ItemRow } from '@/components/create/item-row';
import { Segmented } from '@/components/create/segmented';
import { ChoicePill } from '@/components/create/choice-pill';
import { Field, FIELD_INPUT, FIELD_LABEL } from '@/components/create/field';
import { SummaryRow } from '@/components/create/summary-row';

interface BillItem {
  name: string;
  price: number;
  quantity: number;
}

interface GroupOption {
  id: string;
  name: string;
  emoji: string;
}

const SPLIT_MODES: { key: SplitMode; label: string; description: string }[] = [
  { key: 'items', label: 'By item', description: 'Everyone taps what they ordered' },
  { key: 'even', label: 'Evenly', description: 'Total divided equally' },
  { key: 'custom', label: 'Custom', description: 'You assign each amount' },
];

const SPLIT_MODE_OPTIONS = SPLIT_MODES.map((mode) => ({ value: mode.key, label: mode.label }));

const TIP_SPLIT_OPTIONS: { value: TipSplit; label: string }[] = [
  { value: 'proportional', label: 'Like items' },
  { value: 'even', label: 'Equally' },
];

const TIP_SPLIT_HELP: Record<TipSplit, string> = {
  proportional: 'Each person tips on what they ordered.',
  even: 'Everyone chips in the same tip.',
};

const TIP_PERCENTS = [0, 15, 18, 20, 25];
const TIP_PERCENT_OPTIONS = TIP_PERCENTS.map((pct) => ({ value: String(pct), label: `${pct}%` }));

const STEP_ORDER = ['upload', 'review', 'details'] as const;
const STEP_LABELS = ['Receipt', 'Items', 'Details'] as const;

const NO_SPIN =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

export default function CreatePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'upload' | 'review' | 'details'>('upload');
  const [isScanning, setIsScanning] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const [items, setItems] = useState<BillItem[]>([]);
  const [tax, setTax] = useState(0);
  const [tipPercent, setTipPercent] = useState(18);
  const [billName, setBillName] = useState('');
  const [creatorName, setCreatorName] = useState('');

  const [splitMode, setSplitMode] = useState<SplitMode>('items');
  const [tipSplit, setTipSplit] = useState<TipSplit>('proportional');
  const [customTip, setCustomTip] = useState(''); // non-empty = exact $ tip, overrides %
  const [venmoHandle, setVenmoHandle] = useState('');
  const [cashappHandle, setCashappHandle] = useState('');
  const [paypalHandle, setPaypalHandle] = useState('');
  const [zelleHandle, setZelleHandle] = useState('');
  const [showPayment, setShowPayment] = useState(false);

  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<{ user_id: string; display_name: string }[]>([]);
  const [paidByUserId, setPaidByUserId] = useState<string | null>(null); // null = I paid

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tipAmount =
    customTip !== '' ? Math.max(0, parseFloat(customTip) || 0) : (subtotal + tax) * (tipPercent / 100);
  const total = subtotal + tax + tipAmount;

  const reduceMotion = useReducedMotion();
  const stepIndex = STEP_ORDER.indexOf(step);

  // Prefill payment handles from the last bill; load groups if signed in
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('splittr-payment-handles') || '{}');
      if (saved.venmo) setVenmoHandle(saved.venmo);
      if (saved.cashapp) setCashappHandle(saved.cashapp);
      if (saved.paypal) setPaypalHandle(saved.paypal);
      if (saved.zelle) setZelleHandle(saved.zelle);
      if (saved.venmo || saved.cashapp || saved.paypal || saved.zelle) setShowPayment(true);
    } catch {
      // ignore bad localStorage
    }

    const loadAccount = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMyUserId(user.id);
      const [groupsRes, profileRes] = await Promise.all([
        fetch('/api/groups'),
        fetch('/api/profile'),
      ]);
      if (groupsRes.ok) {
        setGroups(await groupsRes.json());
      }
      if (profileRes.ok) {
        // Smart pay: profile handles beat whatever the last bill used
        const profile = await profileRes.json();
        if (profile.display_name) setCreatorName((prev) => prev || profile.display_name);
        if (profile.venmo_handle) setVenmoHandle(profile.venmo_handle);
        if (profile.cashapp_handle) setCashappHandle(profile.cashapp_handle);
        if (profile.paypal_handle) setPaypalHandle(profile.paypal_handle);
        if (profile.zelle_handle) setZelleHandle(profile.zelle_handle);
        if (profile.venmo_handle || profile.cashapp_handle || profile.paypal_handle || profile.zelle_handle) {
          setShowPayment(true);
        }
      }
    };
    loadAccount();
  }, []);

  // Load the member list for the payer picker whenever a group is selected
  useEffect(() => {
    setPaidByUserId(null);
    if (!selectedGroupId) {
      setGroupMembers([]);
      return;
    }
    fetch(`/api/groups/${selectedGroupId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setGroupMembers(data?.members ?? []))
      .catch(() => setGroupMembers([]));
  }, [selectedGroupId]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);

    try {
      const formData = new FormData();
      formData.append('receipt', file);

      const response = await fetch('/api/scan', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 422 || body.code === 'not_a_receipt') {
          toast.error("That doesn't look like a receipt", {
            description: 'Try a clearer photo of the bill, or enter the items manually below.',
          });
          return;
        }
        if (response.status === 429) {
          toast.error('Too many scans right now', {
            description: body.error || 'Too many scans. Try again in a few minutes.',
          });
          return;
        }
        throw new Error('Failed to scan receipt');
      }

      const data: ScannedReceipt = await response.json();

      setItems(data.items);
      setTax(data.tax || 0);
      setStep('review');
      toast.success('Receipt scanned successfully!');
    } catch (error) {
      console.error('Error scanning receipt:', error);
      toast.error('Failed to scan receipt. Please try again or enter items manually.');
    } finally {
      setIsScanning(false);
      // allow rescanning the same file
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleTotalOnly = () => {
    setItems([{ name: 'Bill total', price: 0, quantity: 1 }]);
    setSplitMode('even');
    setTipPercent(0);
    setStep('review');
  };

  const handleAddItem = () => {
    setItems([...items, { name: '', price: 0, quantity: 1 }]);
  };

  const handleUpdateItem = (index: number, field: keyof BillItem, value: string | number) => {
    const newItems = [...items];
    if (field === 'price') {
      newItems[index][field] = parseFloat(value as string) || 0;
    } else if (field === 'quantity') {
      newItems[index][field] = parseInt(value as string) || 1;
    } else {
      newItems[index][field] = value as string;
    }
    setItems(newItems);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleCreateBill = async () => {
    if (!billName.trim()) {
      toast.error('Please enter a name for the bill');
      return;
    }
    if (!creatorName.trim()) {
      toast.error('Please enter your name');
      return;
    }
    if (items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }

    setIsCreating(true);

    try {
      const response = await fetch('/api/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: billName,
          items,
          tax,
          tip_percent: tipPercent,
          ...(customTip !== '' ? { tip_amount: Math.max(0, parseFloat(customTip) || 0) } : {}),
          creator_name: creatorName,
          split_mode: splitMode,
          tip_split: tipSplit,
          venmo_handle: venmoHandle,
          cashapp_handle: cashappHandle,
          paypal_handle: paypalHandle,
          zelle_handle: zelleHandle,
          group_id: selectedGroupId,
          paid_by_user_id: paidByUserId,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create bill');
      }

      const { id, short_code, creator_participant_id, creator_token } = await response.json();

      // Remember payment handles for next time
      localStorage.setItem(
        'splittr-payment-handles',
        JSON.stringify({
          venmo: venmoHandle.trim(),
          cashapp: cashappHandle.trim(),
          paypal: paypalHandle.trim(),
          zelle: zelleHandle.trim(),
        })
      );

      // Save to localStorage for "My Bills"
      const storedBills = JSON.parse(localStorage.getItem('splittr-my-bills') || '[]');
      storedBills.unshift({
        id,
        name: billName,
        short_code,
        created_at: new Date().toISOString(),
        role: 'creator',
      });
      localStorage.setItem('splittr-my-bills', JSON.stringify(storedBills.slice(0, 20))); // Keep last 20

      // Save creator's participant ID so they're recognized on the bill page
      if (creator_participant_id) {
        localStorage.setItem(`splittr-participant-${id}`, creator_participant_id);
      }

      // Save creator token for authenticated bill edits
      if (creator_token) {
        localStorage.setItem(`splittr-creator-token-${id}`, creator_token);
      }

      toast.success('Bill created!');
      router.push(`/bill/${id}`);
    } catch (error) {
      console.error('Error creating bill:', error);
      const message = error instanceof Error ? error.message : '';
      toast.error(message && message !== 'Failed to create bill' ? message : 'Failed to create bill. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };


  const handleTakePhoto = () => fileInputRef.current?.click();

  const handleUploadPhoto = () => {
    if (fileInputRef.current) {
      fileInputRef.current.removeAttribute('capture');
      fileInputRef.current.click();
      fileInputRef.current.setAttribute('capture', 'environment');
    }
  };

  const selectedMode = SPLIT_MODES.find((mode) => mode.key === splitMode);

  return (
    <main className="min-h-dvh py-8">
      <div className="container mx-auto max-w-2xl px-4">
        <Link
          href="/"
          className="mb-8 inline-flex h-11 items-center gap-2 text-sm text-white/40 transition-colors hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>

        <header className="space-y-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Split a bill</h1>
            <p className="mt-2 text-sm text-white/40">Scan the receipt, check the items, then share one link.</p>
          </div>
          <StepIndicator steps={STEP_LABELS} current={stepIndex} />
        </header>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="mt-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: reduceMotion ? 0 : 0.2, ease: 'easeOut' }}
            >
              {/* Step 1: Receipt */}
              {step === 'upload' && (
                <StepSurface>
                  <ReceiptPicker
                    isScanning={isScanning}
                    onTakePhoto={handleTakePhoto}
                    onUploadPhoto={handleUploadPhoto}
                    onEnterByHand={() => setStep('review')}
                    onTotalOnly={handleTotalOnly}
                  />
                </StepSurface>
              )}

              {/* Step 2: Items */}
              {step === 'review' && (
                <StepSurface>
                  <div>
                    {items.length > 0 ? (
                      <>
                        <div className="-mx-2 hidden items-center gap-2 pb-1 text-xs text-white/35 sm:flex" aria-hidden>
                          <span className="flex-1 px-2">Item</span>
                          <span className="w-32 text-center">Qty</span>
                          <span className="w-24 px-2 text-right">Each</span>
                          <span className="w-10" />
                        </div>
                        <div className="-mx-2 divide-y divide-white/[0.06]">
                          {items.map((item, index) => (
                            <ItemRow
                              key={index}
                              item={item}
                              index={index}
                              onChange={(field, value) => handleUpdateItem(index, field, value)}
                              onRemove={() => handleRemoveItem(index)}
                            />
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-white/40">No items yet. Add what was on the receipt.</p>
                    )}
                    <button
                      type="button"
                      onClick={handleAddItem}
                      className="-ml-3 mt-2 inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-white/60 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <Plus className="size-4" />
                      Add item
                    </button>
                  </div>

                  <div className="border-t border-white/10 pt-6">
                    <div className="ml-auto w-full space-y-4 sm:max-w-sm">
                      <SummaryRow label="Subtotal">{formatCurrency(subtotal)}</SummaryRow>
                      <div className="flex items-center justify-between gap-4">
                        <label htmlFor="tax" className="text-sm text-white/60">
                          Tax
                        </label>
                        <Input
                          id="tax"
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          placeholder="0.00"
                          value={tax || ''}
                          onChange={(e) => setTax(parseFloat(e.target.value) || 0)}
                          className={`font-money w-28 text-right ${FIELD_INPUT} ${NO_SPIN}`}
                        />
                      </div>
                      <div className="space-y-3">
                        <p className="text-sm text-white/60">Tip</p>
                        <Segmented
                          ariaLabel="Tip percent"
                          options={TIP_PERCENT_OPTIONS}
                          value={customTip === '' ? String(tipPercent) : null}
                          onChange={(pct) => {
                            setCustomTip('');
                            setTipPercent(Number(pct));
                          }}
                        />
                        <div className="flex items-center justify-between gap-4">
                          <label htmlFor="tip" className="text-xs text-white/35">
                            Or an exact amount
                          </label>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/35">
                              $
                            </span>
                            <Input
                              id="tip"
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              placeholder="exact"
                              value={customTip}
                              onChange={(e) => setCustomTip(e.target.value)}
                              className={`font-money w-28 pl-6 text-right ${FIELD_INPUT} ${NO_SPIN}`}
                            />
                          </div>
                        </div>
                      </div>
                      <SummaryRow label="Tip amount">{formatCurrency(tipAmount)}</SummaryRow>
                      <div className="border-t border-white/10 pt-4">
                        <SummaryRow label="Total" strong>
                          {formatCurrency(total)}
                        </SummaryRow>
                      </div>
                    </div>
                  </div>

                  <StepActions onBack={() => setStep('upload')}>
                    <Button size="lg" className="w-full" onClick={() => setStep('details')}>
                      Continue
                    </Button>
                  </StepActions>
                </StepSurface>
              )}

              {/* Step 3: Details */}
              {step === 'details' && (
                <StepSurface>
                  <Field htmlFor="billName" label="Bill name">
                    <Input
                      id="billName"
                      placeholder="e.g., Dinner at Joe's"
                      value={billName}
                      onChange={(e) => setBillName(e.target.value)}
                      autoComplete="off"
                      className={FIELD_INPUT}
                    />
                  </Field>

                  <Field htmlFor="creatorName" label="Your name" helper="Shown on the bill, so friends know it's you.">
                    <div className="flex items-center gap-3">
                      {creatorName.trim() && <AvatarInitials name={creatorName} size="lg" className="shrink-0" />}
                      <Input
                        id="creatorName"
                        placeholder="Enter your name"
                        value={creatorName}
                        onChange={(e) => setCreatorName(e.target.value)}
                        autoComplete="name"
                        className={FIELD_INPUT}
                      />
                    </div>
                  </Field>

                  <div className="space-y-6 border-t border-white/10 pt-6">
                    <Field label="How should this split?" helper={selectedMode?.description}>
                      <Segmented
                        ariaLabel="How should this split?"
                        options={SPLIT_MODE_OPTIONS}
                        value={splitMode}
                        onChange={setSplitMode}
                      />
                    </Field>

                    {tipAmount > 0 && (
                      <Field label="Tip split" helper={TIP_SPLIT_HELP[tipSplit]}>
                        <Segmented
                          ariaLabel="Tip split"
                          options={TIP_SPLIT_OPTIONS}
                          value={tipSplit}
                          onChange={setTipSplit}
                        />
                      </Field>
                    )}
                  </div>

                  {groups.length > 0 && (
                    <div className="space-y-6 border-t border-white/10 pt-6">
                      <Field label="Add to a group (optional)">
                        <div className="flex flex-wrap gap-2">
                          {groups.map((group) => (
                            <ChoicePill
                              key={group.id}
                              selected={selectedGroupId === group.id}
                              onClick={() => setSelectedGroupId(selectedGroupId === group.id ? null : group.id)}
                            >
                              <span className="truncate">{group.name}</span>
                            </ChoicePill>
                          ))}
                        </div>
                      </Field>

                      {selectedGroupId && groupMembers.length > 1 && (
                        <Field label="Who paid?">
                          <div className="flex flex-wrap gap-2">
                            <ChoicePill selected={paidByUserId === null} onClick={() => setPaidByUserId(null)} className="pl-1.5">
                              <AvatarInitials name={creatorName.trim() || 'Me'} size="md" className="shrink-0" />
                              I paid
                            </ChoicePill>
                            {groupMembers
                              .filter((m) => m.user_id !== myUserId)
                              .map((m) => (
                                <ChoicePill
                                  key={m.user_id}
                                  selected={paidByUserId === m.user_id}
                                  onClick={() => setPaidByUserId(m.user_id)}
                                  className="pl-1.5"
                                >
                                  <AvatarInitials name={m.display_name} size="md" className="shrink-0" />
                                  <span className="truncate">{m.display_name} paid</span>
                                </ChoicePill>
                              ))}
                          </div>
                        </Field>
                      )}
                    </div>
                  )}

                  <div className="space-y-6 border-t border-white/10 pt-6">
                    <div>
                      <button
                        type="button"
                        aria-expanded={showPayment}
                        onClick={() => setShowPayment(!showPayment)}
                        className="-ml-3 inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-left text-sm font-medium text-white/70 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        How friends pay you back (optional)
                        {showPayment ? (
                          <ChevronUp className="size-4 text-white/35" />
                        ) : (
                          <ChevronDown className="size-4 text-white/35" />
                        )}
                      </button>
                      <p className="text-xs text-white/35">
                        Add your handles and everyone gets one-tap payment links for their exact share.
                      </p>
                    </div>
                    {showPayment && (
                      <>
                        <Field htmlFor="venmo" label="Venmo" helper="Your Venmo username.">
                          <Input
                            id="venmo"
                            placeholder="@your-venmo"
                            value={venmoHandle}
                            onChange={(e) => setVenmoHandle(e.target.value)}
                            autoComplete="off"
                            className={FIELD_INPUT}
                          />
                        </Field>
                        <Field htmlFor="cashapp" label="Cash App" helper="Your $cashtag.">
                          <Input
                            id="cashapp"
                            placeholder="$yourcashtag"
                            value={cashappHandle}
                            onChange={(e) => setCashappHandle(e.target.value)}
                            autoComplete="off"
                            className={FIELD_INPUT}
                          />
                        </Field>
                        <Field htmlFor="paypal" label="PayPal.Me" helper="The name after paypal.me/ in your link.">
                          <Input
                            id="paypal"
                            placeholder="yourpaypalme"
                            value={paypalHandle}
                            onChange={(e) => setPaypalHandle(e.target.value)}
                            autoComplete="off"
                            className={FIELD_INPUT}
                          />
                        </Field>
                        <Field htmlFor="zelle" label="Zelle" helper="The email or phone your Zelle is enrolled with.">
                          <Input
                            id="zelle"
                            placeholder="Email or US phone number"
                            value={zelleHandle}
                            onChange={(e) => setZelleHandle(e.target.value)}
                            autoComplete="off"
                            className={FIELD_INPUT}
                          />
                        </Field>
                      </>
                    )}
                  </div>

                  <div className="space-y-3 border-t border-white/10 pt-6">
                    <p className={FIELD_LABEL}>Bill summary</p>
                    <SummaryRow label={`${items.length} ${items.length === 1 ? 'item' : 'items'}`}>{formatCurrency(subtotal)}</SummaryRow>
                    <SummaryRow label="Tax">{formatCurrency(tax)}</SummaryRow>
                    <SummaryRow label={`Tip ${customTip !== '' ? '(exact)' : `(${tipPercent}%)`}`}>
                      {formatCurrency(tipAmount)}
                    </SummaryRow>
                    <div className="pt-1">
                      <SummaryRow label="Total" strong>
                        {formatCurrency(total)}
                      </SummaryRow>
                    </div>
                  </div>

                  <StepActions onBack={() => setStep('review')}>
                    <Button size="lg" className="w-full" onClick={handleCreateBill} disabled={isCreating}>
                      {isCreating ? (
                        <>
                          <Loader2 className="animate-spin" />
                          Creating...
                        </>
                      ) : (
                        'Create bill'
                      )}
                    </Button>
                  </StepActions>
                </StepSurface>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
