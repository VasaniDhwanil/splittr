'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { ArrowLeft, Copy, Share2, Check, Users, Loader2 } from 'lucide-react';
import { formatCurrency, calculateSplits } from '@/lib/calculations';
import { Bill, BillItem, Participant, ItemClaim, ParticipantSplit } from '@/types';
import { createClient } from '@/lib/supabase/client';

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

  // For split dialog
  const [splitDialogItem, setSplitDialogItem] = useState<BillItem | null>(null);
  const [showSplitDialog, setShowSplitDialog] = useState(false);

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
    }
  }, [bill, items, participants, claims]);

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
      toast.success(`Joined as ${participant.name}`);
      await fetchBill();
    } catch (error) {
      console.error('Error joining:', error);
      toast.error('Failed to join bill');
    } finally {
      setIsJoining(false);
    }
  };

  const handleItemClick = (item: BillItem) => {
    if (!currentParticipant) {
      setShowJoinDialog(true);
      return;
    }

    const existingClaim = claims.find(
      (c) => c.participant_id === currentParticipant.id && c.item_id === item.id
    );

    if (existingClaim) {
      // If already claimed, unclaim it
      handleUnclaimItem(item.id);
    } else {
      // Show split dialog
      setSplitDialogItem(item);
      setShowSplitDialog(true);
    }
  };

  const handleClaimItem = async (itemId: string, share: number) => {
    if (!currentParticipant) return;

    try {
      await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: currentParticipant.id,
          item_id: itemId,
          share,
        }),
      });

      const shareText = share === 1 ? 'full item' : `${Math.round(share * 100)}%`;
      toast.success(`Claimed ${shareText}`);
      setShowSplitDialog(false);
      setSplitDialogItem(null);
      await fetchBill();
    } catch (error) {
      console.error('Error claiming item:', error);
      toast.error('Failed to claim item');
    }
  };

  const handleUnclaimItem = async (itemId: string) => {
    if (!currentParticipant) return;

    try {
      await fetch(`/api/claims?participant_id=${currentParticipant.id}&item_id=${itemId}`, {
        method: 'DELETE',
      });
      toast.success('Item unclaimed');
      await fetchBill();
    } catch (error) {
      console.error('Error unclaiming item:', error);
      toast.error('Failed to unclaim item');
    }
  };

  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success('Link copied!');
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

  const getItemClaims = (itemId: string) => {
    return claims.filter((c) => c.item_id === itemId);
  };

  const isItemClaimedByMe = (itemId: string) => {
    if (!currentParticipant) return false;
    return claims.some(
      (c) => c.participant_id === currentParticipant.id && c.item_id === itemId
    );
  };

  const getMyClaimShare = (itemId: string): number | null => {
    if (!currentParticipant) return null;
    const claim = claims.find(
      (c) => c.participant_id === currentParticipant.id && c.item_id === itemId
    );
    return claim ? claim.share : null;
  };

  const formatShareLabel = (share: number): string => {
    if (share === 1) return 'Full';
    if (share === 0.5) return '1/2';
    if (share >= 0.33 && share <= 0.34) return '1/3';
    if (share === 0.25) return '1/4';
    if (share === 0.2) return '1/5';
    return `${Math.round(share * 100)}%`;
  };

  if (isLoading) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-background to-muted py-8">
        <div className="container mx-auto px-4 max-w-2xl flex justify-center items-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </main>
    );
  }

  if (!bill) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-background to-muted py-8">
        <div className="container mx-auto px-4 max-w-2xl">
          <Card>
            <CardContent className="py-8 text-center">
              <h2 className="text-xl font-semibold mb-2">Bill Not Found</h2>
              <p className="text-muted-foreground mb-4">
                This bill doesn&apos;t exist or has been deleted.
              </p>
              <Link href="/">
                <Button>Go Home</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const myShare = splits.find((s) => s.participant.id === currentParticipant?.id);

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted py-8 pb-32">
      <div className="container mx-auto px-4 max-w-2xl">
        <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Home
        </Link>

        {/* Bill Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold">{bill.name}</h1>
            <p className="text-muted-foreground">Code: {bill.short_code}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={handleCopyLink}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="icon" onClick={handleShare}>
              <Share2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Participants */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex justify-between items-center">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                Participants ({participants.length})
              </CardTitle>
              {!currentParticipant && (
                <Dialog open={showJoinDialog} onOpenChange={setShowJoinDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm">Join Bill</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Join this Bill</DialogTitle>
                      <DialogDescription>
                        Enter your name to join and start claiming items.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="joinName">Your Name</Label>
                        <Input
                          id="joinName"
                          placeholder="Enter your name"
                          value={joinName}
                          onChange={(e) => setJoinName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                        />
                      </div>
                      <Button onClick={handleJoin} className="w-full" disabled={isJoining}>
                        {isJoining ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Joining...
                          </>
                        ) : (
                          'Join'
                        )}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {participants.map((p) => (
                <Badge
                  key={p.id}
                  variant={p.id === currentParticipant?.id ? 'default' : 'secondary'}
                >
                  {p.name}
                  {p.is_creator && ' (host)'}
                  {p.id === currentParticipant?.id && ' (you)'}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Items */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Items</CardTitle>
            <CardDescription>
              {currentParticipant
                ? 'Tap items you ordered. Tap again to unclaim.'
                : 'Join the bill to claim items.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item) => {
              const itemClaims = getItemClaims(item.id);
              const claimedByMe = isItemClaimedByMe(item.id);
              const myShare = getMyClaimShare(item.id);
              const claimersWithShares = itemClaims
                .map((c) => {
                  const p = participants.find((p) => p.id === c.participant_id);
                  return p ? { name: p.name, share: c.share, isMe: p.id === currentParticipant?.id } : null;
                })
                .filter(Boolean) as { name: string; share: number; isMe: boolean }[];

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                    claimedByMe
                      ? 'bg-primary/10 border-primary'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => handleItemClick(item)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-medium">
                        {item.quantity > 1 && `${item.quantity}x `}
                        {item.name}
                      </div>
                      {claimersWithShares.length > 0 && (
                        <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-1">
                          {claimersWithShares.map((c, i) => (
                            <Badge key={i} variant={c.isMe ? 'default' : 'secondary'} className="text-xs">
                              {c.name}: {formatShareLabel(c.share)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-medium">
                        {formatCurrency(item.price * item.quantity)}
                      </div>
                      {claimedByMe && myShare && (
                        <Badge variant="outline" className="mt-1">
                          <Check className="h-3 w-3 mr-1" />
                          {formatShareLabel(myShare)}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            <Separator className="my-4" />

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatCurrency(bill.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span>{formatCurrency(bill.tax)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tip ({bill.tip_percent}%)</span>
                <span>{formatCurrency(bill.tip_amount)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold">
                <span>Total</span>
                <span>
                  {formatCurrency(bill.subtotal + bill.tax + bill.tip_amount)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Split Summary */}
        {splits.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Split Summary</CardTitle>
              <CardDescription>
                Each person&apos;s share including proportional tax and tip.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {splits.map((split) => (
                <div
                  key={split.participant.id}
                  className={`p-4 rounded-lg border ${
                    split.participant.id === currentParticipant?.id
                      ? 'bg-primary/10 border-primary'
                      : ''
                  }`}
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-medium">
                      {split.participant.name}
                      {split.participant.id === currentParticipant?.id && ' (you)'}
                    </span>
                    <span className="text-xl font-bold">
                      {formatCurrency(split.total)}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <span>Items ({split.items.length})</span>
                      <span>{formatCurrency(split.itemsTotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tax share</span>
                      <span>{formatCurrency(split.taxShare)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tip share</span>
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
          <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4">
            <div className="container mx-auto max-w-2xl flex justify-between items-center">
              <div>
                <div className="text-sm text-muted-foreground">Your share</div>
                <div className="text-2xl font-bold">{formatCurrency(myShare.total)}</div>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                {myShare.items.length} items claimed
              </div>
            </div>
          </div>
        )}

        {/* Split Dialog */}
        <Dialog open={showSplitDialog} onOpenChange={setShowSplitDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Claim Item</DialogTitle>
              <DialogDescription>
                {splitDialogItem && (
                  <>
                    <span className="font-medium text-foreground">{splitDialogItem.name}</span>
                    <span className="text-muted-foreground"> - {formatCurrency(splitDialogItem.price * splitDialogItem.quantity)}</span>
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 pt-4">
              <p className="text-sm text-muted-foreground">How are you splitting this item?</p>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="h-16 flex flex-col"
                  onClick={() => splitDialogItem && handleClaimItem(splitDialogItem.id, 1)}
                >
                  <span className="text-lg font-semibold">Just Me</span>
                  <span className="text-xs text-muted-foreground">100%</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-16 flex flex-col"
                  onClick={() => splitDialogItem && handleClaimItem(splitDialogItem.id, 0.5)}
                >
                  <span className="text-lg font-semibold">Split 2</span>
                  <span className="text-xs text-muted-foreground">50% each</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-16 flex flex-col"
                  onClick={() => splitDialogItem && handleClaimItem(splitDialogItem.id, 0.33)}
                >
                  <span className="text-lg font-semibold">Split 3</span>
                  <span className="text-xs text-muted-foreground">33% each</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-16 flex flex-col"
                  onClick={() => splitDialogItem && handleClaimItem(splitDialogItem.id, 0.25)}
                >
                  <span className="text-lg font-semibold">Split 4</span>
                  <span className="text-xs text-muted-foreground">25% each</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-16 flex flex-col"
                  onClick={() => splitDialogItem && handleClaimItem(splitDialogItem.id, 0.2)}
                >
                  <span className="text-lg font-semibold">Split 5</span>
                  <span className="text-xs text-muted-foreground">20% each</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-16 flex flex-col"
                  onClick={() => splitDialogItem && handleClaimItem(splitDialogItem.id, 0.167)}
                >
                  <span className="text-lg font-semibold">Split 6</span>
                  <span className="text-xs text-muted-foreground">~17% each</span>
                </Button>
              </div>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setShowSplitDialog(false);
                  setSplitDialogItem(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
