'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowLeft, Check, Loader2, Plus } from 'lucide-react';
import { formatCurrency, billTotal } from '@/lib/calculations';
import { computeGroupLedger, netBalancesFor, NetBalance } from '@/lib/balances';
import type { BillDetail } from '@/lib/balances';
import { getPaymentOptions, billHasPaymentMethods, getZelleInfo } from '@/lib/payment-links';
import { Group, GroupMember, BillWithParticipants } from '@/types';
import { Reveal } from '@/components/groups/reveal';
import { Section } from '@/components/groups/section';
import { GroupHeader } from '@/components/groups/group-header';
import { InviteDialog } from '@/components/groups/invite-dialog';
import { GroupDialog, ConfirmDialog } from '@/components/groups/group-dialog';
import { BalanceRow } from '@/components/groups/balance-row';
import { StandingsList } from '@/components/groups/standings-list';
import { MemberList } from '@/components/groups/member-list';
import { BillRow } from '@/components/groups/bill-row';
import { GroupSkeleton } from '@/components/groups/group-skeleton';
import { EmptyMark } from '@/components/groups/empty-mark';
import { LIT_FIELD } from '@/components/create/field';


interface GroupDetail extends Group {
  is_owner: boolean;
  me: string;
  members: GroupMember[];
  bills: BillWithParticipants[];
}

