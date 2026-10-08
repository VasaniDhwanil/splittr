'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Receipt, Loader2, X, Eye, EyeOff, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { LIT_FIELD } from '@/components/create/field';
import { Label } from '@/components/ui/label';
import { Bill, Participant } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { billTotal } from '@/lib/calculations';
import { toast } from 'sonner';
import { GroupCard } from '@/components/groups/group-card';
import { EmptyMark } from '@/components/groups/empty-mark';
import { GroupDialog } from '@/components/groups/group-dialog';
import { BillRow } from '@/components/groups/bill-row';
import { SiteNav } from '@/components/landing/site-nav';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { WhySplittr } from '@/components/landing/why-splittr';
import { GroupsStatement } from '@/components/landing/groups-statement';
import { ClosingCta } from '@/components/landing/closing-cta';
import { SiteFooter } from '@/components/landing/site-footer';

interface StoredBill {
  id: string;
  name: string;
  short_code: string;
  created_at: string;
  role: 'creator' | 'participant';
  // Only present on bills from /api/bills/mine (account bills), so a bill that
  // is not in this browser's localStorage can still show its status and total.
  status?: Bill['status'];
  subtotal?: number;
  tax?: number;
  tip_amount?: number;
}

type MineBillRow = Pick<Bill, 'id' | 'name' | 'short_code' | 'status' | 'subtotal' | 'tax' | 'tip_amount' | 'created_at'>;

function storedBillTotal(bill: StoredBill): number | undefined {
  if (bill.subtotal === undefined) return undefined;
  return bill.subtotal + (bill.tax ?? 0) + (bill.tip_amount ?? 0);
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
  member_count?: number;
}


