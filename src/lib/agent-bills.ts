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
  const proposal = data as Proposal | null;
  if (proposal && (await proposalTokenRevoked(proposal.agent_token_id))) return null;
  return proposal;
}

export const isExpired = (proposal: Pick<Proposal, 'approval_expires_at'>) =>
  Date.parse(proposal.approval_expires_at) <= Date.now();

/**
 * Revoking a token takes its unapproved proposals with it: the owner should
 * not be able to approve something a token they no longer trust proposed.
 * Approved bills are never touched. Called from every place tokens are revoked.
 */
export async function deleteUnapprovedProposals(tokenIds: string[]): Promise<void> {
  if (tokenIds.length === 0) return;
  const { error } = await createAdminClient()
    .from('bills')
    .delete()
    .in('agent_token_id', tokenIds)
    .eq('approval_required', true)
    .is('approved_at', null);
  if (error) throw new Error('proposal cleanup failed');
}

/**
 * A connection that a newer one replaced keeps its proposals (replacement is
 * not distrust). When the owner then revokes everything because they distrust
 * their connections ("revoke all", the "Not you?" link), those go too.
 */
export async function deleteReplacedGrantProposals(userId: string): Promise<void> {
  const { data, error } = await createAdminClient()
    .from('agent_tokens')
    .select('id')
    .eq('user_id', userId)
    .eq('revoked_reason', 'replaced');
  if (error) throw new Error('replaced grant read failed');
  await deleteUnapprovedProposals((data ?? []).map((row) => row.id));
}

/** True when the proposal's token row is revoked: such a proposal is not approvable and looks missing. A deleted token row (pruned after expiry) is not a revocation. */
export async function proposalTokenRevoked(agentTokenId: string | null): Promise<boolean> {
  if (!agentTokenId) return false;
  const { data, error } = await createAdminClient()
    .from('agent_tokens')
    .select('revoked_at, revoked_reason')
    .eq('id', agentTokenId)
    .maybeSingle();
  if (error) throw new Error('token read failed');
  // A connection replaced by a newer one is not distrusted: its proposals stay (docs/specs/mcp-oauth.md A7)
  return data?.revoked_at != null && data.revoked_reason !== 'replaced';
}
