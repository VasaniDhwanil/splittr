import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditAgentCall, guardAgentSession, noStore, notFound } from '@/lib/agent-access';
import { APPROVAL_TOOL, DECLINE_OUTCOME, evaluateBreaker } from '@/lib/agent-breaker';
import { findProposal, isBillId } from '@/lib/agent-bills';

/**
 * Deletes the proposal, expired or not. The delete carries the same
 * conditions as approval, so a decline and an approval cannot both win.
 * Declines count toward the circuit breaker.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await guardAgentSession(request);
    if ('response' in guard) return guard.response;
    const { id } = await params;
    if (!isBillId(id)) return notFound();

    // A proposal whose token was revoked looks missing (findProposal says so)
    if (!(await findProposal(guard.user.id, id))) return notFound();

    const { data, error } = await createAdminClient()
      .from('bills')
      .delete()
      .eq('id', id)
      .eq('creator_user_id', guard.user.id)
      .eq('approval_required', true)
      .is('approved_at', null)
      .select('id, agent_token_id');
    if (error) throw new Error('decline failed');

    const declined = data?.[0];
    if (!declined) return notFound();

    await auditAgentCall({ tokenId: declined.agent_token_id, userId: guard.user.id, tool: APPROVAL_TOOL, outcome: DECLINE_OUTCOME });
    await evaluateBreaker(declined.agent_token_id);
    return noStore(NextResponse.json({ ok: true }));
  } catch (error) {
    console.error('Error in agent-bills decline:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
