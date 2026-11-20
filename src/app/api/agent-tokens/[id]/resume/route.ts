import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { guardAgentSession, notFound } from '@/lib/agent-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Clears a suspension. A revoked token stays revoked. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await guardAgentSession(request);
    if ('response' in guard) return guard.response;
    const { id } = await params;
    if (!UUID.test(id)) return notFound();

    const { data, error } = await createAdminClient()
      .from('agent_tokens')
      .update({ suspended_at: null, suspended_reason: null })
      .eq('id', id)
      .eq('user_id', guard.user.id)
      .is('revoked_at', null)
      .select('id');
    if (error) {
      console.error('agent-token resume failed:', error.code);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    return data && data.length > 0 ? NextResponse.json({ ok: true }) : notFound();
  } catch (error) {
    console.error('Error in agent-token resume:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
