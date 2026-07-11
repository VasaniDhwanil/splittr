'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Receipt, Users, Calculator, Share2, ChevronRight, Loader2, Sparkles, X, Eye, EyeOff, CheckCircle2, Clock, Plus, Wallet } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency } from '@/lib/calculations';
import { Bill, Participant } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';


interface StoredBill {
  id: string;
  name: string;
  short_code: string;
  created_at: string;
  role: 'creator' | 'participant';
}

interface BillWithParticipants extends Bill {
  participants?: Participant[];
}

interface GroupSummary {
  id: string;
  name: string;
  emoji: string;
  bill_count: number;
  total_amount: number;
  active_count: number;
}

export default function Home() {
  const [myBills, setMyBills] = useState<StoredBill[]>([]);
  const [billDetails, setBillDetails] = useState<Record<string, BillWithParticipants>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [hiddenBillIds, setHiddenBillIds] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  // Auth state
  const [user, setUser] = useState<{ email: string; id: string } | null>(null);
  const [serverBills, setServerBills] = useState<StoredBill[]>([]);
  const [showClaimPrompt, setShowClaimPrompt] = useState(false);
  const [claimableBills, setClaimableBills] = useState<StoredBill[]>([]);
  const [isClaiming, setIsClaiming] = useState(false);

  // Groups
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupEmoji, setNewGroupEmoji] = useState('👥');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  const fetchGroups = async () => {
    const res = await fetch('/api/groups');
    if (res.ok) {
      setGroups(await res.json());
    }
  };

  const fetchServerBills = async () => {
    const res = await fetch('/api/bills/mine');
    if (res.ok) {
      const serverData = await res.json();
      setServerBills(
        serverData.map((b: { id: string; name: string; short_code: string; created_at: string }) => ({
          id: b.id,
          name: b.name,
          short_code: b.short_code,
          created_at: b.created_at,
          role: 'creator' as const,
        }))
      );
    }
  };

  useEffect(() => {
    const loadBills = async () => {
      // Load bills from localStorage
      const stored = localStorage.getItem('splittr-my-bills');
      let bills: StoredBill[] = [];
      if (stored) {
        try {
          bills = JSON.parse(stored);
          setMyBills(bills);

          // Fetch details for all bills in parallel
          const fetchPromises = bills.map(async (bill) => {
            try {
              const response = await fetch(`/api/bills/${bill.id}`);
              if (response.ok) {
                const data = await response.json();
                return { id: bill.id, data };
              }
            } catch (error) {
              console.error('Error fetching bill:', error);
            }
            return null;
          });

          const results = await Promise.all(fetchPromises);
          const details: Record<string, BillWithParticipants> = {};
          results.forEach(result => {
            if (result) details[result.id] = result.data;
          });
          setBillDetails(details);
        } catch (error) {
          console.error('Error parsing stored bills:', error);
        }
      }

      // Load hidden bills from localStorage
      const hiddenStored = localStorage.getItem('splittr-hidden-bills');
      if (hiddenStored) {
        try {
          const hiddenIds: string[] = JSON.parse(hiddenStored);
          setHiddenBillIds(new Set(hiddenIds));
        } catch (error) {
          console.error('Error parsing hidden bills:', error);
        }
      }

      // Check auth state
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        setUser({ id: authUser.id, email: authUser.email || '' });

        fetchGroups();

        // Fetch server-side bills
        const res = await fetch('/api/bills/mine');
        if (res.ok) {
          const serverData = await res.json();
          setServerBills(
            serverData.map((b: { id: string; name: string; short_code: string; created_at: string }) => ({
              id: b.id,
              name: b.name,
              short_code: b.short_code,
              created_at: b.created_at,
              role: 'creator' as const,
            }))
          );
        }

        // Check if there are unclaimed bills to prompt about
        const alreadyClaimed = JSON.parse(localStorage.getItem('splittr-claimed-bills') || '[]');
        const unclaimed = bills.filter(b =>
          b.role === 'creator' &&
          localStorage.getItem(`splittr-creator-token-${b.id}`) &&
          !alreadyClaimed.includes(b.id)
        );
        if (unclaimed.length > 0) {
          setClaimableBills(unclaimed);
          setShowClaimPrompt(true);
        }
      }

      setIsLoading(false);
    };

    loadBills();
  }, []);

  // Merge local and server bills, deduping by id (server role wins)
  const allBills = useMemo(() => {
    const merged = new Map<string, StoredBill>();
    myBills.forEach(b => merged.set(b.id, b));
    serverBills.forEach(b => merged.set(b.id, b)); // server wins on role
    return Array.from(merged.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [myBills, serverBills]);

  const handleHideBill = (e: React.MouseEvent, billId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const newHiddenIds = new Set(hiddenBillIds);
    newHiddenIds.add(billId);
    setHiddenBillIds(newHiddenIds);
    localStorage.setItem('splittr-hidden-bills', JSON.stringify([...newHiddenIds]));
  };

  const handleUnhideBill = (e: React.MouseEvent, billId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const newHiddenIds = new Set(hiddenBillIds);
    newHiddenIds.delete(billId);
    setHiddenBillIds(newHiddenIds);
    localStorage.setItem('splittr-hidden-bills', JSON.stringify([...newHiddenIds]));
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setServerBills([]);
    setGroups([]);
    toast.success('Signed out');
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      toast.error('Give your group a name');
      return;
    }
    setIsCreatingGroup(true);
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName, emoji: newGroupEmoji }),
      });
      if (!res.ok) throw new Error('Failed to create group');
      setShowCreateGroup(false);
      setNewGroupName('');
      setNewGroupEmoji('👥');
      toast.success('Group created!');
      await fetchGroups();
    } catch {
      toast.error('Failed to create group');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleClaimAll = async () => {
    setIsClaiming(true);
    try {
      const claims = claimableBills.map(b => ({
        bill_id: b.id,
        creator_token: localStorage.getItem(`splittr-creator-token-${b.id}`),
      }));

      const res = await fetch('/api/bills/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claims }),
      });

      if (res.ok) {
        const data = await res.json();
        const alreadyClaimed = JSON.parse(localStorage.getItem('splittr-claimed-bills') || '[]');
        localStorage.setItem(
          'splittr-claimed-bills',
          JSON.stringify([...alreadyClaimed, ...claimableBills.map(b => b.id)])
        );
        await fetchServerBills();
        toast.success(`${data.claimed ?? claimableBills.length} bill${(data.claimed ?? claimableBills.length) !== 1 ? 's' : ''} added to your account`);
      } else {
        toast.error('Failed to add bills. Please try again.');
      }
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsClaiming(false);
      setShowClaimPrompt(false);
    }
  };

  const handleSkipClaim = () => {
    // Mark all as claimed so we don't prompt again
    const alreadyClaimed = JSON.parse(localStorage.getItem('splittr-claimed-bills') || '[]');
    localStorage.setItem(
      'splittr-claimed-bills',
      JSON.stringify([...alreadyClaimed, ...claimableBills.map(b => b.id)])
    );
    setShowClaimPrompt(false);
  };

  // Filter bills based on hidden state
  const visibleBills = allBills.filter(bill => !hiddenBillIds.has(bill.id));
  const hiddenBills = allBills.filter(bill => hiddenBillIds.has(bill.id));
  const displayedBills = showHidden ? allBills : visibleBills;

  return (
    <main className="relative min-h-screen">
      <div className="container mx-auto px-4 py-16">

        {/* Nav */}
        <div className="flex justify-end mb-8">
          {user ? (
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-2 backdrop-blur-sm">
              <Link href="/profile" className="text-sm text-white/60 hover:text-white transition-smooth">
                {user.email}
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="text-white/60 hover:text-white h-9 px-2"
              >
                Sign out
              </Button>
            </div>
          ) : (
            <Link href="/signin">
              <Button
                variant="ghost"
                size="sm"
                className="text-white/60 hover:text-white rounded-full"
              >
                Sign in
              </Button>
            </Link>
          )}
        </div>

        {/* Hero Section */}
        <div className="relative text-center mb-16">
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 bg-white/5 backdrop-blur-sm text-white/60 px-4 py-2 rounded-full text-sm font-medium mb-8 border border-white/10">
              <Sparkles className="h-4 w-4" />
              No app download needed
            </div>
            <h1 className="text-6xl sm:text-7xl md:text-8xl font-bold mb-6 tracking-tight">
              <span className="text-white">Split bills.</span>
              <br />
              <span className="bg-gradient-to-r from-emerald-300 via-green-400 to-lime-300 bg-clip-text text-transparent">
                Effortlessly.
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-white/50 mb-10 max-w-xl mx-auto leading-relaxed font-light">
              Scan your receipt. Share with the group.
              <br className="hidden sm:block" />
              Everyone picks what they ordered.
            </p>
            <div className="flex gap-4 justify-center flex-wrap">
              <Link href="/create">
                <Button size="lg" className="text-lg px-8 bg-white text-black hover:bg-white/90 transition-smooth hover:scale-105 rounded-full">
                  <Receipt className="mr-2 h-5 w-5" />
                  Split a Bill
                </Button>
              </Link>
              <Link href="/join">
                <Button size="lg" variant="outline" className="text-lg px-8 transition-smooth hover:scale-105 rounded-full border-white/20 text-white hover:bg-white/10">
                  <Users className="mr-2 h-5 w-5" />
                  Join a Bill
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* My Bills Section */}
        {!isLoading && allBills.length > 0 && (
          <div className="mb-16 animate-slide-up">
            <h2 className="text-3xl font-semibold text-center mb-6 text-white">Your Bills</h2>

            {/* Show hidden toggle */}
            {hiddenBills.length > 0 && (
              <div className="flex justify-center mb-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowHidden(!showHidden)}
                  className="text-white/40 hover:text-white"
                >
                  {showHidden ? (
                    <>
                      <EyeOff className="h-4 w-4 mr-2" />
                      Hide {hiddenBills.length} archived bill{hiddenBills.length > 1 ? 's' : ''}
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4 mr-2" />
                      Show {hiddenBills.length} archived bill{hiddenBills.length > 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              </div>
            )}

            <div className="grid gap-4 max-w-2xl mx-auto">
              {displayedBills.map((bill) => {
                const details = billDetails[bill.id];
                const isHidden = hiddenBillIds.has(bill.id);
                return (
                  <Link key={bill.id} href={`/bill/${bill.id}`}>
                    <Card className={`bg-white/5 border-white/10 backdrop-blur-sm hover:bg-white/10 transition-smooth cursor-pointer shadow-sm hover:shadow-md group ${isHidden ? 'opacity-60' : ''}`}>
                      <CardContent className="py-4">
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold text-white">{bill.name}</h3>
                              <Badge
                                variant={bill.role === 'creator' ? 'default' : 'secondary'}
                                className={`text-xs ${bill.role === 'creator' ? 'bg-white/10 text-white/80 border-white/20' : 'bg-white/5 text-white/60 border-white/10'}`}
                              >
                                {bill.role === 'creator' ? 'Host' : 'Joined'}
                              </Badge>
                              {details?.status === 'settled' ? (
                                <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/20">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Settled
                                </Badge>
                              ) : details?.status === 'active' ? (
                                <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/20">
                                  <Clock className="h-3 w-3 mr-1" />
                                  Active
                                </Badge>
                              ) : null}
                              {isHidden && (
                                <Badge variant="outline" className="text-xs border-white/20 text-white/40">
                                  Archived
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-white/40 mt-1">
                              Code: <span className="font-mono">{bill.short_code}</span>
                              {details && (
                                <span className="ml-3">
                                  {details.participants?.length || 0} people · {formatCurrency(details.subtotal + details.tax + details.tip_amount)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {isHidden ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-white/40 hover:text-white"
                                onClick={(e) => handleUnhideBill(e, bill.id)}
                                title="Restore bill"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-white/40 hover:text-white"
                                onClick={(e) => handleHideBill(e, bill.id)}
                                title="Archive bill"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
                            <ChevronRight className="h-5 w-5 text-white/30" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>

            {/* Empty state when all bills are hidden */}
            {visibleBills.length === 0 && hiddenBills.length > 0 && !showHidden && (
              <div className="text-center py-8 text-white/40">
                <p>All bills are archived.</p>
                <Button
                  variant="link"
                  onClick={() => setShowHidden(true)}
                  className="text-white/60 hover:text-white"
                >
                  Show archived bills
                </Button>
              </div>
            )}
          </div>
        )}

        {isLoading && allBills.length === 0 && (
          <div className="flex justify-center mb-16">
            <Loader2 className="h-6 w-6 animate-spin text-white/40" />
          </div>
        )}

        {/* Groups Section (signed-in only) */}
        {user && (
          <div className="mb-16 animate-slide-up">
            <h2 className="text-3xl font-semibold text-center mb-2 text-white">Your Groups</h2>
            <p className="text-center text-white/40 text-sm mb-6">
              Roommates, trips, events — keep recurring bills together.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 max-w-2xl mx-auto">
              {groups.map((group) => (
                <Link key={group.id} href={`/groups/${group.id}`}>
                  <Card className="bg-white/5 border-white/10 backdrop-blur-sm hover:bg-white/10 transition-smooth cursor-pointer shadow-sm hover:shadow-md h-full">
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{group.emoji}</span>
                          <div>
                            <h3 className="font-semibold text-white">{group.name}</h3>
                            <p className="text-sm text-white/40">
                              {group.bill_count} bill{group.bill_count !== 1 && 's'}
                              {group.bill_count > 0 && ` · ${formatCurrency(group.total_amount)}`}
                              {group.active_count > 0 && ` · ${group.active_count} active`}
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-white/30" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
              <button
                type="button"
                onClick={() => setShowCreateGroup(true)}
                className="rounded-xl border border-dashed border-white/20 bg-white/5 hover:bg-white/10 transition-smooth p-4 flex items-center justify-center gap-2 text-white/50 hover:text-white min-h-[72px]"
              >
                <Plus className="h-5 w-5" />
                New group
              </button>
            </div>
          </div>
        )}

        {/* How it Works */}
        <div className="mb-16">
          <h2 className="text-3xl font-semibold text-center mb-8 text-white">How <span className="bg-gradient-to-r from-emerald-300 to-green-400 bg-clip-text text-transparent">It Works</span></h2>
          <div className="grid md:grid-cols-4 gap-6">
            <Card className="shadow-sm transition-smooth hover:shadow-md bg-white/5 border-white/10 backdrop-blur-sm">
              <CardHeader>
                <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mb-2">
                  <Receipt className="h-6 w-6 text-green-400" />
                </div>
                <CardTitle className="text-lg text-white">1. Scan Receipt</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Take a photo of your receipt. Our AI extracts all the items automatically.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="shadow-sm transition-smooth hover:shadow-md bg-white/5 border-white/10 backdrop-blur-sm">
              <CardHeader>
                <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mb-2">
                  <Share2 className="h-6 w-6 text-emerald-300" />
                </div>
                <CardTitle className="text-lg text-white">2. Share Link</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Get a shareable link or code. Send it to everyone who was at the table.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="shadow-sm transition-smooth hover:shadow-md bg-white/5 border-white/10 backdrop-blur-sm">
              <CardHeader>
                <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mb-2">
                  <Users className="h-6 w-6 text-lime-300" />
                </div>
                <CardTitle className="text-lg text-white">3. Claim Items</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Everyone taps what they ordered. Shared items split automatically.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="shadow-sm transition-smooth hover:shadow-md bg-white/5 border-white/10 backdrop-blur-sm">
              <CardHeader>
                <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center mb-2">
                  <Calculator className="h-6 w-6 text-green-400" />
                </div>
                <CardTitle className="text-lg text-white">4. See Your Share</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Tax and tip are split fairly. Everyone sees exactly what they owe.
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Features */}
        <div className="text-center">
          <h2 className="text-3xl font-semibold mb-8 text-white">Why <span className="bg-gradient-to-r from-green-400 to-lime-300 bg-clip-text text-transparent">Splittr</span>?</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
              <h3 className="font-semibold mb-2 text-lg text-white">No App Download</h3>
              <p className="text-white/40">
                Works right in the browser. Just share a link.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
              <h3 className="font-semibold mb-2 text-lg text-white">Split Any Way</h3>
              <p className="text-white/40">
                By item, evenly, or custom amounts — tax and tip stay fair.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
              <h3 className="font-semibold mb-2 text-lg text-white flex items-center justify-center gap-2"><Wallet className="h-5 w-5 text-green-400" />Settle Up Fast</h3>
              <p className="text-white/40">
                One-tap Venmo, Cash App, and PayPal links for each share.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
              <h3 className="font-semibold mb-2 text-lg text-white">Real-time Updates</h3>
              <p className="text-white/40">
                See when others claim items or pay up, instantly.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Create group dialog */}
      <Dialog open={showCreateGroup} onOpenChange={setShowCreateGroup}>
        <DialogContent className="sm:max-w-md bg-[#0a0a0a] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">New group</DialogTitle>
            <DialogDescription className="text-white/50">
              Group bills for roommates, a trip, or anything recurring.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-white/70">Emoji</Label>
              <div className="flex flex-wrap gap-2">
                {['👥', '🏠', '✈️', '🎉', '🍕', '⛺', '💼', '🏖️'].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setNewGroupEmoji(emoji)}
                    className={`w-11 h-11 rounded-xl text-xl flex items-center justify-center border transition-smooth ${
                      newGroupEmoji === emoji
                        ? 'border-white/60 bg-white/10'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newGroupName" className="text-white/70">Name</Label>
              <Input
                id="newGroupName"
                placeholder="e.g., Lake house trip"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                className="bg-white/5 border-white/10 text-white"
              />
            </div>
            <Button
              onClick={handleCreateGroup}
              disabled={isCreatingGroup}
              className="w-full bg-white text-black hover:bg-white/90 transition-smooth rounded-full font-medium"
            >
              {isCreatingGroup ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create group'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Claim bills dialog */}
      <Dialog open={showClaimPrompt} onOpenChange={(open) => { if (!open) handleSkipClaim(); }}>
        <DialogContent className="sm:max-w-md bg-[#0a0a0a] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Add bills to your account?</DialogTitle>
            <DialogDescription className="text-white/50">
              We found {claimableBills.length} bill{claimableBills.length !== 1 ? 's' : ''} on this device.
              Add them so you can access them from any device.
            </DialogDescription>
          </DialogHeader>

          {claimableBills.length > 0 && (
            <div className="space-y-2 my-2">
              {claimableBills.map(bill => (
                <div
                  key={bill.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5 border border-white/10"
                >
                  <Receipt className="h-4 w-4 text-white/40 shrink-0" />
                  <span className="text-sm text-white truncate">{bill.name}</span>
                  <span className="ml-auto text-xs font-mono text-white/30 shrink-0">{bill.short_code}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="ghost"
              onClick={handleSkipClaim}
              disabled={isClaiming}
              className="flex-1 text-white/60 hover:text-white hover:bg-white/10 rounded-full border border-white/20"
            >
              Skip
            </Button>
            <Button
              onClick={handleClaimAll}
              disabled={isClaiming}
              className="flex-1 bg-white text-black hover:bg-white/90 transition-smooth rounded-full font-medium"
            >
              {isClaiming ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add all'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
