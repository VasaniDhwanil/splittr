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
} from 'lucide-react';
import { formatCurrency, calculateSplits, billTotal } from '@/lib/calculations';
import { Bill, BillItem, Participant, ItemClaim, GroupWithBills } from '@/types';
import { AvatarInitials } from '@/components/avatar-initials';

interface PersonBalance {
  name: string;
  isCreator: boolean;
  total: number;
  paid: number;
  billCount: number;
}

interface BillDetail extends Bill {
  items: BillItem[];
  participants: Participant[];
  claims: ItemClaim[];
}

export default function GroupPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.id as string;

  const [isLoading, setIsLoading] = useState(true);
  const [group, setGroup] = useState<GroupWithBills | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [balances, setBalances] = useState<PersonBalance[]>([]);

  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [emojiValue, setEmojiValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchGroup = useCallback(async () => {
    try {
      const response = await fetch(`/api/groups/${groupId}`);
      if (response.status === 401) {
        setUnauthorized(true);
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch group');
      const data: GroupWithBills = await response.json();
      setGroup(data);

      // Pull full bill details to compute exact per-person balances
      const details = await Promise.all(
        data.bills.map(async (bill) => {
          const res = await fetch(`/api/bills/${bill.id}`);
          return res.ok ? ((await res.json()) as BillDetail) : null;
        })
      );

      const byName = new Map<string, PersonBalance>();
      for (const detail of details) {
        if (!detail) continue;
        const splits = calculateSplits(detail, detail.items, detail.participants, detail.claims);
        for (const split of splits) {
          const key = split.participant.name.toLowerCase();
          const existing = byName.get(key) || {
            name: split.participant.name,
            isCreator: false,
            total: 0,
            paid: 0,
            billCount: 0,
          };
          existing.total += split.total;
          existing.billCount += 1;
          existing.isCreator = existing.isCreator || split.participant.is_creator;
          if (split.participant.is_creator || split.participant.payment_status === 'paid') {
            existing.paid += split.total;
          }
          byName.set(key, existing);
        }
      }
      setBalances(
        [...byName.values()].sort((a, b) => (b.total - b.paid) - (a.total - a.paid))
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

  const handleRename = async () => {
    if (!renameValue.trim()) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue, emoji: emojiValue }),
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

  if (isLoading) {
    return (
      <main className="min-h-screen py-8">
        <div className="container mx-auto px-4 max-w-2xl flex flex-col justify-center items-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Loading group...</p>
        </div>
      </main>
    );
  }

  if (unauthorized || !group) {
    return (
      <main className="min-h-screen py-8">
        <div className="container mx-auto px-4 max-w-2xl">
          <Card className="shadow-lg">
            <CardContent className="py-12 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">🔒</span>
              </div>
              <h2 className="text-xl font-semibold mb-2">
                {unauthorized ? 'Sign in required' : 'Group not found'}
              </h2>
              <p className="text-muted-foreground mb-6">
                {unauthorized
                  ? 'Groups are tied to your account. Sign in to view this group.'
                  : "This group doesn't exist or belongs to another account."}
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

  return (
    <main className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-2xl">
        <Link href="/" className="inline-flex items-center text-white/40 hover:text-white mb-6 transition-smooth">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Home
        </Link>

        {/* Group Header */}
        <Card className="mb-6 shadow-sm">
          <CardContent className="py-5">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <span className="text-3xl">{group.emoji}</span>
                  {group.name}
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                  {group.bills.length} bill{group.bills.length !== 1 && 's'} ·{' '}
                  {formatCurrency(totalSpend)} total
                  {activeBills.length > 0 && ` · ${activeBills.length} still active`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="transition-smooth hover:scale-105"
                  title="Edit group"
                  onClick={() => {
                    setRenameValue(group.name);
                    setEmojiValue(group.emoji);
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
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Balances */}
        {balances.length > 0 && (
          <Card className="mb-6 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Running balances</CardTitle>
              <CardDescription>
                Totals across every bill in this group. Hosts&apos; own shares count as paid.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {balances.map((person) => {
                const outstanding = person.total - person.paid;
                return (
                  <div
                    key={person.name}
                    className="flex items-center justify-between p-3 rounded-xl bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <AvatarInitials name={person.name} size="md" />
                      <div>
                        <div className="font-medium">
                          {person.name}
                          {person.isCreator && ' ✨'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {person.billCount} bill{person.billCount !== 1 && 's'} ·{' '}
                          {formatCurrency(person.total)} total
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      {outstanding > 0.01 ? (
                        <>
                          <div className="font-bold text-amber-400">{formatCurrency(outstanding)}</div>
                          <div className="text-xs text-muted-foreground">outstanding</div>
                        </>
                      ) : (
                        <div className="inline-flex items-center gap-1 text-green-400 text-sm font-medium">
                          <CheckCircle2 className="h-4 w-4" />
                          Settled up
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

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
                <Label htmlFor="groupEmoji">Emoji</Label>
                <div className="flex flex-wrap gap-2">
                  {['👥', '🏠', '✈️', '🎉', '🍕', '⛺', '💼', '🏖️'].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setEmojiValue(emoji)}
                      className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center border transition-smooth ${
                        emojiValue === emoji
                          ? 'border-primary/60 bg-primary/10'
                          : 'border-white/10 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
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
      </div>
    </main>
  );
}
