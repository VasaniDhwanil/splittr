import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditAgentCall, guardAgentSession, noStore, notFound } from '@/lib/agent-access';
import { APPROVAL_TOOL, APPROVE_OUTCOME } from '@/lib/agent-breaker';
import { findProposal, isBillId, isExpired } from '@/lib/agent-bills';

/**
 * Publishes the bill. One conditional update decides it: the row must be the
 * caller's, still awaiting approval and not expired, so two approvals, or an
 * approval racing a decline, cannot both succeed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await guardAgentSession(request);
    if ('response' in guard) return guard.response;
    const { id } = await params;
    if (!isBillId(id)) return notFound();

    // The token check cannot sit inside the conditional update (PostgREST has no subquery filter);
    // a revoke that lands between this read and the update is ordered after the approval.
    const existing = await findProposal(guard.user.id, id);
    if (!existing) return notFound();

    const now = new Date().toISOString();
    const { data, error } = await createAdminClient()
      .from('bills')
      .update({ approved_at: now })
      .eq('id', id)
      .eq('creator_user_id', guard.user.id)
      .eq('approval_required', true)
      .is('approved_at', null)
      .gt('approval_expires_at', now)
      .select('id, agent_token_id');
    if (error) throw new Error('approve failed');

    const approved = data?.[0];
    if (!approved) {
      // Why it did not take: only the owner's own, unapproved, expired proposal is told so
      const proposal = await findProposal(guard.user.id, id);
      if (proposal && isExpired(proposal)) {
        return noStore(NextResponse.json({ error: 'This proposal expired. Ask your agent to create it again.', code: 'expired' }, { status: 410 }));
      }
      return notFound();
    }

    await auditAgentCall({ tokenId: approved.agent_token_id, userId: guard.user.id, tool: APPROVAL_TOOL, outcome: APPROVE_OUTCOME });
    return noStore(NextResponse.json({ ok: true, bill_id: approved.id }));
  } catch (error) {
    console.error('Error in agent-bills approve:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
