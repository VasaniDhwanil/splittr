'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { formatCurrency, calculateSplits, billTotal } from '@/lib/calculations';
import { getPaymentOptions, billHasPaymentMethods, getZelleInfo } from '@/lib/payment-links';
import { Bill, BillItem, Participant, ItemClaim, ParticipantSplit, SplitMode, TipSplit } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { SplitSheet, SplitEntry } from '@/components/split-sheet';
import { useBillRealtime } from '@/hooks/use-bill-realtime';
import { ShareQrDialog } from '@/components/share-qr-dialog';
import { Reveal } from '@/components/groups/reveal';
import { Section } from '@/components/groups/section';
import { ConfirmDialog } from '@/components/groups/group-dialog';
import { SummaryRow } from '@/components/create/summary-row';
import { BillHeader, HostPanel } from '@/components/bill/bill-header';
import { ParticipantList } from '@/components/bill/participant-list';
import { ItemRow } from '@/components/bill/item-row';
import { PayShare } from '@/components/bill/pay-share';
import { OwesList } from '@/components/bill/owes-list';
import { BottomBar } from '@/components/bill/bottom-bar';
import { BillSkeleton } from '@/components/bill/bill-skeleton';
import { Note } from '@/components/bill/note';
import { Confetti } from '@/components/bill/confetti';
import { JoinDialog } from '@/components/bill/join-dialog';
import { EditBillDialog, type EditableItem, type EditBillDraft } from '@/components/bill/edit-bill-dialog';

const SPLIT_MODE_LABEL: Record<SplitMode, string> = {
  items: 'By item',
  even: 'Split evenly',
  custom: 'Custom amounts',
};

