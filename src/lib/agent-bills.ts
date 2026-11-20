/**
 * A bill an agent proposed, as its owner sees it. Only the account that owns a
 * proposal gets anything but "not found": no other row, no approved bill and
 * no nonexistent id can be told apart.
 */
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isBillId = (value: string) => UUID_RE.test(value);

export interface Proposal {
  id: string;
  name: string;
  subtotal: number;
  tax: number;
  tip_amount: number;
  split_mode: string;
  created_at: string;
  approval_expires_at: string;
  agent_token_id: string | null;
}

/** The owner's unapproved proposal with this id, expired or not. Null for everything else. */
export async function findProposal(userId: string, id: string): Promise<Proposal | null> {
  if (!isBillId(id)) return null;
  const { data, error } = await createAdminClient()
    .from('bills')
    .select('id, name, subtotal, tax, tip_amount, split_mode, created_at, approval_expires_at, agent_token_id')
    .eq('id', id)
    .eq('creator_user_id', userId)
    .eq('approval_required', true)
    .is('approved_at', null)
    .maybeSingle();
  if (error) throw new Error('proposal read failed');
  return data as Proposal | null;
}

export const isExpired = (proposal: Pick<Proposal, 'approval_expires_at'>) =>
  Date.parse(proposal.approval_expires_at) <= Date.now();