export default function GroupPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.id as string;

  const [isLoading, setIsLoading] = useState(true);
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [myBalances, setMyBalances] = useState<NetBalance[]>([]);
  const [standings, setStandings] = useState<{ name: string; user_id: string | null; net: number }[]>([]);

  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [settlingKey, setSettlingKey] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  const fetchGroup = useCallback(async () => {
    try {
      const response = await fetch(`/api/groups/${groupId}`);
      if (response.status === 401) {
        setUnauthorized(true);
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch group');
      const data: GroupDetail = await response.json();
      setGroup(data);

      // Pull full bill details to compute the pairwise ledger
      const details = (
        await Promise.all(
          data.bills.map(async (bill) => {
            const res = await fetch(`/api/bills/${bill.id}`);
            return res.ok ? ((await res.json()) as BillDetail) : null;
          })
        )
      ).filter(Boolean) as BillDetail[];

      const ledger = computeGroupLedger(details, data.members);
      setMyBalances(netBalancesFor(ledger, `u:${data.me}`));

      // Overall standings: everyone's net position (owed money on top)
      const nets = new Map<string, { name: string; user_id: string | null; net: number }>();
      for (const [fromKey, row] of ledger.debts) {
        for (const [toKey, amount] of row) {
          const from = ledger.people.get(fromKey)!;
          const to = ledger.people.get(toKey)!;
          const f = nets.get(fromKey) ?? { name: from.name, user_id: from.user_id, net: 0 };
          f.net += amount; // owes
          nets.set(fromKey, f);
          const t = nets.get(toKey) ?? { name: to.name, user_id: to.user_id, net: 0 };
          t.net -= amount; // is owed
          nets.set(toKey, t);
        }
      }
      setStandings(
        [...nets.values()]
          .filter((n) => Math.abs(n.net) >= 0.01)
          .sort((a, b) => a.net - b.net) // most-owed (negative) first
      );
    } catch (error) {
      console.error('Error fetching group:', error);
      toast.error('Failed to load group');
    } finally {
      setIsLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchGroup();
  }, [fetchGroup]);

  const handleCopyInvite = () => {
    if (!group?.invite_code) return;
    const url = `${window.location.origin}/groups/join?code=${group.invite_code}`;
    navigator.clipboard.writeText(url);
    toast.success('Invite link copied. Send it to your people!');
  };

  const handleEmailInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    // Accept one or more addresses, separated by commas, spaces, or semicolons
    const emails = Array.from(
      new Set(
        inviteEmail
          .split(/[\s,;]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      )
    );
    if (!emails.length || isInviting) return;
    setIsInviting(true);
    try {
      const failed: { email: string; reason: string }[] = [];
      for (const email of emails) {
        try {
          const res = await fetch(`/api/groups/${groupId}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) failed.push({ email, reason: data.error || 'send failed' });
        } catch {
          failed.push({ email, reason: 'network error' });
        }
      }
      const sent = emails.length - failed.length;
      if (sent > 0) {
        toast.success(sent === 1 ? 'Invite sent!' : `Invites sent to ${sent} people`);
      }
      if (failed.length > 0) {
        // Keep the failed addresses in the input so they're easy to retry
        setInviteEmail(failed.map((f) => f.email).join(', '));
        toast.error(`Couldn't send to ${failed.map((f) => f.email).join(', ')}: ${failed[0].reason}`);
      } else {
        setInviteEmail('');
      }
    } finally {
      setIsInviting(false);
    }
  };

  const handleSettle = async (balance: NetBalance) => {
    setSettlingKey(balance.counterparty.key);
    try {
      const res = await fetch(`/api/groups/${groupId}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          balance.counterparty.user_id
            ? { counterparty_user_id: balance.counterparty.user_id }
            : { counterparty_name: balance.counterparty.name }
        ),
      });
      if (!res.ok) throw new Error('Failed to settle');
      toast.success(`Settled up with ${balance.counterparty.name}`);
      await fetchGroup();
    } catch {
      toast.error('Failed to settle');
    } finally {
      setSettlingKey(null);
    }
  };

  const handleRename = async () => {
    if (!renameValue.trim()) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue }),
      });
      if (!response.ok) throw new Error('Failed to rename group');
      setShowRenameDialog(false);
      toast.success('Group updated');
      await fetchGroup();
    } catch {
      toast.error('Failed to update group');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/groups/${groupId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete group');
      toast.success('Group deleted. Its bills are kept.');
      router.push('/');
    } catch {
      toast.error('Failed to delete group');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLeave = async () => {
    setIsLeaving(true);
    try {
      const response = await fetch(`/api/groups/${groupId}/leave`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error || 'Failed to leave group');
        return;
      }
      toast.success('You left the group');
      router.push('/');
    } catch {
      toast.error('Failed to leave group');
    } finally {
      setIsLeaving(false);
    }
  };

  if (isLoading) {
    return (
      <main className="min-h-dvh py-8">
        <div className="container mx-auto max-w-2xl px-4">
          <div className="mb-8 h-5 w-28 rounded-md bg-white/[0.05] animate-pulse" />
          <GroupSkeleton />
        </div>
      </main>
    );
  }

  if (unauthorized || !group) {
    return (
      <main className="min-h-dvh py-8">
        <div className="container mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center px-4 text-center">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              {unauthorized ? 'Sign in required' : 'Group not found'}
            </h2>
            <p className="mt-2 text-sm text-white/40">
              {unauthorized
                ? 'Groups are tied to your account. Sign in to view this group.'
                : "This group doesn't exist or you're not a member."}
            </p>
            <Button asChild className="mt-8" variant={unauthorized ? 'default' : 'secondary'}>
              <Link href={unauthorized ? '/signin' : '/'}>{unauthorized ? 'Sign in' : 'Back to home'}</Link>
            </Button>
          </Reveal>
        </div>
      </main>
    );
  }

  const totalSpend = group.bills.reduce((sum, b) => sum + billTotal(b), 0);
  const activeBills = group.bills.filter((b) => b.status === 'active');
  const iOwe = myBalances.filter((b) => b.amount > 0);
  const owedToMe = myBalances.filter((b) => b.amount < 0);

  const meta = [
    `${group.members.length} member${group.members.length !== 1 ? 's' : ''}`,
    `${group.bills.length} bill${group.bills.length !== 1 ? 's' : ''}`,
    `${formatCurrency(totalSpend)} total`,
    ...(activeBills.length > 0 ? [`${activeBills.length} active`] : []),
  ];
  const inviteUrl =
    group.invite_code && typeof window !== 'undefined'
      ? `${window.location.origin}/groups/join?code=${group.invite_code}`
      : null;
  const showBalances = myBalances.length > 0 || group.bills.length > 0;

  let sectionIndex = 1;

  return (
    <main className="min-h-dvh py-8">
      <div className="container mx-auto max-w-2xl px-4">
        <Link
          href="/"
          className="mb-8 inline-flex h-11 items-center gap-2 text-sm text-white/40 transition-colors hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Home
        </Link>

        <div className="space-y-10">
          <Reveal index={0}>
            <GroupHeader
              name={group.name}
              meta={meta}
              isOwner={group.is_owner}
              onInvite={() => setShowInviteDialog(true)}
              onEdit={() => {
                setRenameValue(group.name);
                setShowRenameDialog(true);
              }}
              onDelete={() => setShowDeleteDialog(true)}
              onLeave={() => setShowLeaveDialog(true)}
            />
          </Reveal>

          {/* Your balances: netted across every bill in the group */}
          {showBalances && (
            <Section
              index={sectionIndex++}
              title="Balances"
              description={
                myBalances.length > 0
                  ? 'Netted across every bill here. Settling clears the whole balance with that person.'
                  : undefined
              }
            >
              {myBalances.length > 0 ? (
                <div className="surface divide-y divide-white/[0.06] overflow-hidden rounded-2xl">
                  {[...iOwe, ...owedToMe].map((balance) => {
                    const person = balance.counterparty;
                    const member = group.members.find((m) => m.user_id === person.user_id);
                    const payOptions =
                      balance.amount > 0 && member?.profile
                        ? getPaymentOptions(member.profile, balance.amount, `Splittr: ${group.name}`)
                        : [];
                    const zelle = balance.amount > 0 && member?.profile ? getZelleInfo(member.profile) : null;
                    return (
                      <BalanceRow
                        key={person.key}
                        name={person.name}
                        isGuest={!person.user_id}
                        amount={balance.amount}
                        payOptions={payOptions}
                        zelle={zelle}
                        isSettling={settlingKey === person.key}
                        onSettle={() => handleSettle(balance)}
                      />
                    );
                  })}
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-white/50">
                  <Check className="size-4 text-primary" />
                  You&apos;re all settled up in this group.
                </p>
              )}
            </Section>
          )}

          {/* Group standings: who's owed, who owes */}
          {standings.length > 0 && (
            <Section index={sectionIndex++} title="Standings" description="Everyone's position. People owed money first.">
              <StandingsList standings={standings} />
            </Section>
          )}

          <Section index={sectionIndex++} title="Members" count={group.members.length}>
            <MemberList
              members={group.members.map((member) => ({
                id: member.id,
                name: member.display_name,
                isYou: member.user_id === group.me,
                isOwner: member.role === 'owner',
                hasPaymentHandles: Boolean(member.profile && billHasPaymentMethods(member.profile)),
              }))}
            />
          </Section>

          <Section
            index={sectionIndex++}
            title="Bills"
            count={group.bills.length || undefined}
            action={
              <Button asChild variant="ghost" size="sm" className="text-white/60 hover:bg-white/[0.06] hover:text-white">
                <Link href="/create">
                  <Plus />
                  New bill
                </Link>
              </Button>
            }
          >
            {group.bills.length === 0 ? (
              <p className="text-sm leading-relaxed text-white/40">
                <EmptyMark className="mb-3 block" />
                No bills yet. Create a bill and pick this group in the details step.
              </p>
            ) : (
              <div className="surface divide-y divide-white/[0.06] overflow-hidden rounded-2xl">
                {group.bills.map((bill, i) => (
                  <BillRow
                    key={bill.id}
                    index={i}
                    id={bill.id}
                    name={bill.name}
                    status={bill.status}
                    createdAt={bill.created_at}
                    peopleCount={bill.participants?.length || 0}
                    total={billTotal(bill)}
                  />
                ))}
              </div>
            )}
          </Section>
        </div>

        <InviteDialog
          open={showInviteDialog}
          onOpenChange={setShowInviteDialog}
          groupName={group.name}
          inviteUrl={inviteUrl}
          onCopy={handleCopyInvite}
          email={inviteEmail}
          onEmailChange={setInviteEmail}
          onSubmitEmail={handleEmailInvite}
          isSending={isInviting}
        />

        <GroupDialog open={showRenameDialog} onOpenChange={setShowRenameDialog} title="Rename group">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="groupName" className="text-sm font-medium text-white/70">
                Name
              </Label>
              <Input
                id="groupName"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                className={LIT_FIELD}
              />
            </div>
            <Button className="w-full" onClick={handleRename} disabled={isSaving}>
              {isSaving && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
        </GroupDialog>

        <ConfirmDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          title="Delete this group?"
          description="The bills inside stay. They just won't be grouped anymore."
          confirmLabel="Delete group"
          onConfirm={handleDelete}
          isPending={isDeleting}
        />

        <ConfirmDialog
          open={showLeaveDialog}
          onOpenChange={setShowLeaveDialog}
          title="Leave this group?"
          description={
            myBalances.length > 0
              ? 'You still have unsettled balances here. Consider settling up first; your bill history stays either way.'
              : 'You can rejoin later with an invite link. Your bill history stays.'
          }
          confirmLabel="Leave group"
          onConfirm={handleLeave}
          isPending={isLeaving}
        />
      </div>
    </main>
  );
}
