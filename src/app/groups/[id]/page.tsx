'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Loader2,
  Pencil,
  Trash2,
  ChevronRight,
  CheckCircle2,
  Clock,
  Receipt,
  Plus,
  UserPlus,
  Copy,
  Mail,
  LogOut,
  Lock,
  ExternalLink,
  Scale,
  Users,
} from 'lucide-react';
import { formatCurrency, billTotal } from '@/lib/calculations';
import { computeGroupLedger, netBalancesFor, NetBalance } from '@/lib/balances';
import type { BillDetail } from '@/lib/balances';
import { getPaymentOptions } from '@/lib/payment-links';
import { Group, GroupMember, BillWithParticipants } from '@/types';
import { AvatarInitials, getPersonHex } from '@/components/avatar-initials';

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
    toast.success('Invite link copied — send it to your people!');
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
        toast.error(`Couldn't send to ${failed.map((f) => f.email).join(', ')} — ${failed[0].reason}`);
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
      toast.success('Group deleted — its bills are kept');
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
        <div className="container mx-auto px-4 max-w-2xl flex flex-col justify-center items-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Loading group...</p>
        </div>
      </main>
    );
  }

  if (unauthorized || !group) {
    return (
      <main className="min-h-dvh py-8">
        <div className="container mx-auto px-4 max-w-2xl">
          <Card className="shadow-lg">
            <CardContent className="py-12 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock className="h-6 w-6 text-white/50" />
              </div>
              <h2 className="text-xl font-semibold mb-2">
                {unauthorized ? 'Sign in required' : 'Group not found'}
              </h2>
              <p className="text-muted-foreground mb-6">
                {unauthorized
                  ? 'Groups are tied to your account. Sign in to view this group.'
                  : "This group doesn't exist or you're not a member."}
              </p>
              <Link href={unauthorized ? '/signin' : '/'}>
                <Button size="lg">{unauthorized ? 'Sign in' : 'Back to Home'}</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const totalSpend = group.bills.reduce((sum, b) => sum + billTotal(b), 0);
  const activeBills = group.bills.filter((b) => b.status === 'active');
  const iOwe = myBalances.filter((b) => b.amount > 0);
  const owedToMe = myBalances.filter((b) => b.amount < 0);

  return (
    <main className="min-h-dvh py-8">
      <div className="container mx-auto px-4 max-w-2xl">
        <Link href="/" className="inline-flex items-center text-white/40 hover:text-white mb-6 transition-smooth">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Home
        </Link>

        {/* Group Header */}
        <Card className="mb-6 shadow-sm">
          <CardContent className="py-5">
            <div className="flex justify-between items-start gap-3 flex-wrap">
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                                    {group.name}
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                  {group.members.length} member{group.members.length !== 1 && 's'} ·{' '}
                  {group.bills.length} bill{group.bills.length !== 1 && 's'} ·{' '}
                  {formatCurrency(totalSpend)} total
                  {activeBills.length > 0 && ` · ${activeBills.length} active`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="transition-smooth hover:scale-105"
                  title="Copy invite link"
                  onClick={handleCopyInvite}
                >
                  <UserPlus className="h-4 w-4" />
                </Button>
                {group.is_owner && (
                  <>
                    <Button
                      variant="outline"
                      size="icon"
                      className="transition-smooth hover:scale-105"
                      title="Edit group"
                      onClick={() => {
                        setRenameValue(group.name);
                                        setShowRenameDialog(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="transition-smooth hover:scale-105 text-destructive/70 hover:text-destructive"
                      title="Delete group"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
                {!group.is_owner && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="transition-smooth hover:scale-105 text-destructive/70 hover:text-destructive"
                    title="Leave group"
                    onClick={() => setShowLeaveDialog(true)}
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" className="mt-4 w-full" onClick={handleCopyInvite}>
              <Copy className="h-4 w-4 mr-2" />
              Copy invite link
            </Button>
            <form onSubmit={handleEmailInvite} className="mt-2 flex gap-2">
              <Input
                type="text"
                inputMode="email"
                autoComplete="off"
                placeholder="Invite by email — commas for several"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="h-9"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={isInviting || !inviteEmail.trim()}
                className="shrink-0"
              >
                {isInviting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    Send
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Your balances — the Splitwise view */}
        {myBalances.length > 0 && (
          <Card className="mb-6 shadow-sm border-primary/20">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" />
                Your balances
              </CardTitle>
              <CardDescription>
                Netted across every bill in this group. Settling clears the whole balance
                between you and that person.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[...iOwe, ...owedToMe].map((balance) => {
                const person = balance.counterparty;
                const member = group.members.find((m) => m.user_id === person.user_id);
                const payOptions =
                  balance.amount > 0 && member?.profile
                    ? getPaymentOptions(member.profile, balance.amount, `Splittr: ${group.name}`)
                    : [];
                return (
                  <div key={person.key} className="p-4 rounded-xl bg-muted/50 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <AvatarInitials name={person.name} size="md" />
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {balance.amount > 0 ? (
                              <>You owe {person.name}</>
                            ) : (
                              <>{person.name} owes you</>
                            )}
                          </div>
                          {!person.user_id && (
                            <div className="text-xs text-muted-foreground">
                              guest — matched by name
                            </div>
                          )}
                        </div>
                      </div>
                      <span
                        className="text-xl font-money shrink-0"
                        style={{ color: balance.amount > 0 ? '#fbbf24' : '#4ade80' }}
                      >
                        {formatCurrency(Math.abs(balance.amount))}
                      </span>
                    </div>

                    {payOptions.length > 0 && (
                      <div className="grid gap-2">
                        {payOptions.map((option) => (
                          <a
                            key={option.key}
                            href={option.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-smooth text-sm"
                          >
                            <span className="flex items-center gap-2">
                              <span
                                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                style={{ backgroundColor: option.color }}
                              >
                                {option.label[0]}
                              </span>
                              <span className="font-medium">{option.label}</span>
                              <span className="text-muted-foreground">{option.handle}</span>
                            </span>
                            <span className="flex items-center gap-1.5 font-semibold text-primary">
                              {formatCurrency(balance.amount)}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </span>
                          </a>
                        ))}
                      </div>
                    )}
                    {balance.amount > 0 && payOptions.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        {person.name} hasn&apos;t set payment handles on their profile — pay them
                        however you usually do, then settle up.
                      </p>
                    )}

                    <Button
                      variant={balance.amount > 0 ? 'default' : 'outline'}
                      size="sm"
                      className="w-full"
                      disabled={settlingKey === person.key}
                      onClick={() => handleSettle(balance)}
                    >
                      {settlingKey === person.key ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                      )}
                      {balance.amount > 0 ? "I've paid — settle up" : 'Mark as settled'}
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Group standings — who's owed, who owes */}
        {standings.length > 0 && (
          <Card className="mb-6 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Group standings</CardTitle>
              <CardDescription>People owed money are on top.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {standings.map((person) => (
                <div
                  key={`${person.user_id ?? person.name}`}
                  className="flex items-center justify-between p-3 rounded-xl bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <AvatarInitials name={person.name} size="sm" />
                    <span className="font-medium text-sm">{person.name}</span>
                  </div>
                  {person.net < 0 ? (
                    <span className="text-sm font-money text-green-400">
                      gets back {formatCurrency(-person.net)}
                    </span>
                  ) : (
                    <span className="text-sm font-money text-amber-400">
                      owes {formatCurrency(person.net)}
                    </span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {myBalances.length === 0 && group.bills.length > 0 && (
          <Card className="mb-6 shadow-sm">
            <CardContent className="py-6 text-center text-muted-foreground text-sm">
              <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-green-400" />
              You&apos;re all settled up in this group.
            </CardContent>
          </Card>
        )}

        {/* Members */}
        <Card className="mb-6 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex justify-between items-center">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Members ({group.members.length})
              </CardTitle>
              <Button size="sm" variant="outline" onClick={handleCopyInvite}>
                <UserPlus className="h-4 w-4 mr-1.5" />
                Invite
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {group.members.map((member) => {
                const hex = getPersonHex(member.display_name);
                const hasPay = Boolean(
                  member.profile?.venmo_handle ||
                    member.profile?.cashapp_handle ||
                    member.profile?.paypal_handle
                );
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-full"
                    style={{ backgroundColor: `${hex}1f` }}
                    title={hasPay ? 'Payment handles configured' : 'No payment handles yet'}
                  >
                    <AvatarInitials name={member.display_name} size="sm" />
                    <span className="text-sm font-medium">
                      {member.display_name}
                      {member.user_id === group.me && ' (you)'}
                      {member.role === 'owner' && ' ✨'}
                    </span>
                    {hasPay && <Receipt className="h-3 w-3 text-green-400" />}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Bills */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Bills in this group</h2>
          <Link href="/create">
            <Button size="sm" variant="outline">
              <Plus className="h-4 w-4 mr-1" />
              New bill
            </Button>
          </Link>
        </div>

        {group.bills.length === 0 ? (
          <Card className="shadow-sm">
            <CardContent className="py-10 text-center text-muted-foreground">
              <Receipt className="h-8 w-8 mx-auto mb-3 text-white/20" />
              <p className="mb-1">No bills yet.</p>
              <p className="text-sm">Create a bill and pick this group in the details step.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {group.bills.map((bill) => (
              <Link key={bill.id} href={`/bill/${bill.id}`}>
                <Card className="bg-white/5 border-white/10 backdrop-blur-sm hover:bg-white/10 transition-smooth cursor-pointer shadow-sm hover:shadow-md">
                  <CardContent className="py-4">
                    <div className="flex justify-between items-center">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-white">{bill.name}</h3>
                          {bill.status === 'settled' ? (
                            <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/20">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Settled
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/20">
                              <Clock className="h-3 w-3 mr-1" />
                              Active
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-white/40 mt-1">
                          Code: <span className="font-mono">{bill.short_code}</span>
                          <span className="ml-3">
                            {bill.participants?.length || 0} people · {formatCurrency(billTotal(bill))}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-white/30" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {/* Rename Dialog */}
        <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit group</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="groupName">Name</Label>
                <Input
                  id="groupName"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                />
              </div>
              <Button className="w-full" onClick={handleRename} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete this group?</DialogTitle>
              <DialogDescription>
                The bills inside stay — they just won&apos;t be grouped anymore.
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
              <Button variant="destructive" className="flex-1" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Delete group
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Leave Dialog */}
        <Dialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Leave this group?</DialogTitle>
              <DialogDescription>
                {myBalances.length > 0
                  ? 'You still have unsettled balances here — consider settling up first. Your bill history stays either way.'
                  : 'You can rejoin later with an invite link. Your bill history stays.'}
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowLeaveDialog(false)}
                disabled={isLeaving}
              >
                Cancel
              </Button>
              <Button variant="destructive" className="flex-1" onClick={handleLeave} disabled={isLeaving}>
                {isLeaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Leave group
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
