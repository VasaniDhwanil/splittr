import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hashAgentToken } from '@/lib/agent-tokens';
import { guardAgentOrigin, notFound } from '@/lib/agent-access';

const SECRET = /^[A-Za-z0-9_-]{43}$/;

/**
 * The "not you?" link in the notification email. It works without a session
 * on purpose: the person following it may be locked out of a compromised
 * account. The secret is 256 random bits; a match revokes all of its owner's
 * live tokens. POST only, so a mail scanner pre-fetching the link does nothing.
 */
export async function POST(request: NextRequest) {
  try {
    const refused = guardAgentOrigin(request);
    if (refused) return refused;

    const body = await request.json().catch(() => null);
    const secret = body && typeof body === 'object' ? body.secret : null;
    if (typeof secret !== 'string' || !SECRET.test(secret)) return notFound();

    const db = createAdminClient();
    const { data: owner } = await db
      .from('agent_tokens')
      .select('user_id')
      .eq('revoke_link_hash', hashAgentToken(secret))
      .limit(1)
      .maybeSingle();
    if (!owner) return notFound();

    const { data, error } = await db
      .from('agent_tokens')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'revoke_link' })
      .eq('user_id', owner.user_id)
      .is('revoked_at', null)
      .select('id');
    if (error) {
      console.error('agent-tokens revoke-link failed:', error.code);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    return NextResponse.json({ revoked: data?.length ?? 0 });
  } catch (error) {
    console.error('Error in agent-tokens revoke-link:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
