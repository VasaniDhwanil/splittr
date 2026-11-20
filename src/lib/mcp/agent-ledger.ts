/**
 * Who owes whom, for an agent. Deliberately NOT src/lib/balances.ts: that
 * ledger folds a nameless participant into a group member whose display name
 * matches, which is fine on a screen but lets anyone who types a member's name
 * redirect a debt. Here only rows linked by account count; a name match is
 * reported separately, with no handle.
 */
import { calculateSplits } from '@/lib/calculations';
import type { Bill, BillItem, ItemClaim, Participant } from '@/types';
import type { BillDetail, ParticipantRow } from './authz';

export interface UnverifiedDebt {
  kind: 'guest_owes_you' | 'name_matches_you';
  bill_id: string;
  amount: number;
}

export interface AgentLedger {
  /** Positive: the actor owes this account. Negative: this account owes the actor. Account id -> dollars. */
  net: Map<string, number>;
  unverified: UnverifiedDebt[];
}

export const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** A participant's account: their own, or the bill's creator for a host row without one. */
export function accountOf(participant: ParticipantRow, creatorUserId: string | null): string | null {
  return participant.user_id ?? (participant.is_creator ? creatorUserId : null);
}

export function computeAgentLedger(details: BillDetail[], actorId: string, actorName: string | null): AgentLedger {
  const net = new Map<string, number>();
  const unverified: UnverifiedDebt[] = [];
  const myName = actorName?.trim().toLowerCase() || null;

  for (const { bill, items, participants, claims } of details) {
    if (bill.status === 'settled') continue;
    const creditor = bill.paid_by_user_id ?? bill.creator_user_id;
    if (!creditor) continue;

    const splits = calculateSplits(
      bill as unknown as Bill,
      items as unknown as BillItem[],
      participants as unknown as Participant[],
      claims as unknown as ItemClaim[]
    );

    for (const split of splits) {
      const row = split.participant as unknown as ParticipantRow;
      if (row.payment_status === 'paid') continue;
      // The host fronted the money themselves unless someone else is the payer
      if (!bill.paid_by_user_id && row.is_creator) continue;
      const amount = split.total;
      if (amount <= 0.005) continue;

      const debtor = accountOf(row, bill.creator_user_id);
      if (debtor === creditor) continue;

      if (debtor === null) {
        if (creditor === actorId) {
          unverified.push({ kind: 'guest_owes_you', bill_id: bill.id, amount: cents(amount) });
        } else if (myName && row.name.trim().toLowerCase() === myName) {
          unverified.push({ kind: 'name_matches_you', bill_id: bill.id, amount: cents(amount) });
        }
        continue;
      }

      if (debtor === actorId) net.set(creditor, (net.get(creditor) ?? 0) + amount);
      else if (creditor === actorId) net.set(debtor, (net.get(debtor) ?? 0) - amount);
    }
  }

  return { net, unverified };
}
