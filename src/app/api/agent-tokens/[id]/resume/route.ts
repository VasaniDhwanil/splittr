import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditAgentCall, guardAgentSession, notFound } from '@/lib/agent-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Clears a suspension. A revoked token stays revoked. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await guardAgentSession(request);
    if ('response' in guard) return guard.response;
    const { id } = await params;
    if (!UUID.test(id)) return notFound();

    const db = createAdminClient();
    const resume = (live: boolean) => {
      const query = db
        .from('agent_tokens')
        .update({ suspended_at: null, suspended_reason: null })
        .eq('id', id)
        .eq('user_id', guard.user.id)
        .is('revoked_at', null);
      // A pending OAuth grant (approved, never redeemed) is not a connection and cannot be resumed
      return (live ? query.or('oauth_status.is.null,oauth_status.eq.live') : query).select('id');
    };
    let { data, error } = await resume(true);
    // Before migration 019 there is no oauth_status column (42703)
    if (error?.code === '42703') ({ data, error } = await resume(false));
    if (error) {
      console.error('agent-token resume failed:', error.code);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if (!data || data.length === 0) return notFound();
    // The circuit breaker counts from here, so one more refusal does not pause the token again at once
    await auditAgentCall({ tokenId: id, userId: guard.user.id, tool: 'token', outcome: 'resumed' });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in agent-token resume:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