export default function BillPage() {
  const params = useParams();
  const router = useRouter();
  const billId = params.id as string;

  const [isLoading, setIsLoading] = useState(true);
  const [bill, setBill] = useState<Bill | null>(null);
  const [items, setItems] = useState<BillItem[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [claims, setClaims] = useState<ItemClaim[]>([]);

  const [currentParticipant, setCurrentParticipant] = useState<Participant | null>(null);
  const [joinName, setJoinName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  // Same name already on the bill (joined from another device?), confirm
  const [duplicateCandidate, setDuplicateCandidate] = useState<Participant | null>(null);
  // Creator removing a participant
  const [removeTarget, setRemoveTarget] = useState<Participant | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  const [splits, setSplits] = useState<ParticipantSplit[]>([]);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [claimingItemId, setClaimingItemId] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [hasShownConfetti, setHasShownConfetti] = useState(false);
  const [prevAllClaimed, setPrevAllClaimed] = useState(false);

  // The split sheet: the one surface for claiming and splitting items
  const [splitItem, setSplitItem] = useState<BillItem | null>(null);
  const [showSplitSheet, setShowSplitSheet] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);

  // Bill status
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Creator tools
  const [hasCreatorToken, setHasCreatorToken] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editName, setEditName] = useState('');
  const [editItems, setEditItems] = useState<EditableItem[]>([]);
  const [editTax, setEditTax] = useState(0);
  const [editTipPercent, setEditTipPercent] = useState(18);
  const [editTipExact, setEditTipExact] = useState(''); // non-empty = exact $ tip, overrides %
  const [editTipSplit, setEditTipSplit] = useState<TipSplit>('proportional');
  const [editSplitMode, setEditSplitMode] = useState<SplitMode>('items');
  const [editVenmo, setEditVenmo] = useState('');
  const [editCashapp, setEditCashapp] = useState('');
  const [editPaypal, setEditPaypal] = useState('');
  const [editZelle, setEditZelle] = useState('');
  const [editPaidBy, setEditPaidBy] = useState<string | null>(null); // null = creator paid

  // Payments
  const [payingParticipantId, setPayingParticipantId] = useState<string | null>(null);
  const [customDrafts, setCustomDrafts] = useState<Record<string, string>>({});

  const splitMode: SplitMode = bill?.split_mode || 'items';

  const fetchBill = useCallback(async () => {
    try {
      const response = await fetch(`/api/bills/${billId}`);
      if (!response.ok) throw new Error('Failed to fetch bill');

      const data = await response.json();
      setBill(data);
      setItems(data.items);
      setParticipants(data.participants);
      setClaims(data.claims);
    } catch (error) {
      console.error('Error fetching bill:', error);
      toast.error('Failed to load bill');
    } finally {
      setIsLoading(false);
    }
  }, [billId]);

  // Realtime events arrive in bursts (8 people tapping = many channel
  // callbacks), so coalesce them into one refetch instead of one each.
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleFetch = useCallback(() => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(() => fetchBill(), 250);
  }, [fetchBill]);

  // Calculate splits whenever data changes
  useEffect(() => {
    if (bill && participants.length > 0) {
      const calculatedSplits = calculateSplits(bill, items, participants, claims);
      setSplits(calculatedSplits);

      if ((bill.split_mode || 'items') !== 'items') return;

      // Check if all items are fully claimed (total shares >= quantity)
      const allItemsClaimed = claims.length > 0 && items.every((item) => {
        const totalClaimed = claims
          .filter((c) => c.item_id === item.id)
          .reduce((sum, c) => sum + c.share, 0);
        // Small slack: a 12-way split of one item sums to 0.9996, not 1
        return totalClaimed >= item.quantity - 0.01;
      });

      // Only show confetti when transitioning from not-all-claimed to all-claimed
      // and we haven't shown it yet for this bill session
      if (allItemsClaimed && !prevAllClaimed && !hasShownConfetti) {
        setShowConfetti(true);
        setHasShownConfetti(true);
        setTimeout(() => setShowConfetti(false), 3000);
      }

      // Track previous state for transition detection
      setPrevAllClaimed(allItemsClaimed);
    }
  }, [bill, items, participants, claims, prevAllClaimed, hasShownConfetti]);

  // Fetch bill data
  useEffect(() => {
    fetchBill();
  }, [fetchBill]);

  // Live updates: any relevant change rings scheduleFetch (refetch-on-doorbell)
  useBillRealtime({ billId: bill?.id ?? null, onChange: scheduleFetch });

  // Check for saved participant + creator token in localStorage
  useEffect(() => {
    if (!bill) return;
    const savedId = localStorage.getItem(`splittr-participant-${bill.id}`);
    if (savedId) {
      const participant = participants.find((p) => p.id === savedId);
      if (participant) {
        setCurrentParticipant(participant);
      }
    }
    setHasCreatorToken(Boolean(localStorage.getItem(`splittr-creator-token-${bill.id}`)));
  }, [bill, participants]);

  // If the creator removed us (or our row vanished), reset to the join state
  useEffect(() => {
    if (!bill || !currentParticipant || participants.length === 0) return;
    if (!participants.some((p) => p.id === currentParticipant.id)) {
      setCurrentParticipant(null);
      localStorage.removeItem(`splittr-participant-${bill.id}`);
      toast.info('You were removed from this bill by the host.');
    }
  }, [bill, participants, currentParticipant]);

  // Recognize signed-in users across devices: if their account already has a
  // participant row on this bill, adopt it instead of asking them to join.
  useEffect(() => {
    if (!bill || currentParticipant) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const mine = participants.find((p) => p.user_id === user.id);
      if (mine) {
        setCurrentParticipant(mine);
        localStorage.setItem(`splittr-participant-${bill.id}`, mine.id);
      }
    });
  }, [bill, participants, currentParticipant]);

  // Join without the name prompt; the server derives the name from the
  // caller's group membership or profile. Returns null when not signed in.
  const autoJoin = async (): Promise<Participant | null> => {
    if (!bill) return null;
    try {
      const res = await fetch('/api/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill_id: bill.id }),
      });
      if (!res.ok) return null;
      const participant: Participant & { participant_token?: string } = await res.json();
      setCurrentParticipant(participant);
      localStorage.setItem(`splittr-participant-${bill.id}`, participant.id);
      rememberParticipantToken(participant);
      toast.success(`Welcome, ${participant.name}!`);
      return participant;
    } catch {
      return null;
    }
  };

  const isCreator = Boolean(currentParticipant?.is_creator) || hasCreatorToken;
  const creatorParticipant = participants.find((p) => p.is_creator);

  const creatorHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    'X-Creator-Token': bill ? localStorage.getItem(`splittr-creator-token-${bill.id}`) || '' : '',
  });

  // Each participant's secret proves "this is me" when marking paid. It's
  // returned once at join and kept per participant id.
  const rememberParticipantToken = (p: { id: string; participant_token?: string }) => {
    if (p.participant_token) localStorage.setItem(`splittr-participant-token-${p.id}`, p.participant_token);
  };
  const participantHeaders = (participantId: string): Record<string, string> => ({
    ...creatorHeaders(),
    'X-Participant-Token': localStorage.getItem(`splittr-participant-token-${participantId}`) || '',
  });

  /** Re-attach to an existing participant (same person, another device). */
  const adoptParticipant = (p: Participant) => {
    if (!bill) return;
    setCurrentParticipant(p);
    localStorage.setItem(`splittr-participant-${bill.id}`, p.id);
    setShowJoinDialog(false);
    setDuplicateCandidate(null);
    setJoinName('');
    toast.success(`Welcome back, ${p.name}!`);
  };

  const handleJoin = async (forceNew = false) => {
    if (!joinName.trim() || !bill) return;

    // Same name already on the bill? Probably the same person on a second
    // device, so confirm before creating a duplicate.
    if (!forceNew) {
      const existing = participants.find(
        (p) => p.name.trim().toLowerCase() === joinName.trim().toLowerCase()
      );
      if (existing) {
        setDuplicateCandidate(existing);
        return;
      }
    }
    setDuplicateCandidate(null);

    setIsJoining(true);
    try {
      const response = await fetch('/api/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bill_id: bill.id,
          name: joinName.trim(),
        }),
      });

      if (!response.ok) throw new Error('Failed to join');

      const participant = await response.json();
      setCurrentParticipant(participant);
      localStorage.setItem(`splittr-participant-${bill.id}`, participant.id);
      rememberParticipantToken(participant);

      // Save to "My Bills" for participants too
      const storedBills = JSON.parse(localStorage.getItem('splittr-my-bills') || '[]');
      const alreadyStored = storedBills.some((b: { id: string }) => b.id === bill.id);
      if (!alreadyStored) {
        storedBills.unshift({
          id: bill.id,
          name: bill.name,
          short_code: bill.short_code,
          created_at: new Date().toISOString(),
          role: 'participant',
        });
        localStorage.setItem('splittr-my-bills', JSON.stringify(storedBills.slice(0, 20)));
      }

      setShowJoinDialog(false);
      setJoinName('');
      toast.success(`Welcome, ${participant.name}!`);
      await fetchBill();
    } catch (error) {
      console.error('Error joining:', error);
      toast.error('Failed to join bill');
    } finally {
      setIsJoining(false);
    }
  };

  const handleRemoveParticipant = async () => {
    if (!removeTarget || !bill) return;
    setIsRemoving(true);
    try {
      const res = await fetch(`/api/participants?participant_id=${removeTarget.id}`, {
        method: 'DELETE',
        headers: creatorHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to remove');
        return;
      }
      toast.success(`${removeTarget.name} removed. Their items are up for grabs again.`);
      setRemoveTarget(null);
      await fetchBill();
    } catch {
      toast.error('Failed to remove');
    } finally {
      setIsRemoving(false);
    }
  };

  // Every item tap opens the split sheet, the one surface for solo claims,
  // group splits, and custom portions alike.
  const handleItemTap = async (item: BillItem) => {
    if (splitMode !== 'items') return;

    // Signed-in users join silently under their known identity; the name
    // dialog is only for anonymous visitors.
    let me = currentParticipant;
    if (!me) {
      me = await autoJoin();
      if (!me) {
        setShowJoinDialog(true);
        return;
      }
    }

    setSplitItem(item);
    setShowSplitSheet(true);
  };

  const handleUnclaim = async (item: BillItem) => {
    const me = currentParticipant;
    if (!me) return;
    const existingClaim = claims.find(
      (c) => c.participant_id === me.id && c.item_id === item.id
    );
    if (!existingClaim) return;

    // Unclaim optimistically, restore on failure
    setClaimingItemId(item.id);
    setClaims((prev) => prev.filter((c) => c.id !== existingClaim.id));
    try {
      const res = await fetch(`/api/claims?participant_id=${me.id}&item_id=${item.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to unclaim');
      toast.success("Got it, you're off the hook!");
      scheduleFetch(); // realtime alone misses claim DELETEs (filter can't match delete payloads)
    } catch (error) {
      setClaims((prev) => [...prev, existingClaim]);
      console.error('Error unclaiming:', error);
      toast.error('Oops, something went wrong');
    } finally {
      setTimeout(() => setClaimingItemId(null), 300);
    }
  };

  // One split action = one batch request; applied optimistically so the
  // sheet's outcome is on screen before the server confirms it.
  const handleSplitSubmit = async (item: BillItem, entries: SplitEntry[], message: string) => {
    setIsSplitting(true);
    const prevClaims = claims;
    const entryPids = new Set(entries.map((e) => e.participant_id));
    const optimistic: ItemClaim[] = entries.map((e) => ({
      id: `optimistic-${e.participant_id}-${item.id}`,
      participant_id: e.participant_id,
      item_id: item.id,
      share: e.share,
      created_at: '',
    }));
    setClaims((prev) => [
      ...prev.filter((c) => !(c.item_id === item.id && entryPids.has(c.participant_id))),
      ...optimistic,
    ]);
    setClaimingItemId(item.id);
    try {
      const res = await fetch('/api/claims/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, entries }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to split');
      setShowSplitSheet(false);
      setSplitItem(null);
      toast.success(message);
      scheduleFetch(); // reconcile with server truth in the background
    } catch (error) {
      // Roll back and keep the sheet open so the split can be adjusted
      setClaims(prevClaims);
      toast.error(error instanceof Error ? error.message : 'Oops, something went wrong');
    } finally {
      setIsSplitting(false);
      setTimeout(() => setClaimingItemId(null), 300);
    }
  };

  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success('Link copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (navigator.share && bill) {
      try {
        await navigator.share({
          title: `Split: ${bill.name}`,
          text: `Join this bill and select your items. Code: ${bill.short_code}`,
          url: window.location.href,
        });
      } catch {
        // User cancelled or share failed
        handleCopyLink();
      }
    } else {
      handleCopyLink();
    }
  };

  const handleToggleStatus = async () => {
    if (!bill) return;

    setIsUpdatingStatus(true);
    const newStatus = bill.status === 'settled' ? 'active' : 'settled';

    try {
      const response = await fetch(`/api/bills/${bill.id}`, {
        method: 'PATCH',
        headers: creatorHeaders(),
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.status === 403) {
        toast.error('Only the bill creator can edit this');
        return;
      }

      if (!response.ok) throw new Error('Failed to update status');

      setBill({ ...bill, status: newStatus });
      toast.success(newStatus === 'settled' ? 'Bill marked as settled!' : 'Bill reopened');
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Failed to update bill status');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleTogglePaid = async (participant: Participant) => {
    const newStatus = participant.payment_status === 'paid' ? 'unpaid' : 'paid';
    setPayingParticipantId(participant.id);
    try {
      const response = await fetch('/api/participants', {
        method: 'PATCH',
        headers: participantHeaders(participant.id),
        body: JSON.stringify({ participant_id: participant.id, payment_status: newStatus }),
      });
      if (response.status === 403) {
        toast.error('Only this person or the host can change that. Ask the host to mark it.');
        return;
      }
      if (!response.ok) throw new Error('Failed to update payment status');
      toast.success(
        newStatus === 'paid'
          ? `${participant.id === currentParticipant?.id ? 'You are' : participant.name + ' is'} marked as paid`
          : 'Marked as unpaid'
      );
      await fetchBill();
    } catch (error) {
      console.error('Error updating payment status:', error);
      toast.error('Failed to update payment status');
    } finally {
      setPayingParticipantId(null);
    }
  };

  const handleSaveCustomAmount = async (participant: Participant) => {
    const draft = customDrafts[participant.id];
    if (draft === undefined) return;
    const amount = parseFloat(draft);
    if (Number.isNaN(amount) || amount < 0) return;
    if ((participant.custom_amount ?? 0) === amount) return;

    try {
      const response = await fetch('/api/participants', {
        method: 'PATCH',
        headers: creatorHeaders(),
        body: JSON.stringify({ participant_id: participant.id, custom_amount: amount }),
      });
      if (response.status === 403) {
        toast.error('Only the bill creator can set custom amounts');
        return;
      }
      if (!response.ok) throw new Error('Failed to save amount');
      await fetchBill();
    } catch (error) {
      console.error('Error saving custom amount:', error);
      toast.error('Failed to save amount');
    }
  };

  const openEditDialog = () => {
    if (!bill) return;
    setEditName(bill.name);
    setEditItems(items.map((i) => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity })));
    setEditTax(bill.tax);
    setEditTipPercent(bill.tip_percent);
    setEditTipExact('');
    setEditTipSplit(bill.tip_split || 'proportional');
    setEditSplitMode(bill.split_mode || 'items');
    setEditVenmo(bill.venmo_handle || '');
    setEditCashapp(bill.cashapp_handle || '');
    setEditPaypal(bill.paypal_handle || '');
    setEditZelle(bill.zelle_handle || '');
    setEditPaidBy(bill.paid_by_user_id ?? null);
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!bill) return;
    if (!editName.trim()) {
      toast.error('Bill name is required');
      return;
    }
    const validItems = editItems.filter((i) => i.name.trim());
    if (validItems.length === 0) {
      toast.error('Keep at least one item');
      return;
    }

    setIsSavingEdit(true);
    try {
      const response = await fetch(`/api/bills/${bill.id}`, {
        method: 'PATCH',
        headers: creatorHeaders(),
        body: JSON.stringify({
          name: editName,
          items: validItems,
          tax: editTax,
          tip_percent: editTipPercent,
          ...(editTipExact !== '' ? { tip_amount: Math.max(0, parseFloat(editTipExact) || 0) } : {}),
          tip_split: editTipSplit,
          split_mode: editSplitMode,
          venmo_handle: editVenmo,
          cashapp_handle: editCashapp,
          paypal_handle: editPaypal,
          zelle_handle: editZelle,
          ...(bill.group_id ? { paid_by_user_id: editPaidBy } : {}),
        }),
      });

      if (response.status === 403) {
        toast.error('Only the bill creator can edit this');
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save changes');
      }

      setShowEditDialog(false);
      toast.success('Bill updated!');
      await fetchBill();
    } catch (error) {
      console.error('Error saving edit:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save changes');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteBill = async () => {
    if (!bill) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/bills/${bill.id}`, {
        method: 'DELETE',
        headers: creatorHeaders(),
      });
      if (response.status === 403) {
        toast.error('Only the bill creator can delete this');
        return;
      }
      if (!response.ok) throw new Error('Failed to delete bill');

      // Clean up localStorage
      const storedBills = JSON.parse(localStorage.getItem('splittr-my-bills') || '[]');
      localStorage.setItem(
        'splittr-my-bills',
        JSON.stringify(storedBills.filter((b: { id: string }) => b.id !== bill.id))
      );
      localStorage.removeItem(`splittr-participant-${bill.id}`);
      localStorage.removeItem(`splittr-creator-token-${bill.id}`);

      toast.success('Bill deleted');
      router.push('/');
    } catch (error) {
      console.error('Error deleting bill:', error);
      toast.error('Failed to delete bill');
    } finally {
      setIsDeleting(false);
    }
  };

  const getItemClaimers = (itemId: string) => {
    const itemClaims = claims.filter((c) => c.item_id === itemId);
    return itemClaims
      .map((c) => {
        const participant = participants.find((p) => p.id === c.participant_id);
        return participant ? { participant, share: c.share } : null;
      })
      .filter(Boolean) as { participant: Participant; share: number }[];
  };

  const getMyClaimShare = (itemId: string): number | null => {
    if (!currentParticipant) return null;
    const claim = claims.find(
      (c) => c.participant_id === currentParticipant.id && c.item_id === itemId
    );
    return claim?.share ?? null;
  };

  const isItemClaimedByMe = (itemId: string) => {
    if (!currentParticipant) return false;
    return claims.some(
      (c) => c.participant_id === currentParticipant.id && c.item_id === itemId
    );
  };

  // Check if all items are fully claimed (total shares >= quantity for each item)
  const allItemsClaimed = splitMode === 'items' && items.length > 0 && claims.length > 0 && items.every((item) => {
    const totalClaimed = claims
      .filter((c) => c.item_id === item.id)
      .reduce((sum, c) => sum + c.share, 0);
    return totalClaimed >= item.quantity;
  });

  if (isLoading) {
    return (
      <main className="min-h-dvh py-8">
        <div className="container mx-auto max-w-2xl px-4">
          <div className="mb-8 h-5 w-20 animate-pulse rounded-md bg-white/[0.05]" />
          <BillSkeleton />
        </div>
      </main>
    );
  }

  if (!bill) {
    return (
      <main className="min-h-dvh py-8">
        <div className="container mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center px-4 text-center">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight text-white">Bill not found</h2>
            <p className="mt-2 text-sm text-white/40">This bill doesn&apos;t exist or has been deleted.</p>
            <Button asChild className="mt-8" variant="secondary">
              <Link href="/">Back to home</Link>
            </Button>
          </Reveal>
        </div>
      </main>
    );
  }

  const myShare = splits.find((s) => s.participant.id === currentParticipant?.id);
  const grandTotal = billTotal(bill);

  // Whoever fronted the money collects: paid_by when set, else the creator
  const payerParticipantId = bill.paid_by_user_id
    ? participants.find((p) => p.user_id === bill.paid_by_user_id)?.id ?? null
    : creatorParticipant?.id ?? null;
  const payerDisplayName = bill.paid_by?.name || creatorParticipant?.name || 'the host';
  const iAmPayer = bill.paid_by_user_id
    ? currentParticipant?.id === payerParticipantId
    : Boolean(currentParticipant?.is_creator);
  // Payment tracking (the payer collects, so progress is over everyone else)
  const payers = participants.filter((p) =>
    bill.paid_by_user_id ? p.id !== payerParticipantId : !p.is_creator
  );
  const paidCount = payers.filter((p) => p.payment_status === 'paid').length;
  const iAmPaid = currentParticipant?.payment_status === 'paid';
  // Deep links point at the payer's handles (their profile) when someone
  // other than the creator paid; otherwise the bill's own handles.
  const paySource = bill.paid_by && billHasPaymentMethods(bill.paid_by) ? bill.paid_by : bill;
  const canPay = Boolean(currentParticipant && !iAmPayer && myShare && billHasPaymentMethods(paySource));
  const myPaymentOptions = canPay ? getPaymentOptions(paySource, myShare!.total, `Splittr: ${bill.name}`) : [];
  const myZelle = canPay ? getZelleInfo(paySource) : null;

  // Custom mode: how much of the bill is assigned so far
  const assignedTotal = participants.reduce((sum, p) => sum + (p.custom_amount ?? 0), 0);
  const unassigned = grandTotal - assignedTotal;

  const headerMeta = [
    ...(creatorParticipant ? [`Hosted by ${creatorParticipant.name}`] : []),
    `${participants.length} ${participants.length === 1 ? 'person' : 'people'}`,
    ...(bill.paid_by ? [`Paid by ${bill.paid_by.name}`] : []),
    ...(splitMode !== 'items' ? [SPLIT_MODE_LABEL[splitMode]] : []),
  ];

  const editDraft: EditBillDraft = {
    name: editName,
    items: editItems,
    tax: editTax,
    tipPercent: editTipPercent,
    tipExact: editTipExact,
    tipSplit: editTipSplit,
    splitMode: editSplitMode,
    venmo: editVenmo,
    cashapp: editCashapp,
    paypal: editPaypal,
    zelle: editZelle,
    paidBy: editPaidBy,
  };
  const patchEditDraft = (patch: Partial<EditBillDraft>) => {
    if (patch.name !== undefined) setEditName(patch.name);
    if (patch.items !== undefined) setEditItems(patch.items);
    if (patch.tax !== undefined) setEditTax(patch.tax);
    if (patch.tipPercent !== undefined) setEditTipPercent(patch.tipPercent);
    if (patch.tipExact !== undefined) setEditTipExact(patch.tipExact);
    if (patch.tipSplit !== undefined) setEditTipSplit(patch.tipSplit);
    if (patch.splitMode !== undefined) setEditSplitMode(patch.splitMode);
    if (patch.venmo !== undefined) setEditVenmo(patch.venmo);
    if (patch.cashapp !== undefined) setEditCashapp(patch.cashapp);
    if (patch.paypal !== undefined) setEditPaypal(patch.paypal);
    if (patch.zelle !== undefined) setEditZelle(patch.zelle);
    if (patch.paidBy !== undefined) setEditPaidBy(patch.paidBy);
  };
  const payerChoices =
    bill.group_id && (bill.group_members?.length ?? 0) > 1
      ? (bill.group_members ?? [])
          .filter((m) => m.user_id !== bill.creator_user_id)
          .map((m) => ({ id: m.user_id, name: m.display_name }))
      : null;

  let sectionIndex = 1;

  return (
    <main className="min-h-dvh py-8 pb-36">
      {/* Confetti overlay */}
      {showConfetti && <Confetti />}

      <div className="container mx-auto max-w-2xl px-4">
        <Link
          href="/"
          className="mb-8 inline-flex h-11 items-center gap-2 text-sm text-white/40 transition-colors hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Home
        </Link>

        <div className="space-y-10">
          <Reveal index={0} className="space-y-6">
            <BillHeader
              name={bill.name}
              status={bill.status}
              meta={headerMeta}
              shortCode={bill.short_code}
              copied={copied}
              canEdit={isCreator}
              onCopy={handleCopyLink}
              onShare={handleShare}
              onShowQr={() => setShowQr(true)}
              onEdit={openEditDialog}
            />
            {isCreator && (
              <HostPanel
                status={bill.status}
                paidCount={paidCount}
                payerCount={payers.length}
                isUpdating={isUpdatingStatus}
                onToggleStatus={handleToggleStatus}
              />
            )}
          </Reveal>

          <Section index={sectionIndex++} title="People" count={participants.length}>
            <ParticipantList
              people={participants.map((p) => ({
                id: p.id,
                name: p.name,
                isYou: p.id === currentParticipant?.id,
                isHost: p.is_creator,
                isPaid: !p.is_creator && p.payment_status === 'paid',
                canRemove: isCreator && !p.is_creator,
              }))}
              onRemove={(id) => setRemoveTarget(participants.find((p) => p.id === id) ?? null)}
            />
            {!currentParticipant && (
              <Button
                className="mt-4 w-full sm:w-auto"
                onClick={async () => {
                  // Signed-in users join under their known identity;
                  // the name dialog is the anonymous fallback.
                  const joined = await autoJoin();
                  if (!joined) setShowJoinDialog(true);
                }}
              >
                Join this bill
              </Button>
            )}
          </Section>

          <Section
            index={sectionIndex++}
            title={splitMode === 'items' ? 'What did you have?' : 'On the bill'}
            description={
              splitMode === 'items'
                ? currentParticipant
                  ? 'Tap an item to claim it, or split it with anyone at the table.'
                  : 'Join the bill first, then tap your items.'
                : splitMode === 'even'
                  ? `The total is split evenly between ${participants.length} ${participants.length === 1 ? 'person' : 'people'}.`
                  : 'The host assigns each person their amount below.'
            }
          >
            <div className="surface overflow-hidden rounded-2xl">
              <div className="divide-y divide-white/[0.06]">
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    claimers={splitMode === 'items' ? getItemClaimers(item.id) : []}
                    myShare={splitMode === 'items' && isItemClaimedByMe(item.id) ? getMyClaimShare(item.id) : null}
                    interactive={splitMode === 'items'}
                    pending={claimingItemId === item.id}
                    onTap={() => handleItemTap(item)}
                    onUnclaim={() => handleUnclaim(item)}
                  />
                ))}
              </div>
              <div className="space-y-1.5 border-t border-white/10 bg-white/[0.015] px-4 py-4">
                <SummaryRow label="Subtotal">{formatCurrency(bill.subtotal)}</SummaryRow>
                <SummaryRow label="Tax">{formatCurrency(bill.tax)}</SummaryRow>
                <SummaryRow label={`Tip (${bill.tip_percent}%)`}>{formatCurrency(bill.tip_amount)}</SummaryRow>
                <div className="pt-1.5">
                  <SummaryRow label="Total" strong>
                    {formatCurrency(grandTotal)}
                  </SummaryRow>
                </div>
              </div>
            </div>

            {(allItemsClaimed || (splitMode === 'custom' && isCreator && Math.abs(unassigned) > 0.01)) && (
              <div className="mt-4 space-y-2">
                {/* All items claimed: one quiet line (the confetti does the cheering) */}
                {allItemsClaimed && <Note check>All items claimed. Everyone&apos;s share is below.</Note>}
                {/* Custom mode: unassigned note for the host */}
                {splitMode === 'custom' && isCreator && Math.abs(unassigned) > 0.01 && (
                  <Note>
                    {unassigned > 0
                      ? `${formatCurrency(unassigned)} of the bill is not assigned to anyone yet.`
                      : `Assigned amounts exceed the bill total by ${formatCurrency(-unassigned)}.`}
                  </Note>
                )}
              </div>
            )}
          </Section>

          {/* Pay your share */}
          {currentParticipant && !currentParticipant.is_creator && myShare && (
            <Section index={sectionIndex++} title="Settle up">
              <PayShare
                amount={myShare.total}
                payerName={payerDisplayName}
                isPaid={iAmPaid}
                payOptions={myPaymentOptions}
                zelle={myZelle}
                isUpdating={payingParticipantId === currentParticipant.id}
                onTogglePaid={() => handleTogglePaid(currentParticipant)}
              />
            </Section>
          )}

          {splits.length > 0 && (
            <Section
              index={sectionIndex++}
              title="Who owes what"
              description={
                splitMode === 'items'
                  ? bill.tip_split === 'even'
                    ? 'Tax follows what each person ordered; the tip is split equally.'
                    : 'Tax and tip are split based on what each person ordered.'
                  : splitMode === 'even'
                    ? 'Everyone pays the same share of the total.'
                    : 'Amounts assigned by the host.'
              }
            >
              <OwesList
                splits={splits}
                splitMode={splitMode}
                currentParticipantId={currentParticipant?.id ?? null}
                isCreator={isCreator}
                payingParticipantId={payingParticipantId}
                customDrafts={customDrafts}
                onCustomDraft={(id, value) => setCustomDrafts((prev) => ({ ...prev, [id]: value }))}
                onCustomCommit={(id) => {
                  const p = participants.find((x) => x.id === id);
                  if (p) handleSaveCustomAmount(p);
                }}
                onTogglePaid={(id) => {
                  const p = participants.find((x) => x.id === id);
                  if (p) handleTogglePaid(p);
                }}
              />
            </Section>
          )}

          {/* Danger zone for the host */}
          {isCreator && (
            <div className="border-t border-white/10 pt-6">
              <Button
                variant="ghost"
                className="-ml-3 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                Delete bill
              </Button>
            </div>
          )}
        </div>

        {/* Fixed bottom bar for current user */}
        {currentParticipant && myShare && (
          <BottomBar
            total={myShare.total}
            details={
              splitMode === 'items'
                ? [
                    `${myShare.items.length} item${myShare.items.length !== 1 ? 's' : ''}`,
                    `+ ${formatCurrency(myShare.taxShare + myShare.tipShare)} tax & tip`,
                  ]
                : [splitMode === 'even' ? `Split ${participants.length} ways` : 'Assigned by host']
            }
            isPaid={!currentParticipant.is_creator && iAmPaid}
          />
        )}

        {/* Scan-to-join code for the table */}
        <ShareQrDialog
          open={showQr}
          onOpenChange={setShowQr}
          url={typeof window !== 'undefined' ? `${window.location.origin}/bill/${bill.id}` : ''}
          billName={bill.name}
          shortCode={bill.short_code}
        />

        {/* The split sheet: the one surface for claiming and splitting items */}
        <SplitSheet
          open={showSplitSheet}
          onOpenChange={(o) => {
            setShowSplitSheet(o);
            if (!o) setSplitItem(null);
          }}
          item={splitItem}
          participants={participants}
          claims={claims}
          currentParticipantId={currentParticipant?.id ?? null}
          isSubmitting={isSplitting}
          onSubmit={handleSplitSubmit}
        />

        {!currentParticipant && (
          <JoinDialog
            open={showJoinDialog}
            onOpenChange={setShowJoinDialog}
            name={joinName}
            onNameChange={(name) => {
              setJoinName(name);
              setDuplicateCandidate(null);
            }}
            duplicateName={duplicateCandidate?.name ?? null}
            isJoining={isJoining}
            onJoin={() => handleJoin()}
            onAdoptDuplicate={() => duplicateCandidate && adoptParticipant(duplicateCandidate)}
            onJoinAsNew={() => handleJoin(true)}
          />
        )}

        <EditBillDialog
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          draft={editDraft}
          onChange={patchEditDraft}
          payerChoices={payerChoices}
          creatorName={creatorParticipant?.name || 'Creator'}
          isSaving={isSavingEdit}
          onSave={handleSaveEdit}
        />

        <ConfirmDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          title="Delete this bill?"
          description={`This permanently removes "${bill.name}" along with all items, participants, and claims. This cannot be undone.`}
          confirmLabel={isDeleting ? 'Deleting...' : 'Delete bill'}
          onConfirm={handleDeleteBill}
          isPending={isDeleting}
        />

        <ConfirmDialog
          open={Boolean(removeTarget)}
          onOpenChange={(open) => !open && setRemoveTarget(null)}
          title={`Remove ${removeTarget?.name ?? ''}?`}
          description="Their claimed items go back up for grabs and their share is recalculated away."
          confirmLabel="Remove"
          onConfirm={handleRemoveParticipant}
          isPending={isRemoving}
        />
      </div>
    </main>
  );
}
