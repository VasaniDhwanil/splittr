import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hashAgentToken } from '@/lib/agent-tokens';
import { guardAgentOrigin, notFound } from '@/lib/agent-access';
import { deleteReplacedGrantProposals, deleteUnapprovedProposals } from '@/lib/agent-bills';

const SECRET = /^[A-Za-z0-9_-]{43}$/;
const LINK_LIFETIME_MS = 30 * 86_400_000;

/**
 * The "not you?" link in the notification email. It works without a session
 * on purpose: the person following it may be locked out of a compromised
 * account. The secret is 256 random bits. It works for 30 days after the
 * token it was sent for was created, then answers 404 like an unknown secret.
 * While valid it revokes ALL of the owner's unrevoked tokens, newer ones
 * included (someone who suspects a break-in wants everything off), and deletes
 * their unapproved proposals. POST only, so a mail scanner pre-fetching the
 * link does nothing.
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
      .select('user_id, created_at')
      .eq('revoke_link_hash', hashAgentToken(secret))
      .limit(1)
      .maybeSingle();
    if (!owner || Date.now() - Date.parse(owner.created_at) > LINK_LIFETIME_MS) return notFound();

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
    await deleteUnapprovedProposals((data ?? []).map((row) => row.id));
    await deleteReplacedGrantProposals(owner.user_id);
    return NextResponse.json({ revoked: data?.length ?? 0 });
  } catch (error) {
    console.error('Error in agent-tokens revoke-link:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