/** Quiet placeholder rows in the bill list's shape. */
function BillListSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div
      className="surface animate-pulse divide-y divide-white/[0.06] overflow-hidden rounded-2xl"
      aria-busy="true"
      aria-label="Loading bills"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-40 max-w-full rounded-md bg-white/[0.05]" />
            <div className="h-3 w-24 rounded-md bg-white/[0.04]" />
          </div>
          <div className="h-5 w-16 rounded-md bg-white/[0.05]" />
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [myBills, setMyBills] = useState<StoredBill[]>([]);
  const [billDetails, setBillDetails] = useState<Record<string, BillWithParticipants>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [hiddenBillIds, setHiddenBillIds] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  // Auth state
  const [user, setUser] = useState<{ email: string; id: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [serverBills, setServerBills] = useState<StoredBill[]>([]);
  const [showClaimPrompt, setShowClaimPrompt] = useState(false);
  const [claimableBills, setClaimableBills] = useState<StoredBill[]>([]);
  const [isClaiming, setIsClaiming] = useState(false);

  // Groups
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  // Safety net: if the user started joining a group but the sign-in flow
  // dropped them here instead (lost ?next=), send them back to finish it.
  useEffect(() => {
    const code = localStorage.getItem('splittr-pending-invite');
    if (!code) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        window.location.href = `/groups/join?code=${encodeURIComponent(code)}`;
      }
    });
  }, []);

  const fetchGroups = async () => {
    const res = await fetch('/api/groups');
    if (res.ok) {
      setGroups(await res.json());
    }
  };

  const fetchServerBills = async () => {
    const res = await fetch('/api/bills/mine');
    if (res.ok) {
      const serverData: MineBillRow[] = await res.json();
      setServerBills(
        serverData.map((b) => ({
          id: b.id,
          name: b.name,
          short_code: b.short_code,
          created_at: b.created_at,
          role: 'creator' as const,
          status: b.status,
          subtotal: b.subtotal,
          tax: b.tax,
          tip_amount: b.tip_amount,
        }))
      );
    }
  };

  useEffect(() => {
    const loadBills = async () => {
      // Start the auth check right away so the page can pick between the
      // landing and the dashboard without waiting on bill details.
      const supabase = createClient();
      const authPromise = supabase.auth.getUser();

      // Load bills from localStorage
      const stored = localStorage.getItem('splittr-my-bills');
      let bills: StoredBill[] = [];
      let detailsPromise: Promise<({ id: string; data: BillWithParticipants } | null)[]> = Promise.resolve([]);
      if (stored) {
        try {
          bills = JSON.parse(stored);
          setMyBills(bills);

          // Fetch details for all bills in parallel
          detailsPromise = Promise.all(
            bills.map(async (bill) => {
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
            })
          );
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
      const { data: { user: authUser } } = await authPromise;
      if (authUser) {
        setUser({ id: authUser.id, email: authUser.email || '' });
      }
      setAuthChecked(true);

      if (authUser) {
        fetchGroups();

        // Fetch server-side bills
        await fetchServerBills();

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

      const results = await detailsPromise;
      const details: Record<string, BillWithParticipants> = {};
      results.forEach(result => {
        if (result) details[result.id] = result.data;
      });
      setBillDetails(details);

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
        body: JSON.stringify({ name: newGroupName }),
      });
      if (!res.ok) throw new Error('Failed to create group');
      setShowCreateGroup(false);
      setNewGroupName('');
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

  const billList = (
    <>
      {displayedBills.length > 0 && (
        <div className="surface divide-y divide-white/[0.06] overflow-hidden rounded-2xl">
          {displayedBills.map((bill, i) => {
            const details = billDetails[bill.id];
            const status = details?.status ?? bill.status;
            const isHidden = hiddenBillIds.has(bill.id);
            return (
              <BillRow
                key={bill.id}
                index={i}
                id={bill.id}
                name={bill.name}
                createdAt={bill.created_at}
                status={status !== 'draft' ? status : undefined}
                peopleCount={details ? details.participants?.length || 0 : undefined}
                total={details ? billTotal(details) : storedBillTotal(bill)}
                role={bill.role === 'creator' ? 'Host' : 'Joined'}
                archived={isHidden}
                action={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-white/40 hover:text-white hover:bg-white/[0.06]"
                    onClick={(e) => (isHidden ? handleUnhideBill(e, bill.id) : handleHideBill(e, bill.id))}
                    title={isHidden ? 'Restore bill' : 'Archive bill'}
                    aria-label={isHidden ? 'Restore bill' : 'Archive bill'}
                  >
                    {isHidden ? <Eye /> : <X />}
                  </Button>
                }
              />
            );
          })}
        </div>
      )}

      {/* Empty state when all bills are hidden */}
      {visibleBills.length === 0 && hiddenBills.length > 0 && !showHidden && (
        <div className="surface flex flex-col items-center rounded-2xl px-4 py-8 text-center text-white/40">
          <EmptyMark />
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

      {/* Show hidden toggle */}
      {hiddenBills.length > 0 && (
        <div className="mt-3 -ml-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHidden(!showHidden)}
            className="text-white/50 hover:text-white hover:bg-white/[0.06]"
          >
            {showHidden ? <EyeOff /> : <Eye />}
            {showHidden ? 'Hide' : 'Show'} {hiddenBills.length} archived bill{hiddenBills.length > 1 ? 's' : ''}
          </Button>
        </div>
      )}
    </>
  );

  return (
    <main className="relative min-h-dvh">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <SiteNav user={authChecked ? user : undefined} onSignOut={handleSignOut} />

        {!authChecked ? (
          <div className="max-w-3xl pt-12 pb-24">
            <BillListSkeleton rows={3} />
          </div>
        ) : user ? (
          /* Signed-in: a dashboard, not a landing */
          <div className="max-w-3xl pt-10 pb-24 sm:pt-14">
            <section className="animate-slide-up">
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">Your Bills</h1>
                <div className="flex shrink-0 gap-2">
                  <Button asChild>
                    <Link href="/create">Split a Bill</Link>
                  </Button>
                  <Button
                    asChild
                    variant="ghost"
                    className="border border-white/10 text-white hover:bg-white/[0.06] hover:text-white"
                  >
                    <Link href="/join">Join a Bill</Link>
                  </Button>
                </div>
              </div>

              {isLoading ? (
                <BillListSkeleton />
              ) : allBills.length > 0 ? (
                billList
              ) : (
                <div className="surface rounded-2xl px-5 py-8 text-sm text-white/45">
                  <EmptyMark />
                  No bills yet. Split one after your next dinner and it will show up here.
                </div>
              )}
            </section>

            <section className="mt-16 border-t border-white/10 pt-10 animate-slide-up">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold tracking-tight text-white">Your Groups</h2>
                  <p className="mt-1 text-sm text-white/40">
                    Keep recurring bills together for roommates, trips and events.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreateGroup(true)}
                  className="-mr-2 shrink-0 text-white/60 hover:text-white hover:bg-white/[0.06]"
                >
                  <Plus />
                  New group
                </Button>
              </div>
              {groups.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {groups.map((group, i) => (
                    <GroupCard
                      key={group.id}
                      index={i}
                      id={group.id}
                      name={group.name}
                      memberCount={group.member_count}
                      billCount={group.bill_count}
                      totalAmount={group.total_amount}
                      activeCount={group.active_count}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* Signed-out: the landing */
          <>
            <Hero />

            {/* Bills saved on this device */}
            {(isLoading ? myBills.length > 0 : allBills.length > 0) && (
              <section className="max-w-2xl pb-24 animate-slide-up">
                <h2 className="mb-5 text-xl font-semibold tracking-tight text-white">Your Bills</h2>
                {isLoading ? <BillListSkeleton rows={Math.min(myBills.length, 3)} /> : billList}
              </section>
            )}

            <HowItWorks />
            <WhySplittr />
            <GroupsStatement />
            <ClosingCta />
          </>
        )}

        {authChecked && <SiteFooter signedIn={!!user} />}
      </div>

      {/* Create group dialog */}
      <GroupDialog
        open={showCreateGroup}
        onOpenChange={setShowCreateGroup}
        title="New group"
        description="Group bills for roommates, a trip, or anything recurring."
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="newGroupName" className="text-sm font-medium text-white/70">Name</Label>
            <Input
              id="newGroupName"
              placeholder="e.g., Lake house trip"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
              className={LIT_FIELD}
            />
          </div>
          <Button onClick={handleCreateGroup} disabled={isCreatingGroup} className="w-full">
            {isCreatingGroup ? (
              <>
                <Loader2 className="animate-spin" />
                Creating...
              </>
            ) : (
              'Create group'
            )}
          </Button>
        </div>
      </GroupDialog>

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
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.035] border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
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
