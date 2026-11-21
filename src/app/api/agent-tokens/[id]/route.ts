import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { guardAgentSession, notFound } from '@/lib/agent-access';
import { deleteUnapprovedProposals } from '@/lib/agent-bills';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await guardAgentSession(request);
    if ('response' in guard) return guard.response;
    const { id } = await params;
    if (!UUID.test(id)) return notFound();

    // The owner filter is in the query: someone else's id matches nothing
    const db = createAdminClient();
    const { data, error } = await db
      .from('agent_tokens')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'user' })
      .eq('id', id)
      .eq('user_id', guard.user.id)
      .is('revoked_at', null)
      .select('id');
    if (error) {
      console.error('agent-token revoke failed:', error.code);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if (data && data.length > 0) {
      await deleteUnapprovedProposals(data.map((row) => row.id));
      return NextResponse.json({ ok: true });
    }

    // Already revoked is still a success for its owner
    const { data: own } = await db.from('agent_tokens').select('id').eq('id', id).eq('user_id', guard.user.id).maybeSingle();
    return own ? NextResponse.json({ ok: true }) : notFound();
  } catch (error) {
    console.error('Error in agent-token DELETE:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
