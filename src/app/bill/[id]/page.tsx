'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ArrowLeft, Copy, Share2, Check, Users, Loader2, Sparkles, CheckCircle2, RotateCcw } from 'lucide-react';
import { formatCurrency, calculateSplits } from '@/lib/calculations';
import { Bill, BillItem, Participant, ItemClaim, ParticipantSplit } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { AvatarInitials, AvatarStack } from '@/components/avatar-initials';

export default function BillPage() {
  const params = useParams();
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

  // Bill status
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

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
    if (bill && items.length > 0 && participants.length > 0) {
      const calculatedSplits = calculateSplits(bill, items, participants, claims);
      setSplits(calculatedSplits);

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

    // Subscribe to claims changes
    const claimsChannel = supabase
      .channel('claims-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'item_claims',
        },
        () => {
          fetchBill();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(participantsChannel);
      supabase.removeChannel(claimsChannel);
    };
  }, [bill, fetchBill]);

  // Check for saved participant in localStorage
  useEffect(() => {
    if (!bill) return;
    const savedId = localStorage.getItem(`splittr-participant-${bill.id}`);
    if (savedId) {
      const participant = participants.find((p) => p.id === savedId);
      if (participant) {
        setCurrentParticipant(participant);
      }
    }
  }, [bill, participants]);

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
    if (!currentParticipant) {
      setShowJoinDialog(true);
      return;
    }

    const existingClaim = claims.find(
      (c) => c.participant_id === currentParticipant.id && c.item_id === item.id
    );

    // If already claimed, unclaim
    if (existingClaim) {
      setClaimingItemId(item.id);
      try {
        await fetch(`/api/claims?participant_id=${currentParticipant.id}&item_id=${item.id}`, {
          method: 'DELETE',
        });
        toast.success("Got it, you're off the hook!");
        await fetchBill();
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

    // Single quantity item - check if already claimed by someone else
    const existingClaimers = claims.filter((c) => c.item_id === item.id);
    if (existingClaimers.length > 0) {
      // Already claimed - allow shared claiming (original behavior)
    }

    // Claim directly
    setClaimingItemId(item.id);
    try {
      await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: currentParticipant.id,
          item_id: item.id,
          share: 1,
        }),
      });
      toast.success('Nice pick!');
      await fetchBill();
    } catch (error) {
      console.error('Error claiming:', error);
      toast.error('Oops, something went wrong');
    } finally {
      setTimeout(() => setClaimingItemId(null), 300);
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
      await fetchBill();
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
      } catch (error) {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

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
  const allItemsClaimed = items.length > 0 && claims.length > 0 && items.every((item) => {
    const totalClaimed = claims
      .filter((c) => c.item_id === item.id)
      .reduce((sum, c) => sum + c.share, 0);
    return totalClaimed >= item.quantity;
  });

  if (isLoading) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-background to-muted py-8">
        <div className="container mx-auto px-4 max-w-2xl flex flex-col justify-center items-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Loading your bill...</p>
        </div>
      </main>
    );
  }

  if (!bill) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-background to-muted py-8">
        <div className="container mx-auto px-4 max-w-2xl">
          <Card className="shadow-lg">
            <CardContent className="py-12 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">🔍</span>
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

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted py-8 pb-36">
      {/* Confetti overlay */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className="absolute w-3 h-3 rounded-sm"
              style={{
                left: `${Math.random() * 100}%`,
                backgroundColor: ['#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#10b981'][
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
        <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6 transition-smooth">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Home
        </Link>

        {/* Bill Header */}
        <Card className="mb-6 shadow-sm">
          <CardContent className="py-5">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-2xl font-bold">{bill.name}</h1>
                  {bill.status === 'settled' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      <CheckCircle2 className="h-3 w-3" />
                      Settled
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground text-sm">
                  Share code: <span className="font-mono font-semibold text-foreground">{bill.short_code}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" onClick={handleCopyLink} className="transition-smooth hover:scale-105">
                  {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" onClick={handleShare} className="transition-smooth hover:scale-105">
                  <Share2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Settle button - visible to all participants */}
            {currentParticipant && (
              <div className="mt-4 pt-4 border-t">
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
                  <DialogTrigger asChild>
                    <Button size="sm" className="transition-smooth hover:scale-105">Join the fun</Button>
                  </DialogTrigger>
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
              {participants.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-full transition-smooth ${
                    p.id === currentParticipant?.id
                      ? 'bg-primary/15 ring-2 ring-primary/30'
                      : 'bg-muted'
                  }`}
                >
                  <AvatarInitials name={p.name} size="sm" />
                  <span className="text-sm font-medium">
                    {p.name}
                    {p.is_creator && ' ✨'}
                    {p.id === currentParticipant?.id && ' (you)'}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Items */}
        <Card className="mb-6 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">What did you have?</CardTitle>
            <CardDescription>
              {currentParticipant
                ? "Tap the items you ordered. If others tap too, you'll split automatically!"
                : 'Join the bill first, then tap your items.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item) => {
              const claimers = getItemClaimers(item.id);
              const claimedByMe = isItemClaimedByMe(item.id);
              const myClaimShare = getMyClaimShare(item.id);
              const totalShares = claimers.reduce((sum, c) => sum + c.share, 0);
              const isAnimating = claimingItemId === item.id;

              // Calculate my portion of the item
              const myPortion = myClaimShare && totalShares > 0
                ? (item.price * item.quantity * myClaimShare) / totalShares
                : 0;

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-smooth ${
                    isAnimating ? 'animate-claim-pop' : ''
                  } ${
                    claimedByMe
                      ? 'bg-primary/10 border-primary/40 shadow-sm'
                      : 'border-transparent bg-muted/50 hover:bg-muted hover:border-muted-foreground/20'
                  }`}
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
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold text-base">
                        {formatCurrency(item.price * item.quantity)}
                      </div>
                      {claimedByMe && myClaimShare && (
                        <div className={`flex items-center justify-end gap-1 mt-1 text-primary text-sm ${isAnimating ? 'animate-claim-check' : ''}`}>
                          <Check className="h-4 w-4" />
                          <span>
                            {item.quantity > 1
                              ? `${myClaimShare}× = ${formatCurrency(myPortion)}`
                              : 'Yours'
                            }
                          </span>
                        </div>
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
                <span>
                  {formatCurrency(bill.subtotal + bill.tax + bill.tip_amount)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* All items claimed celebration */}
        {allItemsClaimed && (
          <Card className="mb-6 shadow-sm bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
            <CardContent className="py-6 text-center">
              <Sparkles className="h-8 w-8 text-primary mx-auto mb-2" />
              <h3 className="font-semibold text-lg">All items claimed!</h3>
              <p className="text-muted-foreground text-sm">Everyone&apos;s share is calculated below.</p>
            </CardContent>
          </Card>
        )}

        {/* Split Summary */}
        {splits.length > 0 && (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Who owes what</CardTitle>
              <CardDescription>
                Tax and tip are split based on what each person ordered.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {splits.map((split) => (
                <div
                  key={split.participant.id}
                  className={`p-4 rounded-xl transition-smooth ${
                    split.participant.id === currentParticipant?.id
                      ? 'bg-primary/10 ring-2 ring-primary/30'
                      : 'bg-muted/50'
                  }`}
                >
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-3">
                      <AvatarInitials name={split.participant.name} size="md" />
                      <span className="font-medium">
                        {split.participant.name}
                        {split.participant.id === currentParticipant?.id && ' (you)'}
                      </span>
                    </div>
                    <span className="text-2xl font-bold text-primary">
                      {formatCurrency(split.total)}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1 pl-11">
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
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Fixed bottom bar for current user */}
        {currentParticipant && myShare && (
          <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t shadow-lg z-40">
            <div className="container mx-auto max-w-2xl p-4">
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-sm text-muted-foreground">Your total</div>
                  <div className="text-3xl font-bold text-primary">{formatCurrency(myShare.total)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">
                    {myShare.items.length} item{myShare.items.length !== 1 && 's'}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    + {formatCurrency(myShare.taxShare + myShare.tipShare)} tax & tip
                  </div>
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

      </div>
    </main>
  );
}
