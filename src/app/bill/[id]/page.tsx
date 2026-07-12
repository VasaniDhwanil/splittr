'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Copy,
  Share2,
  Check,
  Users,
  Loader2,
  CheckCircle2,
  RotateCcw,
  Pencil,
  Trash2,
  Plus,
  Wallet,
  Divide,
  ReceiptText,
  SlidersHorizontal,
  ExternalLink,
  SearchX,
} from 'lucide-react';
import { formatCurrency, calculateSplits, billTotal, formatShare } from '@/lib/calculations';
import { getPaymentOptions, billHasPaymentMethods } from '@/lib/payment-links';
import { Bill, BillItem, Participant, ItemClaim, ParticipantSplit, SplitMode, TipSplit } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { AvatarInitials, AvatarStack, getPersonHex } from '@/components/avatar-initials';

interface EditableItem {
  id?: string;
  name: string;
  price: number;
  quantity: number;
}

const SPLIT_MODE_META: Record<SplitMode, { label: string; icon: typeof ReceiptText }> = {
  items: { label: 'By item', icon: ReceiptText },
  even: { label: 'Split evenly', icon: Divide },
  custom: { label: 'Custom amounts', icon: SlidersHorizontal },
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

  const [splits, setSplits] = useState<ParticipantSplit[]>([]);
  const [copied, setCopied] = useState(false);
  const [claimingItemId, setClaimingItemId] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [hasShownConfetti, setHasShownConfetti] = useState(false);
  const [prevAllClaimed, setPrevAllClaimed] = useState(false);

  // Quantity picker for multi-quantity items
  const [quantityPickerItem, setQuantityPickerItem] = useState<BillItem | null>(null);
  const [showQuantityPicker, setShowQuantityPicker] = useState(false);

  // Portion picker for uneven splits of shared items (e.g. ⅔ of a pasta)
  const [portionPickerItem, setPortionPickerItem] = useState<BillItem | null>(null);
  const [showPortionPicker, setShowPortionPicker] = useState(false);

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
  const [editTipSplit, setEditTipSplit] = useState<TipSplit>('proportional');
  const [editSplitMode, setEditSplitMode] = useState<SplitMode>('items');
  const [editVenmo, setEditVenmo] = useState('');
  const [editCashapp, setEditCashapp] = useState('');
  const [editPaypal, setEditPaypal] = useState('');

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
        return totalClaimed >= item.quantity;
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

  // Set up real-time subscriptions
  useEffect(() => {
    if (!bill) return;

    const supabase = createClient();

    // Subscribe to participants changes
    const participantsChannel = supabase
      .channel('participants-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'participants',
          filter: `bill_id=eq.${bill.id}`,
        },
        () => {
          fetchBill();
        }
      )
      .subscribe();

    // Subscribe to bill changes (edits, status, payment handles)
    const billChannel = supabase
      .channel('bill-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bills',
          filter: `id=eq.${bill.id}`,
        },
        () => {
          fetchBill();
        }
      )
      .subscribe();

    // Subscribe to item changes (creator edits)
    const itemsChannel = supabase
      .channel('items-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bill_items',
          filter: `bill_id=eq.${bill.id}`,
        },
        () => {
          fetchBill();
        }
      )
      .subscribe();

    // Subscribe to claims changes - only for items in this bill.
    // DELETE events can't be filtered (their payload only carries the primary
    // key), so they get their own unfiltered listener — without it, unclaims
    // from other devices never refresh the page.
    const claimsChannel = items.length > 0
      ? supabase
          .channel('claims-changes')
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'item_claims',
              filter: `item_id=in.(${items.map(i => i.id).join(',')})`,
            },
            () => {
              fetchBill();
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'item_claims',
              filter: `item_id=in.(${items.map(i => i.id).join(',')})`,
            },
            () => {
              fetchBill();
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'DELETE',
              schema: 'public',
              table: 'item_claims',
            },
            () => {
              fetchBill();
            }
          )
          .subscribe()
      : null;

    return () => {
      supabase.removeChannel(participantsChannel);
      supabase.removeChannel(billChannel);
      supabase.removeChannel(itemsChannel);
      if (claimsChannel) supabase.removeChannel(claimsChannel);
    };
  }, [bill, items, fetchBill]);

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

  // Join without the name prompt — the server derives the name from the
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
      const participant: Participant = await res.json();
      setCurrentParticipant(participant);
      localStorage.setItem(`splittr-participant-${bill.id}`, participant.id);
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

  const handleJoin = async () => {
    if (!joinName.trim() || !bill) return;

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

  const handleToggleClaim = async (item: BillItem) => {
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

    const existingClaim = claims.find(
      (c) => c.participant_id === me.id && c.item_id === item.id
    );

    // If already claimed, unclaim
    if (existingClaim) {
      setClaimingItemId(item.id);
      try {
        await fetch(`/api/claims?participant_id=${me.id}&item_id=${item.id}`, {
          method: 'DELETE',
        });
        toast.success("Got it, you're off the hook!");
        await fetchBill(); // realtime alone misses claim DELETEs (filter can't match delete payloads)
      } catch (error) {
        console.error('Error unclaiming:', error);
        toast.error('Oops, something went wrong');
      } finally {
        setTimeout(() => setClaimingItemId(null), 300);
      }
      return;
    }

    // If multi-quantity item, show quantity picker
    if (item.quantity > 1) {
      const remaining = getRemainingQuantity(item);
      if (remaining <= 0) {
        toast.error('All claimed! Tap to see who has it.');
        return;
      }
      setQuantityPickerItem(item);
      setShowQuantityPicker(true);
      return;
    }

    // Claim directly
    setClaimingItemId(item.id);
    try {
      await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: me.id,
          item_id: item.id,
          share: 1,
        }),
      });
      toast.success('Nice pick!');
      await fetchBill(); // realtime alone misses claim DELETEs (filter can't match delete payloads)
    } catch (error) {
      console.error('Error claiming:', error);
      toast.error('Oops, something went wrong');
    } finally {
      setTimeout(() => setClaimingItemId(null), 300);
    }
  };

  const handlePortionClaim = async (fraction: number) => {
    if (!currentParticipant || !portionPickerItem) return;

    setShowPortionPicker(false);
    setClaimingItemId(portionPickerItem.id);

    try {
      await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: currentParticipant.id,
          item_id: portionPickerItem.id,
          share: fraction,
        }),
      });
      toast.success(`Got it — ${formatShare(fraction)} of ${portionPickerItem.name}`);
      await fetchBill();
    } catch (error) {
      console.error('Error updating portion:', error);
      toast.error('Oops, something went wrong');
    } finally {
      setTimeout(() => setClaimingItemId(null), 300);
      setPortionPickerItem(null);
    }
  };

  const handleQuantityClaim = async (quantity: number) => {
    if (!currentParticipant || !quantityPickerItem) return;

    setShowQuantityPicker(false);
    setClaimingItemId(quantityPickerItem.id);

    try {
      await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: currentParticipant.id,
          item_id: quantityPickerItem.id,
          share: quantity,
        }),
      });
      toast.success(`Claimed ${quantity} of ${quantityPickerItem.quantity}!`);
      await fetchBill(); // realtime alone misses claim DELETEs (filter can't match delete payloads)
    } catch (error) {
      console.error('Error claiming:', error);
      toast.error('Oops, something went wrong');
    } finally {
      setTimeout(() => setClaimingItemId(null), 300);
      setQuantityPickerItem(null);
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: participant.id, payment_status: newStatus }),
      });
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
    setEditTipSplit(bill.tip_split || 'proportional');
    setEditSplitMode(bill.split_mode || 'items');
    setEditVenmo(bill.venmo_handle || '');
    setEditCashapp(bill.cashapp_handle || '');
    setEditPaypal(bill.paypal_handle || '');
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
          tip_split: editTipSplit,
          split_mode: editSplitMode,
          venmo_handle: editVenmo,
          cashapp_handle: editCashapp,
          paypal_handle: editPaypal,
        }),
      });

      if (response.status === 403) {
        toast.error('Only the bill creator can edit this');
        return;
      }
      if (!response.ok) throw new Error('Failed to save changes');

      setShowEditDialog(false);
      toast.success('Bill updated!');
      await fetchBill();
    } catch (error) {
      console.error('Error saving edit:', error);
      toast.error('Failed to save changes');
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

  const getRemainingQuantity = (item: BillItem): number => {
    const totalClaimed = claims
      .filter((c) => c.item_id === item.id)
      .reduce((sum, c) => sum + c.share, 0);
    return Math.max(0, item.quantity - totalClaimed);
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
        <div className="container mx-auto px-4 max-w-2xl flex flex-col justify-center items-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Loading your bill...</p>
        </div>
      </main>
    );
  }

  if (!bill) {
    return (
      <main className="min-h-dvh py-8">
        <div className="container mx-auto px-4 max-w-2xl">
          <Card className="shadow-lg">
            <CardContent className="py-12 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <SearchX className="h-6 w-6 text-white/50" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Bill Not Found</h2>
              <p className="text-muted-foreground mb-6">
                This bill doesn&apos;t exist or has been deleted.
              </p>
              <Link href="/">
                <Button size="lg">Back to Home</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const myShare = splits.find((s) => s.participant.id === currentParticipant?.id);
  const grandTotal = billTotal(bill);
  const ModeIcon = SPLIT_MODE_META[splitMode].icon;

  // Payment tracking (creator collects, so progress is over everyone else)
  const payers = participants.filter((p) => !p.is_creator);
  const paidCount = payers.filter((p) => p.payment_status === 'paid').length;
  const iAmPaid = currentParticipant?.payment_status === 'paid';
  const myPaymentOptions =
    currentParticipant && !currentParticipant.is_creator && myShare && billHasPaymentMethods(bill)
      ? getPaymentOptions(bill, myShare.total, `Splittr: ${bill.name}`)
      : [];

  // Custom mode: how much of the bill is assigned so far
  const assignedTotal = participants.reduce((sum, p) => sum + (p.custom_amount ?? 0), 0);
  const unassigned = grandTotal - assignedTotal;

  return (
    <main className="min-h-dvh py-8 pb-36">
      {/* Confetti overlay */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className="absolute w-3 h-3 rounded-sm"
              style={{
                left: `${Math.random() * 100}%`,
                backgroundColor: ['#4ade80', '#facc15', '#fb923c', '#f472b6', '#38bdf8'][
                  Math.floor(Math.random() * 5)
                ],
                animation: `confetti-fall ${2 + Math.random() * 2}s linear forwards`,
                animationDelay: `${Math.random() * 0.5}s`,
              }}
            />
          ))}
        </div>
      )}

      <div className="container mx-auto px-4 max-w-2xl">
        <Link href="/" className="inline-flex items-center text-white/40 hover:text-white mb-6 transition-smooth">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Home
        </Link>

        {/* Bill Header */}
        <Card className="mb-6 shadow-sm">
          <CardContent className="py-5">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h1 className="text-2xl font-bold">{bill.name}</h1>
                  {bill.status === 'settled' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Settled
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-white/5 text-white/50 border border-white/10">
                    <ModeIcon className="h-3 w-3" />
                    {SPLIT_MODE_META[splitMode].label}
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">
                  Share code: <span className="font-mono font-semibold text-foreground">{bill.short_code}</span>
                </p>
              </div>
              <div className="flex gap-2">
                {isCreator && (
                  <Button variant="outline" size="icon" onClick={openEditDialog} className="transition-smooth hover:scale-105" title="Edit bill">
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="outline" size="icon" onClick={handleCopyLink} className="transition-smooth hover:scale-105">
                  {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" onClick={handleShare} className="transition-smooth hover:scale-105">
                  <Share2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Payment progress + settle button (creator only) */}
            {isCreator && (
              <div className="mt-4 pt-4 border-t space-y-3">
                {payers.length > 0 && (
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Payments collected</span>
                      <span className="font-medium">{paidCount} of {payers.length} paid</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-green-500/70 transition-all duration-500"
                        style={{ width: `${payers.length > 0 ? (paidCount / payers.length) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                )}
                <Button
                  variant={bill.status === 'settled' ? 'outline' : 'default'}
                  size="sm"
                  onClick={handleToggleStatus}
                  disabled={isUpdatingStatus}
                  className="w-full transition-smooth"
                >
                  {isUpdatingStatus ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : bill.status === 'settled' ? (
                    <RotateCcw className="h-4 w-4 mr-2" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  )}
                  {isUpdatingStatus
                    ? 'Updating...'
                    : bill.status === 'settled'
                    ? 'Reopen Bill'
                    : 'Mark as Settled'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Participants */}
        <Card className="mb-6 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex justify-between items-center">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Who&apos;s splitting? ({participants.length})
              </CardTitle>
              {!currentParticipant && (
                <Dialog open={showJoinDialog} onOpenChange={setShowJoinDialog}>
                  <Button
                    size="sm"
                    className="transition-smooth hover:scale-105"
                    onClick={async () => {
                      // Signed-in users join under their known identity;
                      // the name dialog is the anonymous fallback.
                      const joined = await autoJoin();
                      if (!joined) setShowJoinDialog(true);
                    }}
                  >
                    Join the fun
                  </Button>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Join the Split</DialogTitle>
                      <DialogDescription>
                        Enter your name to start picking what you had!
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="joinName">What&apos;s your name?</Label>
                        <Input
                          id="joinName"
                          placeholder="e.g., Alex"
                          value={joinName}
                          onChange={(e) => setJoinName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                          className="text-lg"
                        />
                      </div>
                      <Button onClick={handleJoin} className="w-full" size="lg" disabled={isJoining}>
                        {isJoining ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Joining...
                          </>
                        ) : (
                          "Let's go!"
                        )}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {participants.map((p) => {
                const hex = getPersonHex(p.name);
                const isMe = p.id === currentParticipant?.id;
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-full transition-smooth"
                    style={{
                      backgroundColor: `${hex}1f`,
                      boxShadow: isMe ? `inset 0 0 0 2px ${hex}99` : undefined,
                    }}
                  >
                    <AvatarInitials name={p.name} size="sm" />
                    <span className="text-sm font-medium">
                      {p.name}
                      {p.is_creator && ' ✨'}
                      {isMe && ' (you)'}
                    </span>
                    {!p.is_creator && p.payment_status === 'paid' && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Items */}
        <Card className="mb-6 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">
              {splitMode === 'items' ? 'What did you have?' : 'On the bill'}
            </CardTitle>
            <CardDescription>
              {splitMode === 'items'
                ? currentParticipant
                  ? "Tap the items you ordered. If others tap too, you'll split automatically!"
                  : 'Join the bill first, then tap your items.'
                : splitMode === 'even'
                ? `The total is split evenly between ${participants.length} ${participants.length === 1 ? 'person' : 'people'}.`
                : 'The host assigns each person their amount below.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item) => {
              const claimers = splitMode === 'items' ? getItemClaimers(item.id) : [];
              const claimedByMe = splitMode === 'items' && isItemClaimedByMe(item.id);
              const myClaimShare = getMyClaimShare(item.id);
              const totalShares = claimers.reduce((sum, c) => sum + c.share, 0);
              // Portions are absolute until the item is over-claimed (must
              // match calculateSplits so the list and totals agree)
              const shareDenominator = Math.max(totalShares, item.quantity);
              const isAnimating = claimingItemId === item.id;

              // Calculate my portion of the item
              const myPortion = myClaimShare && shareDenominator > 0
                ? (item.price * item.quantity * myClaimShare) / shareDenominator
                : 0;

              // Tint the item with its claimers' colors — shared items blend
              // them; the highlight stays light so the blend reads through
              const claimerHexes = claimers.map((c) => getPersonHex(c.participant.name));
              const myHex = currentParticipant ? getPersonHex(currentParticipant.name) : null;
              const itemStyle: React.CSSProperties = {};
              if (claimerHexes.length === 1) {
                itemStyle.backgroundColor = `${claimerHexes[0]}17`;
                itemStyle.boxShadow = `inset 0 0 0 1.5px ${claimerHexes[0]}${claimedByMe ? '73' : '40'}`;
              } else if (claimerHexes.length > 1) {
                itemStyle.background = `linear-gradient(100deg, ${claimerHexes
                  .map((hex, i) => `${hex}1f ${(i / (claimerHexes.length - 1)) * 100}%`)
                  .join(', ')})`;
                if (claimedByMe && myHex) {
                  itemStyle.boxShadow = `inset 0 0 0 1.5px ${myHex}59`;
                }
              }

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-xl transition-smooth ${
                    isAnimating ? 'animate-claim-pop' : ''
                  } ${claimers.length === 0 ? 'bg-muted/50' : 'shadow-sm'} ${
                    splitMode === 'items'
                      ? 'cursor-pointer hover:brightness-125'
                      : ''
                  }`}
                  style={itemStyle}
                  onClick={() => handleToggleClaim(item)}
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-base">
                        {item.quantity > 1 && (
                          <span className="text-muted-foreground">{item.quantity}× </span>
                        )}
                        {item.name}
                      </div>
                      {claimers.length > 0 && (
                        <div className="flex flex-col gap-1 mt-2">
                          <div className="flex items-center gap-2">
                            <AvatarStack
                              names={claimers.map((c) => c.participant.name)}
                              max={4}
                              size="sm"
                            />
                            {item.quantity > 1 && totalShares > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {totalShares >= item.quantity
                                  ? 'fully claimed'
                                  : `${totalShares}/${item.quantity} claimed`}
                              </span>
                            )}
                          </div>
                          {item.quantity > 1 && claimers.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {claimers.map((c, i) => (
                                <span key={c.participant.id}>
                                  {c.participant.name}: {c.share}
                                  {i < claimers.length - 1 && ', '}
                                </span>
                              ))}
                            </div>
                          )}
                          {/* Uneven portions on a shared single item (e.g. ⅔ / ⅓ of a pasta) */}
                          {item.quantity === 1 && totalShares > 0 &&
                            (claimers.length > 1 || claimers.some((c) => c.share !== 1)) && (
                            <div className="text-xs text-muted-foreground">
                              {claimers.map((c, i) => (
                                <span key={c.participant.id}>
                                  {c.participant.name}: {formatShare(c.share / shareDenominator)}
                                  {i < claimers.length - 1 && ' · '}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold text-base">
                        {formatCurrency(item.price * item.quantity)}
                      </div>
                      {claimedByMe && myClaimShare && (
                        <>
                          <div
                            className={`flex items-center justify-end gap-1 mt-1 text-sm ${isAnimating ? 'animate-claim-check' : ''}`}
                            style={{ color: myHex ?? undefined }}
                          >
                            <Check className="h-4 w-4" />
                            <span>
                              {item.quantity > 1
                                ? `${myClaimShare}× = ${formatCurrency(myPortion)}`
                                : claimers.length === 1 && myClaimShare === 1
                                ? 'Yours'
                                : `${formatShare(myClaimShare / shareDenominator)} · ${formatCurrency(myPortion)}`}
                            </span>
                          </div>
                          {item.quantity === 1 && (
                            <button
                              type="button"
                              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-smooth mt-1 py-1.5 px-2 -mr-2 touch-manipulation"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPortionPickerItem(item);
                                setShowPortionPicker(true);
                              }}
                            >
                              adjust my portion
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            <Separator className="my-4" />

            <div className="space-y-2 text-sm bg-muted/30 rounded-lg p-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(bill.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(bill.tax)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tip ({bill.tip_percent}%)</span>
                <span>{formatCurrency(bill.tip_amount)}</span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between font-bold text-base">
                <span>Total</span>
                <span>{formatCurrency(grandTotal)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* All items claimed celebration */}
        {allItemsClaimed && (
          <Card className="mb-6 shadow-sm bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
            <CardContent className="py-6 text-center">
              <CheckCircle2 className="h-8 w-8 text-primary mx-auto mb-2" />
              <h3 className="font-semibold text-lg">All items claimed!</h3>
              <p className="text-muted-foreground text-sm">Everyone&apos;s share is calculated below.</p>
            </CardContent>
          </Card>
        )}

        {/* Custom mode: unassigned warning for the host */}
        {splitMode === 'custom' && isCreator && Math.abs(unassigned) > 0.01 && (
          <Card className="mb-6 shadow-sm border-amber-500/20 bg-amber-500/5">
            <CardContent className="py-4 text-sm text-amber-300/90">
              {unassigned > 0
                ? `${formatCurrency(unassigned)} of the bill is not assigned to anyone yet.`
                : `Assigned amounts exceed the bill total by ${formatCurrency(-unassigned)}.`}
            </CardContent>
          </Card>
        )}

        {/* Pay your share */}
        {currentParticipant && !currentParticipant.is_creator && myShare && (
          <Card className="mb-6 shadow-sm border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                Settle up
              </CardTitle>
              <CardDescription>
                {iAmPaid
                  ? 'You are marked as paid. Thanks for settling up!'
                  : creatorParticipant
                  ? `You owe ${creatorParticipant.name} ${formatCurrency(myShare.total)}.`
                  : `Your share is ${formatCurrency(myShare.total)}.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!iAmPaid && myPaymentOptions.length > 0 && (
                <div className="grid gap-2">
                  {myPaymentOptions.map((option) => (
                    <a
                      key={option.key}
                      href={option.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between px-4 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-smooth"
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ backgroundColor: option.color }}
                        >
                          {option.label[0]}
                        </span>
                        <span>
                          <span className="font-medium">{option.label}</span>
                          <span className="text-muted-foreground text-sm ml-2">{option.handle}</span>
                        </span>
                      </span>
                      <span className="flex items-center gap-2 text-sm font-semibold text-primary">
                        {formatCurrency(myShare.total)}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </span>
                    </a>
                  ))}
                </div>
              )}
              {!iAmPaid && myPaymentOptions.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Pay {creatorParticipant?.name || 'the host'} however you usually do, then mark yourself paid.
                </p>
              )}
              <Button
                variant={iAmPaid ? 'outline' : 'default'}
                className="w-full transition-smooth"
                onClick={() => handleTogglePaid(currentParticipant)}
                disabled={payingParticipantId === currentParticipant.id}
              >
                {payingParticipantId === currentParticipant.id ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : iAmPaid ? (
                  <RotateCcw className="h-4 w-4 mr-2" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                {iAmPaid ? 'Undo — not paid yet' : "I've paid my share"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Split Summary */}
        {splits.length > 0 && (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Who owes what</CardTitle>
              <CardDescription>
                {splitMode === 'items'
                  ? bill.tip_split === 'even'
                    ? 'Tax follows what each person ordered; the tip is split equally.'
                    : 'Tax and tip are split based on what each person ordered.'
                  : splitMode === 'even'
                  ? 'Everyone pays the same share of the total.'
                  : 'Amounts assigned by the host.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {splits.map((split) => {
                const p = split.participant;
                const isPaid = !p.is_creator && p.payment_status === 'paid';
                return (
                  <div
                    key={p.id}
                    className={`p-4 rounded-xl transition-smooth ${
                      p.id === currentParticipant?.id
                        ? 'bg-primary/10 ring-2 ring-primary/30'
                        : 'bg-muted/50'
                    } ${isPaid ? 'opacity-80' : ''}`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-3">
                        <AvatarInitials name={p.name} size="md" />
                        <span className="font-medium">
                          {p.name}
                          {p.id === currentParticipant?.id && ' (you)'}
                        </span>
                        {isPaid && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400">
                            <CheckCircle2 className="h-3 w-3" />
                            Paid
                          </span>
                        )}
                      </div>
                      {splitMode === 'custom' && isCreator ? (
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground text-sm">$</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            className="w-24 text-right font-semibold"
                            value={customDrafts[p.id] ?? (p.custom_amount != null ? String(p.custom_amount) : '')}
                            placeholder="0.00"
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              setCustomDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            onBlur={() => handleSaveCustomAmount(p)}
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          />
                        </div>
                      ) : (
                        <span className="text-2xl font-money" style={{ color: getPersonHex(p.name) }}>
                          {formatCurrency(split.total)}
                        </span>
                      )}
                    </div>
                    {splitMode === 'items' && (
                      <div className="text-sm text-muted-foreground space-y-1 pl-11 mt-2">
                        <div className="flex justify-between">
                          <span>{split.items.length} item{split.items.length !== 1 && 's'}</span>
                          <span>{formatCurrency(split.itemsTotal)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>+ tax</span>
                          <span>{formatCurrency(split.taxShare)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>+ tip</span>
                          <span>{formatCurrency(split.tipShare)}</span>
                        </div>
                      </div>
                    )}
                    {/* Creator can toggle anyone's paid status */}
                    {isCreator && !p.is_creator && (
                      <div className="pl-11 mt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground"
                          disabled={payingParticipantId === p.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePaid(p);
                          }}
                        >
                          {payingParticipantId === p.id ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : isPaid ? (
                            <RotateCcw className="h-3 w-3 mr-1" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                          )}
                          {isPaid ? 'Mark unpaid' : 'Mark paid'}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Danger zone for creator */}
        {isCreator && (
          <div className="mt-6 text-center">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive/70 hover:text-destructive hover:bg-destructive/10"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete this bill
            </Button>
          </div>
        )}

        {/* Fixed bottom bar for current user */}
        {currentParticipant && myShare && (
          <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t shadow-lg z-40">
            <div className="container mx-auto max-w-2xl p-4">
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-sm text-muted-foreground">Your total</div>
                  <div className="text-4xl font-money text-primary">{formatCurrency(myShare.total)}</div>
                </div>
                <div className="text-right">
                  {splitMode === 'items' ? (
                    <>
                      <div className="text-sm text-muted-foreground">
                        {myShare.items.length} item{myShare.items.length !== 1 && 's'}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        + {formatCurrency(myShare.taxShare + myShare.tipShare)} tax & tip
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {splitMode === 'even' ? `Split ${participants.length} ways` : 'Assigned by host'}
                    </div>
                  )}
                  {!currentParticipant.is_creator && iAmPaid && (
                    <div className="text-sm text-green-400 flex items-center justify-end gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Paid
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quantity Picker Dialog */}
        <Dialog open={showQuantityPicker} onOpenChange={setShowQuantityPicker}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>How many did you have?</DialogTitle>
              <DialogDescription>
                {quantityPickerItem && (
                  <>
                    {quantityPickerItem.name} — {getRemainingQuantity(quantityPickerItem)} of {quantityPickerItem.quantity} available
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            {quantityPickerItem && (() => {
              const remaining = getRemainingQuantity(quantityPickerItem);
              const buttonSize = remaining <= 2 ? 'w-20 h-20 text-2xl' : remaining <= 4 ? 'w-16 h-16 text-xl' : 'w-14 h-14 text-lg';
              return (
                <div className="flex flex-wrap justify-center gap-3 pt-4">
                  {Array.from({ length: remaining }, (_, i) => i + 1).map((num) => (
                    <Button
                      key={num}
                      variant="outline"
                      className={`${buttonSize} font-semibold transition-smooth hover:scale-105 hover:bg-primary hover:text-primary-foreground rounded-xl`}
                      onClick={() => handleQuantityClaim(num)}
                    >
                      {num}
                    </Button>
                  ))}
                </div>
              );
            })()}
            <p className="text-sm text-muted-foreground text-center mt-2">
              {quantityPickerItem && formatCurrency(quantityPickerItem.price)} each
            </p>
          </DialogContent>
        </Dialog>

        {/* Portion Picker Dialog (uneven splits of a shared item) */}
        <Dialog open={showPortionPicker} onOpenChange={setShowPortionPicker}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>How much did you have?</DialogTitle>
              <DialogDescription>
                {portionPickerItem && (
                  <>
                    {portionPickerItem.name} — {formatCurrency(portionPickerItem.price)}.
                    Everyone&apos;s portions are balanced against each other, so pick your true share.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-3 pt-4">
              {[
                { label: '¼', value: 0.25 },
                { label: '⅓', value: 1 / 3 },
                { label: '½', value: 0.5 },
                { label: '⅔', value: 2 / 3 },
                { label: '¾', value: 0.75 },
                { label: 'All / equal', value: 1 },
              ].map((portion) => (
                <Button
                  key={portion.label}
                  variant="outline"
                  className="h-16 text-lg font-semibold transition-smooth hover:scale-105 hover:bg-primary hover:text-primary-foreground rounded-xl"
                  onClick={() => handlePortionClaim(Math.round(portion.value * 100) / 100)}
                >
                  {portion.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Example: you had ⅔ of the pasta, your friend had ⅓ — you each pick your share and
              the split follows.
            </p>
          </DialogContent>
        </Dialog>

        {/* Edit Bill Dialog */}
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Bill</DialogTitle>
              <DialogDescription>
                Update items, amounts, split mode, and payment details.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="editBillName">Bill name</Label>
                <Input
                  id="editBillName"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Items</Label>
                {editItems.map((item, index) => (
                  <div key={item.id ?? `new-${index}`} className="flex gap-1 items-center">
                    <Input
                      placeholder="Item name"
                      value={item.name}
                      onChange={(e) => {
                        const next = [...editItems];
                        next[index] = { ...next[index], name: e.target.value };
                        setEditItems(next);
                      }}
                      className="flex-1 text-sm"
                    />
                    <Input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => {
                        const next = [...editItems];
                        next[index] = { ...next[index], quantity: parseInt(e.target.value) || 1 };
                        setEditItems(next);
                      }}
                      className="w-14 text-center text-sm shrink-0"
                    />
                    <Input
                      type="number"
                      step="0.01"
                      value={item.price || ''}
                      placeholder="0.00"
                      onChange={(e) => {
                        const next = [...editItems];
                        next[index] = { ...next[index], price: parseFloat(e.target.value) || 0 };
                        setEditItems(next);
                      }}
                      className="w-20 text-sm shrink-0"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setEditItems(editItems.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setEditItems([...editItems, { name: '', price: 0, quantity: 1 }])}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add item
                </Button>
                <p className="text-xs text-muted-foreground">
                  Removing an item also removes everyone&apos;s claims on it.
                </p>
              </div>

              <div className="flex gap-4">
                <div className="space-y-2 flex-1">
                  <Label htmlFor="editTax">Tax</Label>
                  <Input
                    id="editTax"
                    type="number"
                    step="0.01"
                    value={editTax || ''}
                    onChange={(e) => setEditTax(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2 flex-1">
                  <Label htmlFor="editTip">Tip %</Label>
                  <Input
                    id="editTip"
                    type="number"
                    step="1"
                    value={editTipPercent || ''}
                    onChange={(e) => setEditTipPercent(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Tip split</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditTipSplit('proportional')}
                    className={`p-2 rounded-full border text-sm transition-smooth ${
                      editTipSplit === 'proportional'
                        ? 'border-primary/60 bg-primary/10'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    Follows items
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditTipSplit('even')}
                    className={`p-2 rounded-full border text-sm transition-smooth ${
                      editTipSplit === 'even'
                        ? 'border-primary/60 bg-primary/10'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    Split equally
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Split mode</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(SPLIT_MODE_META) as SplitMode[]).map((mode) => {
                    const Icon = SPLIT_MODE_META[mode].icon;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setEditSplitMode(mode)}
                        className={`p-2 rounded-lg border text-sm flex items-center justify-center gap-1.5 transition-smooth ${
                          editSplitMode === mode
                            ? 'border-primary/60 bg-primary/10'
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {SPLIT_MODE_META[mode].label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <Label>Payment handles</Label>
                <Input
                  placeholder="Venmo — @your-venmo"
                  value={editVenmo}
                  onChange={(e) => setEditVenmo(e.target.value)}
                />
                <Input
                  placeholder="Cash App — $yourcashtag"
                  value={editCashapp}
                  onChange={(e) => setEditCashapp(e.target.value)}
                />
                <Input
                  placeholder="PayPal.Me — yourpaypalme"
                  value={editPaypal}
                  onChange={(e) => setEditPaypal(e.target.value)}
                />
              </div>

              <Button className="w-full" size="lg" onClick={handleSaveEdit} disabled={isSavingEdit}>
                {isSavingEdit ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save changes'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Bill Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete this bill?</DialogTitle>
              <DialogDescription>
                This permanently removes {`"${bill.name}"`} along with all items, participants, and
                claims. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleDeleteBill}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete bill'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

      </div>
    </main>
  );
}
