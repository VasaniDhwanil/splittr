import { Bill, BillItem, Participant, ItemClaim, GroupMember } from '@/types';
import { calculateSplits } from './calculations';

export interface BillDetail extends Bill {
  items: BillItem[];
  participants: Participant[];
  claims: ItemClaim[];
}

export interface PersonRef {
  key: string;
  name: string;
  user_id: string | null;
}

export interface NetBalance {
  counterparty: PersonRef;
  /** positive = you owe them, negative = they owe you */
  amount: number;
}

/**
 * Identity key for a person across bills: their account when known,
 * otherwise their (case-insensitive) name.
 */
export function personKey(userId: string | null | undefined, name: string): string {
  return userId ? `u:${userId}` : `n:${name.trim().toLowerCase()}`;
}

export interface GroupLedger {
  /** debts.get(A)?.get(B) = amount A still owes B across the group's bills */
  debts: Map<string, Map<string, number>>;
  people: Map<string, PersonRef>;
}

/**
 * Build the pairwise debt ledger for a group. Every bill's host fronted the
 * money, so each participant's unpaid share is a debt to that bill's host.
 * Group members joined anonymously on some bills are canonicalized to their
 * account via display-name match.
 */
export function computeGroupLedger(bills: BillDetail[], members: GroupMember[]): GroupLedger {
  const nameToMember = new Map<string, GroupMember>();
  for (const m of members) {
    nameToMember.set(m.display_name.trim().toLowerCase(), m);
  }

  const canonical = (userId: string | null | undefined, name: string): PersonRef => {
    if (userId) {
      const member = members.find((m) => m.user_id === userId);
      return { key: `u:${userId}`, name: member?.display_name ?? name, user_id: userId };
    }
    const member = nameToMember.get(name.trim().toLowerCase());
    if (member) {
      return { key: `u:${member.user_id}`, name: member.display_name, user_id: member.user_id };
    }
    return { key: personKey(null, name), name: name.trim(), user_id: null };
  };

  const debts = new Map<string, Map<string, number>>();
  const people = new Map<string, PersonRef>();

  const addDebt = (from: PersonRef, to: PersonRef, amount: number) => {
    if (amount <= 0.005 || from.key === to.key) return;
    people.set(from.key, from);
    people.set(to.key, to);
    const row = debts.get(from.key) ?? new Map<string, number>();
    row.set(to.key, (row.get(to.key) ?? 0) + amount);
    debts.set(from.key, row);
  };

  for (const bill of bills) {
    if (bill.status === 'settled') continue;
    const host = bill.participants.find((p) => p.is_creator);
    if (!host) continue;
    const creditor = canonical(bill.creator_user_id ?? host.user_id, host.name);

    const splits = calculateSplits(bill, bill.items, bill.participants, bill.claims);
    for (const split of splits) {
      const p = split.participant;
      if (p.is_creator) continue;
      if (p.payment_status === 'paid') continue;
      addDebt(canonical(p.user_id, p.name), creditor, split.total);
    }
  }

  return { debts, people };
}

/** Net the ledger down to one row per counterparty, from `meKey`'s perspective. */
export function netBalancesFor(ledger: GroupLedger, meKey: string): NetBalance[] {
  const totals = new Map<string, number>();

  const myDebts = ledger.debts.get(meKey);
  if (myDebts) {
    for (const [toKey, amount] of myDebts) {
      totals.set(toKey, (totals.get(toKey) ?? 0) + amount);
    }
  }
  for (const [fromKey, row] of ledger.debts) {
    if (fromKey === meKey) continue;
    const owedToMe = row.get(meKey);
    if (owedToMe) {
      totals.set(fromKey, (totals.get(fromKey) ?? 0) - owedToMe);
    }
  }

  return [...totals.entries()]
    .filter(([, amount]) => Math.abs(amount) >= 0.01)
    .map(([key, amount]) => ({ counterparty: ledger.people.get(key)!, amount }))
    .filter((b) => b.counterparty)
    .sort((a, b) => b.amount - a.amount);
}
